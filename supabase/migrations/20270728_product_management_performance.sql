-- Product Management Performance Optimization
-- 1. Add missing index on is_visible
-- 2. Add pagination support to get_governed_products (backward compatible)

-- 1. Missing index for is_visible filter
CREATE INDEX IF NOT EXISTS idx_products_is_visible ON public.products (is_visible);

-- 2. Drop old overloads before recreating
DROP FUNCTION IF EXISTS public.get_governed_products(uuid, boolean, boolean, text, uuid, boolean);

-- 3. get_governed_products with pagination support (SECURITY DEFINER to match original)
CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token text,
  p_active_only boolean DEFAULT false,
  p_visible_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_count_only boolean DEFAULT false,
  p_page integer DEFAULT NULL,
  p_per_page integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_offset integer;
  v_limit integer;
  v_token uuid;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
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

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  SELECT jsonb_agg(sub.data ORDER BY sub.data->>'product_name')
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
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
          jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
    ) AS data
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
    ORDER BY p.product_name
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_governed_products TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
