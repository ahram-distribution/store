-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION F
-- ============================================================================
-- وفق قرارات مراجعة الأعمال المعتمدة (Business Review — 2026-08-01):
--   • BR-RS-03/05 تعديل: «الحجز لا يمنع إنشاء/إرسال الطلب» — قبول الطلب دائماً
--     مع إشعار، والتخصيص النهائي + التقليص التلقائي عند الاعتماد فقط.
--   • BR-VIS-01 تعديل: رسائل الأعمال بلغة المتاجر بالوحدات المختلطة
--     (كرتون + قطعة / دستة + قطعة) مع تفعيل الحجز.
--   • BR-AUD-01 تعديل: سجل الأحداث بلغة أعمال عربية صريحة.
--
-- التغييرات في هذه الخطوة (F):
--   1. دالة داخلية _requested_quantity_for_order (الكمية المطلوبة بالقطع لطلب/منتج).
--   2. دالة داخلية _apply_fcfs_allocation (التخصيص FCFS + التقليص التلقائي عند الاعتماد).
--   3. governed_submit_order / governed_change_order_status:
--      — إلغاء رفض RESERVATION_REJECT عند تجاوز السعة (لا حجب للإرسال).
--      — حدث RESERVATION_NOTICE بإشعار الأعمال المعتمد + قائمة reservations_notice.
--      — أسباب أحداث التخصيص بلغة عربية.
--   4. governed_approve_order:
--      — التخصيص FCFS والتقليص التلقائي (ORDER_ALLOCATION_TRIM) قبل الاعتماد.
--      — سبب تحرير الحجز بالعربية.
--   5. governed_cancel_order / governed_return_order_for_revision:
--      — أسباب تحرير الحجز بالعربية (السلوك كما هو).
--   6. governed_supreme_edit_order:
--      — استبدال رفض السعة بـ RESERVATION_NOTICE (عدم الحجب) + أسباب عربية.
--   7. governed_inventory_deduct / governed_inventory_restore:
--      — أسباب حركات الخصم/الاسترجاع بالعربية (BR-AUD-01).
--   8. governed_check_product_availability_v2:
--      — إضافة max_allowed_pieces (السعة بالقطع) + carton_quantity (BR-VIS-01).
--   9. governed_get_order_inventory_snapshot:
--      — إضافة carton_quantity + reservation_status لكل منتج (BR-VIS-02).
--
-- لا جداول جديدة، لا ترحيل بيانات، لا تغيير لتوقيعات أي RPC عامة قائمة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. _requested_quantity_for_order — الكمية المطلوبة بالقطع (دون شرط الحالة)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._requested_quantity_for_order(
  p_product_id uuid,
  p_order_id   uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_requested integer;
BEGIN
  IF p_product_id IS NULL OR p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)), 0)
  INTO v_requested
  FROM public.order_items oi
  LEFT JOIN public.products pr ON pr.id = oi.product_id
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p_product_id;

  RETURN v_requested;
END;
$$;

COMMENT ON FUNCTION public._requested_quantity_for_order IS
  'الكمية المطلوبة لمنتج في طلب (قطع) — دون اشتراط حالة الطلب (BR-SU-01/02)';

-- ---------------------------------------------------------------------------
-- 2. _apply_fcfs_allocation — التخصيص FCFS + التقليص التلقائي عند الاعتماد
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._apply_fcfs_allocation(
  p_order_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_req record;
  v_product_id uuid;
  v_requested integer;
  v_allocated integer;
  v_stock integer;
  v_remaining integer;
  v_need integer;
  v_unit_pieces integer;
  v_alloc_this integer;
  v_queue record;
  v_line record;
  v_delta integer;
  v_units_to_remove integer;
  v_trim_pieces integer;
  v_total_trimmed integer := 0;
  v_trimmed jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- التخصيص الفعلي يُطبَّق فقط على طلب في submitted لم يُخصم بعد.
  IF v_order.status <> 'submitted' OR v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_allocate', true);
  END IF;

  -- سعة غير محدودة (البيع بالسالب مفعَّل للطلب) → لا تقليص.
  IF COALESCE(v_order.order_negative_selling_allowed, false) THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_allocate', true, 'unlimited', true);
  END IF;

  FOR v_req IN
    SELECT oi.product_id, SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)) AS total_quantity
    FROM public.order_items oi
    LEFT JOIN public.products pr ON pr.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
  LOOP
    v_product_id := v_req.product_id;
    v_requested := v_req.total_quantity;

    -- قفل سطر المخزون (منع سباقات الاعتماد المتزامن على نفس المنتج).
    SELECT quantity INTO v_stock
    FROM public.inventory
    WHERE product_id = v_product_id
    FOR UPDATE;
    IF NOT FOUND THEN v_stock := 0; END IF;
    IF v_stock IS NULL THEN v_stock := 0; END IF;

    -- نصيب FCFS للطلب — نفس الخوارزمية الجشعة في اللقطة الإدارية (القسم 5.2).
    v_remaining := v_stock;
    v_allocated := 0;
    FOR v_queue IN
      SELECT o.id
      FROM public.orders o
      WHERE o.status = 'submitted'
        AND o.inventory_deducted_at IS NULL
      ORDER BY o.submitted_at ASC, o.created_at ASC, o.id ASC
    LOOP
      v_need := public._reserved_quantity_for_order(v_product_id, v_queue.id);
      IF v_need = 0 THEN CONTINUE; END IF;

      -- وحدة بيع هذا الطلب (أول سطر للمنتج) — تقريب لأسفل لوحدات كاملة.
      SELECT public._to_pieces(oi.unit_type, 1, pr.carton_quantity)
      INTO v_unit_pieces
      FROM public.order_items oi
      LEFT JOIN public.products pr ON pr.id = oi.product_id
      WHERE oi.order_id = v_queue.id
        AND oi.product_id = v_product_id
      LIMIT 1;
      IF v_unit_pieces IS NULL OR v_unit_pieces <= 0 THEN v_unit_pieces := 1; END IF;

      v_alloc_this := LEAST(v_need, v_remaining);
      v_alloc_this := (v_alloc_this / v_unit_pieces) * v_unit_pieces;

      IF v_queue.id = p_order_id THEN
        v_allocated := v_alloc_this;
      END IF;
      v_remaining := v_remaining - v_alloc_this;
    END LOOP;

    IF v_allocated >= v_requested THEN
      CONTINUE; -- التخصيص كامل — لا تقليص.
    END IF;

    -- تقليص أسطر الطلب إلى نصيب FCFS (وحدات بيع كاملة — الأكبر أولاً).
    v_delta := v_requested - v_allocated;
    v_trim_pieces := 0;
    FOR v_line IN
      SELECT oi.id, oi.unit_type, oi.unit_quantity, oi.unit_price,
             public._to_pieces(oi.unit_type, 1, pr.carton_quantity) AS unit_pieces,
             pr.carton_quantity AS carton_quantity
      FROM public.order_items oi
      LEFT JOIN public.products pr ON pr.id = oi.product_id
      WHERE oi.order_id = p_order_id AND oi.product_id = v_product_id
      ORDER BY CASE oi.unit_type WHEN 'carton' THEN 0 WHEN 'dozen' THEN 1 ELSE 2 END ASC, oi.id ASC
    LOOP
      IF v_delta <= 0 THEN EXIT; END IF;
      v_unit_pieces := GREATEST(v_line.unit_pieces, 1);
      v_units_to_remove := LEAST(v_line.unit_quantity, v_delta / v_unit_pieces);
      IF v_units_to_remove <= 0 THEN CONTINUE; END IF;

      IF v_units_to_remove >= v_line.unit_quantity THEN
        -- السطر يُحذف بالكامل (CHECK يتطلب unit_quantity>0 و piece_quantity>0).
        DELETE FROM public.order_items WHERE id = v_line.id;
      ELSE
        UPDATE public.order_items
        SET unit_quantity = unit_quantity - v_units_to_remove,
            piece_quantity = public._to_pieces(unit_type, unit_quantity - v_units_to_remove, v_line.carton_quantity),
            total_price = ROUND((unit_price * (unit_quantity - v_units_to_remove))::numeric, 2)
        WHERE id = v_line.id;
      END IF;

      v_delta := v_delta - (v_units_to_remove * v_unit_pieces);
      v_trim_pieces := v_trim_pieces + (v_units_to_remove * v_unit_pieces);
    END LOOP;

    IF v_trim_pieces > 0 THEN
      v_total_trimmed := v_total_trimmed + v_trim_pieces;
      v_trimmed := v_trimmed || jsonb_build_object(
        'product_id', v_product_id,
        'requested_quantity', v_requested,
        'allocated_quantity', v_allocated,
        'trimmed_quantity', v_trim_pieces
      );
      IF p_actor_id IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_product_id, p_order_id, -v_trim_pieces, 'ORDER_ALLOCATION_TRIM',
          'تم تقليل الكمية تلقائيًا عند الاعتماد بسبب أولوية الحجز حسب تاريخ التقديم.',
          v_requested, v_allocated, p_actor_id
        );
      END IF;
    END IF;
  END LOOP;

  -- إعادة حساب الإجماليات بعد التقليص.
  IF v_total_trimmed > 0 THEN
    UPDATE public.orders
    SET subtotal = COALESCE((SELECT SUM(total_price) FROM public.order_items WHERE order_id = p_order_id), 0)
                 + COALESCE((SELECT SUM(total_price) FROM public.order_daily_deals WHERE order_id = p_order_id), 0)
                 + COALESCE((SELECT SUM(total_price) FROM public.order_flash_offers WHERE order_id = p_order_id), 0),
        updated_at = now()
    WHERE id = p_order_id;

    UPDATE public.orders
    SET total_amount = GREATEST(subtotal - COALESCE(discount_amount, 0), 0),
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'trimmed_products', jsonb_array_length(v_trimmed),
    'trimmed_pieces', v_total_trimmed,
    'details', v_trimmed
  );
END;
$$;

COMMENT ON FUNCTION public._apply_fcfs_allocation IS
  'التخصيص FCFS + التقليص التلقائي لكميات الطلب عند الاعتماد (وحدات بيع كاملة — BR-AL-01)';

-- ---------------------------------------------------------------------------
-- 3. governed_submit_order — لا رفض عند تجاوز السعة: إشعار فقط (BR-RS-03/05)
-- ---------------------------------------------------------------------------

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
  v_notices jsonb := '[]'::jsonb;
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

  -- بعد الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  FOR v_req_row IN
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = p_id
  LOOP
    v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_id);
    v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
    v_capacity  := public._reservation_capacity(v_req_row.product_id, p_id);

    -- تخصيص الحجز (سعة محدودة فقط).
    IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
      INSERT INTO public.inventory_movements
        (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
      VALUES (
        v_req_row.product_id, p_id, v_reserved, 'RESERVATION_ALLOCATE',
        'تم حجز الكمية لهذا الصنف.',
        0, v_reserved, v_session.identity_id
      );
    END IF;

    -- تجاوز السعة: قبول مع إشعار (لا رفض — BR-RS-03/05).
    IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
      INSERT INTO public.inventory_movements
        (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
      VALUES (
        v_req_row.product_id, p_id, v_requested, 'RESERVATION_NOTICE',
        'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.',
        0, v_requested, v_session.identity_id
      );
      v_notices := v_notices || jsonb_build_object(
        'product_id', v_req_row.product_id,
        'requested_quantity', v_requested,
        'available_capacity', v_capacity
      );
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, now());

  RETURN jsonb_build_object(
    'success', true,
    'status', 'submitted',
    'reservations_notice', v_notices
  );
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS
  'إرسال الطلب: حجز (RESERVATION_ALLOCATE) + إشعار عند تجاوز السعة (RESERVATION_NOTICE) دون رفض (BR-RS-03/05)';

-- ---------------------------------------------------------------------------
-- 4. governed_approve_order — تخصيص FCFS + تقليص تلقائي + تحرير الحجز + الخصم
-- ---------------------------------------------------------------------------

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
  v_alloc_result jsonb;
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

  -- التخصيص الفعلي FCFS + التقليص التلقائي عند الاعتماد (قبل تحرير الحجز).
  IF v_old_status = 'submitted' THEN
    v_alloc_result := public._apply_fcfs_allocation(p_id, v_employee_id);

    -- تحرير الحجز عند الخروج من submitted (بعد التقليص — يُحتسب من الكمية الفعلية).
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
          'تم اعتماد الفاتورة وتم تحرير حجز الكمية.',
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

  RETURN jsonb_build_object('success', true, 'allocation', v_alloc_result);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS
  'اعتماد الطلب: التخصيص FCFS + التقليص التلقائي (ORDER_ALLOCATION_TRIM) ثم تحرير الحجز ثم الخصم حسب الإعداد';

-- ---------------------------------------------------------------------------
-- 5. governed_cancel_order — تحرير الحجز عند الخروج من submitted (سبب عربي)
-- ---------------------------------------------------------------------------

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

  v_employee_id := v_session.identity_id;

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
          'تم إلغاء الفاتورة وتم تحرير حجز الكمية.',
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
-- 6. governed_return_order_for_revision — تحرير الحجز (سبب عربي) + استرجاع
-- ---------------------------------------------------------------------------

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
          'تمت إعادة الفاتورة للمراجعة وتم تحرير حجز الكمية.',
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
-- 7. governed_change_order_status — لا رفض عند الدخول إلى submitted + تقليص عند الاعتماد
-- ---------------------------------------------------------------------------

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
  v_alloc_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_notices jsonb := '[]'::jsonb;
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

  -- التخصيص الفعلي FCFS + التقليص التلقائي عند الاعتماد (قبل تحرير الحجز).
  IF p_new_status = 'approved' AND v_current_status = 'submitted' THEN
    v_alloc_result := public._apply_fcfs_allocation(p_order_id, v_session.identity_id);
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
          'تم تغيير حالة الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_order_id);
      v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_capacity  := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
          'تم حجز الكمية لهذا الصنف.',
          0, v_reserved, v_session.identity_id
        );
      END IF;

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.',
          0, v_requested, v_session.identity_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
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

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'reservations_notice', v_notices
  );
END;
$$;

COMMENT ON FUNCTION public.governed_change_order_status IS
  'تغيير حالة الطلب: أحداث RESERVATION_ALLOCATE/NOTICE حول submitted (لا رفض) + تقليص عند الاعتماد + الخصم/الاسترجاع';

-- ---------------------------------------------------------------------------
-- 8. governed_supreme_edit_order — لا رفض عند تجاوز السعة (إشعار) + أسباب عربية
-- ---------------------------------------------------------------------------

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
  v_notices jsonb := '[]'::jsonb;
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

  -- طلب في submitted مع تجاوز سعة الحجز عند زيادة المحتوى: إشعار فقط (لا رفض — BR-RS-03/05).
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
          v_req_row.product_id, p_order_id, v_req_row.total_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.',
          COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0),
          v_req_row.total_requested,
          v_actor_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_req_row.total_requested,
          'available_capacity', v_capacity
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
          'تم تعديل كمية الحجز بعد تعديل الفاتورة.',
          v_prev, v_new, v_actor_id
        );
      END IF;
    END LOOP;

    -- منتجات أُزيلت من الطلب: حجزها القديم يتلاشى (previous → 0).
    FOR v_key IN SELECT key FROM jsonb_object_keys(v_old_res_map)
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
            'تم تحرير حجز الصنف المحذوف من الفاتورة.',
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
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total,
    'reservations_notice', v_notices
  );
END;
$$;

COMMENT ON FUNCTION public.governed_supreme_edit_order IS
  'تعديل أعلى إدارة: مزامنة الخصم (ORDER_EDIT_RESTORE ← استبدال ← إعادة خصم) + أحداث RESERVATION_UPDATE/NOTICE لطلب في submitted';

-- ---------------------------------------------------------------------------
-- 9. governed_inventory_deduct — سبب حركة الخصم بالعربية (BR-AUD-01)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_inventory_deduct(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_prev_quantity integer;
  v_new_quantity integer;
  v_shortages jsonb := '[]'::jsonb;
  v_deducted_items jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', true);
  END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  WITH combined AS (
    SELECT oi.product_id, SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)) AS total_qty
    FROM public.order_items oi
    LEFT JOIN public.products pr ON pr.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    UNION ALL
    SELECT di.product_id, SUM(di.quantity * odd.quantity)
    FROM public.order_daily_deals odd
    JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
    WHERE odd.order_id = p_order_id
    GROUP BY di.product_id
    UNION ALL
    SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)
    FROM public.order_flash_offers ofo
    JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
    WHERE ofo.order_id = p_order_id
    GROUP BY foi.product_id
  ),
  aggregated AS (
    SELECT product_id, SUM(total_qty) AS total_quantity
    FROM combined
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object('product_id', product_id, 'total_quantity', total_quantity)
  ) INTO v_requirements
  FROM aggregated;

  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    UPDATE public.orders
    SET inventory_deducted_at = now(),
        inventory_deducted_items = '[]'::jsonb,
        updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'deducted', true, 'item_count', 0);
  END IF;

  -- Phase 1: Lock and validate
  IF NOT v_negative_selling THEN
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;

      IF FOUND AND v_available < (v_req.value->>'total_quantity')::integer THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_req.value->>'product_id',
          'requested_quantity', (v_req.value->>'total_quantity')::integer,
          'available_quantity', v_available
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(v_shortages) > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_STOCK',
        'shortages', v_shortages
      );
    END IF;
  ELSE
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      PERFORM FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;
    END LOOP;
  END IF;

  -- Phase 2: Deduct + audit (previous/new/reason)
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    SELECT quantity INTO v_prev_quantity
    FROM public.inventory
    WHERE product_id = (v_req.value->>'product_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN v_prev_quantity := 0; END IF;
    v_new_quantity := v_prev_quantity - (v_req.value->>'total_quantity')::integer;

    UPDATE public.inventory
    SET quantity = v_new_quantity,
        updated_at = now()
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
    VALUES (
      (v_req.value->>'product_id')::uuid,
      p_order_id,
      -((v_req.value->>'total_quantity')::integer),
      'ORDER_DEDUCTION',
      'تم خصم الكمية من المخزون تلقائيًا.',
      v_prev_quantity,
      v_new_quantity,
      v_order.created_by
    );

    v_deducted_items := v_deducted_items || jsonb_build_object(
      'product_id', v_req.value->>'product_id',
      'piece_quantity', (v_req.value->>'total_quantity')::integer
    );
  END LOOP;

  UPDATE public.orders
  SET inventory_deducted_at = now(),
      inventory_deducted_items = v_deducted_items,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'deducted', true,
    'item_count', jsonb_array_length(v_deducted_items)
  );
END;
$$;

COMMENT ON FUNCTION public.governed_inventory_deduct IS
  'خصم مخزون الطلب مرة واحدة فقط (exactly-once) — تحويل موحد _to_pieces + تدقيق قبل/بعد (BR-AUD-01)';

-- ---------------------------------------------------------------------------
-- 10. governed_inventory_restore — أسباب الاسترجاع الافتراضية بالعربية (BR-AUD-01)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_inventory_restore(
  p_order_id uuid,
  p_movement_type varchar(50) DEFAULT 'ORDER_CANCELLATION_RESTORE',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_prev_quantity integer;
  v_new_quantity integer;
  v_restored_count integer := 0;
  v_actor_id uuid;
  v_movement_type varchar(50);
  v_reason text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NULL OR v_order.inventory_deducted_items IS NULL THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_restore', true);
  END IF;

  v_movement_type := COALESCE(p_movement_type, 'ORDER_CANCELLATION_RESTORE');
  v_reason := COALESCE(
    p_reason,
    CASE v_movement_type
      WHEN 'ORDER_CANCELLATION_RESTORE' THEN 'تم إلغاء الفاتورة وتم استرجاع الكمية إلى المخزون.'
      WHEN 'ORDER_REVISION_RESTORE' THEN 'تمت إعادة الفاتورة للمراجعة وتم استرجاع الكمية إلى المخزون.'
      WHEN 'ORDER_EDIT_RESTORE' THEN 'تم تعديل الفاتورة وتم استرجاع الكمية إلى المخزون.'
      ELSE 'تم استرجاع الكمية إلى المخزون.'
    END
  );
  v_actor_id := v_order.created_by;

  -- Phase 1: Lock all inventory rows (منع السباقات المتزامنة)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
  LOOP
    PERFORM FROM public.inventory
    WHERE product_id = (v_item->>'product_id')::uuid
    FOR UPDATE;
  END LOOP;

  -- Phase 2: Restore all (now safely locked) + audit
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'piece_quantity')::integer;

    SELECT quantity INTO v_prev_quantity
    FROM public.inventory
    WHERE product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN v_prev_quantity := 0; END IF;
    v_new_quantity := v_prev_quantity + v_quantity;

    UPDATE public.inventory
    SET quantity = v_new_quantity,
        updated_at = now()
    WHERE product_id = v_product_id;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
    VALUES (v_product_id, p_order_id, v_quantity, v_movement_type, v_reason, v_prev_quantity, v_new_quantity, v_actor_id);

    v_restored_count := v_restored_count + 1;
  END LOOP;

  -- Clear deducted marker (idempotency: next call returns nothing_to_restore)
  UPDATE public.orders
  SET inventory_deducted_at = NULL,
      inventory_deducted_items = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'restored', true,
    'item_count', v_restored_count
  );
END;
$$;

COMMENT ON FUNCTION public.governed_inventory_restore IS
  'استرداد كامل لتأثير المخزون للطلب (مرة واحدة فقط) — مع القفل والتسجيل ونوع الحركة (BR-AUD-01)';

-- ---------------------------------------------------------------------------
-- 11. governed_check_product_availability_v2 — إضافة max_allowed_pieces و carton_quantity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_check_product_availability_v2(
  p_product_id          uuid,
  p_requested_quantity  integer,
  p_unit_type           varchar(20) DEFAULT NULL,
  p_token               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_product record;
  v_unit_type varchar(20);
  v_unit_pieces integer;
  v_requested_pieces integer;
  v_capacity integer;
  v_available boolean;
  v_max_units integer;
BEGIN
  SELECT is_out_of_stock, carton_quantity INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.is_out_of_stock THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_OUT_OF_STOCK');
  END IF;

  v_unit_type := COALESCE(p_unit_type, 'piece');
  v_unit_pieces := public._to_pieces(v_unit_type, 1, COALESCE(v_product.carton_quantity, 0));
  IF v_unit_pieces IS NULL OR v_unit_pieces <= 0 THEN
    v_unit_pieces := 1; -- وقائي: كرتون بلا carton_quantity يُعامل كقطعة
  END IF;

  -- القسم 8.1: غياب سياق الجلسة → سعة غير محدودة افتراضياً.
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', 'NEGATIVE_SELLING_ALLOWED',
      'max_allowed_units', NULL,
      'max_allowed_pieces', NULL,
      'carton_quantity', COALESCE(v_product.carton_quantity, 0),
      'unit_type', v_unit_type
    );
  END IF;

  -- سعة غير محدودة (البيع بالسالب مفعَّل عالمياً) → متاح دائماً.
  v_capacity := public._reservation_capacity(p_product_id, NULL);
  IF v_capacity IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', 'NEGATIVE_SELLING_ALLOWED',
      'max_allowed_units', NULL,
      'max_allowed_pieces', NULL,
      'carton_quantity', COALESCE(v_product.carton_quantity, 0),
      'unit_type', v_unit_type
    );
  END IF;

  v_requested_pieces := public._to_pieces(
    v_unit_type,
    COALESCE(p_requested_quantity, 0),
    COALESCE(v_product.carton_quantity, 0)
  );
  v_available := v_capacity >= v_requested_pieces;

  -- الحد الأقصى بوحدات البيع المطلوبة — floor لأعداد صحيحة (BR-SU-01).
  v_max_units := v_capacity / v_unit_pieces;

  RETURN jsonb_build_object(
    'available', v_available,
    'error', CASE WHEN v_available THEN NULL ELSE 'INSUFFICIENT_STOCK' END,
    'max_allowed_units', v_max_units,
    'max_allowed_pieces', v_capacity,
    'carton_quantity', COALESCE(v_product.carton_quantity, 0),
    'unit_type', v_unit_type
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_product_availability_v2(uuid, integer, varchar, text) IS
  'فحص توفر الكمية مع مراعاة الحجوزات والسعة (بدون كشف أرقام مخزون/حجز خام — BR-VIS-01)';

-- ---------------------------------------------------------------------------
-- 12. governed_get_order_inventory_snapshot — إضافة carton_quantity و reservation_status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_get_order_inventory_snapshot(
  p_token text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_has_inventory boolean;
  v_snapshot jsonb := '[]'::jsonb;
  v_is_sufficient boolean;
  v_reserved integer;
  v_capacity integer;
  v_allocated integer;
  v_stock integer;
  v_remaining integer;
  v_need integer;
  v_unit_pieces integer;
  v_alloc_this integer;
  v_queue record;
  v_product_id uuid;
  v_requested integer;
  v_carton_quantity integer;
  v_status text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'orders.manage');

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  WITH combined AS (
    SELECT oi.product_id, SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)) AS total_qty
    FROM public.order_items oi
    LEFT JOIN public.products pr ON pr.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    UNION ALL
    SELECT di.product_id, SUM(di.quantity * odd.quantity)
    FROM public.order_daily_deals odd
    JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
    WHERE odd.order_id = p_order_id
    GROUP BY di.product_id
    UNION ALL
    SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)
    FROM public.order_flash_offers ofo
    JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
    WHERE ofo.order_id = p_order_id
    GROUP BY foi.product_id
  ),
  aggregated AS (
    SELECT product_id, SUM(total_qty) AS total_quantity
    FROM combined
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object('product_id', product_id, 'total_quantity', total_quantity)
  ) INTO v_requirements
  FROM aggregated;

  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    RETURN jsonb_build_object('snapshot', '[]'::jsonb);
  END IF;

  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    v_product_id := (v_req.value->>'product_id')::uuid;
    v_requested  := (v_req.value->>'total_quantity')::integer;

    v_available := 0;
    v_has_inventory := false;
    SELECT quantity INTO v_available
    FROM public.inventory
    WHERE product_id = v_product_id;
    IF FOUND THEN
      v_has_inventory := true;
      IF v_available IS NULL THEN v_available := 0; END IF;
    ELSE
      v_available := 0;
    END IF;

    -- is_sufficient: دلالة الحقل الحالي محفوظة (القسم 8.2 — «موجود»).
    v_is_sufficient := v_negative_selling
                    OR NOT v_has_inventory
                    OR v_available >= v_requested;

    v_reserved  := public._reserved_quantity_for_order(v_product_id, p_order_id);
    v_capacity  := public._reservation_capacity(v_product_id, p_order_id);

    SELECT carton_quantity INTO v_carton_quantity
    FROM public.products WHERE id = v_product_id;
    IF NOT FOUND OR v_carton_quantity IS NULL THEN v_carton_quantity := 0; END IF;

    -- حالة الأعمال للصنف (BR-VIS-01): جاهز / حجز سابق / عجز.
    v_status := 'sufficient';
    IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
      v_status := 'shortage';
    ELSIF v_capacity IS NOT NULL AND v_available - v_capacity > 0 THEN
      v_status := 'prior_reservation';
    END IF;

    -- نصيب FCFS الفعلي لهذا الطلب (تخصيص جشع — القسم 5.2).
    v_allocated := 0;
    IF v_order.status = 'submitted' AND v_order.inventory_deducted_at IS NULL THEN
      IF v_capacity IS NULL THEN
        v_allocated := v_reserved;
      ELSE
        v_stock    := v_available;
        v_remaining := v_stock;
        FOR v_queue IN
          SELECT o.id
          FROM public.orders o
          WHERE o.status = 'submitted'
            AND o.inventory_deducted_at IS NULL
          ORDER BY o.submitted_at ASC, o.created_at ASC, o.id ASC
        LOOP
          v_need := public._reserved_quantity_for_order(v_product_id, v_queue.id);
          IF v_need = 0 THEN CONTINUE; END IF;

          SELECT public._to_pieces(oi.unit_type, 1, pr.carton_quantity)
          INTO v_unit_pieces
          FROM public.order_items oi
          LEFT JOIN public.products pr ON pr.id = oi.product_id
          WHERE oi.order_id = v_queue.id
            AND oi.product_id = v_product_id
          LIMIT 1;
          IF v_unit_pieces IS NULL OR v_unit_pieces <= 0 THEN
            v_unit_pieces := 1;
          END IF;

          v_alloc_this := LEAST(v_need, v_remaining);
          v_alloc_this := (v_alloc_this / v_unit_pieces) * v_unit_pieces;

          IF v_queue.id = p_order_id THEN
            v_allocated := v_alloc_this;
          END IF;
          v_remaining := v_remaining - v_alloc_this;
        END LOOP;
      END IF;
    END IF;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_product_id,
      'requested_quantity', v_requested,
      'available_quantity', v_available,
      'is_sufficient', v_is_sufficient,
      'reserved_quantity', v_reserved,
      'allocated_quantity', v_allocated,
      'capacity', v_capacity,
      'carton_quantity', COALESCE(v_carton_quantity, 0),
      'reservation_status', v_status
    );
  END LOOP;

  RETURN jsonb_build_object('snapshot', v_snapshot);
END;
$$;

COMMENT ON FUNCTION public.governed_get_order_inventory_snapshot IS
  'لقطة مخزون للاطلاع فقط (إدارة) — حجز الطلب ونصيب FCFS والسعة وحالة الأعمال لكل منتج';

-- ---------------------------------------------------------------------------
-- 13. الدوال الداخلية الجديدة غير معروضة عبر PostgREST
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._requested_quantity_for_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_fcfs_allocation(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- END OF MIGRATION F
-- ============================================================================
