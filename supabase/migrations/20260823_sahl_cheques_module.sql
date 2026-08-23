-- ============================================================================
-- SAHL MODULE — الشيكات (Cheques Register) — Stage 7
-- Maps SAHL's cheque tracking (money.is_cheque / due_date / is_liquid) onto a
-- dedicated deferred-instrument register inside AHRAM:
--
--   Incoming cheque (من عميل)  → registers against the customer's credit
--     account IMMEDIATELY (same LEAST rule as القبض), but money reaches the
--     treasury only when the cheque CLEARS (SAHL is_liquid).
--   Outgoing cheque (لمورّد)   → mirrors supplier payments: supplier payable
--     drops at registration; treasury outflow happens on clearing.
--
-- Lifecycle: pending → deposited → cleared
--                    ↘ bounced    (restores the party balance)
--                    ↘ cancelled  (restores the party balance)
--
-- Audit trail: customer_credit_ledger / supplier_credit_ledger INSERT-only
-- rows reference_type='cheque'. running_balance is always the authoritative
-- post-movement balance. Registration mirrors Stage 1 ('debit' lowers the
-- balance); bounce/cancel reversals are recorded as the symmetric 'credit'
-- row restoring the balance.
-- ============================================================================

-- 1. Treasury reference types: allow cheque settlement movements ----------------

ALTER TABLE public.treasury_transactions DROP CONSTRAINT IF EXISTS ck_treasury_reference_type;
ALTER TABLE public.treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
  CHECK (reference_type IN ('collection', 'expense', 'employee_advance', 'purchase',
                            'supplier_payment', 'purchase_return', 'advance_settlement',
                            'cheque'));

-- 2. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.cheques.read',   'عرض الشيكات — سهل'),
  ('sahl.cheques.manage', 'إدارة الشيكات وتسييلها — سهل')
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
  WHERE c.code IN ('sahl.cheques.read', 'sahl.cheques.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 3. sahl_cheques -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  direction varchar(10) NOT NULL,
  party_type varchar(10) NOT NULL,
  party_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  applied_amount numeric(12,2) NOT NULL DEFAULT 0,
  bank_name varchar(120) NOT NULL,
  cheque_number varchar(60) NOT NULL,
  due_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  deposited_at timestamptz,
  cleared_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cheques_code UNIQUE (code),
  CONSTRAINT ck_cheques_direction CHECK (direction IN ('incoming', 'outgoing')),
  CONSTRAINT ck_cheques_party CHECK (
    party_type IN ('customer', 'supplier')
    AND (direction = 'incoming' AND party_type = 'customer'
         OR direction = 'outgoing' AND party_type = 'supplier')
  ),
  CONSTRAINT ck_cheques_amount CHECK (amount > 0),
  CONSTRAINT ck_cheques_applied CHECK (applied_amount >= 0 AND applied_amount <= amount),
  CONSTRAINT ck_cheques_status CHECK (status IN ('pending', 'deposited', 'cleared', 'bounced', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_cheques_status ON public.sahl_cheques (status);
CREATE INDEX IF NOT EXISTS idx_cheques_party ON public.sahl_cheques (party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_cheques_due ON public.sahl_cheques (due_date) WHERE status IN ('pending', 'deposited');

COMMENT ON TABLE public.sahl_cheques IS 'Deferred cheque instruments (الشيكات — سهل): account impact at registration, treasury impact at clearing.';
COMMENT ON COLUMN public.sahl_cheques.code IS 'e.g., CHQ-YYYY-NNNNNN';
COMMENT ON COLUMN public.sahl_cheques.applied_amount IS 'Amount actually deducted from the party balance at registration (LEAST rule); restored on bounce/cancel.';
COMMENT ON COLUMN public.sahl_cheques.status IS 'pending → deposited → cleared; or bounced/cancelled from pending/deposited';

-- 4. Document numbering -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_cheque_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('cheque', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'CHQ-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 5. sahl_register_cheque ---------------------------------------------------------------
-- Registers an incoming (customer) or outgoing (supplier) cheque and applies
-- its account impact immediately. Treasury movement is deferred to clearing.

CREATE OR REPLACE FUNCTION public.sahl_register_cheque(
  p_token text,
  p_direction text,
  p_party_id uuid,
  p_amount numeric,
  p_bank_name text,
  p_cheque_number text,
  p_due_date date,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session        app.sessions;
  v_id             uuid;
  v_code           varchar(30);
  v_outstanding    numeric(12,2);
  v_applied        numeric(12,2);
  v_new_out        numeric(12,2);
  v_party_name     text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.cheques.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.cheques.manage');
  END IF;

  IF p_direction NOT IN ('incoming', 'outgoing') THEN RETURN jsonb_build_object('error', 'INVALID_DIRECTION'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF NULLIF(btrim(COALESCE(p_bank_name, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'BANK_REQUIRED'); END IF;
  IF NULLIF(btrim(COALESCE(p_cheque_number, '')), '') IS NULL THEN RETURN jsonb_build_object('error', 'CHEQUE_NUMBER_REQUIRED'); END IF;
  IF p_due_date IS NULL THEN RETURN jsonb_build_object('error', 'DUE_DATE_REQUIRED'); END IF;

  IF p_direction = 'incoming' THEN
    -- Customer owes less immediately (LEAST rule, mirrors القبض)
    SELECT company_name INTO v_party_name FROM public.customers WHERE id = p_party_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;

    SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
    FROM public.customer_credit_accounts WHERE customer_id = p_party_id FOR UPDATE;

    IF FOUND THEN
      v_applied := LEAST(p_amount, GREATEST(v_outstanding, 0));
      v_new_out := v_outstanding - v_applied;
      UPDATE public.customer_credit_accounts
      SET outstanding_credit = v_new_out, updated_at = now()
      WHERE customer_id = p_party_id;
    ELSE
      v_applied := 0;
      v_new_out := NULL;
    END IF;
  ELSE
    -- Supplier payable drops immediately (mirrors صرف للموردين)
    SELECT supplier_name INTO v_party_name FROM public.suppliers WHERE id = p_party_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SUPPLIER_NOT_FOUND'); END IF;

    SELECT outstanding_credit INTO v_outstanding
    FROM public.supplier_credit_accounts WHERE supplier_id = p_party_id FOR UPDATE;

    IF FOUND THEN
      v_applied := LEAST(p_amount, GREATEST(v_outstanding, 0));
      v_new_out := v_outstanding - v_applied;
      UPDATE public.supplier_credit_accounts
      SET outstanding_credit = v_new_out, updated_at = now()
      WHERE supplier_id = p_party_id;
    ELSE
      v_applied := 0;
      v_new_out := NULL;
    END IF;

    INSERT INTO public.supplier_credit_accounts (supplier_id, outstanding_credit)
    VALUES (p_party_id, 0)
    ON CONFLICT (supplier_id) DO NOTHING;
  END IF;

  INSERT INTO public.sahl_cheques (
    code, direction, party_type, party_id, amount, applied_amount,
    bank_name, cheque_number, due_date, notes, created_by
  ) VALUES (
    public.generate_cheque_number(), p_direction,
    CASE WHEN p_direction = 'incoming' THEN 'customer' ELSE 'supplier' END,
    p_party_id, p_amount, v_applied,
    btrim(p_bank_name), btrim(p_cheque_number), p_due_date,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id
  )
  RETURNING id, code INTO v_id, v_code;

  -- Account audit row (INSERT-only ledger)
  IF p_direction = 'incoming' THEN
    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      p_party_id, 'debit', p_amount, COALESCE(v_new_out, 0),
      'cheque', v_id,
      'شيك وارد ' || v_code || ' — رقم ' || btrim(p_cheque_number) || ' (' || btrim(p_bank_name) || ')'
        || CASE WHEN v_applied < p_amount THEN ' — المبلغ يتجاوز الرصيد المطبق على الحساب الائتماني' ELSE '' END,
      v_session.employee_id
    );
  ELSE
    INSERT INTO public.supplier_credit_ledger (
      supplier_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      p_party_id, 'debit', p_amount, COALESCE(v_new_out, 0),
      'cheque', v_id,
      'شيك صادر ' || v_code || ' — رقم ' || btrim(p_cheque_number) || ' (' || btrim(p_bank_name) || ')',
      v_session.employee_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'code', v_code,
    'party_name', v_party_name,
    'applied_amount', COALESCE(v_applied, 0),
    'outstanding_after', COALESCE(v_new_out, 0)
  );
END;
$$;

-- 6. sahl_cheque_action ---------------------------------------------------------------------
-- p_action: 'deposited' | 'clear' | 'bounce' | 'cancel'

CREATE OR REPLACE FUNCTION public.sahl_cheque_action(
  p_token text,
  p_cheque_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session  app.sessions;
  v_chq      public.sahl_cheques;
  v_new_out  numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.cheques.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.cheques.manage');
  END IF;

  SELECT * INTO v_chq FROM public.sahl_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF p_action = 'deposited' THEN
    IF v_chq.status != 'pending' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;
    UPDATE public.sahl_cheques SET status = 'deposited', deposited_at = now(), updated_at = now()
    WHERE id = p_cheque_id;
    RETURN jsonb_build_object('success', true, 'status', 'deposited');

  ELSIF p_action = 'clear' THEN
    IF v_chq.status NOT IN ('pending', 'deposited') THEN RETURN jsonb_build_object('error', 'ALREADY_CLOSED'); END IF;

    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by
    ) VALUES (
      CASE WHEN v_chq.direction = 'incoming' THEN 'inflow' ELSE 'outflow' END,
      v_chq.amount, 'cheque', v_chq.id,
      CASE WHEN v_chq.direction = 'incoming' THEN 'تحصيل شيك وارد ' ELSE 'صرف شيك صادر ' END
        || v_chq.code || ' — رقم ' || v_chq.cheque_number,
      v_session.employee_id
    )
    ON CONFLICT (reference_type, reference_id) DO NOTHING;

    UPDATE public.sahl_cheques SET status = 'cleared', cleared_at = now(), updated_at = now()
    WHERE id = p_cheque_id;

    RETURN jsonb_build_object('success', true, 'status', 'cleared',
                              'treasury', CASE WHEN v_chq.direction = 'incoming' THEN 'inflow' ELSE 'outflow' END);

  ELSIF p_action IN ('bounce', 'cancel') THEN
    IF v_chq.status NOT IN ('pending', 'deposited') THEN RETURN jsonb_build_object('error', 'ALREADY_CLOSED'); END IF;

    -- Restore whatever was deducted from the party balance at registration
    IF v_chq.applied_amount > 0 THEN
      IF v_chq.direction = 'incoming' THEN
        SELECT COALESCE(outstanding_credit, 0) + v_chq.applied_amount INTO v_new_out
        FROM public.customer_credit_accounts WHERE customer_id = v_chq.party_id FOR UPDATE;

        UPDATE public.customer_credit_accounts
        SET outstanding_credit = v_new_out, updated_at = now()
        WHERE customer_id = v_chq.party_id;

        INSERT INTO public.customer_credit_ledger (
          customer_id, transaction_type, amount, running_balance,
          reference_type, reference_id, notes, created_by
        ) VALUES (
          v_chq.party_id, 'credit', v_chq.applied_amount, COALESCE(v_new_out, 0),
          'cheque', v_chq.id,
          CASE WHEN p_action = 'bounce' THEN 'ارتداد شيك وارد ' ELSE 'إلغاء شيك وارد ' END
            || v_chq.code || ' — إعادة الرصيد المخصوم',
          v_session.employee_id
        );
      ELSE
        SELECT outstanding_credit + v_chq.applied_amount INTO v_new_out
        FROM public.supplier_credit_accounts WHERE supplier_id = v_chq.party_id FOR UPDATE;

        UPDATE public.supplier_credit_accounts
        SET outstanding_credit = v_new_out, updated_at = now()
        WHERE supplier_id = v_chq.party_id;

        INSERT INTO public.supplier_credit_ledger (
          supplier_id, transaction_type, amount, running_balance,
          reference_type, reference_id, notes, created_by
        ) VALUES (
          v_chq.party_id, 'credit', v_chq.applied_amount, COALESCE(v_new_out, 0),
          'cheque', v_chq.id,
          CASE WHEN p_action = 'bounce' THEN 'ارتداد شيك صادر ' ELSE 'إلغاء شيك صادر ' END
            || v_chq.code || ' — إعادة الرصيد المخصوم',
          v_session.employee_id
        );
      END IF;
    END IF;

    UPDATE public.sahl_cheques SET
      status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
      closed_at = now(), updated_at = now()
    WHERE id = p_cheque_id;

    RETURN jsonb_build_object('success', true,
                              'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                              'restored_amount', v_chq.applied_amount);

  ELSE
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;
END;
$$;

-- 7. Read RPC ----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_cheques(p_token text)
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
  IF NOT public.check_capability(p_token, 'sahl.cheques.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.cheques.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT q.id, q.code, q.direction, q.party_type, q.party_id,
           COALESCE(c.company_name, s.supplier_name, '') AS party_name,
           q.amount, q.applied_amount, q.bank_name, q.cheque_number,
           q.due_date, q.status, q.deposited_at, q.cleared_at, q.closed_at,
           q.notes, q.created_at,
           (q.due_date < CURRENT_DATE AND q.status IN ('pending', 'deposited')) AS overdue
    FROM public.sahl_cheques q
    LEFT JOIN public.customers c ON q.direction = 'incoming' AND c.id = q.party_id
    LEFT JOIN public.suppliers s ON q.direction = 'outgoing' AND s.id = q.party_id
  ) t;

  RETURN v_result;
END;
$$;

-- 8. Grants & schema reload ------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_register_cheque(text, text, uuid, numeric, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cheque_action(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_cheques(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL الشيكات Module (Stage 7)
-- ============================================================================
