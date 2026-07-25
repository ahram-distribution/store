-- ============================================================================
-- INVENTORY GOVERNANCE — PHASE 2: Inventory Management RPCs
-- SET/REPLACE stock, configure negative selling, configure deduction status.
-- ============================================================================

-- 1. governed_set_product_stock — SET/REPLACE inventory in pieces or cartons
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_product_stock(
  p_token uuid,
  p_product_id uuid,
  p_quantity integer,
  p_unit varchar(20) DEFAULT 'piece'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_product record;
  v_pieces integer;
  v_carton_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  SELECT id, carton_quantity INTO v_product
  FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

  -- Convert input to pieces
  IF p_unit = 'carton' THEN
    IF v_product.carton_quantity IS NULL OR v_product.carton_quantity <= 0 THEN
      RETURN jsonb_build_object('error', 'CARTON_QUANTITY_NOT_CONFIGURED');
    END IF;
    v_pieces := p_quantity * v_product.carton_quantity;
  ELSIF p_unit = 'piece' THEN
    v_pieces := p_quantity;
  ELSE
    RETURN jsonb_build_object('error', 'INVALID_UNIT: use piece or carton');
  END IF;

  -- SET/REPLACE semantics (not additive)
  INSERT INTO public.inventory (product_id, quantity, updated_at)
  VALUES (p_product_id, v_pieces, now())
  ON CONFLICT (product_id) DO UPDATE
  SET quantity = v_pieces, updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'quantity_pieces', v_pieces,
    'unit', p_unit
  );
END;
$$;

COMMENT ON FUNCTION public.governed_set_product_stock IS
  'تعيين/استبدال مخزون المنتج بالقطع أو الكراتين (SET/REPLACE وليس إضافي)';

-- 2. governed_set_product_negative_selling — change with scope
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_product_negative_selling(
  p_token uuid,
  p_product_id uuid,
  p_negative_selling boolean,
  p_scope varchar(20) DEFAULT 'new_orders'
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  SELECT id, negative_selling_allowed INTO v_product
  FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

  v_old_value := v_product.negative_selling_allowed;

  -- Update product setting
  UPDATE public.products
  SET negative_selling_allowed = p_negative_selling, updated_at = now()
  WHERE id = p_product_id;

  -- If scope is previous_and_new, update snapshot on existing non-delivered orders
  IF p_scope = 'previous_and_new' AND v_old_value != p_negative_selling THEN
    UPDATE public.orders
    SET order_negative_selling_allowed = p_negative_selling, updated_at = now()
    WHERE id IN (
      SELECT o.id FROM public.orders o
      WHERE o.customer_id IS NOT NULL
        AND o.status NOT IN ('delivered', 'cancelled', 'stock_review')
    )
    AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = orders.id AND oi.product_id = p_product_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'negative_selling_allowed', p_negative_selling,
    'scope', p_scope
  );
END;
$$;

COMMENT ON FUNCTION public.governed_set_product_negative_selling IS
  'تغيير سياسة البيع بالسالب للمنتج مع تحديد النطاق (طلبات جديدة فقط / سابقة وحديثة)';

-- 3. governed_set_product_deduction_status — change with scope
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_product_deduction_status(
  p_token uuid,
  p_product_id uuid,
  p_deduction_status varchar(30),
  p_scope varchar(20) DEFAULT 'new_orders'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_product record;
  v_old_value varchar(30);
  v_valid_statuses text[] := ARRAY[
    'submitted', 'reviewing', 'approved', 'preparing', 'prepared',
    'ready_for_dispatch', 'sent_to_delivery', 'dispatched', 'delivered'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  IF NOT (p_deduction_status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('error', 'INVALID_DEDUCTION_STATUS');
  END IF;

  SELECT id, inventory_deduction_status INTO v_product
  FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

  v_old_value := v_product.inventory_deduction_status;

  -- Update product setting
  UPDATE public.products
  SET inventory_deduction_status = p_deduction_status, updated_at = now()
  WHERE id = p_product_id;

  -- If scope is previous_and_new, update snapshot on existing non-delivered orders
  IF p_scope = 'previous_and_new' AND v_old_value != p_deduction_status THEN
    UPDATE public.orders
    SET order_inventory_deduction_status = p_deduction_status, updated_at = now()
    WHERE id IN (
      SELECT o.id FROM public.orders o
      WHERE o.customer_id IS NOT NULL
        AND o.status NOT IN ('delivered', 'cancelled', 'stock_review')
    )
    AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = orders.id AND oi.product_id = p_product_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'inventory_deduction_status', p_deduction_status,
    'scope', p_scope
  );
END;
$$;

COMMENT ON FUNCTION public.governed_set_product_deduction_status IS
  'تغيير حالة الخصم المخزنية للمنتج مع تحديد النطاق';

-- ============================================================================
-- END OF PHASE 2
-- ============================================================================
