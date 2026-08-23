-- ============================================================================
-- SAHL MODULE — Foundations: Stores / Treasuries / Settings — Stage 9 (G1)
--
-- Adds the organizational dimensions سهل works with, WITHOUT disturbing the
-- canonical single-pool inventory or the existing treasury semantics:
--
--   • sahl_stores      logical stores/warehouses (المخازن). Canonical
--                      public.inventory remains the authoritative TOTAL stock
--                      for all pre-existing AHRAM flows; per-store attribution
--                      is kept in an append-only moves journal
--                      (sahl_store_moves) whose balance view is what سهل uses.
--   • sahl_treasuries  cash drawers & bank accounts (الخزائن). Existing
--                      treasury_transactions rows keep working unchanged —
--                      NULL treasury_id is displayed under the MAIN drawer.
--   • sahl_settings    key/value app settings consumed by real logic.
--
-- External-change catcher: a trigger on inventory logs every delta made by
-- non-SAHL flows to the MAIN store. SAHL RPCs opt out by setting
-- set_config('app.sahl_store_guard', 'sahl', true) and write their own exact
-- per-store moves instead.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.settings.manage', 'إدارة إعدادات سهل والمخازن والخزائن')
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
  WHERE c.code = 'sahl.settings.manage'
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. sahl_stores -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sahl_stores_code UNIQUE (code)
);

COMMENT ON TABLE public.sahl_stores IS 'Logical stores/warehouses (المخازن — سهل). Total stock authority stays canonical inventory; per-store split lives in sahl_store_moves.';

INSERT INTO public.sahl_stores (code, name)
VALUES ('MAIN', 'المخزن الرئيسي')
ON CONFLICT (code) DO NOTHING;

-- 3. sahl_treasuries -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_treasuries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  kind varchar(10) NOT NULL DEFAULT 'cash',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sahl_treasuries_code UNIQUE (code),
  CONSTRAINT ck_sahl_treasuries_kind CHECK (kind IN ('cash', 'bank'))
);

COMMENT ON TABLE public.sahl_treasuries IS 'Cash drawers and bank accounts (الخزائن — سهل). Legacy treasury rows (treasury_id IS NULL) are reported under MAIN.';

INSERT INTO public.sahl_treasuries (code, name, kind)
VALUES ('MAIN', 'الدرج الرئيسي', 'cash')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.treasury_transactions
  ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES public.sahl_treasuries (id);

CREATE INDEX IF NOT EXISTS idx_treasury_tx_treasury ON public.treasury_transactions (treasury_id);

COMMENT ON COLUMN public.treasury_transactions.treasury_id IS 'Drawer/bank this movement belongs to. NULL (legacy rows) is reported under the MAIN drawer.';

-- Allow transfer legs now; sale/sale_void reserved for the sales module.
ALTER TABLE public.treasury_transactions DROP CONSTRAINT IF EXISTS ck_treasury_reference_type;
ALTER TABLE public.treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
  CHECK (reference_type IN ('collection', 'expense', 'employee_advance', 'purchase',
                            'supplier_payment', 'purchase_return', 'advance_settlement',
                            'cheque', 'treasury_transfer_out', 'treasury_transfer_in',
                            'sale', 'sale_void'));

-- 4. sahl_settings ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_settings (
  key varchar(80) PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES public.employees (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sahl_settings IS 'سهل application settings (key/value). Only keys actually consumed by logic may exist here.';

INSERT INTO public.sahl_settings (key, value, description) VALUES
  ('default_store_code', '"MAIN"', 'المخزن الافتراضي لشاشات البيع والشراء'),
  ('default_drawer_code', '"MAIN"', 'خزينة الدرج الافتراضية للنقدية'),
  ('receipt_paper_width', '"80mm"', 'عرض ورق الطباعة الافتراضي (80mm أو A4)')
ON CONFLICT (key) DO NOTHING;

-- 5. Store moves journal ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_store_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.sahl_stores (id),
  delta integer NOT NULL,
  reason varchar(40) NOT NULL,
  reference_type varchar(40),
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sahl_store_moves_delta CHECK (delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_store_moves_product ON public.sahl_store_moves (product_id);
CREATE INDEX IF NOT EXISTS idx_store_moves_store_product ON public.sahl_store_moves (store_id, product_id);

COMMENT ON TABLE public.sahl_store_moves IS 'Append-only per-store stock journal (سهل). Store balance = SUM(delta). Deltas made outside سهل are auto-attributed to MAIN by trg_sahl_inventory_external.';
COMMENT ON COLUMN public.sahl_store_moves.reason IS 'sale | sale_void | quote_release | purchase | purchase_return | sales_return | stocktake | adjustment | transfer_out | transfer_in | external';

CREATE OR REPLACE VIEW public.sahl_store_balances AS
SELECT m.product_id,
       m.store_id,
       SUM(m.delta)::integer AS qty
FROM public.sahl_store_moves m
GROUP BY m.product_id, m.store_id;

COMMENT ON VIEW public.sahl_store_balances IS 'Per-store stock quantities derived from the moves journal.';

-- External-change catcher: every canonical inventory change NOT made by a سهل
-- flow (which sets app.sahl_store_guard='sahl' for its transaction) is logged
-- as a MAIN-store move so the per-store split never drifts from the total.
CREATE OR REPLACE FUNCTION public.sahl_log_external_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta integer;
  v_main  uuid;
BEGIN
  IF current_setting('app.sahl_store_guard', true) = 'sahl' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := NEW.quantity;
  ELSIF TG_OP = 'DELETE' THEN
    v_delta := -OLD.quantity;
  ELSE
    v_delta := NEW.quantity - OLD.quantity;
  END IF;

  IF v_delta = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_main FROM public.sahl_stores WHERE code = 'MAIN';

  INSERT INTO public.sahl_store_moves (product_id, store_id, delta, reason, reference_type, created_by)
  VALUES (COALESCE(NEW.product_id, OLD.product_id), v_main, v_delta, 'external', TG_OP, NULL);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sahl_inventory_external ON public.inventory;
CREATE TRIGGER trg_sahl_inventory_external
AFTER INSERT OR UPDATE OF quantity OR DELETE ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.sahl_log_external_inventory_change();

COMMENT ON FUNCTION public.sahl_log_external_inventory_change IS 'Attributes non-SAHL inventory deltas to the MAIN store so sahl_store_balances stays consistent with canonical inventory.';

-- 6. Document numbering --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_transfer_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('treasury_transfer', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'TRF-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 7. Treasury transfers doc ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_treasury_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  from_treasury_id uuid NOT NULL REFERENCES public.sahl_treasuries (id),
  to_treasury_id uuid NOT NULL REFERENCES public.sahl_treasuries (id),
  amount numeric(12,2) NOT NULL,
  notes text,
  status varchar(20) NOT NULL DEFAULT 'posted',
  created_by uuid NOT NULL REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sahl_transfers_code UNIQUE (code),
  CONSTRAINT ck_sahl_transfers_distinct CHECK (from_treasury_id <> to_treasury_id),
  CONSTRAINT ck_sahl_transfers_amount CHECK (amount > 0),
  CONSTRAINT ck_sahl_transfers_status CHECK (status IN ('posted'))
);

COMMENT ON TABLE public.sahl_treasury_transfers IS 'تحويل من خزينة لأخرى — immediate two-leg posting (outflow from source, inflow to destination).';

-- 8. sahl_create_treasury_transfer ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_treasury_transfer(
  p_token text,
  p_from_treasury_id uuid,
  p_to_treasury_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_from    public.sahl_treasuries;
  v_to      public.sahl_treasuries;
  v_from_bal numeric(14,2);
  v_id      uuid;
  v_code    varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.settings.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.settings.manage');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_from_treasury_id = p_to_treasury_id THEN RETURN jsonb_build_object('error', 'SAME_TREASURY'); END IF;

  SELECT * INTO v_from FROM public.sahl_treasuries WHERE id = p_from_treasury_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'FROM_TREASURY_NOT_FOUND'); END IF;
  IF NOT v_from.is_active THEN RETURN jsonb_build_object('error', 'FROM_TREASURY_INACTIVE'); END IF;

  SELECT * INTO v_to FROM public.sahl_treasuries WHERE id = p_to_treasury_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TO_TREASURY_NOT_FOUND'); END IF;
  IF NOT v_to.is_active THEN RETURN jsonb_build_object('error', 'TO_TREASURY_INACTIVE'); END IF;

  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'inflow' THEN amount ELSE -amount END), 0)
    INTO v_from_bal
  FROM public.treasury_transactions
  WHERE treasury_id = p_from_treasury_id
     OR (treasury_id IS NULL AND v_from.code = 'MAIN');

  -- SAHL allows over-drafting a drawer silently; we warn through the response
  -- but still post (documented live behavior: no blocking validation).
  INSERT INTO public.sahl_treasury_transfers (
    code, from_treasury_id, to_treasury_id, amount, notes, created_by
  ) VALUES (
    public.generate_transfer_number(), p_from_treasury_id, p_to_treasury_id,
    p_amount, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id
  )
  RETURNING id, code INTO v_id, v_code;

  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, treasury_id, notes, created_by
  ) VALUES
    ('outflow', p_amount, 'treasury_transfer_out', v_id, p_from_treasury_id,
     'تحويل خزينة ' || v_code || ' — من ' || v_from.name, v_session.employee_id),
    ('inflow', p_amount, 'treasury_transfer_in', v_id, p_to_treasury_id,
     'تحويل خزينة ' || v_code || ' — إلى ' || v_to.name, v_session.employee_id);

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'code', v_code,
    'from_balance_after', v_from_bal - p_amount,
    'to_name', v_to.name
  );
END;
$$;

-- 9. Read/admin RPCs ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_stores(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.code), '[]'::jsonb) INTO v_result
  FROM (
    SELECT s.id, s.code, s.name, s.is_active, s.notes, s.created_at
    FROM public.sahl_stores s
  ) t;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_treasuries(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.kind, t.code), '[]'::jsonb) INTO v_result
  FROM (
    SELECT tr.id, tr.code, tr.name, tr.kind, tr.is_active, tr.notes, tr.created_at,
           COALESCE(SUM(CASE WHEN tt.transaction_type = 'inflow' THEN tt.amount
                             WHEN tt.transaction_type = 'outflow' THEN -tt.amount END), 0)::numeric(14,2) AS balance
    FROM public.sahl_treasuries tr
    LEFT JOIN public.treasury_transactions tt
      ON tt.treasury_id = tr.id
      OR (tt.treasury_id IS NULL AND tr.code = 'MAIN')
    GROUP BY tr.id
  ) t;
  RETURN v_result;
END;
$$;

-- Per-store stock: store split + canonical total side by side.
CREATE OR REPLACE FUNCTION public.sahl_get_store_stock(
  p_token text,
  p_store_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT p.id AS product_id, p.product_name, p.legacy_code,
           COALESCE(b.qty, 0) AS store_qty,
           i.quantity AS total_qty,
           p.carton_quantity
    FROM public.products p
    JOIN public.inventory i ON i.product_id = p.id
    LEFT JOIN public.sahl_store_balances b
      ON b.product_id = p.id AND b.store_id = COALESCE(p_store_id, (SELECT id FROM public.sahl_stores WHERE code = 'MAIN'))
    WHERE p.is_active
  ) t;
  RETURN v_result;
END;
$$;

-- Settings read/update (admin-gated writes).
CREATE OR REPLACE FUNCTION public.sahl_get_settings(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_result
  FROM public.sahl_settings;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_update_setting(
  p_token text,
  p_key text,
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.settings.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.settings.manage');
  END IF;

  IF NULLIF(btrim(COALESCE(p_key, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'KEY_REQUIRED'); END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN jsonb_build_object('error', 'VALUE_REQUIRED'); END IF;

  INSERT INTO public.sahl_settings (key, value, updated_by)
  VALUES (btrim(p_key), p_value, v_session.employee_id)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();

  RETURN jsonb_build_object('success', true, 'key', btrim(p_key), 'value', p_value);
END;
$$;

-- Stores/treasuries admin (settings-manage gated).
CREATE OR REPLACE FUNCTION public.sahl_upsert_store(
  p_token text,
  p_store_id uuid,
  p_code text,
  p_name text,
  p_is_active boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_id uuid; v_code varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.settings.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.settings.manage');
  END IF;

  v_code := UPPER(NULLIF(btrim(COALESCE(p_code, '')), ''));
  IF v_code IS NULL OR length(v_code) > 30 THEN RETURN jsonb_build_object('error', 'CODE_REQUIRED'); END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'NAME_REQUIRED'); END IF;

  IF p_store_id IS NOT NULL THEN
    UPDATE public.sahl_stores SET
      code = v_code, name = btrim(p_name), is_active = p_is_active,
      notes = NULLIF(btrim(COALESCE(p_notes, '')), ''), updated_at = now()
    WHERE id = p_store_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  ELSE
    INSERT INTO public.sahl_stores (code, name, is_active, notes, created_by)
    VALUES (v_code, btrim(p_name), p_is_active, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name, is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes, updated_at = now()
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_upsert_treasury(
  p_token text,
  p_treasury_id uuid,
  p_code text,
  p_name text,
  p_kind text DEFAULT 'cash',
  p_is_active boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.settings.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.settings.manage');
  END IF;

  IF NULLIF(btrim(COALESCE(p_code, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'CODE_REQUIRED'); END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'NAME_REQUIRED'); END IF;
  IF p_kind NOT IN ('cash', 'bank') THEN RETURN jsonb_build_object('error', 'INVALID_KIND'); END IF;

  IF p_treasury_id IS NOT NULL THEN
    UPDATE public.sahl_treasuries SET
      code = UPPER(btrim(p_code)), name = btrim(p_name), kind = p_kind,
      is_active = p_is_active, notes = NULLIF(btrim(COALESCE(p_notes, '')), ''), updated_at = now()
    WHERE id = p_treasury_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  ELSE
    INSERT INTO public.sahl_treasuries (code, name, kind, is_active, notes, created_by)
    VALUES (UPPER(btrim(p_code)), btrim(p_name), p_kind, p_is_active,
            NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name, kind = EXCLUDED.kind, is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes, updated_at = now()
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- 10. Grants & schema reload -----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_create_treasury_transfer(text, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_stores(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_treasuries(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_store_stock(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_settings(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_update_setting(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_upsert_store(text, uuid, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_upsert_treasury(text, uuid, text, text, text, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL Foundations: Stores / Treasuries / Settings (Stage 9)
-- ============================================================================
