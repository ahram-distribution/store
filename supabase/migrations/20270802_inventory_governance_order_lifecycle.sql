-- ============================================================================
-- INVENTORY GOVERNANCE — PHASE 3: Order Lifecycle & Policy Change RPCs
-- Exactly-once deduct/restore, Stock Review revalidation, and transition
-- updates for governed_approve_order, governed_cancel_order,
-- governed_return_order_for_revision, governed_change_order_status.
-- ============================================================================

-- 1. governed_inventory_deduct — deduct inventory for an order exactly once
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
  v_shortages jsonb := '[]'::jsonb;
  v_deducted_items jsonb := '[]'::jsonb;
BEGIN
  -- Fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', true);
  END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  -- Aggregate required quantities per product across normal items, daily deals, and flash offers
  WITH combined AS (
    SELECT oi.product_id, SUM(oi.piece_quantity) AS total_qty
    FROM public.order_items oi WHERE oi.order_id = p_order_id
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

  -- No products to deduct — mark as deducted and return
  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    UPDATE public.orders
    SET inventory_deducted_at = now(),
        inventory_deducted_items = '[]'::jsonb,
        updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'deducted', true, 'item_count', 0);
  END IF;

  -- -----------------------------------------------------------------------
  -- PHASE 1: Lock all inventory rows and validate stock (pre-check)
  -- -----------------------------------------------------------------------
  -- No UPDATE happens here.  Every row is locked with FOR UPDATE to prevent
  -- concurrent transactions from seeing stale data.  If any product lacks
  -- sufficient stock (and negative selling is disabled), we collect ALL
  -- shortages and return a structured error — still nothing has been written.
  -- -----------------------------------------------------------------------

  IF NOT v_negative_selling THEN
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;

      IF FOUND AND v_available < (v_req.value->>'total_quantity')::integer THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_req.value->>'product_id',
          'requested_quantity', (v_req.value->>'total_quantity')::integer
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
    -- Negative selling: lock rows but skip stock validation
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      PERFORM FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;
    END LOOP;
  END IF;

  -- -----------------------------------------------------------------------
  -- PHASE 2: Deduct every product once (all validated or negative selling)
  -- -----------------------------------------------------------------------

  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    UPDATE public.inventory
    SET quantity = quantity - (v_req.value->>'total_quantity')::integer,
        updated_at = now()
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    v_deducted_items := v_deducted_items || jsonb_build_object(
      'product_id', v_req.value->>'product_id',
      'piece_quantity', (v_req.value->>'total_quantity')::integer
    );
  END LOOP;

  -- Mark as deducted (exactly-once)
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
  'خصم مخزون الطلب مرة واحدة فقط (exactly-once)';

-- 2. governed_inventory_restore — restore full inventory effect exactly once
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_inventory_restore(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_item jsonb;
  v_restored_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  IF v_order.inventory_deducted_at IS NULL OR v_order.inventory_deducted_items IS NULL THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_restore', true);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
  LOOP
    UPDATE public.inventory
    SET quantity = quantity + (v_item->>'piece_quantity')::integer,
        updated_at = now()
    WHERE product_id = (v_item->>'product_id')::uuid;

    v_restored_count := v_restored_count + 1;
  END LOOP;

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
  'استرداد كامل لتأثير المخزون للطلب (مرة واحدة فقط)';

-- 3. Replace governed_approve_order — use governed_inventory_deduct
--    Note: p_token is TEXT (not uuid) to match existing signature
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_approve_order(uuid, uuid);
DROP FUNCTION IF EXISTS public.governed_approve_order(text, uuid);

CREATE OR REPLACE FUNCTION public.governed_approve_order(
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
  v_employee_id uuid;
  v_old_status varchar(30);
  v_order record;
  v_deduct_result jsonb;
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

  -- If order's configured deduction status is 'approved', deduct now
  IF v_order.order_inventory_deduction_status = 'approved' THEN
    v_deduct_result := public.governed_inventory_deduct(p_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. Replace governed_cancel_order — restore if previously deducted
--    p_token is TEXT
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

  -- Restore inventory if previously deducted
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

-- 5. Replace governed_return_order_for_revision — restore if previously deducted
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

  -- Restore inventory if previously deducted
  v_restore_result := public.governed_inventory_restore(p_id);

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

-- 6. Replace governed_change_order_status — add stock_review, inventory deduction at configured status
--    p_token is TEXT
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
    RETURN json_build_object('success', false, 'error', 'حالة غير صالحة');
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'الطلب غير موجود');
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', 'الطلب بنفس الحالة');
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
    RETURN json_build_object('success', false, 'error', 'ليس لديك الصلاحية لهذا الإجراء');
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
    RETURN json_build_object('success', false, 'error', 'الرجاء إدخال سبب للتغيير الاستثنائي');
  END IF;

  IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', 'الرقم المرجعى إجباري عند التحويل إلى جارى المراجعة');
    END IF;
  END IF;

  -- Inventory deduction at configured status
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.order_inventory_deduction_status = p_new_status
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
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

  RETURN json_build_object('success', true, 'from_status', v_current_status, 'to_status', p_new_status);
END;
$$;

-- 7. Policy change with Stock Review revalidation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_change_negative_selling_policy(
  p_token uuid,
  p_product_id uuid,
  p_negative_selling boolean,
  p_scope varchar(20)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_product record;
  v_old_value boolean;
  v_order record;
  v_has_unavailable boolean;
  v_has_insufficient boolean;
  v_restore_result jsonb;
  v_moved_count integer := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

  v_old_value := v_product.negative_selling_allowed;

  UPDATE public.products
  SET negative_selling_allowed = p_negative_selling, updated_at = now()
  WHERE id = p_product_id;

  IF p_scope = 'previous_and_new' AND v_old_value = true AND p_negative_selling = false THEN
    FOR v_order IN
      SELECT DISTINCT o.id, o.status, o.inventory_deducted_at
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      WHERE oi.product_id = p_product_id
        AND o.status NOT IN ('delivered', 'cancelled', 'stock_review')
    LOOP
      v_has_unavailable := false;
      v_has_insufficient := false;

      IF EXISTS (
        SELECT 1 FROM public.order_items oi2
        JOIN public.products p2 ON p2.id = oi2.product_id
        WHERE oi2.order_id = v_order.id
          AND (p2.is_out_of_stock = true OR p2.is_active = false)
      ) THEN
        v_has_unavailable := true;
      END IF;

      IF v_order.inventory_deducted_at IS NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.order_items oi3
          JOIN public.inventory inv ON inv.product_id = oi3.product_id
          WHERE oi3.order_id = v_order.id
            AND inv.quantity < oi3.piece_quantity
        ) INTO v_has_insufficient;
      END IF;

      IF v_has_unavailable OR v_has_insufficient THEN
        PERFORM public.governed_inventory_restore(v_order.id);

        UPDATE public.orders
        SET status = 'stock_review',
            order_negative_selling_allowed = false,
            updated_at = now()
        WHERE id = v_order.id;

        INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
        VALUES (v_order.id, v_order.status, 'stock_review', v_session.identity_id,
                'تم نقل الطلب لمراجعة المخزونdue to Negative Selling policy change', now());

        v_moved_count := v_moved_count + 1;
      ELSE
        UPDATE public.orders
        SET order_negative_selling_allowed = false, updated_at = now()
        WHERE id = v_order.id;
      END IF;
    END LOOP;
  ELSIF p_scope = 'previous_and_new' THEN
    UPDATE public.orders
    SET order_negative_selling_allowed = p_negative_selling, updated_at = now()
    WHERE id IN (
      SELECT o.id FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      WHERE oi.product_id = p_product_id
        AND o.status NOT IN ('delivered', 'cancelled', 'stock_review')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'product_id', p_product_id,
    'negative_selling_allowed', p_negative_selling,
    'scope', p_scope, 'moved_to_stock_review', v_moved_count
  );
END;
$$;

-- ============================================================================
-- END OF PHASE 3
-- ============================================================================
