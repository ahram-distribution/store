-- ============================================================================
-- P1 HOTFIX: column "product_code" does not exist in products table
--
-- Bug 2 (pre-existing, masked by v_item ambiguity):
--   The products table has legacy_code, NOT product_code.
--   The SELECT ... FROM products references product_code which doesn't exist.
--   Fix: SELECT legacy_code AS product_code
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_order(
  p_token uuid, p_customer_id uuid,
  p_tier_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_execution_location_id uuid DEFAULT NULL,
  p_execution_latitude numeric DEFAULT NULL,
  p_execution_longitude numeric DEFAULT NULL,
  p_execution_accuracy_meters numeric DEFAULT NULL,
  p_execution_captured_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_order_number text;
  v_seq int;
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric;
  v_calculated_total_price numeric;
  v_exec_location_id uuid;

  -- Snapshot variables
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.create'; END IF;
  ELSE
    IF v_session.customer_id IS NULL OR p_customer_id IS DISTINCT FROM v_session.customer_id THEN
      RAISE EXCEPTION 'FORBIDDEN: customers can only create orders for themselves';
    END IF;
  END IF;

  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RAISE EXCEPTION 'TIER_NOT_FOUND_OR_INACTIVE';
    END IF;
  END IF;

  -- Validate no out_of_stock products in the order
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS elem
    JOIN public.products p ON p.id = (elem->>'product_id')::uuid
    WHERE p.is_out_of_stock = true AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS';
  END IF;

  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Capture snapshot data BEFORE inserting
  SELECT
    c.code,
    c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE(
      (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
      (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
      ''
    )
  INTO v_cust_code, v_cust_name, v_cust_phone, v_cust_address
  FROM customers c
  WHERE c.id = p_customer_id;

  -- Owner snapshot (employee responsible for the customer)
  SELECT
    COALESCE(e.full_name, ''),
    COALESCE(i.phone, ''),
    COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = p_customer_id;

  -- Sender snapshot (the person creating the order)
  IF v_session.identity_type = 'employee' THEN
    SELECT
      COALESCE(e.full_name, ''),
      COALESCE(i.phone, ''),
      COALESCE(e.address, '')
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM employees e
    LEFT JOIN identities i ON i.id = e.identity_id
    WHERE e.identity_id = v_session.identity_id;
  ELSE
    SELECT
      COALESCE(c.company_name, ''),
      COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE(
        (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
        (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
        ''
      )
    INTO v_sender_name, v_sender_phone, v_sender_address
    FROM customers c
    WHERE c.identity_id = v_session.identity_id;
  END IF;

  -- Generate order number
  SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
  IF NOT FOUND THEN v_seq := 1; END IF;
  v_order_number := 'ORD-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

  -- Insert order with snapshot
  IF v_session.identity_type = 'employee' THEN
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_code, snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'employee', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_code, v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      order_number, customer_id, owner_type, owner_id, created_by,
      notes, tier_id,
      execution_location_id, execution_latitude, execution_longitude,
      execution_accuracy_meters, execution_captured_at,
      snapshot_customer_code, snapshot_customer_name, snapshot_customer_phone, snapshot_customer_address,
      snapshot_owner_name, snapshot_owner_phone, snapshot_owner_address,
      snapshot_sender_name, snapshot_sender_phone, snapshot_sender_address
    ) VALUES (
      v_order_number, p_customer_id, 'customer', v_session.identity_id, v_session.identity_id,
      p_notes, p_tier_id,
      v_exec_location_id, p_execution_latitude, p_execution_longitude,
      p_execution_accuracy_meters, p_execution_captured_at,
      v_cust_code, v_cust_name, v_cust_phone, v_cust_address,
      v_owner_name, v_owner_phone, v_owner_address,
      v_sender_name, v_sender_phone, v_sender_address
    )
    RETURNING * INTO v_order;
  END IF;

  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, legacy_code AS product_code, product_name, unit_id, product_unit_id,
           selling_price, max_price, min_price, has_tax, tax_ratio, commercial_unit_ratio
    INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', (v_item->>'product_id')::uuid;
    END IF;

    IF v_product.has_tax THEN
      v_calculated_unit_price := ROUND(
        ((v_item->>'unit_price')::numeric * (1 + v_product.tax_ratio / 100))::numeric, 2
      );
    ELSE
      v_calculated_unit_price := (v_item->>'unit_price')::numeric;
    END IF;

    v_calculated_total_price := ROUND(
      (v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2
    );

    INSERT INTO public.order_items (
      order_id, product_id, product_code, product_name, unit_id, product_unit_id,
      quantity, unit_price, total_price, selling_price, max_price, min_price,
      has_tax, tax_ratio, commercial_unit_ratio
    ) VALUES (
      v_order.id, v_product.id, v_product.product_code, v_product.product_name,
      v_product.unit_id, v_product.product_unit_id,
      (v_item->>'unit_quantity')::numeric, v_calculated_unit_price, v_calculated_total_price,
      v_product.selling_price, v_product.max_price, v_product.min_price,
      v_product.has_tax, v_product.tax_ratio, v_product.commercial_unit_ratio
    );
  END LOOP;

  INSERT INTO public.order_status_history (order_id, from_status, to_status)
  VALUES (v_order.id, 'draft', 'pending');

  UPDATE public.code_sequences
  SET last_sequence = v_seq
  WHERE code_type = 'order' AND year = EXTRACT(year FROM now())::int;

  PERFORM pg_notify('order_created', jsonb_build_object('order_id', v_order.id, 'number', v_order.order_number)::text);

  RETURN jsonb_build_object(
    'success', true,
    'id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_order IS 'إنشاء طلب جديد (مع رفض المنتجات المنتهية الكمية)';
