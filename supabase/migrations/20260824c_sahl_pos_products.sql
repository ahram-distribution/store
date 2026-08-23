-- SAHL G2: POS product picker — one call feeding شاشة البيع with pricing,
-- packaging and live stock (canonical total + per-store split).

CREATE OR REPLACE FUNCTION public.sahl_get_pos_products(
  p_token text,
  p_store_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_store   uuid;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.access') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.access');
  END IF;

  v_store := COALESCE(p_store_id, (SELECT id FROM public.sahl_stores WHERE code = 'MAIN'));

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT p.id AS product_id,
           p.product_name,
           COALESCE(p.legacy_code, '') AS legacy_code,
           p.carton_quantity,
           COALESCE(p.piece_price, 0) AS piece_price,
           COALESCE(p.dozen_price, 0) AS dozen_price,
           COALESCE(p.carton_price, 0) AS carton_price,
           p.avg_cost,
           i.quantity AS total_qty,
           COALESCE(b.qty, 0) AS store_qty
    FROM public.products p
    LEFT JOIN public.inventory i ON i.product_id = p.id
    LEFT JOIN public.sahl_store_balances b ON b.product_id = p.id AND b.store_id = v_store
    WHERE p.is_active
      AND (NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
           OR p.product_name ILIKE '%' || btrim(p_search) || '%'
           OR COALESCE(p.legacy_code, '') ILIKE '%' || btrim(p_search) || '%')
  ) t;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sahl_get_pos_products(text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
