-- ============================================================================
-- Migration: Remove four order statuses
-- sales_manager_approved, ready_for_dispatch, sent_to_delivery, stock_review
--
-- New workflow: submitted → reviewing → approved → preparing → prepared → dispatched → delivered
-- ============================================================================

-- 1. Update execution_status_group() — remove ready_for_dispatch, sent_to_delivery
CREATE OR REPLACE FUNCTION public.execution_status_group()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['approved','preparing','prepared','dispatched','delivered']::text[];
$$;

-- 2. Update governed_change_order_status() — remove 4 statuses from array + capability logic
CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token text,
  p_order_id uuid,
  p_new_status varchar(50),
  p_reason text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_confirm_adjustments boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status varchar(50);
  v_customer_id uuid;
  v_total_amount numeric;
  v_payment_method varchar(20);
  v_reference_number text;
  v_has_capability boolean;
  v_required_capability varchar(100);
  v_from_idx integer;
  v_to_idx integer;
  v_is_exceptional boolean;
  v_notices jsonb := '[]'::jsonb;
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
  statuses text[] := ARRAY[
    'draft','submitted','reviewing','returned_for_revision',
    'approved','preparing','prepared',
    'dispatched','deferred','cancelled',
    'delivered'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method, reference_number
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method, v_reference_number
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1593)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
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
    ELSIF v_current_status IN ('submitted','returned_for_revision','cancelled')
          AND p_new_status IN ('returned_for_revision','cancelled')
          AND p_new_status <> v_current_status THEN
      v_required_capability := 'orders.approve';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'prepared' AND p_new_status = 'dispatched' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1576)||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
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
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1593)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  -- Reference number rule — mandatory when entering reviewing (from ANY previous
  -- status) UNLESS the order already carries a reference number.
  IF p_new_status = 'reviewing' THEN
    IF COALESCE(trim(v_reference_number), '') = '' THEN
      IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
        RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
      END IF;
    END IF;
  END IF;

  -- Execution Group Entry Finalization
  IF p_new_status = ANY(public.execution_status_group())
     AND v_current_status <> ALL(public.execution_status_group()) THEN
    SELECT order_negative_selling_allowed, inventory_deducted_at
    INTO v_neg, v_deducted_at
    FROM public.orders WHERE id = p_order_id;

    IF v_deducted_at IS NULL AND NOT COALESCE(v_neg, true) THEN
      v_adjust_plan := public._plan_execution_entry_adjustments(p_order_id, true);
      IF jsonb_array_length(v_adjust_plan) > 0 THEN
        IF p_confirm_adjustments THEN
          PERFORM public._apply_execution_entry_adjustments(p_order_id, v_adjust_plan, v_session.identity_id);
        ELSE
          RETURN json_build_object(
            'error', 'ADJUSTMENTS_REQUIRED',
            'adjustments', v_adjust_plan,
            'details', 'يجب مراجعة تعديلات الكميات قبل دخول مجموعة التنفيذ'
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Execute the transition
  UPDATE orders
  SET status = p_new_status,
      updated_at = now(),
      submitted_at = CASE WHEN p_new_status = 'submitted' AND v_current_status = 'draft' THEN now() ELSE submitted_at END,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
      cancel_reason = CASE WHEN p_new_status = 'cancelled' THEN p_reason ELSE cancel_reason END
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, reference_number)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, p_reference_number);

  RETURN json_build_object('success', true, 'new_status', p_new_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, varchar, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.governed_change_order_status IS 'تغيير حالة الطلب مع التحقق من الصلاحيات وقواعد الانتقال (v3 — removes sales_manager_approved, ready_for_dispatch, sent_to_delivery, stock_review)';

-- 3. Update set_global_negative_selling_policy() — remove stock_review references
CREATE OR REPLACE FUNCTION public.set_global_negative_selling_policy(
  p_token text,
  p_value boolean,
  p_scope varchar(20) DEFAULT 'new_orders'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_old_value boolean;
  v_order record;
  v_has_unavailable boolean;
  v_has_insufficient boolean;
  v_restore_result jsonb;
  v_moved_count integer := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  -- Read old value
  SELECT (value->>'value')::boolean INTO v_old_value
  FROM app.app_settings WHERE key = 'inventory_negative_selling_allowed';
  IF v_old_value IS NULL THEN v_old_value := true; END IF;

  -- Update global setting
  INSERT INTO app.app_settings (key, value, description)
  VALUES ('inventory_negative_selling_allowed', jsonb_build_object('value', p_value),
          'Global negative selling policy')
  ON CONFLICT (key) DO UPDATE
  SET value = jsonb_build_object('value', p_value), updated_at = now();

  -- If scope is previous_and_new AND changing from true to false, revalidate orders
  IF p_scope = 'previous_and_new' AND v_old_value = true AND p_value = false THEN
    FOR v_order IN
      SELECT DISTINCT o.id, o.status, o.inventory_deducted_at
      FROM public.orders o
      WHERE o.status NOT IN ('delivered', 'cancelled')
    LOOP
      v_has_unavailable := false;
      v_has_insufficient := false;

      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = v_order.id
          AND (p.is_out_of_stock = true OR p.is_active = false)
      ) THEN
        v_has_unavailable := true;
      END IF;

      IF v_order.inventory_deducted_at IS NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.order_items oi2
          JOIN public.inventory inv ON inv.product_id = oi2.product_id
          WHERE oi2.order_id = v_order.id
            AND inv.quantity < oi2.piece_quantity
        ) INTO v_has_insufficient;
      END IF;

      IF v_has_unavailable OR v_has_insufficient THEN
        PERFORM public.governed_inventory_restore(v_order.id);

        -- Return order to submitted for review instead of stock_review
        UPDATE public.orders
        SET status = 'submitted',
            order_negative_selling_allowed = false,
            updated_at = now()
        WHERE id = v_order.id;

        INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
        VALUES (v_order.id, v_order.status, 'submitted', v_session.identity_id,
                'تم إرجاع الطلب للمراجعة بسبب تغيير سياسة البيع بالسالب', now());

        v_moved_count := v_moved_count + 1;
      ELSE
        UPDATE public.orders
        SET order_negative_selling_allowed = false, updated_at = now()
        WHERE id = v_order.id;
      END IF;
    END LOOP;
  ELSIF p_scope = 'previous_and_new' THEN
    UPDATE public.orders
    SET order_negative_selling_allowed = p_value, updated_at = now()
    WHERE status NOT IN ('delivered', 'cancelled');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'negative_selling_allowed', p_value,
    'scope', p_scope,
    'moved_to_stock_review', v_moved_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_global_negative_selling_policy TO authenticated;

COMMENT ON FUNCTION public.set_global_negative_selling_policy IS
  'تغيير سياسة البيع بالسالب العالمية مع تحديد النطاق (طلبات جديدة فقط / سابقة وحديثة) — stock_review status removed';
