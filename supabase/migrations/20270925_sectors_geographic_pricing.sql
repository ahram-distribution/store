-- ============================================================
-- SECTORS, GOVERNORATE MAPPING & GEOGRAPHIC PRICING
-- Surgical additive migration — zero modifications to existing objects
-- ============================================================

-- 1. SECTORS
CREATE TABLE IF NOT EXISTS public.sectors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    name_ar varchar(255),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sectors IS 'Geographic sectors grouping governorates for pricing and assignment.';

-- 2. SECTOR ↔ GOVERNORATE MAPPING (one governorate → exactly one sector)
CREATE TABLE IF NOT EXISTS public.sector_governorates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
    governorate_id uuid NOT NULL REFERENCES public.reference_governorates(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(sector_id, governorate_id)
);

COMMENT ON TABLE public.sector_governorates IS 'Maps governorates to sectors. Each governorate belongs to exactly one sector.';

-- Enforce one governorate → one sector at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uq_sector_governorates_governorate
    ON public.sector_governorates(governorate_id);

-- 3. GEOGRAPHIC PRICE RULES
CREATE TABLE IF NOT EXISTS public.geographic_price_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name varchar(255) NOT NULL,
    adjustment_percent numeric(7,4) NOT NULL,
    scope varchar(30) NOT NULL CHECK (scope IN (
        'sector', 'governorate', 'company_governorate', 'product_governorate', 'product_company_governorate'
    )),
    sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE,
    governorate_id uuid REFERENCES public.reference_governorates(id),
    company_id uuid REFERENCES public.companies(id),
    product_id uuid REFERENCES public.products(id),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (sector_id IS NOT NULL OR governorate_id IS NOT NULL),
    CHECK (
        (scope = 'sector' AND sector_id IS NOT NULL AND governorate_id IS NULL AND company_id IS NULL AND product_id IS NULL)
        OR (scope = 'governorate' AND governorate_id IS NOT NULL AND company_id IS NULL AND product_id IS NULL)
        OR (scope = 'company_governorate' AND governorate_id IS NOT NULL AND company_id IS NOT NULL AND product_id IS NULL)
        OR (scope = 'product_governorate' AND governorate_id IS NOT NULL AND product_id IS NOT NULL AND company_id IS NULL)
        OR (scope = 'product_company_governorate' AND governorate_id IS NOT NULL AND company_id IS NOT NULL AND product_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.geographic_price_rules IS 'Geographic pricing adjustments. Percentage applied to original unit price. No stacking — most specific wins.';

-- 4. EMPLOYEE GEOGRAPHIC ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.employee_geographic_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    assignment_type varchar(20) NOT NULL CHECK (assignment_type IN ('governorate', 'sector')),
    governorate_id uuid REFERENCES public.reference_governorates(id),
    sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (assignment_type = 'governorate' AND governorate_id IS NOT NULL AND sector_id IS NULL)
        OR (assignment_type = 'sector' AND sector_id IS NOT NULL AND governorate_id IS NULL)
    )
);

COMMENT ON TABLE public.employee_geographic_assignments IS 'Geographic scope assignments for employees (reps/managers).';

-- 5. CAPABILITIES
INSERT INTO public.capabilities (code, name, "group") VALUES
    ('sectors.create', 'إنشاء القطاعات', 'sectors'),
    ('sectors.manage', 'إدارة القطاعات', 'sectors'),
    ('sectors.read', 'عرض القطاعات', 'sectors'),
    ('geographic_pricing.manage', 'إدارة التسعير الجغرافي', 'geographic_pricing'),
    ('geographic_pricing.read', 'عرض التسعير الجغرافي', 'geographic_pricing'),
    ('geographic_assignment.manage', 'إدارة التعيينات الجغرافية', 'geographic_assignment')
ON CONFLICT (code) DO NOTHING;

-- Assign sectors.manage to الإدارة العليا
DO $$
DECLARE
    v_um_role_id uuid;
    v_cap_id uuid;
    v_codes text[] := ARRAY['sectors.create','sectors.manage','sectors.read','geographic_pricing.manage','geographic_pricing.read','geographic_assignment.manage'];
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

-- ============================================================
-- RPCs: SECTOR CRUD
-- ============================================================

CREATE OR REPLACE FUNCTION public.governed_create_sector(
    p_token uuid,
    p_name character varying,
    p_name_ar character varying DEFAULT NULL,
    p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
    v_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'sectors.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: sectors.manage';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.sectors (id, name, name_ar, description)
    VALUES (v_id, p_name, p_name_ar, p_description);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_update_sector(
    p_token uuid,
    p_sector_id uuid,
    p_name character varying DEFAULT NULL,
    p_name_ar character varying DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'sectors.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: sectors.manage';
    END IF;
    UPDATE public.sectors SET
        name = COALESCE(p_name, name),
        name_ar = COALESCE(p_name_ar, name_ar),
        description = COALESCE(p_description, description),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_sector_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_delete_sector(
    p_token uuid,
    p_sector_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'sectors.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: sectors.manage';
    END IF;
    DELETE FROM public.sectors WHERE id = p_sector_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_governed_sectors(
    p_token uuid,
    p_search text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    name varchar,
    name_ar varchar,
    description text,
    is_active boolean,
    governorate_count bigint,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT s.id, s.name, s.name_ar, s.description, s.is_active,
           (SELECT count(*) FROM public.sector_governorates sg WHERE sg.sector_id = s.id) AS governorate_count,
           s.created_at, s.updated_at
    FROM public.sectors s
    WHERE (p_search IS NULL OR s.name ILIKE '%' || p_search || '%' OR s.name_ar ILIKE '%' || p_search || '%')
    ORDER BY s.name_ar NULLS LAST, s.name;
END;
$$;

-- ============================================================
-- RPCs: SECTOR ↔ GOVERNORATE MAPPING
-- ============================================================

CREATE OR REPLACE FUNCTION public.governed_set_sector_governorates(
    p_token uuid,
    p_sector_id uuid,
    p_governorate_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
    v_count integer := 0;
    v_gov_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'sectors.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: sectors.manage';
    END IF;
    -- Remove existing mappings for this sector
    DELETE FROM public.sector_governorates WHERE sector_id = p_sector_id;
    -- Insert new mappings
    FOREACH v_gov_id IN ARRAY p_governorate_ids LOOP
        INSERT INTO public.sector_governorates (sector_id, governorate_id)
        VALUES (p_sector_id, v_gov_id)
        ON CONFLICT DO NOTHING;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sector_governorates(
    p_token uuid,
    p_sector_id uuid
)
RETURNS TABLE (
    governorate_id uuid,
    governorate_code varchar,
    governorate_name_ar varchar,
    governorate_name_en varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT rg.id, rg.code, rg.name_ar, rg.name_en
    FROM public.sector_governorates sg
    JOIN public.reference_governorates rg ON rg.id = sg.governorate_id
    WHERE sg.sector_id = p_sector_id
    ORDER BY rg.display_order, rg.name_ar;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_governorate_sector(
    p_governorate_id uuid
)
RETURNS TABLE (
    sector_id uuid,
    sector_name varchar,
    sector_name_ar varchar
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.name, s.name_ar
    FROM public.sector_governorates sg
    JOIN public.sectors s ON s.id = sg.sector_id
    WHERE sg.governorate_id = p_governorate_id AND s.is_active = true
    LIMIT 1;
END;
$$;

-- ============================================================
-- RPCs: GEOGRAPHIC PRICE RULES CRUD
-- ============================================================

CREATE OR REPLACE FUNCTION public.governed_create_geographic_price_rule(
    p_token uuid,
    p_rule_name character varying,
    p_adjustment_percent numeric,
    p_scope character varying,
    p_sector_id uuid DEFAULT NULL,
    p_governorate_id uuid DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_product_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
        sector_id, governorate_id, company_id, product_id
    ) VALUES (
        v_id, p_rule_name, p_adjustment_percent, p_scope,
        p_sector_id, p_governorate_id, p_company_id, p_product_id
    );
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_update_geographic_price_rule(
    p_token uuid,
    p_rule_id uuid,
    p_rule_name character varying DEFAULT NULL,
    p_adjustment_percent numeric DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_pricing.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.manage';
    END IF;
    UPDATE public.geographic_price_rules SET
        rule_name = COALESCE(p_rule_name, rule_name),
        adjustment_percent = COALESCE(p_adjustment_percent, adjustment_percent),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_rule_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_delete_geographic_price_rule(
    p_token uuid,
    p_rule_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_pricing.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.manage';
    END IF;
    DELETE FROM public.geographic_price_rules WHERE id = p_rule_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_geographic_price_rules(
    p_token uuid,
    p_sector_id uuid DEFAULT NULL,
    p_governorate_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    rule_name varchar,
    adjustment_percent numeric,
    scope varchar,
    sector_id uuid,
    sector_name varchar,
    governorate_id uuid,
    governorate_name varchar,
    company_id uuid,
    company_name varchar,
    product_id uuid,
    product_name varchar,
    is_active boolean,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT gpr.id, gpr.rule_name, gpr.adjustment_percent, gpr.scope,
           gpr.sector_id, s.name AS sector_name,
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

-- ============================================================
-- RPC: RESOLVE EFFECTIVE GEOGRAPHIC ADJUSTMENT
-- Priority: Product → Company → Governorate → Sector → Original Price
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_effective_geographic_adjustment(
    p_governorate_id uuid,
    p_company_id uuid DEFAULT NULL,
    p_product_id uuid DEFAULT NULL
)
RETURNS TABLE (
    adjustment_percent numeric,
    rule_name varchar,
    scope varchar,
    applied_level text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_sector_id uuid;
BEGIN
    -- Resolve sector from governorate
    SELECT sg.sector_id INTO v_sector_id
    FROM public.sector_governorates sg WHERE sg.governorate_id = p_governorate_id LIMIT 1;

    -- Priority 1: Product + Company + Governorate
    IF p_product_id IS NOT NULL AND p_company_id IS NOT NULL THEN
        RETURN QUERY
        SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_company_governorate'
          AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id
          AND gpr.product_id = p_product_id
          AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Priority 2: Product + Governorate
    IF p_product_id IS NOT NULL THEN
        RETURN QUERY
        SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_governorate'
          AND gpr.governorate_id = p_governorate_id
          AND gpr.product_id = p_product_id
          AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Priority 3: Company + Governorate
    IF p_company_id IS NOT NULL THEN
        RETURN QUERY
        SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_governorate'
          AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id
          AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Priority 4: Governorate only
    RETURN QUERY
    SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'governorate'::text
    FROM public.geographic_price_rules gpr
    WHERE gpr.scope = 'governorate'
      AND gpr.governorate_id = p_governorate_id
      AND gpr.is_active = true
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Priority 5: Sector (only if sector exists for this governorate)
    IF v_sector_id IS NOT NULL THEN
        RETURN QUERY
        SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'sector'
          AND gpr.sector_id = v_sector_id
          AND gpr.is_active = true
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- No rule found — no adjustment
    RETURN;
END;
$$;

-- ============================================================
-- RPCs: EMPLOYEE GEOGRAPHIC ASSIGNMENTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.governed_assign_employee_geographic(
    p_token uuid,
    p_employee_id uuid,
    p_assignment_type character varying,
    p_governorate_id uuid DEFAULT NULL,
    p_sector_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
    v_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_assignment.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_assignment.manage';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.employee_geographic_assignments (id, employee_id, assignment_type, governorate_id, sector_id)
    VALUES (v_id, p_employee_id, p_assignment_type, p_governorate_id, p_sector_id);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_remove_employee_geographic(
    p_token uuid,
    p_assignment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_assignment.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_assignment.manage';
    END IF;
    DELETE FROM public.employee_geographic_assignments WHERE id = p_assignment_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_geographic_assignments(
    p_token uuid,
    p_employee_id uuid
)
RETURNS TABLE (
    id uuid,
    employee_id uuid,
    assignment_type varchar,
    governorate_id uuid,
    governorate_name varchar,
    sector_id uuid,
    sector_name varchar,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT ega.id, ega.employee_id, ega.assignment_type,
           ega.governorate_id, rg.name_ar AS governorate_name,
           ega.sector_id, s.name AS sector_name,
           ega.created_at
    FROM public.employee_geographic_assignments ega
    LEFT JOIN public.reference_governorates rg ON rg.id = ega.governorate_id
    LEFT JOIN public.sectors s ON s.id = ega.sector_id
    WHERE ega.employee_id = p_employee_id
    ORDER BY ega.assignment_type, rg.name_ar NULLS LAST, s.name NULLS LAST;
END;
$$;

-- ============================================================
-- RPC: GET GOVERNMENTOATE-BASED CUSTOMER SECTOR (derived)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_sector_info(
    p_customer_id uuid
)
RETURNS TABLE (
    governorate_id uuid,
    governorate_name varchar,
    sector_id uuid,
    sector_name varchar
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT ca.governorate_id, rg.name_ar AS governorate_name,
           s.id AS sector_id, s.name AS sector_name
    FROM public.customer_addresses ca
    JOIN public.reference_governorates rg ON rg.id = ca.governorate_id
    LEFT JOIN public.sector_governorates sg ON sg.governorate_id = ca.governorate_id
    LEFT JOIN public.sectors s ON s.id = sg.sector_id AND s.is_active = true
    WHERE ca.customer_id = p_customer_id AND ca.is_default = true
    LIMIT 1;
END;
$$;

-- ============================================================
-- RPC: COUNT AFFECTED CUSTOMERS PER GOVERNORATE/SECTOR
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_geographic_customer_counts(
    p_token uuid
)
RETURNS TABLE (
    governorate_id uuid,
    governorate_name varchar,
    sector_id uuid,
    sector_name varchar,
    customer_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    RETURN QUERY
    SELECT ca.governorate_id, rg.name_ar AS governorate_name,
           sg.sector_id, s.name AS sector_name,
           count(DISTINCT ca.customer_id) AS customer_count
    FROM public.customer_addresses ca
    JOIN public.reference_governorates rg ON rg.id = ca.governorate_id
    LEFT JOIN public.sector_governorates sg ON sg.governorate_id = ca.governorate_id
    LEFT JOIN public.sectors s ON s.id = sg.sector_id
    WHERE ca.governorate_id IS NOT NULL
    GROUP BY ca.governorate_id, rg.name_ar, sg.sector_id, s.name
    ORDER BY s.name NULLS LAST, rg.name_ar;
END;
$$;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sector_governorates_sector ON public.sector_governorates(sector_id);
CREATE INDEX IF NOT EXISTS idx_sector_governorates_governorate ON public.sector_governorates(governorate_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_sector ON public.geographic_price_rules(sector_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_governorate ON public.geographic_price_rules(governorate_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_company ON public.geographic_price_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_product ON public.geographic_price_rules(product_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_active ON public.geographic_price_rules(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_emp_geo_employee ON public.employee_geographic_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_geo_governorate ON public.employee_geographic_assignments(governorate_id);
CREATE INDEX IF NOT EXISTS idx_emp_geo_sector ON public.employee_geographic_assignments(sector_id);
