-- ==========================================================================
-- GEOGRAPHIC PRICE LISTS: SERVER-GOVERNED SECTOR BATCH RESOLVER
--
-- Purpose: serve the new Upper-Management قوائم الأسعار الجغرافية screen
-- (سعر القطاع mode). The existing batch resolver
-- (get_effective_geographic_adjustments) is governorate-only. This RPC mirrors
-- its shape but resolves adjustments for a SECTOR by reusing the authoritative
-- single resolver (get_effective_geographic_adjustment) with
-- p_governorate_id = NULL and p_sector_id set, so only the sector chain
-- applies (same engine, no second pricing system).
--
-- Server-governed: valid session + geographic_pricing.read capability.
-- (الإدارة العليا passes via check_capability's upper-management bypass.)
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.get_effective_geographic_adjustments_for_sector(
  p_token uuid,
  p_sector_id uuid,
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
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $func$
DECLARE
    v_session app.sessions;
    v_count integer;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

    IF NOT public.check_capability(p_token, 'geographic_pricing.read') THEN
        RAISE EXCEPTION 'MISSING_CAPABILITY: geographic_pricing.read';
    END IF;

    IF p_sector_id IS NULL OR p_company_ids IS NULL OR p_product_ids IS NULL THEN
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
        NULL::uuid, g.company_id, g.product_id, p_sector_id
    ) a;
END;
$func$;

COMMENT ON FUNCTION public.get_effective_geographic_adjustments_for_sector IS
  'Sector-scoped batch geographic resolution reusing the authoritative single '
  'resolver (governorate NULL, sector set so the governorate chain is skipped '
  'and only sector-scope rules are evaluated). Server-governed via '
  'geographic_pricing.read. Absent rows mean no matching sector rule = original price.';

GRANT EXECUTE ON FUNCTION public.get_effective_geographic_adjustments_for_sector TO authenticated;

NOTIFY pgrst, 'reload schema';