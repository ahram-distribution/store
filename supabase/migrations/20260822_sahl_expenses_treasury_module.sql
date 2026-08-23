-- ============================================================================
-- SAHL MODULE — المصروفات + الخزينة (Expenses & Treasury) — Stage 2
-- Completes the SAHL financial cycle inside AHRAM's canonical structures:
--
--   SAHL expense voucher  → expenses (code EXP-YYYY-NNNNNN)
--   SAHL cash-out         → treasury_transactions (outflow / 'expense')
--
-- Gap filled: the expenses table existed (Phase 6) with NO status and NO
-- posting logic anywhere — vouchers could never reach the treasury.
-- Mirrors the receipts cycle: create (pending) → post (treasury_posted).
--
-- Treasury view implements SAHL's daily cash report concept:
-- opening/period in/out/closing over the single treasury.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.expenses.read',   'عرض المصروفات — سهل'),
  ('sahl.expenses.create', 'إنشاء سند مصروف — سهل'),
  ('sahl.expenses.post',   'ترحيل سندات المصروفات إلى الخزينة — سهل'),
  ('sahl.treasury.read',   'عرض حركة الخزينة — سهل')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'الإدارة العليا';
  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role الإدارة العليا not found — capability grant skipped';
    RETURN;
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, c.id
  FROM public.capabilities c
  WHERE c.code IN ('sahl.access', 'sahl.receipts.read', 'sahl.receipts.post',
                   'sahl.expenses.read', 'sahl.expenses.create', 'sahl.expenses.post',
                   'sahl.treasury.read')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. Additive: explicit document state on expenses --------------------------------

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_expenses_status'
  ) THEN
    ALTER TABLE public.expenses ADD CONSTRAINT ck_expenses_status
      CHECK (status IN ('pending', 'treasury_posted'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.expenses.status IS 'pending → treasury_posted (سهل: دورة سند الصرف)';

-- 3. Document numbering (mirrors generate_collection_number) ----------------------

CREATE OR REPLACE FUNCTION public.generate_expense_number()
RETURNS varchar(30)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('expense', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  RETURN 'EXP-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 4. sahl_create_expense ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_expense(
  p_token text,
  p_expense_type text,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_expense_id uuid;
  v_code varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.expenses.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.expenses.create');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_expense_type IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_TYPE'); END IF;

  v_code := public.generate_expense_number();

  INSERT INTO public.expenses (code, expense_type, amount, description, status, created_by)
  VALUES (v_code, p_expense_type, round(p_amount, 2), p_description, 'pending', v_session.employee_id)
  RETURNING id INTO v_expense_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_expense_id,
    'code', v_code,
    'status', 'pending'
  );
END;
$$;

-- 5. sahl_post_expense -----------------------------------------------------------------
-- Posts an expense voucher to the treasury as money OUT. Idempotent-safe.

CREATE OR REPLACE FUNCTION public.sahl_post_expense(
  p_token text,
  p_expense_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_exp     public.expenses;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.expenses.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.expenses.post');
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_exp.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;

  -- Cash OUT of the treasury; unique index uq_treasury_reference guarantees one row.
  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'outflow', v_exp.amount, 'expense', v_exp.id,
    'سند صرف ' || v_exp.code || ' — ' || v_exp.expense_type
      || CASE WHEN v_exp.description IS NOT NULL THEN ' — ' || v_exp.description ELSE '' END,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  UPDATE public.expenses SET
    status      = 'treasury_posted',
    approved_by = COALESCE(approved_by, v_session.employee_id),
    approved_at = COALESCE(approved_at, now())
  WHERE id = v_exp.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_exp.id,
    'code', v_exp.code,
    'amount', v_exp.amount,
    'status', 'treasury_posted'
  );
END;
$$;

-- 6. sahl_get_expenses ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_expenses(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.expenses.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.expenses.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT e.id, e.code, e.expense_type, e.amount, e.description, e.status,
           e.approved_by, e.approved_at, e.created_by, e.created_at,
           emp.full_name AS created_by_name
    FROM public.expenses e
    LEFT JOIN public.employees emp ON emp.id = e.created_by
    ORDER BY e.created_at DESC
    LIMIT 100
  ) t;

  RETURN v_result;
END;
$$;

-- 7. sahl_get_treasury_summary -----------------------------------------------------------
-- SAHL "التقرير اليومي للخزينة": period in/out totals + running balance +
-- recent movements with source-document codes.

CREATE OR REPLACE FUNCTION public.sahl_get_treasury_summary(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.treasury.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.treasury.read');
  END IF;

  SELECT jsonb_build_object(
    'today_inflow',
      COALESCE((SELECT SUM(amount) FROM public.treasury_transactions
                WHERE transaction_type='inflow' AND created_at >= date_trunc('day', now())), 0),
    'today_outflow',
      COALESCE((SELECT SUM(amount) FROM public.treasury_transactions
                WHERE transaction_type='outflow' AND created_at >= date_trunc('day', now())), 0),
    'month_inflow',
      COALESCE((SELECT SUM(amount) FROM public.treasury_transactions
                WHERE transaction_type='inflow' AND created_at >= date_trunc('month', now())), 0),
    'month_outflow',
      COALESCE((SELECT SUM(amount) FROM public.treasury_transactions
                WHERE transaction_type='outflow' AND created_at >= date_trunc('month', now())), 0),
    'balance',
      COALESCE((SELECT SUM(CASE WHEN transaction_type='inflow' THEN amount ELSE -amount END)
                FROM public.treasury_transactions), 0),
    'transactions', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT t.id, t.transaction_type, t.amount, t.reference_type, t.notes, t.created_at,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT c.code FROM public.collections c WHERE c.id = t.reference_id)
                 WHEN 'expense'    THEN (SELECT e.code FROM public.expenses e WHERE e.id = t.reference_id)
                 ELSE NULL
               END AS doc_code,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT cu.company_name FROM public.collections c
                                          JOIN public.customers cu ON cu.id = c.customer_id
                                          WHERE c.id = t.reference_id)
                 WHEN 'expense' THEN NULL
                 ELSE NULL
               END AS party_name,
               emp.full_name AS created_by_name
        FROM public.treasury_transactions t
        LEFT JOIN public.employees emp ON emp.id = t.created_by
        ORDER BY t.created_at DESC
        LIMIT 50
      ) x
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 8. Grants & schema reload ---------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.generate_expense_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_expense(text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_expense(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_expenses(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_treasury_summary(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL المصروفات + الخزينة Module (Stage 2)
-- ============================================================================
