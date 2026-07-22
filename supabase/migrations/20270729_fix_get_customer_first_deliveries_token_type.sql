-- ============================================================================
-- Fix get_customer_first_deliveries: p_token uuid → p_token text
--
-- Problem:
--   p_token uuid forces PostgREST to cast the input string to uuid at
--   the HTTP layer. If the token has whitespace or is invalid, PostgREST
--   returns HTTP 400 before the function executes.
--
-- Fix:
--   Change p_token to text (matching all other RPCs). Cast to uuid
--   inside the function body with exception handling.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_customer_first_deliveries(p_token uuid);

CREATE OR REPLACE FUNCTION public.get_customer_first_deliveries(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
  v_token uuid;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'NOT_EMPLOYEE');
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);

  IF NOT v_is_super THEN
    v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'customer_id', sub.customer_id,
        'first_delivery_at', sub.first_delivery_at
      )
    ), '[]'::jsonb)
    FROM (
      SELECT o.customer_id,
             MIN(COALESCE(o.delivered_at, o.created_at)) AS first_delivery_at
      FROM public.orders o
      WHERE o.status = 'delivered'
        AND public.is_order_in_statistics(o.status)
        AND (v_is_super OR o.owner_id = ANY(v_visible))
      GROUP BY o.customer_id
    ) sub
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_first_deliveries TO authenticated;
