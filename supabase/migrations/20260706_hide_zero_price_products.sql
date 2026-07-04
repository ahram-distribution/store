-- ============================================================================
-- Hide products without a valid sale price from customers
-- 1. Mark existing zero/NULL-price products as inactive + hidden
-- 2. Update get_governed_products to enforce price > 0 at query level
-- ============================================================================

-- 1. Mark products with no valid price as inactive + invisible
UPDATE products
SET
  is_active = false,
  is_visible = false
WHERE
  (carton_price IS NULL OR carton_price <= 0)
  AND (is_active = true OR is_visible = true);

-- 2. Recreate get_governed_products with hard price check
DROP FUNCTION IF EXISTS public.get_governed_products(p_token uuid, p_active_only boolean, p_visible_only boolean, p_search text, p_company_id uuid, p_count_only boolean);

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

  -- Hard price requirement: carton_price must be > 0
  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND p.carton_price IS NOT NULL AND p.carton_price > 0
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
    AND p.carton_price IS NOT NULL AND p.carton_price > 0
    AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_products IS 'المنتجات مع دعم البحث والتصفية — يمنع ظهور الأصناف بدون سعر';
