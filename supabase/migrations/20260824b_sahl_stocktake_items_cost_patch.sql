-- SAHL patch: sahl_get_stocktake_items should expose avg_cost_snapshot so the
-- inventory screen can show live variance value while counting (matches
-- value_impact computed at close).

CREATE OR REPLACE FUNCTION public.sahl_get_stocktake_items(
  p_token text,
  p_stocktake_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT it.id, it.product_id, p.product_name, COALESCE(p.legacy_code, '') AS legacy_code,
           it.system_quantity, it.counted_quantity, it.value_impact, it.avg_cost_snapshot
    FROM public.sahl_stocktake_items it
    JOIN public.products p ON p.id = it.product_id
    WHERE it.stocktake_id = p_stocktake_id
  ) t;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sahl_get_stocktake_items(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
