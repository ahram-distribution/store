-- Multi-company/multi-product geographic pricing rules
-- Adds array columns for multi-selection support

-- 1. Add array columns
ALTER TABLE geographic_price_rules ADD COLUMN IF NOT EXISTS company_ids uuid[] DEFAULT '{}';
ALTER TABLE geographic_price_rules ADD COLUMN IF NOT EXISTS product_ids uuid[] DEFAULT '{}';

-- 2. Migrate existing single values to arrays
UPDATE geographic_price_rules
SET company_ids = CASE WHEN company_id IS NOT NULL THEN ARRAY[company_id] ELSE '{}' END,
    product_ids = CASE WHEN product_id IS NOT NULL THEN ARRAY[product_id] ELSE '{}' END
WHERE company_ids = '{}' AND product_ids = '{}';

-- 3. Update check constraint to validate arrays
ALTER TABLE geographic_price_rules DROP CONSTRAINT IF EXISTS geographic_price_rules_fields_check;

ALTER TABLE geographic_price_rules ADD CONSTRAINT geographic_price_rules_fields_check CHECK (
  (scope = 'sector' AND sector_id IS NOT NULL AND company_ids = '{}' AND product_ids = '{}' AND governorate_id IS NULL) OR
  (scope = 'governorate' AND governorate_id IS NOT NULL AND company_ids = '{}' AND product_ids = '{}' AND sector_id IS NULL) OR
  (scope = 'company_sector' AND sector_id IS NOT NULL AND company_ids <> '{}' AND product_ids = '{}' AND governorate_id IS NULL) OR
  (scope = 'product_sector' AND sector_id IS NOT NULL AND product_ids <> '{}' AND company_ids <> '{}' AND governorate_id IS NULL) OR
  (scope = 'company_governorate' AND governorate_id IS NOT NULL AND company_ids <> '{}' AND product_ids = '{}' AND sector_id IS NULL) OR
  (scope = 'product_governorate' AND governorate_id IS NOT NULL AND product_ids <> '{}' AND company_ids <> '{}' AND sector_id IS NULL) OR
  (scope = 'product_company_governorate' AND governorate_id IS NOT NULL AND company_ids <> '{}' AND product_ids <> '{}' AND sector_id IS NULL)
);

-- 4. Update get_effective_geographic_adjustment to use = ANY() for array matching
CREATE OR REPLACE FUNCTION public.get_effective_geographic_adjustment(
  p_governorate_id uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_product_id uuid DEFAULT NULL::uuid,
  p_sector_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(adjustment_percent numeric, rule_name character varying, scope character varying, applied_level text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE v_sector_id uuid;
BEGIN
    IF p_sector_id IS NOT NULL THEN
        v_sector_id := p_sector_id;
    ELSE
        SELECT sg.sector_id INTO v_sector_id
        FROM public.sector_governorates sg WHERE sg.governorate_id = p_governorate_id LIMIT 1;
    END IF;

    -- Governorate chain (higher priority)
    IF p_product_id IS NOT NULL AND p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_company_governorate' AND gpr.governorate_id = p_governorate_id
          AND p_company_id = ANY(gpr.company_ids) AND p_product_id = ANY(gpr.product_ids) AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_product_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_governorate' AND gpr.governorate_id = p_governorate_id
          AND p_product_id = ANY(gpr.product_ids) AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_governorate' AND gpr.governorate_id = p_governorate_id
          AND p_company_id = ANY(gpr.company_ids) AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'governorate'::text
    FROM public.geographic_price_rules gpr
    WHERE gpr.scope = 'governorate' AND gpr.governorate_id = p_governorate_id AND gpr.is_active = true
    ORDER BY gpr.created_at DESC LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Sector chain (lower priority)
    IF p_product_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_sector' AND gpr.sector_id = v_sector_id
          AND p_product_id = ANY(gpr.product_ids) AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_sector' AND gpr.sector_id = v_sector_id
          AND p_company_id = ANY(gpr.company_ids) AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'sector' AND gpr.sector_id = v_sector_id AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    RETURN;
END;
$func$;

-- 5. Update governed_create_geographic_price_rule to accept arrays
CREATE OR REPLACE FUNCTION public.governed_create_geographic_price_rule(
  p_token uuid,
  p_rule_name character varying,
  p_adjustment_percent numeric,
  p_scope character varying,
  p_sector_id uuid DEFAULT NULL::uuid,
  p_governorate_id uuid DEFAULT NULL::uuid,
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
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_pricing.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.manage';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.geographic_price_rules (
        id, rule_name, adjustment_percent, scope,
        sector_id, governorate_id, company_ids, product_ids
    ) VALUES (
        v_id, p_rule_name, p_adjustment_percent, p_scope,
        p_sector_id, p_governorate_id, p_company_ids, p_product_ids
    );
    RETURN v_id;
END;
$func$;

-- 6. Update governed_update_geographic_price_rule to accept arrays
CREATE OR REPLACE FUNCTION public.governed_update_geographic_price_rule(
  p_token uuid,
  p_rule_id uuid,
  p_rule_name character varying DEFAULT NULL::character varying,
  p_adjustment_percent numeric DEFAULT NULL::numeric,
  p_is_active boolean DEFAULT NULL::boolean,
  p_scope character varying DEFAULT NULL::character varying,
  p_sector_id uuid DEFAULT NULL::uuid,
  p_governorate_id uuid DEFAULT NULL::uuid,
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
    v_new_sector_id uuid;
    v_new_governorate_id uuid;
    v_new_company_ids uuid[];
    v_new_product_ids uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_pricing.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.manage';
    END IF;

    SELECT scope, sector_id, governorate_id, company_ids, product_ids
    INTO v_new_scope, v_new_sector_id, v_new_governorate_id, v_new_company_ids, v_new_product_ids
    FROM public.geographic_price_rules WHERE id = p_rule_id;

    v_new_scope       := COALESCE(p_scope, v_new_scope);
    v_new_sector_id   := COALESCE(p_sector_id, v_new_sector_id);
    v_new_governorate_id := COALESCE(p_governorate_id, v_new_governorate_id);
    IF p_company_ids IS NOT NULL THEN v_new_company_ids := p_company_ids; END IF;
    IF p_product_ids IS NOT NULL THEN v_new_product_ids := p_product_ids; END IF;

    UPDATE public.geographic_price_rules SET
        rule_name         = COALESCE(p_rule_name, rule_name),
        adjustment_percent = COALESCE(p_adjustment_percent, adjustment_percent),
        is_active         = COALESCE(p_is_active, is_active),
        scope             = v_new_scope,
        sector_id         = v_new_sector_id,
        governorate_id    = v_new_governorate_id,
        company_ids       = v_new_company_ids,
        product_ids       = v_new_product_ids,
        updated_at        = now()
    WHERE id = p_rule_id;

    RETURN FOUND;
END;
$func$;

-- 7. Update get_geographic_price_rules to return arrays with resolved names
DROP FUNCTION IF EXISTS public.get_geographic_price_rules(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_geographic_price_rules(
  p_token uuid,
  p_sector_id uuid DEFAULT NULL::uuid,
  p_governorate_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid, rule_name character varying, adjustment_percent numeric, scope character varying,
  sector_id uuid, sector_name character varying,
  governorate_id uuid, governorate_name character varying,
  company_ids uuid[], company_names character varying[],
  product_ids uuid[], product_names character varying[],
  is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone
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
    SELECT gpr.id, gpr.rule_name, gpr.adjustment_percent, gpr.scope,
           gpr.sector_id, COALESCE(s.name_ar, s.name) AS sector_name,
           gpr.governorate_id, rg.name_ar AS governorate_name,
           gpr.company_ids,
           ARRAY(SELECT c.company_name FROM public.companies c WHERE c.id = ANY(gpr.company_ids)) AS company_names,
           gpr.product_ids,
           ARRAY(SELECT p.product_name FROM public.products p WHERE p.id = ANY(gpr.product_ids)) AS product_names,
           gpr.is_active, gpr.created_at, gpr.updated_at
    FROM public.geographic_price_rules gpr
    LEFT JOIN public.sectors s ON s.id = gpr.sector_id
    LEFT JOIN public.reference_governorates rg ON rg.id = gpr.governorate_id
    WHERE (p_sector_id IS NULL OR gpr.sector_id = p_sector_id)
      AND (p_governorate_id IS NULL OR gpr.governorate_id = p_governorate_id)
    ORDER BY gpr.scope, gpr.rule_name;
END;
$func$;
