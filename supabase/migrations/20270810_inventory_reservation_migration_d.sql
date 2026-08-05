-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION D
-- ============================================================================
-- وفق التصميم المعتمد: docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md
-- (القسم 15 — الخطوة 4، القسم 7.3، القسم 8.3، القسم 8.4، القسم 8.5)
--
-- خريطة المسارات الحقيقية المعتمدة (قرار تعيين 2026-08-01):
--   الدخول إلى submitted  → governed_submit_order, governed_change_order_status
--   الخروج من submitted   → governed_approve_order (→ approved),
--                           governed_cancel_order (→ cancelled),
--                           governed_change_order_status (أي وجهة أخرى),
--                           governed_return_order_for_revision (→ draft)
--   تعديل محتوى أثناء submitted → governed_supreme_edit_order فقط
--
-- 1. governed_submit_order: فحص سعة قبل الدخول (رفض RESERVATION_REJECT إن
--    تجاوزت السعة المحدودة — BR-RS-03/05) + أحداث RESERVATION_ALLOCATE بعد
--    الدخول (سعة محدودة فقط — القسم 7.3/8.4).
-- 2. governed_approve_order / governed_cancel_order / governed_return_order_for_revision:
--    أحداث RESERVATION_RELEASE عند الخروج من submitted (previous = حجز الطلب، new = 0).
-- 3. governed_change_order_status: RELEASE عند الخروج + فحص سعة/REJECT + ALLOCATE عند الدخول.
-- 4. governed_supreme_edit_order: مزامنة الخصم (استرجاع ORDER_EDIT_RESTORE ← استبدال ←
--    إعادة خصم) لطلب محسوم (BR-RS-08) + أحداث RESERVATION_UPDATE لطلب في submitted +
--    فحص سعة عند الزيادة (REJECT — القسم 8.5).
-- 5. governed_return_order_for_revision: استرجاع بنوع حركة ORDER_REVISION_RESTORE.
--
-- ملاحظة مسجَّلة: governed_create_order و governed_replace_order_contents لا
-- يعملان أبداً على طلب في submitted (إنشاء دائم في draft؛ الاستبدال محصور في
-- draft/returned_for_revision/stock_review) — والقرار 2 (القسم 16.1) يجعل
-- الحجز صفراً خارج submitted → لا يوجد مسار تنفيذ فعلي للحجز فيهما، فلا يُضاف
-- لهما أي رمز حجز (لا سلوك جديد، لا منطق ميت).
--
-- لا RPC عامة جديدة. لا ترحيل بيانات. تُحافظ كل توقيعات الدوال على حالها.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. governed_submit_order — فحص السعة + أحداث الدخول إلى submitted
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_submit_order(uuid, uuid);
DROP FUNCTION IF EXISTS public.governed_submit_order(text, uuid);

CREATE OR REPLACE FUNCTION public.governed_submit_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_is_revision boolean;
  v_creator_identity_type text;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  IF v_old_status NOT IN ('draft', 'returned_for_revision', 'stock_review') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft, returned_for_revision, or stock_review orders can be submitted');
  END IF;

  v_is_revision := EXISTS(
    SELECT 1 FROM public.order_modification_history
    WHERE order_id = p_id AND field_name = 'REVISION_SNAPSHOT'
  );

  IF v_session.identity_type = 'employee' THEN
    IF NOT v_is_revision THEN
      IF NOT public.check_capability(p_token, 'orders.create') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
      END IF;
      IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit');
      END IF;
    ELSE
      SELECT identity_type INTO v_creator_identity_type
      FROM public.identities WHERE id = v_order.created_by;
    END IF;
  END IF;

  -- فحص السعة قبل الدخول إلى submitted (BR-RS-03/05 — القسم 8.5):
  -- عند السعة المحدودة فقط، ولا يشمل الحجز المشتق هذا الطلب بعد (لا يزال غير محجوز).
  FOR v_req_row IN
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT COALESCE(SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)), 0)::integer
    INTO v_requested
    FROM public.order_items oi
    LEFT JOIN public.products pr ON pr.id = oi.product_id
    WHERE oi.order_id = p_id
      AND oi.product_id = v_req_row.product_id;

    v_capacity := public._reservation_capacity(v_req_row.product_id, p_id);

    IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
      INSERT INTO public.inventory_movements
        (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
      VALUES (
        v_req_row.product_id, p_id, v_requested, 'RESERVATION_REJECT',
        'reservation rejected on submission: requested ' || v_requested || ' exceeds capacity ' || v_capacity,
        0, v_requested, v_session.identity_id
      );
      v_rejected := v_rejected || jsonb_build_object(
        'product_id', v_req_row.product_id,
        'requested_quantity', v_requested,
        'available_capacity', v_capacity
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_rejected) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_STOCK',
      'reservations_rejected', v_rejected
    );
  END IF;

  SELECT COALESCE(SUM(total_price), 0) INTO v_product_subtotal
  FROM public.order_items WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total
  FROM public.order_daily_deals WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total
  FROM public.order_flash_offers WHERE order_id = p_id;

  UPDATE public.orders SET
    status = 'submitted',
    submitted_at = now(),
    subtotal = v_product_subtotal + v_deal_total + v_flash_offer_total,
    total_amount = v_product_subtotal + v_deal_total + v_flash_offer_total - COALESCE(discount_amount, 0),
    updated_at = now()
  WHERE id = p_id;

  -- أحداث التخصيص بعد الدخول إلى submitted (سعة محدودة فقط — القسم 7.3/8.4).
  FOR v_req_row IN
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = p_id
  LOOP
    v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
    IF v_reserved > 0 THEN
      v_capacity := public._reservation_capacity(v_req_row.product_id, p_id);
      IF v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, v_reserved, 'RESERVATION_ALLOCATE',
          'reservation allocated on submission',
          0, v_reserved, v_session.identity_id
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, now());

  RETURN jsonb_build_object('success', true, 'status', 'submitted');
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS
  'إرسال الطلب: فحص سعة الحجز (RESERVATION_REJECT) + حدث RESERVATION_ALLOCATE عند الدخول (BR-RS-03/05)';

-- ---------------------------------------------------------------------------
-- 2. governed_approve_order — RESERVATION_RELEASE عند الخروج من submitted
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_approve_order(p_token text, p_id uuid);

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_order record;
  v_deduct_result jsonb;
  v_req_row record;
  v_reserved integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_status := v_order.status;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- تحرير الحجز عند الخروج من submitted (قبل الخصم — يُحتسب من الحالة السابقة).
  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'reservation released on approval',
          v_reserved, 0, v_employee_id
        );
      END IF;
    END LOOP;
  END IF;

  IF v_order.order_inventory_deduction_status = 'approved' THEN
    v_deduct_result := public.governed_inventory_deduct(p_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS
  'اعتماد الطلب: تحرير الحجز (RESERVATION_RELEASE) عند الخروج من submitted + الخصم حسب الإعداد';

-- ---------------------------------------------------------------------------
-- 3. governed_cancel_order — RESERVATION_RELEASE عند الخروج من submitted
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_cancel_order(text, uuid, text);
DROP FUNCTION IF EXISTS public.governed_cancel_order(text, uuid);

CREATE OR REPLACE FUNCTION public.governed_cancel_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_restore_result jsonb;
  v_req_row record;
  v_reserved integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.cancel');

  SELECT status, customer_id, total_amount, payment_method
  INTO v_old_status, v_customer_id, v_total_amount, v_payment_method
  FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status IN ('cancelled', 'delivered', 'collected') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- تحرير الحجز عند الخروج من submitted (قبل الاسترجاع/تغيير الحالة).
  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'reservation released on cancellation',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  v_restore_result := public.governed_inventory_restore(p_id);

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'cancelled', v_employee_id, p_reason, now());

  IF v_payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_cancel_order IS
  'إلغاء الطلب: تحرير الحجز (RESERVATION_RELEASE) عند الخروج من submitted + استرجاع المخزون إن حُسم';

-- ---------------------------------------------------------------------------
-- 4. governed_return_order_for_revision — RESERVATION_RELEASE + استرجاع
--    بنوع حركة ORDER_REVISION_RESTORE
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_return_order_for_revision(uuid, uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid, numeric, numeric, numeric, timestamptz);
DROP FUNCTION IF EXISTS public.governed_return_order_for_revision(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_return_order_for_revision(
  p_token uuid,
  p_id uuid,
  p_reason text DEFAULT NULL::text,
  p_items jsonb DEFAULT NULL::jsonb,
  p_daily_deals jsonb DEFAULT NULL::jsonb,
  p_flash_offers jsonb DEFAULT NULL::jsonb,
  p_tier_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_execution_location_id uuid DEFAULT NULL::uuid,
  p_execution_latitude numeric DEFAULT NULL::numeric,
  p_execution_longitude numeric DEFAULT NULL::numeric,
  p_execution_accuracy_meters numeric DEFAULT NULL::numeric,
  p_execution_captured_at timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_new_revision_number int;
  v_old_items_data jsonb;
  v_old_daily_deals_data jsonb;
  v_old_flash_offers_data jsonb;
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_deal jsonb;
  v_deal_record record;
  v_offer jsonb;
  v_offer_record record;
  v_exec_location_id uuid;
  v_cust_code text;
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;
  v_restore_result jsonb;
  v_req_row record;
  v_reserved integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.manage') AND NOT public.check_capability(p_token, 'orders.approve') THEN
      RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.manage or orders.approve');
    END IF;
  ELSE
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_order.status NOT IN ('submitted', 'approved', 'delivered', 'partially_delivered', 'stock_review') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only submitted, approved, delivered, or stock_review orders can be returned for revision');
  END IF;

  v_old_status := v_order.status;

  -- تحرير الحجز عند الخروج من submitted (قبل الاسترجاع/تغيير الحالة).
  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'reservation released on return for revision',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  v_restore_result := public.governed_inventory_restore(p_id, 'ORDER_REVISION_RESTORE', p_reason);

  -- Snapshot old data
  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_items_data
  FROM (SELECT product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price
        FROM public.order_items WHERE order_id = p_id) sub;

  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_daily_deals_data
  FROM (SELECT deal_id, quantity, fixed_price AS unit_price, total_price
        FROM public.order_daily_deals WHERE order_id = p_id) sub;

  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_flash_offers_data
  FROM (SELECT offer_id, quantity, fixed_price AS unit_price, total_price
        FROM public.order_flash_offers WHERE order_id = p_id) sub;

  -- Retire current prices
  UPDATE public.daily_deals dd SET status = 'active'
  FROM public.order_daily_deals odd WHERE odd.order_id = p_id AND odd.deal_id = dd.id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;

  UPDATE public.flash_offers fo SET status = 'active'
  FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id AND ofo.offer_id = fo.id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;

  -- Location
  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Snapshots
  SELECT c.code, c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
             (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1), '')
  INTO v_cust_code, v_cust_name, v_cust_phone, v_cust_address
  FROM customers c WHERE c.id = v_order.customer_id;

  SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c LEFT JOIN employees e ON e.id = c.owner_id LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = v_order.customer_id;

  SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
  INTO v_sender_name, v_sender_phone, v_sender_address
  FROM employees e LEFT JOIN identities i ON i.id = e.identity_id
  WHERE e.identity_id = v_session.identity_id;

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_new_revision_number
  FROM public.order_modification_history WHERE order_id = p_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items,
    old_daily_deals, new_daily_deals,
    old_flash_offers, new_flash_offers,
    modified_by, reason, modified_at
  ) VALUES (
    p_id, v_new_revision_number, 'REVISION_SNAPSHOT',
    row_to_json(v_order)::text, NULL,
    v_old_items_data,
    (SELECT jsonb_agg(row_to_json(sub_oi))
     FROM (SELECT oi.product_id, pr.product_name, oi.unit_type, oi.unit_quantity,
                  oi.piece_quantity, oi.unit_price, oi.total_price
           FROM public.order_items oi LEFT JOIN public.products pr ON pr.id = oi.product_id
           WHERE oi.order_id = p_id) sub_oi),
    v_old_daily_deals_data,
    (SELECT jsonb_agg(row_to_json(sub_odd))
     FROM (SELECT odd.deal_id, odd.quantity, odd.fixed_price AS unit_price, odd.total_price
           FROM public.order_daily_deals odd WHERE odd.order_id = p_id) sub_odd),
    v_old_flash_offers_data,
    (SELECT jsonb_agg(row_to_json(sub_fo))
     FROM (SELECT ofo.offer_id, ofo.quantity, ofo.fixed_price AS unit_price, ofo.total_price
           FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id) sub_fo),
    v_session.identity_id, p_reason, now()
  );

  -- Replace items if provided
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    DELETE FROM public.order_items WHERE order_id = p_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      SELECT id, carton_price, carton_quantity INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_item->>'product_id')::uuid);
      END IF;
      v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type');
      IF v_calculated_unit_price IS NULL THEN
        RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || (v_item->>'product_id')::uuid);
      END IF;
      v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2);
      INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
      VALUES (p_id, (v_item->>'product_id')::uuid, v_item->>'unit_type', (v_item->>'unit_quantity')::int,
        COALESCE((v_item->>'piece_quantity')::int, 0), v_calculated_unit_price, v_calculated_total_price);
    END LOOP;
  END IF;

  IF p_daily_deals IS NOT NULL AND jsonb_array_length(p_daily_deals) > 0 THEN
    FOR v_deal IN SELECT * FROM jsonb_array_elements(p_daily_deals) LOOP
      SELECT id, fixed_price INTO v_deal_record FROM public.daily_deals WHERE id = (v_deal->>'deal_id')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'DAILY_DEAL_NOT_FOUND'); END IF;
      INSERT INTO public.order_daily_deals (order_id, deal_id, quantity, unit_price, total_price)
      VALUES (p_id, v_deal_record.id, 1, v_deal_record.fixed_price, v_deal_record.fixed_price);
    END LOOP;
  END IF;

  IF p_flash_offers IS NOT NULL AND jsonb_array_length(p_flash_offers) > 0 THEN
    FOR v_offer IN SELECT * FROM jsonb_array_elements(p_flash_offers) LOOP
      SELECT id, fixed_price INTO v_offer_record FROM public.flash_offers WHERE id = (v_offer->>'offer_id')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'FLASH_OFFER_NOT_FOUND'); END IF;
      INSERT INTO public.order_flash_offers (order_id, offer_id, quantity, unit_price, total_price)
      VALUES (p_id, v_offer_record.id, 1, v_offer_record.fixed_price, v_offer_record.fixed_price);
    END LOOP;
  END IF;

  UPDATE public.orders SET
    status = 'draft', revision_number = v_new_revision_number, last_revised_at = now(),
    tier_id = COALESCE(p_tier_id, tier_id), notes = COALESCE(p_notes, notes),
    execution_location_id = COALESCE(v_exec_location_id, execution_location_id),
    execution_latitude = COALESCE(p_execution_latitude, execution_latitude),
    execution_longitude = COALESCE(p_execution_longitude, execution_longitude),
    execution_accuracy_meters = COALESCE(p_execution_accuracy_meters, execution_accuracy_meters),
    execution_captured_at = COALESCE(p_execution_captured_at, execution_captured_at),
    snapshot_customer_code = v_cust_code, snapshot_customer_name = v_cust_name,
    snapshot_customer_phone = v_cust_phone, snapshot_customer_address = v_cust_address,
    snapshot_owner_name = v_owner_name, snapshot_owner_phone = v_owner_phone,
    snapshot_owner_address = v_owner_address, snapshot_sender_name = v_sender_name,
    snapshot_sender_phone = v_sender_phone, snapshot_sender_address = v_sender_address,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'draft', v_session.identity_id, p_reason);

  RETURN jsonb_build_object('success', true, 'revision_number', v_new_revision_number);
END;
$$;

COMMENT ON FUNCTION public.governed_return_order_for_revision IS
  'الإعادة للمراجعة: تحرير الحجز (RESERVATION_RELEASE) + استرجاع بنوع ORDER_REVISION_RESTORE';

-- ---------------------------------------------------------------------------
-- 5. governed_change_order_status — RELEASE عند الخروج، فحص سعة/REJECT + ALLOCATE عند الدخول
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_change_order_status(text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token text,
  p_order_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL::text,
  p_reference_number text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  v_order record;
  v_deduct_result jsonb;
  v_restore_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_rejected jsonb := '[]'::jsonb;
  statuses text[] := ARRAY[
    'draft','submitted','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','deferred','cancelled',
    'delivered','stock_review'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1576)||chr(1606)||chr(1601)||chr(1587)||' '||chr(1575)||chr(1604)||chr(1581)||chr(1575)||chr(1604)||chr(1577));
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1594)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
    END IF;
  END IF;

  -- تحرير الحجز عند الخروج من submitted (قبل أي خصم/تغيير حالة).
  IF v_current_status = 'submitted' AND p_new_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, -v_reserved, 'RESERVATION_RELEASE',
          'reservation released on status change from submitted to ' || p_new_status,
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- فحص السعة قبل الدخول إلى submitted (BR-RS-03/05).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      SELECT COALESCE(SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)), 0)::integer
      INTO v_requested
      FROM public.order_items oi
      LEFT JOIN public.products pr ON pr.id = oi.product_id
      WHERE oi.order_id = p_order_id
        AND oi.product_id = v_req_row.product_id;

      v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_REJECT',
          'reservation rejected on entering submitted: requested ' || v_requested || ' exceeds capacity ' || v_capacity,
          0, v_requested, v_session.identity_id
        );
        v_rejected := v_rejected || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(v_rejected) > 0 THEN
      RETURN json_build_object(
        'success', false,
        'error', 'INSUFFICIENT_STOCK',
        'reservations_rejected', v_rejected
      );
    END IF;
  END IF;

  -- Inventory management
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Case 1: Transitioning TO deduction status → attempt deduct
    IF v_order.order_inventory_deduction_status = p_new_status
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    -- Case 2: Transitioning TO cancelled → restore if previously deducted
    IF p_new_status = 'cancelled' THEN
      v_restore_result := public.governed_inventory_restore(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    reference_number = CASE
      WHEN v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN trim(p_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  -- حدث التخصيص بعد الدخول إلى submitted (سعة محدودة فقط).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);
        IF v_capacity IS NOT NULL THEN
          INSERT INTO public.inventory_movements
            (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
          VALUES (
            v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
            'reservation allocated on entering submitted',
            0, v_reserved, v_session.identity_id
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$$;

COMMENT ON FUNCTION public.governed_change_order_status IS
  'تغيير حالة الطلب: أحداث RESERVATION_RELEASE/ALLOCATE/REJECT حول submitted + الخصم/الاسترجاع حسب الإعداد';

-- ---------------------------------------------------------------------------
-- 6. governed_supreme_edit_order — مزامنة الخصم (BR-RS-08) + أحداث الحجز
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_supreme_edit_order(text, uuid, jsonb, text, numeric, text, varchar);

CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(
  p_token text,
  p_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_discount_amount decimal(12,2) DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_type varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item jsonb;
  v_product record;
  v_subtotal decimal(12,2);
  v_discount_amount decimal(12,2);
  v_total decimal(12,2);
  v_is_super boolean;
  v_order_status text;
  v_was_deducted boolean;
  v_old_res_map jsonb := '{}'::jsonb;
  v_restore_map jsonb := '{}'::jsonb;
  v_req_row record;
  v_restore_item jsonb;
  v_requested integer;
  v_capacity integer;
  v_available integer;
  v_prev integer;
  v_new integer;
  v_key text;
  v_actor_id uuid;
  v_restore_result jsonb;
  v_deduct_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_actor_id := v_session.identity_id;
  v_order_status := v_order.status;
  v_was_deducted := v_order.inventory_deducted_at IS NOT NULL;

  -- خريطة الحجز القديم لكل منتج (النموذج المشتق — قبل أي تغيير).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_old_res_map := v_old_res_map || jsonb_build_object(
        v_req_row.product_id::text,
        public._reserved_quantity_for_order(v_req_row.product_id, p_order_id)
      );
    END LOOP;
  END IF;

  -- خريطة المبالغ المستردة من الخصم السابق (للتحقق المسبق من الرصيد بعد الاسترجاع).
  IF v_was_deducted THEN
    FOR v_restore_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
    LOOP
      v_restore_map := v_restore_map || jsonb_build_object(
        v_restore_item->>'product_id',
        COALESCE((v_restore_item->>'piece_quantity')::integer, 0)
      );
    END LOOP;
  END IF;

  -- تحقق مسبق من الرصيد لطلب محسوم ستُعاد خصمه بعد الاسترجاع (يماثل فحص الخصم الفعلي).
  IF v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_req_row.product_id;

      IF NOT FOUND THEN v_available := 0; END IF;

      v_available := v_available
        + COALESCE((v_restore_map->>v_req_row.product_id::text)::integer, 0);

      IF v_available < v_req_row.total_requested THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'shortages', jsonb_build_array(jsonb_build_object(
            'product_id', v_req_row.product_id,
            'requested_quantity', v_req_row.total_requested,
            'available_quantity', v_available
          ))
        );
      END IF;
    END LOOP;
  END IF;

  -- فحص سعة الحجز لطلب في submitted عند زيادة المحتوى (BR-RS-03 — القسم 8.5).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);
      IF v_capacity IS NOT NULL AND v_req_row.total_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_req_row.total_requested, 'RESERVATION_REJECT',
          'reservation rejected on supreme edit: requested ' || v_req_row.total_requested || ' exceeds capacity ' || v_capacity,
          COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0),
          v_req_row.total_requested,
          v_actor_id
        );
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'reservations_rejected', jsonb_build_array(jsonb_build_object(
            'product_id', v_req_row.product_id,
            'requested_quantity', v_req_row.total_requested,
            'available_capacity', v_capacity
          ))
        );
      END IF;
    END LOOP;
  END IF;

  -- استرجاع الخصم القديم قبل استبدال المحتوى (BR-RS-08 — القسم 8.3).
  IF v_was_deducted THEN
    v_restore_result := public.governed_inventory_restore(
      p_order_id, 'ORDER_EDIT_RESTORE', COALESCE(p_reason, 'Supreme Management edit')
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND', 'detail', 'Product ' || (v_item->>'product_id'));
    END IF;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_order_id, (v_item->>'product_id')::uuid, v_item->>'unit_type',
      (v_item->>'unit_quantity')::int, COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- أحداث RESERVATION_UPDATE لطلب في submitted (لم يُعَد خصمه في نفس العملية).
  IF v_order_status = 'submitted'
     AND NOT (v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status) THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_new := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_prev := COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0);
      IF v_prev <> v_new THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_new - v_prev, 'RESERVATION_UPDATE',
          'reservation updated on supreme edit',
          v_prev, v_new, v_actor_id
        );
      END IF;
    END LOOP;

    -- منتجات أُزيلت من الطلب: حجزها القديم يتلاشى (previous → 0).
    FOR v_key IN SELECT jsonb_object_keys(v_old_res_map)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = p_order_id AND product_id = v_key::uuid
      ) THEN
        v_prev := (v_old_res_map->>v_key)::integer;
        IF v_prev > 0 THEN
          INSERT INTO public.inventory_movements
            (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
          VALUES (
            v_key::uuid, p_order_id, -v_prev, 'RESERVATION_UPDATE',
            'reservation released on product removal via supreme edit',
            v_prev, 0, v_actor_id
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- إعادة خصم المحتوى الجديد إن كان الطلب وصل/تجاوز نقطة الخصم (BR-RS-08).
  IF v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status THEN
    v_deduct_result := public.governed_inventory_deduct(p_order_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'supreme_edit',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount, 'notes', v_order.notes)::text,
    jsonb_build_object('subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total, 'notes', COALESCE(p_notes, v_order.notes))::text,
    v_old_items, v_new_items, v_session.identity_id, COALESCE(p_reason, 'Supreme Management edit'), now()
  );

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.governed_supreme_edit_order IS
  'تعديل أعلى إدارة: مزامنة الخصم (ORDER_EDIT_RESTORE ← استبدال ← إعادة خصم) + أحداث RESERVATION_UPDATE/REJECT لطلب في submitted';

-- ============================================================================
-- END OF MIGRATION D
-- ============================================================================
