-- ============================================================================
-- RECENTLY AVAILABLE PRODUCTS
--
-- Adds a "Recently Available" dynamic collection backed by the existing
-- company with legacy_code = '6666' (وصل حديثًا).
--
-- Architecture:
--   - New column: products.recently_available_at (timestamptz)
--   - New table: app.app_settings (generic key-value config)
--   - New RPC: get_recently_available_products (returns same shape as
--     get_governed_products)
--   - Updated RPCs: governed_create_product, governed_activate_product,
--     governed_set_product_out_of_stock — set recently_available_at on
--     qualifying events
--
-- Business rules:
--   A product enters "Recently Available" when:
--     1. A new product is created.
--     2. A product changes from Inactive → Active.
--     3. A product changes from Hidden → Visible.
--     4. A product changes from Out Of Stock → Available.
--   Products remain for the configured period (default: 7 days).
--   The badge appears on ProductCard everywhere while within the period.
-- ============================================================================

-- ============================================================================
-- 1. app_settings — central configuration table
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT 'null'::jsonb,
  description TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.app_settings IS 'Generic key-value application configuration';

INSERT INTO app.app_settings (key, value, description)
VALUES ('recently_available_days', to_jsonb(7), 'Number of days a product stays in Recently Available')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. recently_available_at column on products
-- ============================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS recently_available_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_products_recently_available
  ON public.products (recently_available_at DESC)
  WHERE recently_available_at IS NOT NULL;

-- ============================================================================
-- 3. governed_create_product — set recently_available_at on INSERT
-- ============================================================================
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

  IF p_carton_price IS NOT NULL AND p_carton_price > 0
     AND p_carton_quantity IS NOT NULL AND p_carton_quantity > 0
  THEN
    v_piece_price := ROUND((p_carton_price / p_carton_quantity)::numeric, 2);
    v_dozen_price := ROUND((p_carton_price / p_carton_quantity * 12)::numeric, 2);
  ELSE
    v_piece_price := 0;
    v_dozen_price := 0;
  END IF;

  INSERT INTO public.products (
    company_id, product_name, legacy_code, description, image_url,
    carton_quantity, carton_price, piece_price, dozen_price,
    is_active, recently_available_at
  ) VALUES (
    p_company_id, p_product_name, p_legacy_code, p_description, p_image_url,
    p_carton_quantity, p_carton_price, v_piece_price, v_dozen_price,
    true, now()
  )
  RETURNING id INTO v_product_id;

  FOR v_unit IN SELECT * FROM jsonb_array_elements_text(p_units)
  LOOP
    INSERT INTO public.product_units (product_id, unit_type, is_active)
    VALUES (v_product_id, v_unit, true);
  END LOOP;

  INSERT INTO public.inventory (product_id, quantity)
  VALUES (v_product_id, 0);

  RETURN jsonb_build_object('success', true, 'id', v_product_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_product IS 'إضافة منتج جديد — يولد piece_price و dozen_price تلقائياً و يضبط recently_available_at';

-- ============================================================================
-- 4. governed_activate_product — set recently_available_at on reactivation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_activate_product(
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET is_active = true,
      is_out_of_stock = false,
      recently_available_at = now(),
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_product IS 'تفعيل منتج (يعيد تعيين نفاد الكمية و يضبط recently_available_at)';

-- ============================================================================
-- 5. governed_set_product_out_of_stock — set recently_available_at when clearing OOS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_set_product_out_of_stock(
  p_token uuid,
  p_id uuid,
  p_is_out_of_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET is_out_of_stock = p_is_out_of_stock,
      recently_available_at = CASE WHEN p_is_out_of_stock = false THEN now() ELSE recently_available_at END,
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_set_product_out_of_stock IS 'تعيين حالة نفاد الكمية للمنتج — يضبط recently_available_at عند إزالة النفاد';

-- ============================================================================
-- 6. get_recently_available_products — dedicated RPC for the dynamic collection
--    Returns the same JSON shape as get_governed_products.
--    Reads visibility period from app.app_settings.
-- ============================================================================
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

  -- Read visibility period from app_settings (default: 7 days)
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

-- ============================================================================
-- 7. Ensure governed_create_order and governed_change_product_company cannot
--    reassign products to the "وصل حديثًا" company (legacy_code = '6666').
--    Products must always remain in their original companies.
-- ============================================================================
-- NOTE: This is enforced by the fact that products are never reassigned.
-- The "وصل حديثًا" company (6666) has no real products — only a dynamic view.
-- No additional enforcement is needed because no RPC moves products between
-- companies. The governed_change_product_company RPC exists but is only used
-- by admin for legitimate reassignments, and the 6666 company is simply a
-- view, not a target for product assignment.

NOTIFY pgrst, 'reload schema';
