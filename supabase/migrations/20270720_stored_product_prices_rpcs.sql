-- Phase 1: Stored Product Prices — RPC Updates
-- Update governed_create_product, governed_update_product_pricing,
-- get_governed_products, and get_company_products to work with
-- the new piece_price and dozen_price columns.

-- 1. governed_create_product — generate piece_price/dozen_price on insert
CREATE OR REPLACE FUNCTION public.governed_create_product(
  p_token uuid,
  p_company_id uuid,
  p_product_name varchar,
  p_legacy_code varchar,
  p_description text DEFAULT NULL,
  p_carton_quantity integer DEFAULT NULL,
  p_carton_price decimal DEFAULT NULL,
  p_units jsonb DEFAULT '["piece", "dozen", "carton"]',
  p_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_product_id uuid;
  v_unit text;
  v_piece_price numeric;
  v_dozen_price numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  -- Generate derived prices from carton_price / carton_quantity
  IF p_carton_price IS NOT NULL AND p_carton_price > 0
     AND p_carton_quantity IS NOT NULL AND p_carton_quantity > 0
  THEN
    v_piece_price := ROUND((p_carton_price / p_carton_quantity)::numeric, 2);
    v_dozen_price := ROUND((p_carton_price / p_carton_quantity * 12)::numeric, 2);
  ELSE
    v_piece_price := 0;
    v_dozen_price := 0;
  END IF;

  INSERT INTO public.products (company_id, product_name, legacy_code, description, image_url, carton_quantity, carton_price, piece_price, dozen_price, is_active)
  VALUES (p_company_id, p_product_name, p_legacy_code, p_description, p_image_url, p_carton_quantity, p_carton_price, v_piece_price, v_dozen_price, true)
  RETURNING id INTO v_product_id;

  -- Create product units
  FOR v_unit IN SELECT * FROM jsonb_array_elements_text(p_units)
  LOOP
    INSERT INTO public.product_units (product_id, unit_type, is_active)
    VALUES (v_product_id, v_unit, true);
  END LOOP;

  -- Create inventory record
  INSERT INTO public.inventory (product_id, quantity)
  VALUES (v_product_id, 0);

  RETURN jsonb_build_object('success', true, 'id', v_product_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_product IS 'إضافة منتج جديد — يولد piece_price و dozen_price تلقائياً';

-- 2. governed_update_product_pricing — regenerate derived prices atomically
CREATE OR REPLACE FUNCTION public.governed_update_product_pricing(
  p_token uuid,
  p_id uuid,
  p_carton_price decimal DEFAULT NULL,
  p_carton_quantity integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_new_carton_price numeric;
  v_new_carton_quantity integer;
  v_piece_price numeric;
  v_dozen_price numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  -- Resolve final values (COALESCE with existing row)
  SELECT
    COALESCE(p_carton_price, carton_price),
    COALESCE(p_carton_quantity, carton_quantity)
  INTO v_new_carton_price, v_new_carton_quantity
  FROM public.products WHERE id = p_id;

  -- Generate derived prices
  IF v_new_carton_price IS NOT NULL AND v_new_carton_price > 0
     AND v_new_carton_quantity IS NOT NULL AND v_new_carton_quantity > 0
  THEN
    v_piece_price := ROUND((v_new_carton_price / v_new_carton_quantity)::numeric, 2);
    v_dozen_price := ROUND((v_new_carton_price / v_new_carton_quantity * 12)::numeric, 2);
  ELSE
    v_piece_price := 0;
    v_dozen_price := 0;
  END IF;

  -- Single atomic update: all pricing columns
  UPDATE public.products
  SET
    carton_price = COALESCE(p_carton_price, carton_price),
    carton_quantity = COALESCE(p_carton_quantity, carton_quantity),
    piece_price = v_piece_price,
    dozen_price = v_dozen_price,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_pricing IS 'تحديث أسعار المنتج — يولد piece_price و dozen_price تلقائياً في نفس المعاملة';

-- 3. get_governed_products — return piece_price and dozen_price
CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token uuid,
  p_active_only boolean DEFAULT true,
  p_visible_only boolean DEFAULT true,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_count_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id);
    RETURN v_result;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'description', p.description,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'created_at', p.created_at,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', pu.id,
            'unit_type', pu.unit_type,
            'is_active', pu.is_active
          )
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
    )
    ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  WHERE (NOT p_active_only OR p.is_active = true)
    AND (NOT p_visible_only OR p.is_visible = true)
    AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_products IS 'المنتجات — يعيد piece_price و dozen_price المخزنة';

-- 4. get_company_products — return piece_price and dozen_price
CREATE OR REPLACE FUNCTION public.get_company_products(
  p_token uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'is_active', p.is_active,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'created_at', p.created_at
    ) ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  WHERE p.company_id = p_company_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_company_products IS 'منتجات الشركة — يعيد piece_price و dozen_price المخزنة';
