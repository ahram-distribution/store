-- Add company_sector and product_sector scopes to geographic pricing
-- Fix sector_name to use Arabic name (name_ar)
-- Extend price resolution with sector-based priority chain

-- 1. Add new scope values
ALTER TABLE public.geographic_price_rules
    DROP CONSTRAINT IF EXISTS geographic_price_rules_scope_check;

ALTER TABLE public.geographic_price_rules
    ADD CONSTRAINT geographic_price_rules_scope_check
    CHECK (scope IN (
        'sector', 'governorate',
        'company_governorate', 'product_governorate', 'product_company_governorate',
        'company_sector', 'product_sector'
    ));

-- 2. Update field-consistency CHECK constraint
DO $$
DECLARE
    v_conname text;
BEGIN
    SELECT conname INTO v_conname
    FROM pg_constraint
    WHERE conrelid = 'public.geographic_price_rules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%scope = %sector_id IS NOT NULL%'
    LIMIT 1;

    IF v_conname IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.geographic_price_rules DROP CONSTRAINT ' || quote_ident(v_conname);
    END IF;
END $$;

ALTER TABLE public.geographic_price_rules
    ADD CONSTRAINT geographic_price_rules_fields_check
    CHECK (
        (scope = 'sector' AND sector_id IS NOT NULL AND governorate_id IS NULL AND company_id IS NULL AND product_id IS NULL)
        OR (scope = 'governorate' AND governorate_id IS NOT NULL AND company_id IS NULL AND product_id IS NULL)
        OR (scope = 'company_governorate' AND governorate_id IS NOT NULL AND company_id IS NOT NULL AND product_id IS NULL)
        OR (scope = 'product_governorate' AND governorate_id IS NOT NULL AND product_id IS NOT NULL AND company_id IS NULL)
        OR (scope = 'product_company_governorate' AND governorate_id IS NOT NULL AND company_id IS NOT NULL AND product_id IS NOT NULL)
        OR (scope = 'company_sector' AND sector_id IS NOT NULL AND company_id IS NOT NULL AND governorate_id IS NULL AND product_id IS NULL)
        OR (scope = 'product_sector' AND sector_id IS NOT NULL AND product_id IS NOT NULL AND governorate_id IS NULL AND company_id IS NULL)
    );

-- 3. Fix get_geographic_price_rules to use Arabic sector name
CREATE OR REPLACE FUNCTION public.get_geographic_price_rules(
    p_token uuid,
    p_sector_id uuid DEFAULT NULL,
    p_governorate_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid, rule_name varchar, adjustment_percent numeric, scope varchar,
    sector_id uuid, sector_name varchar,
    governorate_id uuid, governorate_name varchar,
    company_id uuid, company_name varchar,
    product_id uuid, product_name varchar,
    is_active boolean, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT gpr.id, gpr.rule_name, gpr.adjustment_percent, gpr.scope,
           gpr.sector_id, COALESCE(s.name_ar, s.name) AS sector_name,
           gpr.governorate_id, rg.name_ar AS governorate_name,
           gpr.company_id, c.company_name,
           gpr.product_id, p.product_name,
           gpr.is_active, gpr.created_at, gpr.updated_at
    FROM public.geographic_price_rules gpr
    LEFT JOIN public.sectors s ON s.id = gpr.sector_id
    LEFT JOIN public.reference_governorates rg ON rg.id = gpr.governorate_id
    LEFT JOIN public.companies c ON c.id = gpr.company_id
    LEFT JOIN public.products p ON p.id = gpr.product_id
    WHERE (p_sector_id IS NULL OR gpr.sector_id = p_sector_id)
      AND (p_governorate_id IS NULL OR gpr.governorate_id = p_governorate_id)
    ORDER BY gpr.scope, gpr.rule_name;
END;
$$;

-- 4. Extend price resolution with sector-based priority chain
CREATE OR REPLACE FUNCTION public.get_effective_geographic_adjustment(
    p_governorate_id uuid,
    p_company_id uuid DEFAULT NULL,
    p_product_id uuid DEFAULT NULL,
    p_sector_id uuid DEFAULT NULL
)
RETURNS TABLE (adjustment_percent numeric, rule_name varchar, scope varchar, applied_level text)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
DECLARE v_sector_id uuid;
BEGIN
    IF p_sector_id IS NOT NULL THEN
        v_sector_id := p_sector_id;
    ELSE
        SELECT sg.sector_id INTO v_sector_id
        FROM public.sector_governorates sg WHERE sg.governorate_id = p_governorate_id LIMIT 1;
    END IF;

    -- Governorate chain: product+company+gov → product+gov → company+gov → gov
    IF p_product_id IS NOT NULL AND p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_company_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id AND gpr.product_id = p_product_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_product_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.product_id = p_product_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'governorate'::text
    FROM public.geographic_price_rules gpr
    WHERE gpr.scope = 'governorate' AND gpr.governorate_id = p_governorate_id AND gpr.is_active = true
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Sector chain: product+sector → company+sector → sector
    IF p_product_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_sector' AND gpr.sector_id = v_sector_id
          AND gpr.product_id = p_product_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_sector' AND gpr.sector_id = v_sector_id
          AND gpr.company_id = p_company_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'sector' AND gpr.sector_id = v_sector_id AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    RETURN;
END;
$$;
