-- ============================================================================
-- SAHL MODULE — الأقساط (Customer Installments) — Stage 6
-- Maps SAHL's installment cycle (installments / installments_parts) onto
-- AHRAM's canonical financial structures:
--
--   SAHL installment plan      → sahl_installment_plans (INS-YYYY-NNNNNN)
--   SAHL installment part      → sahl_installment_parts (dated schedule,
--                                monthly by default, FIFO settlement)
--   SAHL installment receipt   → canonical collections document posted through
--                                the exact القبض cycle: treasury inflow
--                                ('collection'), customer_credit_accounts
--                                settlement (LEAST rule), INSERT-only ledger
--                                audit — plus per-part allocation.
--
-- Business rules:
--   • Plan split: part_amount = round(total/parts); last part absorbs the
--     rounding remainder (must stay > 0).
--   • Parts fall due monthly starting from p_start_date.
--   • Receiving money settles parts strictly FIFO (part_number order).
--   • A receipt never exceeds the plan's remaining unpaid total; overpaying
--     the CUSTOMER account beyond outstanding is still handled by the same
--     LEAST rule as القبض (AHRAM keeps outstanding >= 0).
--   • Cancelling a plan is only allowed while nothing was received on it.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.installments.read',   'عرض الأقساط — سهل'),
  ('sahl.installments.manage', 'إدارة الأقساط وتحصيلها — سهل')
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
  WHERE c.code IN ('sahl.installments.read', 'sahl.installments.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. sahl_installment_plans ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers (id),
  order_id uuid REFERENCES public.orders (id),
  title text,
  total_amount numeric(12,2) NOT NULL,
  paid_total numeric(12,2) NOT NULL DEFAULT 0,
  parts_count integer NOT NULL,
  part_amount numeric(12,2) NOT NULL,
  last_part_amount numeric(12,2),
  start_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  cancelled_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_inst_plans_code UNIQUE (code),
  CONSTRAINT ck_inst_plans_total CHECK (total_amount > 0),
  CONSTRAINT ck_inst_plans_paid CHECK (paid_total >= 0 AND paid_total <= total_amount),
  CONSTRAINT ck_inst_plans_parts CHECK (parts_count >= 1 AND parts_count <= 120),
  CONSTRAINT ck_inst_plans_status CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_inst_plans_customer ON public.sahl_installment_plans (customer_id);
CREATE INDEX IF NOT EXISTS idx_inst_plans_status ON public.sahl_installment_plans (status);
CREATE INDEX IF NOT EXISTS idx_inst_plans_order ON public.sahl_installment_plans (order_id);

COMMENT ON TABLE public.sahl_installment_plans IS 'Installment plans per customer (الأقساط — سهل).';
COMMENT ON COLUMN public.sahl_installment_plans.code IS 'e.g., INS-YYYY-NNNNNN';

CREATE TABLE IF NOT EXISTS public.sahl_installment_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.sahl_installment_plans (id) ON DELETE CASCADE,
  part_number integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  settled_at timestamptz,
  CONSTRAINT ck_inst_parts_number CHECK (part_number >= 1),
  CONSTRAINT ck_inst_parts_amount CHECK (amount > 0),
  CONSTRAINT ck_inst_parts_paid CHECK (paid_amount >= 0 AND paid_amount <= amount),
  CONSTRAINT uq_inst_parts UNIQUE (plan_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_inst_parts_plan ON public.sahl_installment_parts (plan_id);
CREATE INDEX IF NOT EXISTS idx_inst_parts_due ON public.sahl_installment_parts (due_date)
  WHERE paid_amount < amount;

COMMENT ON TABLE public.sahl_installment_parts IS 'Dated installment schedule; settled FIFO by part_number.';
COMMENT ON COLUMN public.sahl_installment_parts.due_date IS 'Due date (monthly cadence from plan start).';

-- 3. Document numbering -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_installment_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('installment', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'INS-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 4. sahl_create_installment_plan ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_installment_plan(
  p_token text,
  p_customer_id uuid,
  p_total numeric,
  p_parts integer,
  p_start_date date,
  p_title text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_id        uuid;
  v_code      varchar(30);
  v_part_amt  numeric(12,2);
  v_last_amt  numeric(12,2);
  i           integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.installments.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.manage');
  END IF;

  IF p_total IS NULL OR p_total <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_TOTAL'); END IF;
  IF p_parts IS NULL OR p_parts < 1 OR p_parts > 120 THEN RETURN jsonb_build_object('error', 'INVALID_PARTS_COUNT'); END IF;
  IF p_start_date IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_START_DATE'); END IF;

  IF p_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.customer_id = p_customer_id
  ) THEN
    RETURN jsonb_build_object('error', 'ORDER_MISMATCH');
  END IF;

  v_part_amt := ROUND(p_total / p_parts, 2);
  v_last_amt := ROUND(p_total - v_part_amt * (p_parts - 1), 2);
  IF v_last_amt <= 0 OR (p_parts > 1 AND v_last_amt > p_total - v_part_amt * (p_parts - 1) + 0.01) THEN
    RETURN jsonb_build_object('error', 'INVALID_SPLIT');
  END IF;
  IF p_parts = 1 THEN
    v_part_amt := p_total;
    v_last_amt := NULL;
  END IF;

  INSERT INTO public.sahl_installment_plans (
    code, customer_id, order_id, title, total_amount, parts_count,
    part_amount, last_part_amount, start_date, notes, created_by
  ) VALUES (
    public.generate_installment_number(), p_customer_id, p_order_id,
    NULLIF(btrim(COALESCE(p_title, '')), ''), p_total, p_parts,
    v_part_amt, v_last_amt, p_start_date,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id
  )
  RETURNING id, code INTO v_id, v_code;

  FOR i IN 1..p_parts LOOP
    INSERT INTO public.sahl_installment_parts (plan_id, part_number, due_date, amount)
    VALUES (
      v_id, i,
      p_start_date + ((i - 1) || ' month')::interval,
      CASE WHEN i = p_parts AND p_parts > 1 THEN v_last_amt ELSE v_part_amt END
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code,
                            'part_amount', v_part_amt, 'last_part_amount', COALESCE(v_last_amt, v_part_amt));
END;
$$;

-- 5. sahl_receive_installment -----------------------------------------------------------------
-- Receives money against a plan: creates + posts a canonical collection through
-- the القبض financial cycle, then allocates FIFO across unpaid parts.

CREATE OR REPLACE FUNCTION public.sahl_receive_installment(
  p_token text,
  p_plan_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session         app.sessions;
  v_plan            public.sahl_installment_plans;
  v_col             public.collections%ROWTYPE;
  v_remaining       numeric(12,2);
  v_left            numeric(12,2);
  v_applied_part    numeric(12,2);
  r                 record;
  v_allocations     jsonb := '[]'::jsonb;
  v_outstanding     numeric(12,2);
  v_applied_credit  numeric(12,2);
  v_new_outstanding numeric(12,2);
  v_col_seq         integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.installments.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.manage');
  END IF;

  SELECT * INTO v_plan FROM public.sahl_installment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_plan.status != 'active' THEN RETURN jsonb_build_object('error', 'PLAN_NOT_ACTIVE'); END IF;

  v_remaining := v_plan.total_amount - v_plan.paid_total;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_amount > v_remaining THEN
    RETURN jsonb_build_object('error', 'EXCEEDS_REMAINING', 'remaining', v_remaining);
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'cheque', 'deposit') THEN
    RETURN jsonb_build_object('error', 'INVALID_METHOD');
  END IF;

  -- Canonical receipt document (same family as القبض), posted in one step.
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('collection', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_col_seq;

  INSERT INTO public.collections (
    code, customer_id, owner_type, owner_id, method, amount,
    reference_number, status, notes, collected_at, created_by
  ) VALUES (
    'COL-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_col_seq::text, 6, '0'),
    v_plan.customer_id, 'employee',
    v_session.employee_id, p_method, p_amount,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    'pending',
    'تحصيل قسط ' || v_plan.code,
    now(), v_session.employee_id
  )
  RETURNING * INTO v_col;

  -- Treasury movement: money IN (unique reference index dedupes).
  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'inflow', v_col.amount, 'collection', v_col.id,
    'سند قبض ' || v_col.code || ' — تحصيل قسط ' || v_plan.code,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  -- Customer credit settlement (LEAST rule — mirrors sahl_post_receipt).
  SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
  FROM public.customer_credit_accounts
  WHERE customer_id = v_plan.customer_id
  FOR UPDATE;

  IF FOUND THEN
    v_applied_credit := LEAST(v_col.amount, GREATEST(v_outstanding, 0));
    v_new_outstanding := v_outstanding - v_applied_credit;
    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_outstanding, updated_at = now()
    WHERE customer_id = v_plan.customer_id;
  ELSE
    v_applied_credit := 0;
    v_new_outstanding := NULL;
  END IF;

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_plan.customer_id, 'debit', v_col.amount, COALESCE(v_new_outstanding, 0),
    'collection', v_col.id,
    'قبض ' || v_col.code || ' — قسط ' || v_plan.code
      || CASE WHEN v_applied_credit < v_col.amount THEN ' — المبلغ يتجاوز الرصيد المطبق على الحساب الائتماني' ELSE '' END,
    v_session.employee_id
  );

  UPDATE public.collections SET
    status = 'treasury_posted',
    approved_by = v_session.employee_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = v_col.id;

  -- FIFO allocation across unpaid parts.
  v_left := p_amount;
  FOR r IN
    SELECT id, part_number, amount, paid_amount
    FROM public.sahl_installment_parts
    WHERE plan_id = p_plan_id AND paid_amount < amount
    ORDER BY part_number
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_applied_part := LEAST(v_left, r.amount - r.paid_amount);
    UPDATE public.sahl_installment_parts
    SET paid_amount = paid_amount + v_applied_part,
        settled_at = CASE WHEN paid_amount + v_applied_part >= amount THEN now() ELSE settled_at END
    WHERE id = r.id;
    v_allocations := v_allocations || jsonb_build_object(
      'part_number', r.part_number, 'applied', v_applied_part,
      'fully_settled', (r.paid_amount + v_applied_part >= r.amount));
    v_left := v_left - v_applied_part;
  END LOOP;

  UPDATE public.sahl_installment_plans SET
    paid_total = paid_total + p_amount,
    status = CASE WHEN paid_total + p_amount >= total_amount THEN 'completed' ELSE status END,
    updated_at = now()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object(
    'success', true,
    'plan_code', v_plan.code,
    'collection_code', v_col.code,
    'amount', p_amount,
    'allocations', v_allocations,
    'remaining_after', v_remaining - p_amount,
    'plan_completed', (v_plan.paid_total + p_amount >= v_plan.total_amount),
    'outstanding_after', COALESCE(v_new_outstanding, 0)
  );
END;
$$;

-- 6. sahl_cancel_installment_plan --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_installment_plan(
  p_token text,
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_plan    public.sahl_installment_plans;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.installments.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.manage');
  END IF;

  SELECT * INTO v_plan FROM public.sahl_installment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_plan.status != 'active' THEN RETURN jsonb_build_object('error', 'PLAN_NOT_ACTIVE'); END IF;
  IF v_plan.paid_total > 0 THEN
    RETURN jsonb_build_object('error', 'HAS_PAYMENTS', 'paid_total', v_plan.paid_total);
  END IF;

  UPDATE public.sahl_installment_plans
  SET status = 'cancelled', cancelled_by = v_session.employee_id, updated_at = now()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$;

-- 7. Read RPCs -----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_installment_plans(p_token text)
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
  IF NOT public.check_capability(p_token, 'sahl.installments.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT pl.id, pl.code, pl.customer_id,
           c.company_name AS customer_name,
           pl.order_id, pl.title, pl.total_amount, pl.paid_total,
           pl.total_amount - pl.paid_total AS remaining,
           pl.parts_count, pl.part_amount, pl.last_part_amount, pl.start_date,
           pl.status, pl.notes, pl.created_at,
           (SELECT count(*)::int FROM public.sahl_installment_parts x
             WHERE x.plan_id = pl.id AND x.paid_amount >= x.amount) AS settled_count,
           (SELECT min(x.due_date) FROM public.sahl_installment_parts x
             WHERE x.plan_id = pl.id AND x.paid_amount < x.amount) AS next_due_date
    FROM public.sahl_installment_plans pl
    JOIN public.customers c ON c.id = pl.customer_id
  ) t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_installment_parts(
  p_token text,
  p_plan_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.installments.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.part_number), '[]'::jsonb) INTO v_result
  FROM (
    SELECT id, part_number, due_date, amount, paid_amount,
           amount - paid_amount AS unpaid, settled_at,
           CASE WHEN paid_amount >= amount THEN 'settled'
                WHEN paid_amount > 0 THEN 'partial'
                WHEN due_date < CURRENT_DATE THEN 'overdue'
                ELSE 'pending' END AS state
    FROM public.sahl_installment_parts
    WHERE plan_id = p_plan_id
  ) t;

  RETURN v_result;
END;
$$;

-- 8. Grants & schema reload ------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_create_installment_plan(text, uuid, numeric, integer, date, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_receive_installment(text, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_installment_plan(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_installment_plans(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_installment_parts(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL الأقساط Module (Stage 6)
-- ============================================================================
