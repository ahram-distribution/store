-- ============================================================================
-- P1_OPERATIONAL_COMPLETION
-- Fixes: GPS params on governed_create_order, warehouse→delivery handoff,
--        governed_approve_order audit bug, governed_create_collection RPC
-- ============================================================================

-- 1. Fix governed_create_order to accept GPS parameters -----------------------

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid,
  p_customer_id uuid,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order orders;
  v_item jsonb;
  v_product products;
  v_calculated_unit_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_owner_type varchar(20);
  v_owner_id uuid;
  v_created_by uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    PERFORM check_capability(p_token, 'orders.create');
    v_owner_type := 'employee';
    v_owner_id := v_session.employee_id;
    v_created_by := v_session.employee_id;
  ELSE
    v_owner_type := 'customer';
    v_owner_id := v_session.customer_id;
    v_created_by := NULL;
  END IF;

  INSERT INTO public.orders (
    order_number, customer_id, owner_type, owner_id, status,
    subtotal, total_amount, notes, created_by,
    execution_latitude, execution_longitude,
    execution_accuracy_meters, execution_captured_at
  ) VALUES (
    generate_order_number(),
    p_customer_id,
    v_owner_type,
    v_owner_id,
    'draft',
    0, 0,
    p_notes,
    v_created_by,
    p_execution_latitude,
    p_execution_longitude,
    p_execution_accuracy_meters,
    p_execution_captured_at
  )
  RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF v_product.carton_price IS NULL OR v_product.carton_price <= 0
       OR v_product.carton_quantity IS NULL OR v_product.carton_quantity <= 0
    THEN RAISE EXCEPTION 'PRICE_NOT_CONFIGURED'; END IF;

    CASE v_item->>'unit_type'
      WHEN 'piece' THEN
        v_calculated_unit_price := ROUND(v_product.carton_price / v_product.carton_quantity, 2);
      WHEN 'dozen' THEN
        v_calculated_unit_price := ROUND(v_product.carton_price / v_product.carton_quantity * 12, 2);
      WHEN 'carton' THEN
        v_calculated_unit_price := ROUND(v_product.carton_price, 2);
      ELSE
        RAISE EXCEPTION 'INVALID_UNIT_TYPE';
    END CASE;

    v_calculated_total_price := v_calculated_unit_price * (v_item->>'unit_quantity')::int;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      v_order.id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'unit_quantity')::int,
      COALESCE((v_item->>'piece_quantity')::int, 0),
      v_calculated_unit_price,
      v_calculated_total_price
    );

    v_subtotal := v_subtotal + v_calculated_total_price;
  END LOOP;

  UPDATE public.orders SET subtotal = v_subtotal, total_amount = v_subtotal WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by)
  VALUES (v_order.id, NULL, 'draft', COALESCE(v_created_by, v_session.customer_id));

  RETURN v_order;
END;
$$;

-- 2. Fix governed_review_preparation to revert order to approved --------------

CREATE OR REPLACE FUNCTION public.governed_review_preparation(
  p_token uuid,
  p_preparation_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_prep preparation_records;
  v_employee_id uuid;
  v_order_id uuid;
  v_old_status varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  SELECT * INTO v_prep FROM public.preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;
  IF v_prep.status != 'completed' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  v_order_id := v_prep.order_id;

  -- Save old order status before update
  SELECT status INTO v_old_status FROM public.orders WHERE id = v_order_id;

  -- Mark preparation as reviewed
  UPDATE public.preparation_records
  SET status = 'reviewed', reviewed_by = v_employee_id, reviewed_at = now(), notes = COALESCE(p_notes, notes)
  WHERE id = p_preparation_id;

  -- Revert order status to 'approved' so it can be dispatched
  UPDATE public.orders
  SET status = 'approved', updated_at = now()
  WHERE id = v_order_id AND status = 'preparing';

  -- Insert order_status_history for the transition
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (v_order_id, v_old_status, 'approved', v_employee_id, now());

  -- Insert preparation status history
  INSERT INTO public.preparation_status_history (preparation_id, from_status, to_status, changed_by)
  VALUES (p_preparation_id, v_prep.status, 'reviewed', v_employee_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 3. Fix governed_approve_order audit trail (from_status bug) -----------------

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token uuid,
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.approve');

  -- Save old status BEFORE update
  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status != 'submitted' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.orders SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status = 'submitted';

  -- Use saved v_old_status for correct audit trail
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. governed_create_collection RPC -------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_collection_number()
RETURNS varchar(30)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
  v_code varchar(30);
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('collection', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'COL-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_create_collection(
  p_token uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method varchar(20),
  p_reference_number varchar(100) DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_collection_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'collections.create');

  IF p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'cheque', 'deposit') THEN
    RETURN jsonb_build_object('error', 'INVALID_METHOD');
  END IF;

  INSERT INTO public.collections (code, customer_id, owner_type, owner_id, method, amount, reference_number, notes, created_by, collected_at)
  VALUES (
    generate_collection_number(),
    p_customer_id,
    'employee',
    v_employee_id,
    p_method,
    p_amount,
    p_reference_number,
    p_notes,
    v_employee_id,
    now()
  )
  RETURNING id INTO v_collection_id;

  RETURN jsonb_build_object('success', true, 'id', v_collection_id);
END;
$$;

-- ============================================================================
-- END OF P1_OPERATIONAL_COMPLETION
-- ============================================================================
