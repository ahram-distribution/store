-- Extend governed_update_geographic_price_rule to accept scope + FK fields
-- so the UI can fully edit a geographic pricing rule.

CREATE OR REPLACE FUNCTION public.governed_update_geographic_price_rule(
    p_token uuid,
    p_rule_id uuid,
    p_rule_name character varying DEFAULT NULL,
    p_adjustment_percent numeric DEFAULT NULL,
    p_is_active boolean DEFAULT NULL,
    p_scope character varying DEFAULT NULL,
    p_sector_id uuid DEFAULT NULL,
    p_governorate_id uuid DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_product_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session app.sessions;
    v_new_scope varchar(30);
    v_new_sector_id uuid;
    v_new_governorate_id uuid;
    v_new_company_id uuid;
    v_new_product_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF NOT public.check_capability(p_token, 'geographic_pricing.manage') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.manage';
    END IF;

    -- Resolve new values: use provided param or fall back to current DB value
    SELECT scope, sector_id, governorate_id, company_id, product_id
    INTO v_new_scope, v_new_sector_id, v_new_governorate_id, v_new_company_id, v_new_product_id
    FROM public.geographic_price_rules WHERE id = p_rule_id;

    v_new_scope       := COALESCE(p_scope, v_new_scope);
    v_new_sector_id   := COALESCE(p_sector_id, v_new_sector_id);
    v_new_governorate_id := COALESCE(p_governorate_id, v_new_governorate_id);
    v_new_company_id  := COALESCE(p_company_id, v_new_company_id);
    v_new_product_id  := COALESCE(p_product_id, v_new_product_id);

    UPDATE public.geographic_price_rules SET
        rule_name         = COALESCE(p_rule_name, rule_name),
        adjustment_percent = COALESCE(p_adjustment_percent, adjustment_percent),
        is_active         = COALESCE(p_is_active, is_active),
        scope             = v_new_scope,
        sector_id         = v_new_sector_id,
        governorate_id    = v_new_governorate_id,
        company_id        = v_new_company_id,
        product_id        = v_new_product_id,
        updated_at        = now()
    WHERE id = p_rule_id;

    RETURN FOUND;
END;
$$;
