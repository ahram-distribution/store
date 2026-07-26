-- ============================================================================
-- FIX: get_governed_customer — city_name returns NULL for manual text cities
-- Problem: Uses reference_cities UUID lookup (city_id) which is NULL for
--          manually-entered cities. Should use addr.city (text) first.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_customer(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'company_name', c.company_name,
    'responsible_name', c.responsible_name,
    'business_type', c.business_type,
    'email', c.email,
    'phone', i.phone,
    'credit_limit', c.credit_limit,
    'credit_days', c.credit_days,
    'owner_id', c.owner_id,
    'owner_name', e.full_name,
    'owner_code', e.code,
    'is_active', c.is_active,
    'location_id', c.location_id,
    'registered_at', c.registered_at,
    'created_at', c.created_at,
    'governorate_id', addr.governorate_id,
    'city_id', addr.city_id,
    'street_address', addr.street_address,
    'landmark', addr.landmark,
    'location_accuracy', addr.location_accuracy,
    'governorate_name', COALESCE(addr.governorate, (SELECT rg.name_ar FROM reference_governorates rg WHERE rg.id = addr.governorate_id)),
    'city_name', COALESCE(addr.city, (SELECT rc.name_ar FROM reference_cities rc WHERE rc.id = addr.city_id)),
    'registered_address', addr.address_line1
  ) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN LATERAL fn_customer_default_address(c.id) addr ON true
  WHERE c.id = p_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_governed_customer IS 'بيانات عميل كاملة مع العنوان والنشاط التجاري (v3 — COALESCE text + UUID lookup for city/governorate)';
