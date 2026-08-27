-- Desktop migration 11: Sectors & Geographic Pricing
-- Mirrors remote migration 20270925_sectors_geographic_pricing.sql

CREATE TABLE IF NOT EXISTS public.sectors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    name_ar varchar(255),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sector_governorates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
    governorate_id uuid NOT NULL REFERENCES public.reference_governorates(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(sector_id, governorate_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sector_governorates_governorate
    ON public.sector_governorates(governorate_id);

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
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_geographic_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    assignment_type varchar(20) NOT NULL CHECK (assignment_type IN ('governorate', 'sector')),
    governorate_id uuid REFERENCES public.reference_governorates(id),
    sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- RPC: Resolve effective geographic adjustment (READ-ONLY for offline)
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
AS $$
DECLARE
    v_sector_id uuid;
BEGIN
    SELECT sg.sector_id INTO v_sector_id
    FROM public.sector_governorates sg WHERE sg.governorate_id = p_governorate_id LIMIT 1;

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

    RETURN QUERY
    SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'governorate'::text
    FROM public.geographic_price_rules gpr
    WHERE gpr.scope = 'governorate'
      AND gpr.governorate_id = p_governorate_id
      AND gpr.is_active = true
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

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

    RETURN;
END;
$$;

-- RPC: Get governorate sector
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

-- Indexes
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
