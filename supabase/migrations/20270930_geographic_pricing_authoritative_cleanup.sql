-- ==========================================================================
-- GEOGRAPHIC PRICING: AUTHORITATIVE CONTRACT CLEANUP (Fix #4)
--
-- 1. Drop the obsolete single-company/single-product SCALAR overloads of the
--    governed rule RPCs so PostgREST unambiguously routes to the
--    multi-company/multi-product ARRAY contract (the authoritative source
--    used by the Store frontend).
-- 2. Add get_effective_geographic_adjustments: a batch resolver that reuses
--    the existing authoritative single resolver (no second pricing system).
-- ==========================================================================

-- 1a. Scalar create overload (single company/product) - obsolete.
DROP FUNCTION IF EXISTS public.governed_create_geographic_price_rule(
  uuid, character varying, numeric, character varying, uuid, uuid, uuid, uuid
);

-- 1b. Scalar update overload (single company/product) - obsolete.
DROP FUNCTION IF EXISTS public.governed_update_geographic_price_rule(
  uuid, uuid, character varying, numeric, boolean, character varying, uuid, uuid, uuid, uuid
);

-- 2. Batch authoritative resolver.
CREATE OR REPLACE FUNCTION public.get_effective_geographic_adjustments(
  p_governorate_id uuid,
  p_company_ids uuid[] DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  company_id uuid,
  adjustment_percent numeric,
  rule_name character varying,
  scope character varying,
  applied_level text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_count integer;
BEGIN
    IF p_company_ids IS NULL OR p_product_ids IS NULL THEN
        RETURN;
    END IF;
    v_count := least(array_length(p_company_ids, 1), array_length(p_product_ids, 1));
    IF v_count IS NULL OR v_count = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT g.product_id, g.company_id,
           a.adjustment_percent, a.rule_name, a.scope, a.applied_level
    FROM (
        SELECT p_product_ids[i] AS product_id, p_company_ids[i] AS company_id
        FROM generate_series(1, v_count) AS i
    ) g
    CROSS JOIN LATERAL public.get_effective_geographic_adjustment(
        p_governorate_id, g.company_id, g.product_id
    ) a;
END;
$func$;

COMMENT ON FUNCTION public.get_effective_geographic_adjustments IS
  'Batch geographic resolution reusing the authoritative single resolver. '
  'Parallel arrays, one entry per product/company pair. Returns the winning '
  'rule per product (explicit 0%% is a valid override). Absent rows mean no '
  'matching rule anywhere = original price.';