-- ============================================================================
-- get_governed_product — single-product read for Product Profile
--
-- WHY: ProductProfilePage previously loaded the ENTIRE governed product
-- catalog (every product with nested units + inventory) via
-- get_governed_products and filtered client-side by id — a 1,411-row /
-- ~2.6 MB un-gzipped payload to render one product. get_governed_products
-- has no product-id filter among its 8 params, so a dedicated read is needed.
--
-- This is a NEW function (NOT an overload of get_governed_products and NOT a
-- modification of the canonical 8-arg signature, per the 20270802/20270808
-- PostgREST PGRST203 lesson). It replicates the EXACT same jsonb shape that
-- get_governed_products emits for each row, but for a single p_id only.
--
-- Same session validation as get_governed_products (p_token cast to uuid,
-- app.sessions lookup). No active/visible/price filter — mirrors the Product
-- Profile call's "no filters" semantics (inactive/hidden/zero-price products
-- remain viewable, as today).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_product(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_token uuid;
  v_result jsonb;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'product_name', p.product_name,
    'legacy_code', p.legacy_code,
    'description', p.description,
    'company_id', p.company_id,
    'company_name', comp.company_name,
    'company_legacy_code', comp.legacy_code,
    'company_bonus_enabled', comp.bonus_enabled,
    'bonus_enabled', p.bonus_enabled,
    'is_active', p.is_active,
    'is_visible', p.is_visible,
    'is_out_of_stock', p.is_out_of_stock,
    'image_url', p.image_url,
    'carton_price', p.carton_price,
    'carton_quantity', p.carton_quantity,
    'piece_price', p.piece_price,
    'dozen_price', p.dozen_price,
    'recently_available_at', p.recently_available_at,
    'created_at', p.created_at,
    'negative_selling_allowed', p.negative_selling_allowed,
    'inventory_deduction_status', p.inventory_deduction_status,
    'oos_source', p.oos_source,
    'product_units', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
        ORDER BY pu.unit_type
      ) FROM product_units pu WHERE pu.product_id = p.id),
      '[]'::jsonb
    ),
    'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  WHERE p.id = p_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_governed_product(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_governed_product(text, uuid) IS
  'منتج محكوم واحد حسب المعرّف — نفس شكل get_governed_products لصفحة ملف المنتج (يقرأ منتجاً واحداً بدل الكتالوج الكامل).';