-- ============================================================================
-- SAHL MODULE — الجرد والتسويات المخزنية (Stock-Taking & Adjustments) — Stage 5
-- Maps SAHL's INVENT (physical count) and ADJUST (manual adjustment) cycles
-- onto AHRAM's canonical single-warehouse inventory table.
--
--   SAHL stock-taking session → sahl_stocktakes + sahl_stocktake_items
--     (system quantity is snapshotted when a product is added to the session;
--      closing applies counted quantities atomically and writes one audit row
--      per changed product)
--   SAHL manual adjustment    → direct set of a product's quantity with
--     reason category; variance recorded in the same audit ledger
--
--   Audit trail               → sahl_inventory_adjustments (INSERT-only):
--     quantity_before / quantity_after / delta_pieces / unit_cost snapshot /
--     value_impact (delta × avg_cost) / reason_category / reference
--
-- Business rules:
--   • Closing a stock-take REQUIRES every item to have a counted quantity.
--   • Counted quantity becomes the system quantity (count is authoritative).
--   • Adjustments never drive treasury or customer/supplier ledgers — they are
--     pure inventory operations with value visibility only.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.inventory.read',     'عرض المخزون والجرد — سهل'),
  ('sahl.inventory.count',    'تسجيل أعداد الجرد — سهل'),
  ('sahl.inventory.post',     'إغلاق الجرد وإجراء التسويات — سهل')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'الإدارة العليا';
  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role الإدارة العليا not found — capability grants skipped';
    RETURN;
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, c.id
  FROM public.capabilities c
  WHERE c.code IN ('sahl.inventory.read', 'sahl.inventory.count', 'sahl.inventory.post')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. sahl_stocktakes ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  notes text,
  total_value_impact numeric(12,2),
  created_by uuid NOT NULL REFERENCES public.employees (id),
  closed_by uuid REFERENCES public.employees (id),
  closed_at timestamptz,
  cancelled_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_stocktakes_code UNIQUE (code),
  CONSTRAINT ck_stocktakes_status CHECK (status IN ('open', 'closed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_stocktakes_status ON public.sahl_stocktakes (status);

COMMENT ON TABLE public.sahl_stocktakes IS 'Physical stock-count sessions (الجرد — سهل).';
COMMENT ON COLUMN public.sahl_stocktakes.code IS 'e.g., STK-YYYY-NNNNNN';
COMMENT ON COLUMN public.sahl_stocktakes.status IS 'open → closed/cancelled';

CREATE TABLE IF NOT EXISTS public.sahl_stocktake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES public.sahl_stocktakes (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  system_quantity integer NOT NULL,
  counted_quantity integer,
  avg_cost_snapshot numeric(12,4),
  value_impact numeric(12,2),
  CONSTRAINT ck_stk_items_system CHECK (system_quantity >= 0),
  CONSTRAINT ck_stk_items_counted CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  CONSTRAINT uq_stk_items_product UNIQUE (stocktake_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stk_items_stocktake ON public.sahl_stocktake_items (stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stk_items_product ON public.sahl_stocktake_items (product_id);

COMMENT ON TABLE public.sahl_stocktake_items IS 'Counted lines within a stock-take session. system_quantity snapshotted at add time.';
COMMENT ON COLUMN public.sahl_stocktake_items.value_impact IS '(counted − system) × avg_cost snapshot, computed at close';

-- 3. sahl_inventory_adjustments (INSERT-only audit ledger) --------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id),
  quantity_before integer NOT NULL,
  quantity_after integer NOT NULL,
  delta_pieces integer NOT NULL,
  unit_cost numeric(12,4),
  value_impact numeric(12,2),
  reason_category varchar(20) NOT NULL DEFAULT 'correction',
  reference_type varchar(20) NOT NULL DEFAULT 'direct',
  reference_id uuid,
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_inv_adj_quantities CHECK (
    quantity_before >= 0 AND quantity_after >= 0
    AND delta_pieces = quantity_after - quantity_before AND delta_pieces <> 0
  ),
  CONSTRAINT ck_inv_adj_reason CHECK (reason_category IN
    ('stocktake', 'damage', 'loss', 'expiry', 'correction', 'found', 'other')),
  CONSTRAINT ck_inv_adj_reference CHECK (reference_type IN ('direct', 'stocktake'))
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_product ON public.sahl_inventory_adjustments (product_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_created ON public.sahl_inventory_adjustments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_adj_reference ON public.sahl_inventory_adjustments (reference_type, reference_id);

COMMENT ON TABLE public.sahl_inventory_adjustments IS 'INSERT-only audit of every inventory quantity change made through سهل (adjustments and stock-take closes).';

-- 4. Document numbering -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_stocktake_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('stocktake', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'STK-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 5. sahl_get_inventory_snapshot -------------------------------------------------------
-- Products with live system quantities for counting/adjustment screens.

CREATE OR REPLACE FUNCTION public.sahl_get_inventory_snapshot(
  p_token text,
  p_search text DEFAULT NULL
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
    SELECT p.id AS product_id, p.product_name, COALESCE(p.legacy_code, '') AS legacy_code,
           GREATEST(COALESCE(p.carton_quantity, 1), 1) AS carton_quantity,
           COALESCE(i.quantity, 0) AS quantity,
           p.avg_cost,
           ROUND(COALESCE(i.quantity, 0) * COALESCE(p.avg_cost, 0), 2) AS stock_value
    FROM public.products p
    LEFT JOIN public.inventory i ON i.product_id = p.id
    WHERE p.is_active
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR p.product_name ILIKE '%' || btrim(p_search) || '%'
           OR COALESCE(p.legacy_code, '') ILIKE '%' || btrim(p_search) || '%')
  ) t;

  RETURN v_result;
END;
$$;

-- 6. sahl_create_manual_adjustment ---------------------------------------------------------
-- Sets a product's system quantity directly (SAHL ADJUST). Delta is derived.

CREATE OR REPLACE FUNCTION public.sahl_create_manual_adjustment(
  p_token text,
  p_product_id uuid,
  p_new_quantity integer,
  p_reason_category text DEFAULT 'correction',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_product record;
  v_cur integer;
  v_delta integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.post');
  END IF;

  SELECT p.id, p.product_name, p.avg_cost INTO v_product
  FROM public.products p WHERE p.id = p_product_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_QUANTITY');
  END IF;
  IF p_reason_category NOT IN ('damage', 'loss', 'expiry', 'correction', 'found', 'other') THEN
    RETURN jsonb_build_object('error', 'INVALID_REASON');
  END IF;

  SELECT quantity INTO v_cur FROM public.inventory WHERE product_id = p_product_id FOR UPDATE;
  v_cur := COALESCE(v_cur, 0);
  v_delta := p_new_quantity - v_cur;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object('success', true, 'changed', false,
                              'quantity_before', v_cur, 'quantity_after', p_new_quantity);
  END IF;

  INSERT INTO public.inventory (product_id, quantity)
  VALUES (p_product_id, p_new_quantity)
  ON CONFLICT (product_id) DO UPDATE
    SET quantity = EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.sahl_inventory_adjustments (
    product_id, quantity_before, quantity_after, delta_pieces,
    unit_cost, value_impact, reason_category, reference_type, notes, created_by
  ) VALUES (
    p_product_id, v_cur, p_new_quantity, v_delta,
    v_product.avg_cost, ROUND(v_delta * COALESCE(v_product.avg_cost, 0), 2),
    p_reason_category, 'direct',
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_session.employee_id
  );

  RETURN jsonb_build_object('success', true, 'changed', true,
    'product_name', v_product.product_name,
    'quantity_before', v_cur, 'quantity_after', p_new_quantity,
    'delta_pieces', v_delta,
    'value_impact', ROUND(v_delta * COALESCE(v_product.avg_cost, 0), 2));
END;
$$;

-- 7. sahl_create_stocktake ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_stocktake(
  p_token text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_id      uuid;
  v_code    varchar(30);
  v_cnt     integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.post');
  END IF;

  -- One open session at a time keeps counts coherent
  IF EXISTS (SELECT 1 FROM public.sahl_stocktakes WHERE status = 'open') THEN
    RETURN jsonb_build_object('error', 'OPEN_STOCKTAKE_EXISTS');
  END IF;

  INSERT INTO public.sahl_stocktakes (code, notes, created_by)
  VALUES (public.generate_stocktake_number(), NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
  RETURNING id, code INTO v_id, v_code;

  INSERT INTO public.sahl_stocktake_items (stocktake_id, product_id, system_quantity, avg_cost_snapshot)
  SELECT v_id, p.id, COALESCE(i.quantity, 0), p.avg_cost
  FROM public.products p
  LEFT JOIN public.inventory i ON i.product_id = p.id
  WHERE p.is_active;

  SELECT count(*) INTO v_cnt FROM public.sahl_stocktake_items WHERE stocktake_id = v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code, 'line_count', v_cnt);
END;
$$;

-- 8. sahl_add_stocktake_product -------------------------------------------------------------------
-- Adds one more product mid-session (e.g., newly activated product).

CREATE OR REPLACE FUNCTION public.sahl_add_stocktake_product(
  p_token text,
  p_stocktake_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_stk public.sahl_stocktakes;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.count') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.count');
  END IF;

  SELECT * INTO v_stk FROM public.sahl_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_stk.status != 'open' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND');
  END IF;

  INSERT INTO public.sahl_stocktake_items (stocktake_id, product_id, system_quantity, avg_cost_snapshot)
  SELECT p_stocktake_id, p.id, COALESCE(i.quantity, 0), p.avg_cost
  FROM public.products p
  LEFT JOIN public.inventory i ON i.product_id = p.id
  WHERE p.id = p_product_id
  ON CONFLICT (stocktake_id, product_id) DO NOTHING;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ALREADY_IN_STOCKTAKE'); END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. sahl_record_count -------------------------------------------------------------------------------
-- p_counts jsonb: [{"item_id":"...","counted_quantity":42}]

CREATE OR REPLACE FUNCTION public.sahl_record_count(
  p_token text,
  p_stocktake_id uuid,
  p_counts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session   app.sessions;
  v_stk       public.sahl_stocktakes;
  v_item      jsonb;
  v_qty       integer;
  v_counted   integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.count') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.count');
  END IF;

  SELECT * INTO v_stk FROM public.sahl_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_stk.status != 'open' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) != 'array' OR jsonb_array_length(p_counts) = 0 THEN
    RETURN jsonb_build_object('error', 'EMPTY_COUNTS');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_counts) LOOP
    v_qty := COALESCE((v_item->>'counted_quantity')::int, -1);
    IF v_qty < 0 THEN RETURN jsonb_build_object('error', 'INVALID_QUANTITY'); END IF;

    UPDATE public.sahl_stocktake_items
    SET counted_quantity = v_qty
    WHERE id = (v_item->>'item_id')::uuid AND stocktake_id = p_stocktake_id;
  END LOOP;

  SELECT count(*) INTO v_counted FROM public.sahl_stocktake_items
  WHERE stocktake_id = p_stocktake_id AND counted_quantity IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'counted_lines', v_counted,
                            'total_lines', (SELECT count(*)::int FROM public.sahl_stocktake_items WHERE stocktake_id = p_stocktake_id));
END;
$$;

-- 10. sahl_close_stocktake -----------------------------------------------------------------------------
-- Applies all counted quantities atomically; writes one audit row per change.

CREATE OR REPLACE FUNCTION public.sahl_close_stocktake(
  p_token text,
  p_stocktake_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_stk     public.sahl_stocktakes;
  r         record;
  v_uncounted integer;
  v_changed   integer := 0;
  v_value_impact numeric(12,2) := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.post');
  END IF;

  SELECT * INTO v_stk FROM public.sahl_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_stk.status != 'open' THEN RETURN jsonb_build_object('error', 'ALREADY_CLOSED'); END IF;

  SELECT count(*) INTO v_uncounted FROM public.sahl_stocktake_items
  WHERE stocktake_id = p_stocktake_id AND counted_quantity IS NULL;
  IF v_uncounted > 0 THEN
    RETURN jsonb_build_object('error', 'PENDING_COUNTS', 'uncounted_lines', v_uncounted);
  END IF;

  -- Apply counts: counted quantity becomes the system quantity (authoritative)
  FOR r IN
    SELECT it.id, it.product_id, it.system_quantity, it.counted_quantity,
           it.avg_cost_snapshot, p.product_name
    FROM public.sahl_stocktake_items it
    JOIN public.products p ON p.id = it.product_id
    WHERE it.stocktake_id = p_stocktake_id
      AND it.counted_quantity IS DISTINCT FROM it.system_quantity
    ORDER BY it.id
  LOOP
    UPDATE public.inventory
    SET quantity = r.counted_quantity, updated_at = now()
    WHERE product_id = r.product_id;
    IF NOT FOUND THEN
      INSERT INTO public.inventory (product_id, quantity)
      VALUES (r.product_id, r.counted_quantity);
    END IF;

    INSERT INTO public.sahl_inventory_adjustments (
      product_id, quantity_before, quantity_after, delta_pieces,
      unit_cost, value_impact, reason_category, reference_type, reference_id,
      notes, created_by
    ) VALUES (
      r.product_id, r.system_quantity, r.counted_quantity,
      r.counted_quantity - r.system_quantity,
      r.avg_cost_snapshot,
      ROUND((r.counted_quantity - r.system_quantity) * COALESCE(r.avg_cost_snapshot, 0), 2),
      'stocktake', 'stocktake', p_stocktake_id,
      'جرد ' || v_stk.code || ' — ' || r.product_name,
      v_session.employee_id
    );

    UPDATE public.sahl_stocktake_items
    SET value_impact = ROUND((r.counted_quantity - r.system_quantity) * COALESCE(r.avg_cost_snapshot, 0), 2)
    WHERE id = r.id;

    v_changed := v_changed + 1;
    v_value_impact := v_value_impact + ROUND((r.counted_quantity - r.system_quantity) * COALESCE(r.avg_cost_snapshot, 0), 2);
  END LOOP;

  UPDATE public.sahl_stocktakes SET
    status = 'closed',
    closed_by = v_session.employee_id,
    closed_at = now(),
    total_value_impact = v_value_impact,
    updated_at = now()
  WHERE id = p_stocktake_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', p_stocktake_id,
    'code', v_stk.code,
    'changed_lines', v_changed,
    'value_impact', v_value_impact
  );
END;
$$;

-- 11. sahl_cancel_stocktake -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_stocktake(
  p_token text,
  p_stocktake_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_stk     public.sahl_stocktakes;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.inventory.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.inventory.post');
  END IF;

  SELECT * INTO v_stk FROM public.sahl_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_stk.status != 'open' THEN RETURN jsonb_build_object('error', 'ALREADY_CLOSED'); END IF;

  UPDATE public.sahl_stocktakes SET status = 'cancelled', cancelled_by = v_session.employee_id, updated_at = now()
  WHERE id = p_stocktake_id;

  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$;

-- 12. Read RPCs -------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_stocktakes(p_token text)
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

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT s.id, s.code, s.status, s.notes, s.total_value_impact,
           s.created_at, s.closed_at,
           ce.full_name AS closed_by_name,
           (SELECT count(*)::int FROM public.sahl_stocktake_items x WHERE x.stocktake_id = s.id) AS item_count,
           (SELECT count(*)::int FROM public.sahl_stocktake_items x WHERE x.stocktake_id = s.id AND x.counted_quantity IS NOT NULL) AS counted_count
    FROM public.sahl_stocktakes s
    LEFT JOIN public.employees ce ON ce.id = s.closed_by
  ) t;

  RETURN v_result;
END;
$$;

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
           it.system_quantity, it.counted_quantity, it.value_impact
    FROM public.sahl_stocktake_items it
    JOIN public.products p ON p.id = it.product_id
    WHERE it.stocktake_id = p_stocktake_id
  ) t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_inventory_adjustments(
  p_token text,
  p_limit integer DEFAULT 100
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

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT a.id, a.product_id, p.product_name,
           a.quantity_before, a.quantity_after, a.delta_pieces,
           a.value_impact, a.reason_category, a.reference_type,
           a.reference_id, a.notes, a.created_at
    FROM public.sahl_inventory_adjustments a
    JOIN public.products p ON p.id = a.product_id
    ORDER BY a.created_at DESC
    LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
  ) t;

  RETURN v_result;
END;
$$;

-- 13. Grants & schema reload ------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_get_inventory_snapshot(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_manual_adjustment(text, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_stocktake(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_add_stocktake_product(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_record_count(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_close_stocktake(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_stocktake(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_stocktakes(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_stocktake_items(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_inventory_adjustments(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL الجرد والتسويات Module (Stage 5)
-- ============================================================================
