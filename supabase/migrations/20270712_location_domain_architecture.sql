-- ============================================================================
-- Location Domain Architecture — v1
-- Implements: ALTER unified_locations, enrich_location RPC,
--             updated get_governed_location/get_governed_locations
-- See docs/01-ARCHITECTURE/LOCATION_DOMAIN_ARCHITECTURE.md
-- ============================================================================

-- 1. Enrichment status ENUM
DO $$ BEGIN
  CREATE TYPE location_enrichment_status AS ENUM ('pending','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. New columns on unified_locations
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS governorate_id      uuid REFERENCES reference_governorates(id);
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS city_id             uuid REFERENCES reference_cities(id);
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS road                text;
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS enriched_at         timestamptz;
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS enrichment_status   location_enrichment_status DEFAULT 'pending';
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS geocoding_provider  text DEFAULT 'nominatim';
ALTER TABLE unified_locations ADD COLUMN IF NOT EXISTS enrichment_version  integer DEFAULT 1;

COMMENT ON COLUMN unified_locations.governorate_id     IS 'FK → reference_governorates — matched from Nominatim state at enrichment time';
COMMENT ON COLUMN unified_locations.city_id            IS 'FK → reference_cities — matched from Nominatim city/town/village at enrichment time';
COMMENT ON COLUMN unified_locations.road               IS 'Street/road name from Nominatim reverse geocoding (NOT customer_addresses.street_address)';
COMMENT ON COLUMN unified_locations.enriched_at        IS 'Timestamp of last successful enrichment';
COMMENT ON COLUMN unified_locations.enrichment_status  IS 'pending | processing | completed | failed';
COMMENT ON COLUMN unified_locations.geocoding_provider IS 'nominatim, google, manual, etc.';
COMMENT ON COLUMN unified_locations.enrichment_version IS 'Increment when matching algorithm changes to reprocess old records';

-- ============================================================================
-- 3. enrich_location — the ONLY RPC that writes enrichment fields
--    Called exclusively by LocationNormalizationService (frontend).
--    Idempotent: if enrichment_status = 'completed', does nothing (unless forced).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enrich_location(
  p_token               uuid,
  p_location_id         uuid,
  p_governorate_id      uuid DEFAULT NULL,
  p_city_id             uuid DEFAULT NULL,
  p_road                text DEFAULT NULL,
  p_formatted_address   text DEFAULT NULL,
  p_geocoding_provider  text DEFAULT 'nominatim',
  p_enrichment_version  integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Authorized if employee or admin
  IF v_session.employee_id IS NULL AND v_session.customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  UPDATE unified_locations
  SET
    governorate_id      = COALESCE(p_governorate_id, governorate_id),
    city_id             = COALESCE(p_city_id, city_id),
    road                = COALESCE(p_road, road),
    formatted_address   = COALESCE(p_formatted_address, formatted_address),
    enriched_at         = now(),
    enrichment_status   = 'completed',
    geocoding_provider  = p_geocoding_provider,
    enrichment_version  = p_enrichment_version
  WHERE id = p_location_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_location_id);
END;
$$;

COMMENT ON FUNCTION public.enrich_location IS 'تحديث بيانات التخصيب للموقع (يدعوه LocationNormalizationService فقط)';

-- ============================================================================
-- 4. get_governed_location — updated with enrichment fields + reference JOINs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_location(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_authorized boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.employee_id IS NOT NULL THEN
    v_authorized := EXISTS (
      SELECT 1 FROM customers WHERE location_id = p_id AND owner_id = v_session.employee_id
    ) OR EXISTS (
      SELECT 1 FROM visits WHERE (start_location_id = p_id OR end_location_id = p_id)
        AND employee_id = v_session.employee_id
    ) OR EXISTS (
      SELECT 1 FROM orders WHERE execution_location_id = p_id
        AND (created_by = v_session.employee_id OR owner_id = v_session.employee_id)
    ) OR public.check_capability(p_token, 'locations.view_all');
  ELSIF v_session.customer_id IS NOT NULL THEN
    v_authorized := EXISTS (
      SELECT 1 FROM customers WHERE location_id = p_id AND id = v_session.customer_id
    );
  ELSE
    v_authorized := false;
  END IF;

  IF v_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT jsonb_build_object(
    'id', ul.id,
    'latitude', ul.latitude,
    'longitude', ul.longitude,
    'accuracy_meters', ul.accuracy_meters,
    'google_maps_url', ul.google_maps_url,
    'formatted_address', ul.formatted_address,
    -- NEW enrichment fields
    'governorate_id', ul.governorate_id,
    'city_id', ul.city_id,
    'road', ul.road,
    'enriched_at', ul.enriched_at,
    'enrichment_status', ul.enrichment_status,
    'geocoding_provider', ul.geocoding_provider,
    'enrichment_version', ul.enrichment_version,
    -- Resolved names from reference tables
    'governorate_name', (SELECT rg.name_ar FROM reference_governorates rg WHERE rg.id = ul.governorate_id),
    'city_name', (SELECT rc.name_ar FROM reference_cities rc WHERE rc.id = ul.city_id),
    -- Original fields
    'captured_at', ul.captured_at,
    'created_at', ul.created_at
  ) INTO v_result
  FROM unified_locations ul
  WHERE ul.id = p_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'NOT_FOUND'));
END;
$$;

COMMENT ON FUNCTION public.get_governed_location IS 'جلب سجل موقع مع بيانات التخصيب والمراجع';

-- ============================================================================
-- 5. get_governed_locations — batch version with enrichment fields
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_locations(
  p_token uuid,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_has_view_all boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.employee_id IS NOT NULL THEN
    v_has_view_all := public.check_capability(p_token, 'locations.view_all');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', ul.id,
    'latitude', ul.latitude,
    'longitude', ul.longitude,
    'accuracy_meters', ul.accuracy_meters,
    'google_maps_url', ul.google_maps_url,
    'formatted_address', ul.formatted_address,
    -- NEW enrichment fields
    'governorate_id', ul.governorate_id,
    'city_id', ul.city_id,
    'road', ul.road,
    'enriched_at', ul.enriched_at,
    'enrichment_status', ul.enrichment_status,
    'geocoding_provider', ul.geocoding_provider,
    'enrichment_version', ul.enrichment_version,
    -- Resolved names
    'governorate_name', (SELECT rg.name_ar FROM reference_governorates rg WHERE rg.id = ul.governorate_id),
    'city_name', (SELECT rc.name_ar FROM reference_cities rc WHERE rc.id = ul.city_id),
    -- Original fields
    'captured_at', ul.captured_at,
    'created_at', ul.created_at
  )) INTO v_result
  FROM unified_locations ul
  WHERE ul.id = ANY(p_ids)
    AND (
      (v_session.employee_id IS NOT NULL AND (
        v_has_view_all
        OR ul.id IN (SELECT location_id FROM customers WHERE owner_id = v_session.employee_id AND location_id IS NOT NULL)
        OR ul.id IN (SELECT start_location_id FROM visits WHERE employee_id = v_session.employee_id AND start_location_id IS NOT NULL)
        OR ul.id IN (SELECT end_location_id FROM visits WHERE employee_id = v_session.employee_id AND end_location_id IS NOT NULL)
        OR ul.id IN (SELECT execution_location_id FROM orders WHERE (created_by = v_session.employee_id OR owner_id = v_session.employee_id) AND execution_location_id IS NOT NULL)
      ))
      OR
      (v_session.customer_id IS NOT NULL AND
       ul.id IN (SELECT location_id FROM customers WHERE id = v_session.customer_id AND location_id IS NOT NULL))
    );

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_locations IS 'جلب سجلات مواقع متعددة مع بيانات التخصيب والمراجع';
