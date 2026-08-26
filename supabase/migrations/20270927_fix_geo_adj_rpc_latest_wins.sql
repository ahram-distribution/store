-- Fix get_effective_geographic_adjustment: add ORDER BY created_at DESC for latest-rule-wins
-- 0% rules already work because the RPC returns adjustment_percent=0 when a matching rule exists,
-- and IF FOUND stops resolution (does not fall through to broader scope).

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

    IF p_product_id IS NOT NULL AND p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_company_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id AND gpr.product_id = p_product_id AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_product_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.product_id = p_product_id AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_governorate'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_governorate' AND gpr.governorate_id = p_governorate_id
          AND gpr.company_id = p_company_id AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'governorate'::text
    FROM public.geographic_price_rules gpr
    WHERE gpr.scope = 'governorate' AND gpr.governorate_id = p_governorate_id AND gpr.is_active = true
    ORDER BY gpr.created_at DESC LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    IF p_product_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'product_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'product_sector' AND gpr.sector_id = v_sector_id
          AND gpr.product_id = p_product_id AND gpr.is_active = true
        ORDER BY gpr.created_at DESC LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    IF p_company_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
        RETURN QUERY SELECT gpr.adjustment_percent, gpr.rule_name, gpr.scope, 'company_sector'::text
        FROM public.geographic_price_rules gpr
        WHERE gpr.scope = 'company_sector' AND gpr.sector_id = v_sector_id
          AND gpr.company_id = p_company_id AND gpr.is_active = true
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
$$;
