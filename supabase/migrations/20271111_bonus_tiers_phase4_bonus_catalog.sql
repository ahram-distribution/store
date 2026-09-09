-- ============================================================================
-- BONUS TIERS — PHASE 4: BONUS CATALOG + ELIGIBILITY CONTROLS
-- Companion: docs\Bonus Tiers — Final Implementation Design Review.md (approved)
--            docs\Bonus Tiers — بونص الشرائح.md (v2.2, locked business spec)
--
-- SCOPE (ADDITIVE ONLY — no destructive DDL, no data rewrites):
--   1. get_governed_bonus_products — Bonus catalog RPC (design D.1 #3).
--   2. get_governed_products        — superset: exposes bonus_enabled,
--                                     company_bonus_enabled, company_legacy_code.
--   3. get_governed_companies       — superset: exposes bonus_enabled.
--   4. governed_update_product      — superset: p_bonus_enabled (products.manage).
--   5. governed_update_company      — superset: p_bonus_enabled (companies.manage).
--
-- ELIGIBILITY PREDICATE (approved, OR-only, no exclusion override):
--   products.bonus_enabled OR companies.bonus_enabled
--   The dedicated Bonus company "هدايا و بونص" (legacy code 7000) is created in
--   Phase 1 with companies.bonus_enabled = true, so its products are eligible
--   through the company flag — products are NEVER reassigned into company 7000.
--
-- GEOGRAPHIC PRICING: the Bonus catalog reuses the AUTHORITATIVE geographic
--   resolver (get_effective_geographic_adjustment) when a governorate is
--   supplied; otherwise it returns raw base prices. No second pricing system.
--
-- OFF-MODE ISOLATION: products outside the catalog are untouched; the catalog
--   is read-only to customer sessions; the superset mutations use COALESCE so
--   NULL = no change (existing behavior unchanged by the added parameter).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. get_governed_bonus_products (design D.1 #3)
--    Session-validated, read-only. Returns ONLY active + visible + Bonus-eligible
--    products with their raw storefront base prices and, when p_governorate_id is
--    supplied, the winning geographic adjustment_percent per product (reusing the
--    authoritative single resolver — no second pricing system). The caller overlays
--    the adjustment on the base price exactly like the main storefront does.
-- ----------------------------------------------------------------------------

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
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

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
      'geo_adjustment_percent', CASE WHEN p_governorate_id IS NULL THEN NULL::numeric
        ELSE g.adjustment_percent END,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      )
    )
    ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  LEFT JOIN LATERAL public.get_effective_geographic_adjustment(p_governorate_id, p.company_id, p.id) g ON true
  WHERE p.is_active = true
    AND p.is_visible = true
    AND (
      p.bonus_enabled
      OR comp.bonus_enabled
      OR comp.legacy_code = '7000'
    )
    AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_bonus_products IS
  'كتالوج منتجات البونص والهدايا — المنتجات النشطة والظاهرة والمؤهلة فقط (بونص عبر المنتج أو عبر الشركة، أو عبر شركة البونص 7000). الأسعار أساسية (بدون خصم) مع نسبة التسعير الجغرافي عند تمرير المحافظة، ويُطبق الخصم في الواجهة عبر الآلية المعتمدة نفسها.';

-- ----------------------------------------------------------------------------
-- 2. get_governed_products — superset: bonus eligibility flags per product.
--    Additive output keys only. NOTE: we must extend the CANONICAL p_token text
--    (8-arg) signature — NOT create a second p_token uuid overload — because a
--    uuid overload caused PostgREST PGRST203 ambiguity historically (see
--    20270802/20270808). Old signature and filtering behavior unchanged.
-- ----------------------------------------------------------------------------

-- Defensive drop of any stale uuid overload (idempotent; keeps PostgREST clean)
DROP FUNCTION IF EXISTS public.get_governed_products(
  uuid, boolean, boolean, text, uuid, boolean
);

CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token text,
  p_active_only boolean DEFAULT false,
  p_visible_only boolean DEFAULT false,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_count_only boolean DEFAULT false,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
      AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id);
    RETURN v_result;
  END IF;

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

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
    ) AS data
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
    ORDER BY p.product_name
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_products(text, boolean, boolean, text, uuid, boolean, integer, integer) IS
  'قائمة المنتجات المحكومة مع علامات أهلية البونص (بونص المنتج، بونص الشركة، كود الشركة) للتحكم من بطاقة إدارة المنتج.';

-- ----------------------------------------------------------------------------
-- 3. get_governed_companies — superset: bonus_enabled flag per company.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_companies(p_token uuid)
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
      'id', comp.id,
      'company_name', comp.company_name,
      'legacy_code', comp.legacy_code,
      'is_active', comp.is_active,
      'is_visible', comp.is_visible,
      'logo_url', comp.logo_url,
      'bonus_enabled', comp.bonus_enabled,
      'created_at', comp.created_at,
      'product_count', (SELECT COUNT(*) FROM products p WHERE p.company_id = comp.id)
    ) ORDER BY comp.company_name
  ) INTO v_result FROM companies comp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_companies IS
  'قائمة الشركات مع عدد المنتجات والشعار والرؤية وعلامة بونص الشركة';

-- ----------------------------------------------------------------------------
-- 4. governed_update_product — superset: p_bonus_enabled (products.manage).
--    Trailing nullable parameter; COALESCE keeps NULL = no change.
--    NOTE: must DROP any earlier non-bonus overload first so PostgREST has
--    exactly ONE canonical signature (otherwise PGRST203 named-argument
--    ambiguity). See 20270802/20270808 for the same root cause.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_update_product(
  uuid, uuid, varchar, text, varchar, text
);

CREATE OR REPLACE FUNCTION public.governed_update_product(
  p_token uuid,
  p_id uuid,
  p_product_name varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_bonus_enabled boolean DEFAULT NULL
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
  SET
    product_name = COALESCE(p_product_name, product_name),
    description = COALESCE(p_description, description),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    image_url = COALESCE(p_image_url, image_url),
    bonus_enabled = COALESCE(p_bonus_enabled, bonus_enabled),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product(uuid, uuid, varchar, text, varchar, text, boolean) IS
  'تعديل بيانات منتج (مع الصورة وأهلية البونص يضاف إلى الهدايا والبونص)';

-- ----------------------------------------------------------------------------
-- 5. governed_update_company — superset: p_bonus_enabled + p_display_order.
--    (companies.manage). When bonus_enabled=true, ALL products of the company
--    become Bonus-eligible.
--    NOTE: DROP the earlier non-bonus (p_display_order integer) overload AND
--    the previously-introduced bonus-but-no-order overload so PostgREST has
--    exactly ONE canonical signature (no PGRST203 ambiguity). The canonical
--    function merges the original reorder behaviour with the Bonus flag.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_update_company(
  uuid, uuid, varchar, varchar, text, boolean, integer
);
DROP FUNCTION IF EXISTS public.governed_update_company(
  uuid, uuid, varchar, varchar, text, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.governed_update_company(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL,
  p_display_order integer DEFAULT NULL,
  p_bonus_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_old_position int;
  v_new_position int;
  v_total int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies
  SET
    company_name = COALESCE(p_company_name, company_name),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    logo_url = COALESCE(p_logo_url, logo_url),
    is_visible = COALESCE(p_is_visible, is_visible),
    bonus_enabled = COALESCE(p_bonus_enabled, bonus_enabled),
    updated_at = now()
  WHERE id = p_id;

  -- Reorder if position changed
  IF p_display_order IS NOT NULL THEN
    SELECT display_order INTO v_old_position FROM companies WHERE id = p_id;
    SELECT COUNT(*) INTO v_total FROM companies;

    -- Clamp new position: must be between 1 and total
    v_new_position := GREATEST(1, LEAST(p_display_order, v_total));

    IF v_old_position IS NOT NULL AND v_old_position <> v_new_position THEN
      IF v_old_position < v_new_position THEN
        -- Moving DOWN: shift companies between old+1..new UP (decrement)
        UPDATE companies SET display_order = display_order - 1
        WHERE display_order > v_old_position AND display_order <= v_new_position;
      ELSE
        -- Moving UP: shift companies between new..old-1 DOWN (increment)
        UPDATE companies SET display_order = display_order + 1
        WHERE display_order >= v_new_position AND display_order < v_old_position;
      END IF;

      UPDATE companies SET display_order = v_new_position WHERE id = p_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_company(uuid, uuid, varchar, varchar, text, boolean, integer, boolean) IS
  'تعديل بيانات شركة (الشعار، الظهور، الترتيب، وأهلية البونص تضاف إلى الهدايا والبونص)';

-- ============================================================================
-- GRANTS (see 20260708_governed_rpc_execute_grants.sql rationale)
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_governed_bonus_products(uuid, uuid, uuid[]) TO authenticated, service_role;

-- ============================================================================
-- END OF PHASE 4 — BONUS CATALOG + ELIGIBILITY CONTROLS
-- ============================================================================