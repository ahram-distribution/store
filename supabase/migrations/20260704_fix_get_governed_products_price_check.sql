-- ============================================================================
-- Fix: Restore mandatory price check in get_governed_products, but only for
-- customer-facing queries (p_active_only = true).
--
-- Rationale:
--   - Migration 20260706 added the check; migration 20260922 accidentally
--     dropped it when overriding the function for is_out_of_stock support.
--   - Admin UI passes p_active_only=false so managers can see unpriced
--     products (now marked with "موقوف - السعر غير محدد" badge) and fix them.
--   - Storefront / customer queries pass p_active_only=true (default) and
--     must never expose unpriced products.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_governed_products(
  p_token uuid,
  p_active_only boolean,
  p_visible_only boolean,
  p_search text,
  p_company_id uuid,
  p_count_only boolean
);

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
      AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
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
    AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
    AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_products IS 'المنتجات — شرط السعر إجباري لواجهة العملاء فقط';
