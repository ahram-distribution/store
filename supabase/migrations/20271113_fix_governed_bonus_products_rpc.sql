-- ============================================================================
-- Production hotfix: get_governed_bonus_products
--
-- Root cause: the Phase 4 RPC referenced g.a.adjustment_percent even though
-- the LATERAL resolver is aliased as g and exposes adjustment_percent directly.
-- PostgreSQL therefore raised "missing FROM-clause entry for table \"a\"".
--
-- This keeps the approved catalog contract: active + visible products where
-- product bonus, company bonus, or the dedicated Bonus/Gift company (7000)
-- makes the product eligible. It never changes product.company_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_bonus_products(
  p_token uuid,
  p_governorate_id uuid DEFAULT NULL,
  p_company_ids uuid[] DEFAULT NULL
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
  SELECT * INTO v_session
  FROM app.sessions
  WHERE token = p_token AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'company_legacy_code', comp.legacy_code,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'bonus_enabled', p.bonus_enabled,
      'company_bonus_enabled', comp.bonus_enabled,
      'geo_adjustment_percent', CASE
        WHEN p_governorate_id IS NULL THEN NULL::numeric
        ELSE g.adjustment_percent
      END,
      'product_units', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pu.id,
              'unit_type', pu.unit_type,
              'is_active', pu.is_active
            )
            ORDER BY pu.unit_type
          )
          FROM product_units pu
          WHERE pu.product_id = p.id
        ),
        '[]'::jsonb
      )
    )
    ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  LEFT JOIN LATERAL public.get_effective_geographic_adjustment(
    p_governorate_id,
    p.company_id,
    p.id
  ) g ON true
  WHERE p.is_active = true
    AND p.is_visible = true
    AND (
      COALESCE(p.bonus_enabled, false)
      OR COALESCE(comp.bonus_enabled, false)
      OR comp.legacy_code = '7000'
    )
    AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_bonus_products(uuid, uuid, uuid[]) IS
  'كتالوج منتجات البونص والهدايا: نشطة ومرئية ومؤهلة عبر المنتج أو الشركة أو شركة 7000، بأسعار أساسية مع نسبة التسعير الجغرافي دون خصومات.';

GRANT EXECUTE ON FUNCTION public.get_governed_bonus_products(uuid, uuid, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
