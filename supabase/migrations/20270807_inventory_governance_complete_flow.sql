-- ============================================================================
-- INVENTORY GOVERNANCE — COMPLETE BUSINESS FLOW
-- 
-- This migration completes the inventory governance system:
--   1. inventory_movements audit table
--   2. Atomic governed_inventory_restore (pre-lock, then restore)
--   3. governed_check_product_availability RPC (no reservation, no stock leak)
--   4. Audit logging in governed_inventory_deduct and governed_inventory_restore
--   5. governed_change_order_status: restore inventory on cancellation
-- ============================================================================

-- ============================================================================
-- 1. INVENTORY MOVEMENTS AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id),
  order_id      uuid REFERENCES public.orders(id),
  quantity_change integer NOT NULL,
  movement_type varchar(50) NOT NULL,
  reference_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
  ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
  ON public.inventory_movements(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
  ON public.inventory_movements(movement_type);

COMMENT ON TABLE public.inventory_movements IS
  'سجل حركات المخزون — خصم، استرجاع إلغاء، استرجاع تعديل';

-- ============================================================================
-- 2. ATOMIC governed_inventory_restore (with audit + FOR UPDATE)
-- ============================================================================

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
  v_items jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_restored_count integer := 0;
  v_actor_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NULL OR v_order.inventory_deducted_items IS NULL THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_restore', true);
  END IF;

  v_items := v_order.inventory_deducted_items;
  v_actor_id := v_order.created_by;

  -- Phase 1: Lock all inventory rows (prevent concurrent races)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    PERFORM FROM public.inventory
    WHERE product_id = (v_item->>'product_id')::uuid
    FOR UPDATE;
  END LOOP;

  -- Phase 2: Restore all (now safely locked)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'piece_quantity')::integer;

    UPDATE public.inventory
    SET quantity = quantity + v_quantity,
        updated_at = now()
    WHERE product_id = v_product_id;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, created_by)
    VALUES (v_product_id, p_order_id, v_quantity, 'ORDER_CANCELLATION_RESTORE', v_actor_id);

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
  'استرداد كامل لتأثير المخزون للطلب (مرة واحدة فقط) — مع القفل والتسجيل';

-- ============================================================================
-- 3. governed_check_product_availability
--    Returns whether a requested quantity is available WITHOUT revealing stock.
--    Does NOT reserve.  Read-only check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_check_product_availability(
  p_product_id  uuid,
  p_requested_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_product record;
  v_current_qty integer;
  v_negative_selling boolean;
BEGIN
  SELECT p.is_out_of_stock, p.negative_selling_allowed
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.is_out_of_stock THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_OUT_OF_STOCK');
  END IF;

  IF v_product.negative_selling_allowed THEN
    RETURN jsonb_build_object('available', true);
  END IF;

  SELECT quantity INTO v_current_qty
  FROM public.inventory
  WHERE product_id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', true);
  END IF;

  IF v_current_qty >= p_requested_quantity THEN
    RETURN jsonb_build_object('available', true);
  END IF;

  RETURN jsonb_build_object(
    'available', false,
    'error', 'INSUFFICIENT_STOCK'
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_product_availability IS
  'فحص توفر الكمية بدون حجز أو كشف الرصيد';

-- ============================================================================
-- 4. UPDATE governed_inventory_deduct — add audit logging
-- ============================================================================

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
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  IF v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', true);
  END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

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

  -- Phase 2: Deduct and audit
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    UPDATE public.inventory
    SET quantity = quantity - (v_req.value->>'total_quantity')::integer,
        updated_at = now()
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, created_by)
    VALUES (
      (v_req.value->>'product_id')::uuid,
      p_order_id,
      -((v_req.value->>'total_quantity')::integer),
      'ORDER_DEDUCTION',
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

-- ============================================================================
-- 5. UPDATE governed_change_order_status — restore inventory on cancellation
-- ============================================================================

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
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
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
  'تغيير حالة الطلب مع خصم/استرجاع المخزون حسب الإعدادات';
