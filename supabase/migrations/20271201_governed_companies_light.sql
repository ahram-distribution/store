-- =============================================================================
-- get_governed_companies_light — light contract for list / dropdown callers
-- =============================================================================
--
-- WHY A SEPARATE FUNCTION INSTEAD OF CHANGING get_governed_companies
-- ------------------------------------------------------------------
-- get_governed_companies returns 9 fields, and one of them is expensive:
--
--   'product_count', (SELECT COUNT(*) FROM products p WHERE p.company_id = comp.id)
--
-- That correlated COUNT runs once per company, for EVERY company, with no
-- LIMIT — so the cost grows with (companies x products) on every call, and
-- the whole array is serialised to the browser. It is also the only field
-- any caller outside the Companies ADMIN screen actually reads.
--
-- Measured: ~40 companies => ~79.7 KB of JSON for what is, at most, a
-- name + id dropdown list.
--
-- A field-usage audit of all 7 call sites established:
--
--   needs product_count : useCompanyMutations (feeds CompanyManagerPage,
--                         which displays product_count and bonus_enabled)
--   needs 3 fields only : CompanyProfilePage  (id, company_name, is_visible)
--   needs 2 fields only : ProductManagerPage  (id, company_name)
--   needs 4 fields      : SupremeOrderEditor, OrderDetailPage, OrderEditPage,
--                         SalesListPage  (id, company_name, logo_url,
--                         is_visible)
--
--   NO caller anywhere reads `is_active` or `created_at`.
--
-- So the correct fix is NOT to strip fields from the shared function (that
-- would break CompanyManagerPage) and NOT to add an overload. It is a second,
-- explicitly-named function:
--
--   - distinct NAME, so there is no PGRST203 named-argument ambiguity
--   - omits ONLY the expensive product_count, plus the two never-read fields
--   - keeps every field the light callers demonstrably use
--   - same ordering, same session validation, same security model
--
-- get_governed_companies is left BYTE-FOR-BYTE UNCHANGED and is still what
-- the admin screens and CompanyProfilePage call.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_companies_light(p_token uuid)
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

  -- No product_count correlated subquery, and no is_active / created_at.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', comp.id,
      'company_name', comp.company_name,
      'legacy_code', comp.legacy_code,
      'is_visible', comp.is_visible,
      'logo_url', comp.logo_url,
      'bonus_enabled', comp.bonus_enabled
    ) ORDER BY comp.company_name
  ) INTO v_result FROM companies comp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_governed_companies_light(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_governed_companies_light IS
  'قائمة الشركات (خفيف) للقوائم والمنسدولات — بدون product_count/created_at/is_active';


-- =============================================================================
-- get_governed_companies_minimal — for callers that render NO logo
-- =============================================================================
--
-- MEASURED FINDING: get_governed_companies_light only cut the response by
-- 3% JSON / 0.4% gzip (118,049 -> 114,451 B), because the payload was never
-- dominated by the fields it removed:
--
--   40 companies, 33 with a logo, 15 of those stored as base64 data URIs,
--   105 kB of logo_url out of a 118 kB response (~2.7 kB average each).
--
-- logo_url is ~89% of the entire response. Removing product_count cannot
-- matter until logo_url is out of the picture.
--
-- A field audit shows two callers never render a logo and re-project their
-- rows before use:
--
--   ProductManagerPage : every consumer re-projects to { id, company_name }
--   SalesListPage      : hard-projects to { id, company_name } after an
--                        is_visible filter
--
-- They need only identity + display name + the visibility flag. For those,
-- logo_url is ~2.7 kB of base64 per row that is transferred, decoded and
-- discarded. This third contract omits it.
--
-- Deliberately NOT changed: the 4 logo-tile callers (SupremeOrderEditor,
-- OrderDetailPage, OrderEditPage) and the admin chain keep logo_url.
-- Inline base64 is a data-modelling problem tracked separately — this only
-- stops shipping image bytes to screens that never draw them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_companies_minimal(p_token uuid)
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
      'is_visible', comp.is_visible
    ) ORDER BY comp.company_name
  ) INTO v_result FROM companies comp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_governed_companies_minimal(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_governed_companies_minimal IS
  'قائمة الشركات (الأخف) — الهوية والاسم والرؤية فقط، بدون شعار أو عدد منتجات';

NOTIFY pgrst, 'reload schema';
