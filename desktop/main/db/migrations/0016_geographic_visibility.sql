-- Desktop migration 16: Geographic Company & Product Visibility Rules
-- Mirrors remote migration 20271011_geographic_visibility.sql

-- ============================================================================
-- GEOGRAPHIC VISIBILITY: Geographic Company & Product Visibility Rules
--
-- New sibling feature to geographic_price_rules that reuses the SAME
-- architecture, geographic scope hierarchy and governed-RPC pattern:
--   - governed (SECURITY DEFINER + check_capability) CRUD RPC pattern
--   - per-governorate client-side resolution model (resolved AFTER fetching,
--     exactly like geographic pricing adjustments)
--
-- A visibility rule is ALWAYS dual-surface: it hides the selected companies
-- and/or products from BOTH (المتجر) and (ليستة البيع) inside the covered
-- scope. It NEVER changes the product's global status (is_active /
-- is_visible / is_out_of_stock), prices or inventory.
--
-- Scopes:
--   'all'          -> applies everywhere          (جميع القطاعات)
--   'governorates' -> applies to selected    محافظات محددة (one or more)
--   'sectors'      -> applies to selected    قطاعات محددة (one or more)
--
-- A rule targets companies AND/OR products (union: every product of the
-- selected companies + the selected products). Multiple rules union together.
-- ============================================================================

-- 1. TABLE -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.geographic_visibility_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name varchar(255) NOT NULL,
    scope varchar(30) NOT NULL,
    sector_ids uuid[] NOT NULL DEFAULT '{}',
    governorate_ids uuid[] NOT NULL DEFAULT '{}',
    company_ids uuid[] NOT NULL DEFAULT '{}',
    product_ids uuid[] NOT NULL DEFAULT '{}',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT geographic_visibility_rules_scope_check CHECK (
        (scope = 'all' AND sector_ids = '{}' AND governorate_ids = '{}') OR
        (scope = 'governorates' AND governorate_ids <> '{}' AND sector_ids = '{}') OR
        (scope = 'sectors' AND sector_ids <> '{}' AND governorate_ids = '{}')
    ),
    CONSTRAINT geographic_visibility_rules_targets_check CHECK (
        company_ids <> '{}' OR product_ids <> '{}'
    )
);

-- Realtime: mirror the geographic-pricing live-refresh pattern.
-- Idempotent and safe when the publication does not exist (desktop mirror).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'geographic_visibility_rules'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.geographic_visibility_rules';
    END IF;
END $$;

-- 2. CAPABILITIES ------------------------------------------------------------
INSERT INTO public.capabilities (code, name, "group") VALUES
    ('geographic_visibility.manage', 'إدارة ظهور الشركات والمنتجات', 'geographic_visibility'),
    ('geographic_visibility.read', 'عرض ظهور الشركات والمنتجات', 'geographic_visibility')
ON CONFLICT (code) DO NOTHING;

-- Same permission model as geographic_pricing.* (granted to الإدارة العليا).
DO $$
DECLARE
    v_um_role_id uuid;
    v_cap_id uuid;
    v_codes text[] := ARRAY['geographic_visibility.manage','geographic_visibility.read'];
    v_code text;
BEGIN
    SELECT id INTO v_um_role_id FROM public.roles WHERE name = 'الإدارة العليا' LIMIT 1;
    IF v_um_role_id IS NULL THEN RETURN; END IF;
    FOREACH v_code IN ARRAY v_codes LOOP
        SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
        IF v_cap_id IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_um_role_id, v_cap_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- 3. LIST RPC ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_geographic_visibility_rules(
  p_token uuid
)
RETURNS TABLE(
  id uuid,
  rule_name character varying,
  scope character varying,
  sector_ids uuid[],
  sector_names character varying[],
  governorate_ids uuid[],
  governorate_names character varying[],
  company_ids uuid[],
  company_names character varying[],
  product_ids uuid[],
  product_names character varying[],
  is_active boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

    RETURN QUERY
    SELECT gvr.id, gvr.rule_name, gvr.scope,
           gvr.sector_ids,
           ARRAY(
               SELECT COALESCE(s.name_ar, s.name) FROM public.sectors s
               WHERE s.id = ANY(gvr.sector_ids) ORDER BY 1
           ) AS sector_names,
           gvr.governorate_ids,
           ARRAY(
               SELECT rg.name_ar FROM public.reference_governorates rg
               WHERE rg.id = ANY(gvr.governorate_ids) ORDER BY 1
           ) AS governorate_names,
           gvr.company_ids,
           ARRAY(
               SELECT c.company_name FROM public.companies c
               WHERE c.id = ANY(gvr.company_ids) ORDER BY 1
           ) AS company_names,
           gvr.product_ids,
           ARRAY(
               SELECT p.product_name FROM public.products p
               WHERE p.id = ANY(gvr.product_ids) ORDER BY 1
           ) AS product_names,
           gvr.is_active, gvr.created_at, gvr.updated_at
    FROM public.geographic_visibility_rules gvr
    ORDER BY gvr.created_at DESC, gvr.rule_name;
END;
$func$;

-- 4. CREATE RPC --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_create_geographic_visibility_rule(
  p_token uuid,
  p_rule_name character varying,
  p_scope character varying,
  p_sector_ids uuid[] DEFAULT '{}',
  p_governorate_ids uuid[] DEFAULT '{}',
  p_company_ids uuid[] DEFAULT '{}',
  p_product_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_session app.sessions;
    v_id uuid;
    v_sector_ids uuid[] := COALESCE(p_sector_ids, '{}');
    v_governorate_ids uuid[] := COALESCE(p_governorate_ids, '{}');
    v_company_ids uuid[] := COALESCE(p_company_ids, '{}');
    v_product_ids uuid[] := COALESCE(p_product_ids, '{}');
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_visibility.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_visibility.manage';
    END IF;

    IF p_rule_name IS NULL OR btrim(p_rule_name) = '' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_NAME';
    END IF;
    IF p_scope = 'governorates' AND v_governorate_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_GOVERNORATES';
    END IF;
    IF p_scope = 'sectors' AND v_sector_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_SECTORS';
    END IF;
    IF v_company_ids = '{}' AND v_product_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_TARGETS';
    END IF;

    v_id := gen_random_uuid();
    INSERT INTO public.geographic_visibility_rules (
        id, rule_name, scope, sector_ids, governorate_ids, company_ids, product_ids
    ) VALUES (
        v_id, btrim(p_rule_name), p_scope,
        v_sector_ids, v_governorate_ids,
        v_company_ids, v_product_ids
    );
    RETURN v_id;
END;
$func$;

-- 5. UPDATE RPC --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_update_geographic_visibility_rule(
  p_token uuid,
  p_rule_id uuid,
  p_rule_name character varying DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_scope character varying DEFAULT NULL,
  p_sector_ids uuid[] DEFAULT NULL,
  p_governorate_ids uuid[] DEFAULT NULL,
  p_company_ids uuid[] DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_session app.sessions;
    v_new_scope varchar(30);
    v_new_sector_ids uuid[];
    v_new_governorate_ids uuid[];
    v_new_company_ids uuid[];
    v_new_product_ids uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_visibility.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_visibility.manage';
    END IF;

    SELECT scope, sector_ids, governorate_ids, company_ids, product_ids
    INTO v_new_scope, v_new_sector_ids, v_new_governorate_ids, v_new_company_ids, v_new_product_ids
    FROM public.geographic_visibility_rules WHERE id = p_rule_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIBILITY_RULE_NOT_FOUND'; END IF;

    v_new_scope := COALESCE(p_scope, v_new_scope);
    IF p_sector_ids IS NOT NULL THEN v_new_sector_ids := p_sector_ids; END IF;
    IF p_governorate_ids IS NOT NULL THEN v_new_governorate_ids := p_governorate_ids; END IF;
    IF p_company_ids IS NOT NULL THEN v_new_company_ids := p_company_ids; END IF;
    IF p_product_ids IS NOT NULL THEN v_new_product_ids := p_product_ids; END IF;

    IF v_new_scope = 'governorates' AND v_new_governorate_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_GOVERNORATES';
    END IF;
    IF v_new_scope = 'sectors' AND v_new_sector_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_SECTORS';
    END IF;
    IF v_new_company_ids = '{}' AND v_new_product_ids = '{}' THEN
        RAISE EXCEPTION 'VISIBILITY_RULE_NEEDS_TARGETS';
    END IF;

    UPDATE public.geographic_visibility_rules SET
        rule_name      = COALESCE(p_rule_name, rule_name),
        is_active      = COALESCE(p_is_active, is_active),
        scope          = v_new_scope,
        sector_ids     = v_new_sector_ids,
        governorate_ids = v_new_governorate_ids,
        company_ids    = v_new_company_ids,
        product_ids    = v_new_product_ids,
        updated_at     = now()
    WHERE id = p_rule_id;

    RETURN TRUE;
END;
$func$;

-- 6. DELETE RPC --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_geographic_visibility_rule(
  p_token uuid,
  p_rule_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_visibility.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_visibility.manage';
    END IF;

    DELETE FROM public.geographic_visibility_rules WHERE id = p_rule_id;
    RETURN TRUE;
END;
$func$;

-- 7. RESOLVERS ---------------------------------------------------------------
-- Mirrors the pricing resolver model (get_effective_geographic_adjustments /
-- _for_sector): resolved client-side per governorate/sector, no N+1, single
-- query per scope. Return every (product, company) hidden by an ACTIVE rule
-- for the scope. Global product status is never modified.
CREATE OR REPLACE FUNCTION public.get_geographic_visibility_hidden_products(
  p_governorate_id uuid
)
RETURNS TABLE(
  product_id uuid,
  company_id uuid,
  rule_name text,
  scope character varying
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_sector_id uuid;
BEGIN
    SELECT sg.sector_id INTO v_sector_id
    FROM public.sector_governorates sg
    WHERE sg.governorate_id = p_governorate_id
    LIMIT 1;

    RETURN QUERY
    SELECT DISTINCT p.id, p.company_id, gvr.rule_name::text, gvr.scope
    FROM public.geographic_visibility_rules gvr
    JOIN public.products p
      ON (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
    WHERE gvr.is_active = true
      AND (
           gvr.scope = 'all'
        OR (gvr.scope = 'governorates' AND gvr.governorate_ids @> ARRAY[p_governorate_id])
        OR (gvr.scope = 'sectors' AND v_sector_id IS NOT NULL AND gvr.sector_ids @> ARRAY[v_sector_id])
      );
END;
$func$;

CREATE OR REPLACE FUNCTION public.get_geographic_visibility_hidden_products_for_sector(
  p_sector_id uuid
)
RETURNS TABLE(
  product_id uuid,
  company_id uuid,
  rule_name text,
  scope character varying
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
BEGIN
    RETURN QUERY
    SELECT DISTINCT p.id, p.company_id, gvr.rule_name::text, gvr.scope
    FROM public.geographic_visibility_rules gvr
    JOIN public.products p
      ON (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
    WHERE gvr.is_active = true
      AND (
           gvr.scope = 'all'
        OR (gvr.scope = 'sectors' AND gvr.sector_ids @> ARRAY[p_sector_id])
        OR (
             gvr.scope = 'governorates'
             AND EXISTS (
               SELECT 1 FROM public.sector_governorates sg
               WHERE sg.sector_id = p_sector_id
                 AND gvr.governorate_ids @> ARRAY[sg.governorate_id]
             )
           )
      );
END;
$func$;

-- 8. INDEXES -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_geo_vis_gov_gin
    ON public.geographic_visibility_rules USING GIN (governorate_ids);
CREATE INDEX IF NOT EXISTS idx_geo_vis_sector_gin
    ON public.geographic_visibility_rules USING GIN (sector_ids);
CREATE INDEX IF NOT EXISTS idx_geo_vis_company_gin
    ON public.geographic_visibility_rules USING GIN (company_ids);
CREATE INDEX IF NOT EXISTS idx_geo_vis_product_gin
    ON public.geographic_visibility_rules USING GIN (product_ids);
CREATE INDEX IF NOT EXISTS idx_geo_vis_active
    ON public.geographic_visibility_rules(is_active) WHERE is_active = true;