-- Add is_out_of_stock = false to get_recently_available_products
-- The collection must always represent CURRENT business state.
-- A product that is out of stock must be excluded immediately
-- even if the configured period has not expired.

CREATE OR REPLACE FUNCTION public.get_recently_available_products(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_token uuid;
  v_days int;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT COALESCE((value #>> '{}')::int, 7) INTO v_days
  FROM app.app_settings
  WHERE key = 'recently_available_days';

  IF v_days IS NULL OR v_days < 1 THEN v_days := 7; END IF;

  SELECT jsonb_agg(sub.data)
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
      'recently_available_at', p.recently_available_at,
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
    WHERE p.is_active = true
      AND p.is_visible = true
      AND p.is_out_of_stock = false
      AND (p.carton_price IS NOT NULL AND p.carton_price > 0)
      AND p.recently_available_at IS NOT NULL
      AND p.recently_available_at >= now() - (v_days || ' days')::interval
    ORDER BY p.recently_available_at DESC
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_recently_available_products TO authenticated;

COMMENT ON FUNCTION public.get_recently_available_products IS 'المنتجات المتوفرة حديثاً — نفس شكل get_governed_products مع فلترة ديناميكية';

NOTIFY pgrst, 'reload schema';
