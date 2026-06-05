-- ============================================================================
-- CREDIT PROGRAM MODULE V2
-- Adds: customer_credit_accounts, credit_invoices, credit_invoice_cheques
-- Payment method integration with orders
-- ============================================================================

-- 0. New ENUMs ---------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.credit_account_status AS ENUM ('active', 'suspended', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.credit_invoice_status AS ENUM ('open', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cheque_status AS ENUM ('received', 'deposited', 'collected', 'cancelled', 'returned', 'paid_directly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. customer_credit_accounts ------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_credit_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL UNIQUE,
    credit_program_id uuid NOT NULL,
    credit_limit decimal(12,2) NOT NULL,
    payment_term_days integer NOT NULL,
    outstanding_credit decimal(12,2) NOT NULL DEFAULT 0,
    reserved_credit decimal(12,2) NOT NULL DEFAULT 0,
    guarantee_cheque_amount decimal(12,2),
    credit_status public.credit_account_status NOT NULL DEFAULT 'active',
    activated_at timestamptz NOT NULL DEFAULT now(),
    activated_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_credit_accounts ADD CONSTRAINT fk_cca_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE customer_credit_accounts ADD CONSTRAINT fk_cca_program
    FOREIGN KEY (credit_program_id) REFERENCES credit_programs (id);
ALTER TABLE customer_credit_accounts ADD CONSTRAINT fk_cca_activated_by
    FOREIGN KEY (activated_by) REFERENCES employees (id);
ALTER TABLE customer_credit_accounts ADD CONSTRAINT ck_cca_limits
    CHECK (credit_limit >= 0 AND outstanding_credit >= 0 AND reserved_credit >= 0);

CREATE INDEX IF NOT EXISTS idx_cca_customer_id ON customer_credit_accounts (customer_id);
CREATE INDEX IF NOT EXISTS idx_cca_status ON customer_credit_accounts (credit_status);

COMMENT ON TABLE customer_credit_accounts IS 'Active credit accounts per customer. One account per customer.';

-- 2. credit_invoices ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number varchar(50) NOT NULL,
    customer_id uuid NOT NULL,
    order_id uuid NOT NULL,
    invoice_amount decimal(12,2) NOT NULL,
    issue_date date NOT NULL DEFAULT CURRENT_DATE,
    due_date date NOT NULL,
    status public.credit_invoice_status NOT NULL DEFAULT 'open',
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_invoices ADD CONSTRAINT fk_ci_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE credit_invoices ADD CONSTRAINT fk_ci_order
    FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE credit_invoices ADD CONSTRAINT ck_ci_amount
    CHECK (invoice_amount >= 0);
ALTER TABLE credit_invoices ADD CONSTRAINT ck_ci_dates
    CHECK (due_date >= issue_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_invoice_number ON credit_invoices (invoice_number);
CREATE INDEX IF NOT EXISTS idx_ci_customer_id ON credit_invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_ci_order_id ON credit_invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON credit_invoices (status);
CREATE INDEX IF NOT EXISTS idx_ci_due_date ON credit_invoices (due_date);

COMMENT ON TABLE credit_invoices IS 'Per-order credit invoices. Each approved credit order generates one invoice.';

-- 3. credit_invoice_cheques --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_invoice_cheques (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL UNIQUE,
    cheque_number varchar(100) NOT NULL,
    bank_name varchar(255) NOT NULL,
    amount decimal(12,2) NOT NULL,
    due_date date NOT NULL,
    status public.cheque_status NOT NULL DEFAULT 'received',
    recorded_by uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_invoice_cheques ADD CONSTRAINT fk_cic_invoice
    FOREIGN KEY (invoice_id) REFERENCES credit_invoices (id);
ALTER TABLE credit_invoice_cheques ADD CONSTRAINT fk_cic_recorded_by
    FOREIGN KEY (recorded_by) REFERENCES employees (id);
ALTER TABLE credit_invoice_cheques ADD CONSTRAINT ck_cic_amount
    CHECK (amount >= 0);

CREATE INDEX IF NOT EXISTS idx_cic_invoice_id ON credit_invoice_cheques (invoice_id);
CREATE INDEX IF NOT EXISTS idx_cic_status ON credit_invoice_cheques (status);

COMMENT ON TABLE credit_invoice_cheques IS 'One cheque per invoice. One-to-one relationship.';

-- 4. New capabilities --------------------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.account.activate', 'تفعيل حساب ائتماني', 'Activate customer credit account from approved application', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.account.activate');

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.account.suspend', 'إيقاف حساب ائتماني', 'Suspend customer credit account', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.account.suspend');

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.account.reactivate', 'إعادة تفعيل حساب ائتماني', 'Reactivate suspended credit account', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.account.reactivate');

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.cheque.manage', 'إدارة الشيكات', 'Record and manage credit invoice cheques', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.cheque.manage');

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.payment.record', 'تسجيل المدفوعات', 'Record credit invoice payments', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.payment.record');

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'credit.program.manage', 'إدارة برامج الائتمان', 'Create and manage credit programs', 'credit'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'credit.program.manage');

-- 5. Add payment_method column to orders -------------------------------------

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN payment_method varchar(20) DEFAULT 'cash';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 6. New RPCs -----------------------------------------------------------------

-- 6a. get_governed_customer_credit_account -----------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_customer_credit_account(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_account jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_CUSTOMER');
  END IF;

  SELECT jsonb_build_object(
    'id', cca.id,
    'customer_id', cca.customer_id,
    'program_id', cca.credit_program_id,
    'program_name', cp.name,
    'credit_limit', cca.credit_limit,
    'payment_term_days', cca.payment_term_days,
    'outstanding_credit', cca.outstanding_credit,
    'reserved_credit', cca.reserved_credit,
    'available_credit', cca.credit_limit - cca.outstanding_credit - cca.reserved_credit,
    'guarantee_cheque_amount', cca.guarantee_cheque_amount,
    'credit_status', cca.credit_status,
    'activated_at', cca.activated_at
  ) INTO v_account
  FROM public.customer_credit_accounts cca
  JOIN credit_programs cp ON cp.id = cca.credit_program_id
  WHERE cca.customer_id = v_session.customer_id;

  RETURN COALESCE(v_account, jsonb_build_object('error', 'NOT_FOUND'));
END;
$$;

COMMENT ON FUNCTION public.get_governed_customer_credit_account IS 'جلب حساب الائتمان للعميل الحالي';

-- 6b. governed_activate_credit_account ---------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_credit_account(
  p_token uuid,
  p_customer_id uuid,
  p_program_id uuid,
  p_guarantee_cheque_amount decimal DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_program public.credit_programs;
  v_account_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'credit.account.activate');

  SELECT * INTO v_program FROM public.credit_programs WHERE id = p_program_id AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PROGRAM_NOT_FOUND'); END IF;

  IF EXISTS (SELECT 1 FROM public.customer_credit_accounts WHERE customer_id = p_customer_id) THEN
    RETURN jsonb_build_object('error', 'ALREADY_EXISTS');
  END IF;

  INSERT INTO public.customer_credit_accounts (
    customer_id, credit_program_id, credit_limit, payment_term_days,
    guarantee_cheque_amount, activated_by
  ) VALUES (
    p_customer_id, p_program_id, v_program.credit_limit, v_program.credit_days,
    COALESCE(p_guarantee_cheque_amount, v_program.credit_limit * 0.5), v_session.employee_id
  ) RETURNING id INTO v_account_id;

  -- Update the application status to activated
  UPDATE public.credit_applications SET
    status = 'approved',
    approved_by = v_session.employee_id,
    approved_at = now()
  WHERE customer_id = p_customer_id AND status = 'approved' AND program_id = p_program_id;

    -- Log to ledger
    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
    VALUES (p_customer_id, 'credit', v_program.credit_limit, v_program.credit_limit, 'credit_account', v_account_id, 'تفعيل الحساب الائتماني', v_session.employee_id);

  RETURN jsonb_build_object('success', true, 'account_id', v_account_id);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_credit_account IS 'تفعيل حساب ائتماني لعميل بعد اعتماد الطلب';

-- 6c. governed_suspend_credit_account ----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_suspend_credit_account(
  p_token uuid,
  p_customer_id uuid,
  p_reason text DEFAULT NULL
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'credit.account.suspend');

  UPDATE public.customer_credit_accounts SET
    credit_status = 'suspended', updated_at = now()
  WHERE customer_id = p_customer_id AND credit_status = 'active';

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND_OR_ALREADY_SUSPENDED'); END IF;

    -- Log to ledger
    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, notes, created_by)
    SELECT p_customer_id, 'debit', 0, outstanding_credit, COALESCE(p_reason, 'إيقاف الحساب الائتماني'), v_session.employee_id
  FROM public.customer_credit_accounts WHERE customer_id = p_customer_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_suspend_credit_account IS 'إيقاف حساب ائتماني';

-- 6d. governed_reactivate_credit_account -------------------------------------

CREATE OR REPLACE FUNCTION public.governed_reactivate_credit_account(
  p_token uuid,
  p_customer_id uuid
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'credit.account.reactivate');

  UPDATE public.customer_credit_accounts SET
    credit_status = 'active', updated_at = now()
  WHERE customer_id = p_customer_id AND credit_status = 'suspended';

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND_OR_NOT_SUSPENDED'); END IF;

    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, notes, created_by)
    SELECT p_customer_id, 'credit', 0, outstanding_credit, 'إعادة تفعيل الحساب الائتماني', v_session.employee_id
  FROM public.customer_credit_accounts WHERE customer_id = p_customer_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_reactivate_credit_account IS 'إعادة تفعيل حساب ائتماني موقوف';

-- 6e. get_governed_credit_invoices -------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_credit_invoices(
  p_token uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_customer_id uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- If employee, use p_customer_id. If customer, use their own.
  IF v_session.identity_type = 'employee' THEN
    v_customer_id := p_customer_id;
  ELSIF v_session.customer_id IS NOT NULL THEN
    v_customer_id := v_session.customer_id;
  ELSE
    RETURN jsonb_build_object('error', 'ACCESS_DENIED');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ci.id,
      'invoice_number', ci.invoice_number,
      'order_id', ci.order_id,
      'order_number', o.order_number,
      'invoice_amount', ci.invoice_amount,
      'issue_date', ci.issue_date,
      'due_date', ci.due_date,
      'status', ci.status,
      'days_overdue', CASE WHEN ci.status != 'paid' AND ci.due_date < CURRENT_DATE THEN (CURRENT_DATE - ci.due_date) ELSE 0 END,
      'cheque_status', (SELECT cic.status FROM public.credit_invoice_cheques cic WHERE cic.invoice_id = ci.id)
    ) ORDER BY ci.issue_date DESC
  ) INTO v_result
  FROM public.credit_invoices ci
  JOIN orders o ON o.id = ci.order_id
  WHERE ci.customer_id = v_customer_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_credit_invoices IS 'جلب فواتير الائتمان لعميل';

-- 6f. get_governed_credit_invoice_detail -------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_credit_invoice_detail(
  p_token uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_invoice jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_build_object(
    'invoice', row_to_json(ci.*),
    'cheque', row_to_json(cic.*),
    'order', row_to_json(o.*)
  ) INTO v_invoice
  FROM public.credit_invoices ci
  LEFT JOIN public.credit_invoice_cheques cic ON cic.invoice_id = ci.id
  JOIN orders o ON o.id = ci.order_id
  WHERE ci.id = p_invoice_id;

  RETURN COALESCE(v_invoice, jsonb_build_object('error', 'NOT_FOUND'));
END;
$$;

COMMENT ON FUNCTION public.get_governed_credit_invoice_detail IS 'جلب تفاصيل فاتورة ائتمان مع الشيك';

-- 6g. governed_record_cheque --------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_record_cheque(
  p_token uuid,
  p_invoice_id uuid,
  p_cheque_number varchar,
  p_bank_name varchar,
  p_amount decimal,
  p_due_date date
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'credit.cheque.manage');

  IF EXISTS (SELECT 1 FROM public.credit_invoice_cheques WHERE invoice_id = p_invoice_id) THEN
    RETURN jsonb_build_object('error', 'CHEQUE_ALREADY_EXISTS');
  END IF;

  INSERT INTO public.credit_invoice_cheques (invoice_id, cheque_number, bank_name, amount, due_date, recorded_by)
  VALUES (p_invoice_id, p_cheque_number, p_bank_name, p_amount, p_due_date, v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_record_cheque IS 'تسجيل شيك لفاتورة ائتمان (شيك واحد لكل فاتورة)';

-- 6h. governed_record_credit_payment -----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_record_credit_payment(
  p_token uuid,
  p_invoice_id uuid,
  p_payment_method varchar DEFAULT 'collected'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_invoice public.credit_invoices;
  v_customer_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'credit.payment.record');

  SELECT * INTO v_invoice FROM public.credit_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVOICE_NOT_FOUND'); END IF;
  IF v_invoice.status = 'paid' THEN RETURN jsonb_build_object('error', 'ALREADY_PAID'); END IF;

  v_customer_id := v_invoice.customer_id;

  -- Update invoice
  UPDATE public.credit_invoices SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = p_invoice_id;

  -- Update cheque status if exists
  IF p_payment_method IN ('collected', 'paid_directly') THEN
    UPDATE public.credit_invoice_cheques SET status = p_payment_method::public.cheque_status
    WHERE invoice_id = p_invoice_id;
  END IF;

  -- Reduce outstanding credit
  UPDATE public.customer_credit_accounts SET
    outstanding_credit = GREATEST(0, outstanding_credit - v_invoice.invoice_amount),
    updated_at = now()
  WHERE customer_id = v_customer_id;

  -- Log to ledger
    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
    SELECT v_customer_id, 'credit', v_invoice.invoice_amount,
      (SELECT outstanding_credit FROM public.customer_credit_accounts WHERE customer_id = v_customer_id),
      'credit_invoice', p_invoice_id, 'تسجيل دفع فاتورة ائتمان', v_session.employee_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_record_credit_payment IS 'تسجيل دفع فاتورة ائتمان. المدير المالي أو أعلى فقط.';

-- 6i. governed_reserve_credit_for_order ------------------------------------

CREATE OR REPLACE FUNCTION public.governed_reserve_credit_for_order(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_account public.customer_credit_accounts;
  v_available decimal;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status != 'draft' THEN RETURN jsonb_build_object('error', 'INVALID_STATUS'); END IF;

  SELECT * INTO v_account FROM public.customer_credit_accounts
  WHERE customer_id = v_order.customer_id AND credit_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_ACTIVE_CREDIT'); END IF;

  v_available := v_account.credit_limit - v_account.outstanding_credit - v_account.reserved_credit;
  IF v_order.total_amount > v_available THEN
    RETURN jsonb_build_object('error', 'INSUFFICIENT_CREDIT', 'available', v_available, 'required', v_order.total_amount);
  END IF;

  UPDATE public.customer_credit_accounts SET
    reserved_credit = reserved_credit + v_order.total_amount,
    updated_at = now()
  WHERE id = v_account.id;

  UPDATE public.orders SET payment_method = 'credit' WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'reserved', v_order.total_amount);
END;
$$;

COMMENT ON FUNCTION public.governed_reserve_credit_for_order IS 'حجز رصيد ائتماني للطلب';

-- 6j. governed_release_credit_reservation ----------------------------------

CREATE OR REPLACE FUNCTION public.governed_release_credit_reservation(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  UPDATE public.customer_credit_accounts SET
    reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
    updated_at = now()
  WHERE customer_id = v_order.customer_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_release_credit_reservation IS 'إلغاء حجز رصيد ائتماني (عند رفض/إلغاء الطلب)';

-- 6k. governed_convert_credit_reservation_to_outstanding -------------------

CREATE OR REPLACE FUNCTION public.governed_convert_credit_reservation_to_outstanding(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_account public.customer_credit_accounts;
  v_invoice_id uuid;
  v_invoice_num varchar(50);
  v_due_date date;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  SELECT * INTO v_account FROM public.customer_credit_accounts
  WHERE customer_id = v_order.customer_id AND credit_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_ACTIVE_CREDIT'); END IF;

  -- Move reserved to outstanding
  UPDATE public.customer_credit_accounts SET
    reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
    outstanding_credit = outstanding_credit + v_order.total_amount,
    updated_at = now()
  WHERE id = v_account.id;

  -- Generate invoice number
  v_invoice_num := 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || COALESCE((SELECT MAX(SUBSTRING(invoice_number FROM '\d+$'))::int + 1 FROM public.credit_invoices WHERE invoice_number LIKE 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%'), 1);

  -- Calculate due date based on payment term
  v_due_date := CURRENT_DATE + v_account.payment_term_days;

  -- Create invoice
  INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
  VALUES (v_invoice_num, v_order.customer_id, p_order_id, v_order.total_amount, CURRENT_DATE, v_due_date, 'open')
  RETURNING id INTO v_invoice_id;

  -- Log to ledger
    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
    SELECT v_order.customer_id, 'debit', v_order.total_amount,
      (SELECT outstanding_credit FROM public.customer_credit_accounts WHERE customer_id = v_order.customer_id),
      'credit_invoice', v_invoice_id, 'تحويل طلب رقم ' || v_order.order_number || ' إلى فاتورة ائتمان', v_session.employee_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_num, 'due_date', v_due_date::text);
END;
$$;

COMMENT ON FUNCTION public.governed_convert_credit_reservation_to_outstanding IS 'تحويل الحجز الائتماني إلى استحقاق فعلي بعد اعتماد الطلب';

-- 6l. get_governed_credit_dashboard ------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_credit_dashboard(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_stats jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT jsonb_build_object(
    'total_accounts', (SELECT COUNT(*) FROM public.customer_credit_accounts),
    'active_accounts', (SELECT COUNT(*) FROM public.customer_credit_accounts WHERE credit_status = 'active'),
    'suspended_accounts', (SELECT COUNT(*) FROM public.customer_credit_accounts WHERE credit_status = 'suspended'),
    'total_outstanding', (SELECT COALESCE(SUM(outstanding_credit), 0) FROM public.customer_credit_accounts),
    'total_reserved', (SELECT COALESCE(SUM(reserved_credit), 0) FROM public.customer_credit_accounts),
    'total_credit_limit', (SELECT COALESCE(SUM(credit_limit), 0) FROM public.customer_credit_accounts),
    'open_invoices', (SELECT COUNT(*) FROM public.credit_invoices WHERE status = 'open'),
    'overdue_invoices', (SELECT COUNT(*) FROM public.credit_invoices WHERE status = 'overdue' OR (status = 'open' AND due_date < CURRENT_DATE)),
    'pending_applications', (SELECT COUNT(*) FROM public.credit_applications WHERE status IN ('submitted', 'under_review', 'documents_received'))
  ) INTO v_stats;

  RETURN v_stats;
END;
$$;

COMMENT ON FUNCTION public.get_governed_credit_dashboard IS 'إحصائيات لوحة تحكم الائتمان';

-- 6m. governed_auto_suspend_overdue_accounts ---------------------------------

CREATE OR REPLACE FUNCTION public.governed_auto_suspend_overdue_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_suspended int := 0;
  v_customer RECORD;
BEGIN
  FOR v_customer IN
    SELECT DISTINCT ci.customer_id
    FROM public.credit_invoices ci
    JOIN public.customer_credit_accounts cca ON cca.customer_id = ci.customer_id AND cca.credit_status = 'active'
    WHERE ci.status = 'open' AND ci.due_date < CURRENT_DATE
  LOOP
    UPDATE public.customer_credit_accounts SET
      credit_status = 'suspended', updated_at = now()
    WHERE customer_id = v_customer.customer_id AND credit_status = 'active';

    INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, notes, created_by)
    SELECT v_customer.customer_id, 'debit', 0, outstanding_credit,
      'إيقاف تلقائي بسبب فواتير متأخرة', (SELECT id FROM public.employees ORDER BY created_at ASC LIMIT 1)
    FROM public.customer_credit_accounts WHERE customer_id = v_customer.customer_id;

    v_suspended := v_suspended + 1;
  END LOOP;

  -- Mark overdue invoices
  UPDATE public.credit_invoices SET status = 'overdue', updated_at = now()
  WHERE status = 'open' AND due_date < CURRENT_DATE;

  RETURN jsonb_build_object('success', true, 'suspended', v_suspended);
END;
$$;

COMMENT ON FUNCTION public.governed_auto_suspend_overdue_accounts IS 'الفحص التلقائي اليومي لإيقاف الحسابات المتأخرة';

-- ============================================================================
-- SEED TEST DATA
-- ============================================================================

DO $$
DECLARE
  v_prog1_id uuid;
  v_prog2_id uuid;
  v_emp_id uuid;
  v_cust1_id uuid;
  v_cust2_id uuid;
  v_cust3_id uuid;
  v_pending_cust_id uuid;
  v_order_id uuid;
  v_invoice_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Find employee
  SELECT e.id INTO v_emp_id FROM public.employees e
  JOIN public.employee_roles er ON er.employee_id = e.id
  JOIN public.roles r ON r.id = er.role_id
  WHERE r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN') LIMIT 1;
  IF v_emp_id IS NULL THEN
    SELECT id INTO v_emp_id FROM public.employees ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_emp_id IS NULL THEN RETURN; END IF;

  -- ==========================================================================
  -- SEED CREDIT PROGRAMS (only if none exist)
  -- ==========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.credit_programs LIMIT 1) THEN
    INSERT INTO public.credit_programs (name, credit_limit, credit_days, terms, is_active) VALUES
      ('برنامج ائتماني 100 ألف', 100000, 15,
       E'شروط برنامج 100 ألف:\n1. حد ائتماني: 100,000 ج.م\n2. مدة السداد: 15 يوم\n3. يتم تقديم شيك ضمان بقيمة 50,000 ج.م',
       true) RETURNING id INTO v_prog1_id;

    INSERT INTO public.credit_programs (name, credit_limit, credit_days, terms, is_active) VALUES
      ('برنامج ائتماني 300 ألف', 300000, 30,
       E'شروط برنامج 300 ألف:\n1. حد ائتماني: 300,000 ج.م\n2. مدة السداد: 30 يوم\n3. يتم تقديم شيك ضمان بقيمة 150,000 ج.م',
       true) RETURNING id INTO v_prog2_id;

    -- Assign to variables for later use
    SELECT id INTO v_prog1_id FROM public.credit_programs WHERE name LIKE '%100 ألف%' LIMIT 1;
    SELECT id INTO v_prog2_id FROM public.credit_programs WHERE name LIKE '%300 ألف%' LIMIT 1;
  ELSE
    SELECT id INTO v_prog1_id FROM public.credit_programs ORDER BY credit_limit ASC LIMIT 1;
    SELECT id INTO v_prog2_id FROM public.credit_programs ORDER BY credit_limit DESC LIMIT 1;
  END IF;

  -- ==========================================================================
  -- FIND OR CREATE TEST CUSTOMERS
  -- ==========================================================================

  -- Customer 1: شركة النور للتوزيع (active, 100K program)
  SELECT id INTO v_cust1_id FROM public.customers WHERE company_name ILIKE '%النور%' LIMIT 1;

  -- Customer 2: شركة البركة للتجارة (active, 300K program)
  SELECT id INTO v_cust2_id FROM public.customers WHERE company_name ILIKE '%البركة%' LIMIT 1;

  -- Customer 3: مؤسسة المستقبل (active, 300K program, will have overdue)
  SELECT id INTO v_cust3_id FROM public.customers WHERE company_name ILIKE '%المستقبل%' LIMIT 1;

  -- Pending customer
  SELECT id INTO v_pending_cust_id FROM public.customers WHERE company_name ILIKE '%الأمل%' LIMIT 1;

  -- ==========================================================================
  -- CREATE CREDIT ACCOUNTS (only if none exist)
  -- ==========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.customer_credit_accounts LIMIT 1) THEN
    -- Customer 1: Active, 100K program, used: 40000, reserved: 10000
    IF v_cust1_id IS NOT NULL AND v_prog1_id IS NOT NULL THEN
      WITH ins AS (
        INSERT INTO public.customer_credit_accounts (customer_id, credit_program_id, credit_limit, payment_term_days, outstanding_credit, reserved_credit, guarantee_cheque_amount, credit_status, activated_by, activated_at)
        VALUES (v_cust1_id, v_prog1_id, 100000, 15, 40000, 10000, 50000, 'active', v_emp_id, v_now - interval '30 days')
        RETURNING id
      )
      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_cust1_id, 'credit', 100000, 100000, 'credit_account', ins.id, 'تفعيل الحساب الائتماني', v_emp_id FROM ins;
    END IF;

    -- Customer 2: Active, 300K program, used: 180000, reserved: 50000
    IF v_cust2_id IS NOT NULL AND v_prog2_id IS NOT NULL THEN
      WITH ins AS (
        INSERT INTO public.customer_credit_accounts (customer_id, credit_program_id, credit_limit, payment_term_days, outstanding_credit, reserved_credit, guarantee_cheque_amount, credit_status, activated_by, activated_at)
        VALUES (v_cust2_id, v_prog2_id, 300000, 30, 180000, 50000, 150000, 'active', v_emp_id, v_now - interval '30 days')
        RETURNING id
      )
      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_cust2_id, 'credit', 300000, 300000, 'credit_account', ins.id, 'تفعيل الحساب الائتماني', v_emp_id FROM ins;
    END IF;

    -- Customer 3: Suspended, 300K program, overdue invoice: 200000
    IF v_cust3_id IS NOT NULL AND v_prog2_id IS NOT NULL THEN
      WITH ins AS (
        INSERT INTO public.customer_credit_accounts (customer_id, credit_program_id, credit_limit, payment_term_days, outstanding_credit, reserved_credit, guarantee_cheque_amount, credit_status, activated_by, activated_at)
        VALUES (v_cust3_id, v_prog2_id, 300000, 30, 200000, 0, 150000, 'suspended', v_emp_id, v_now - interval '30 days')
        RETURNING id
      )
      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_cust3_id, 'credit', 300000, 300000, 'credit_account', ins.id, 'تفعيل الحساب الائتماني', v_emp_id FROM ins;
    END IF;
  END IF;

  -- ==========================================================================
  -- CREATE CREDIT INVOICES
  -- ==========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.credit_invoices LIMIT 1) THEN
    -- Customer 1: One paid invoice + one open invoice
    IF v_cust1_id IS NOT NULL THEN
      -- Create a dummy order for customer 1 (paid)
      INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, status, subtotal, discount_amount, total_amount, payment_method, created_by, created_at, approved_at)
      VALUES ('ORD-CR-TEST-001', v_cust1_id, 'employee', v_emp_id, 'approved', 30000, 0, 30000, 'credit', v_emp_id, v_now - interval '25 days', v_now - interval '24 days')
      RETURNING id INTO v_order_id;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status, paid_at)
      VALUES ('CI-20260501-001', v_cust1_id, v_order_id, 30000, (CURRENT_DATE - interval '25 days')::date, (CURRENT_DATE - interval '10 days')::date, 'paid', v_now - interval '10 days');

      -- Another open invoice for customer 1
      INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, status, subtotal, discount_amount, total_amount, payment_method, created_by, created_at, approved_at)
      VALUES ('ORD-CR-TEST-002', v_cust1_id, 'employee', v_emp_id, 'approved', 10000, 0, 10000, 'credit', v_emp_id, v_now - interval '10 days', v_now - interval '9 days')
      RETURNING id INTO v_order_id;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES ('CI-20260510-001', v_cust1_id, v_order_id, 10000, (CURRENT_DATE - interval '10 days')::date, (CURRENT_DATE + interval '5 days')::date, 'open')
      RETURNING id INTO v_invoice_id;

      -- Record cheque for open invoice
      INSERT INTO public.credit_invoice_cheques (invoice_id, cheque_number, bank_name, amount, due_date, recorded_by)
      VALUES (v_invoice_id, 'CHQ-10001', 'البنك الأهلي المصري', 10000, (CURRENT_DATE + interval '5 days')::date, v_emp_id);
    END IF;

    -- Customer 2: One open invoice (large)
    IF v_cust2_id IS NOT NULL THEN
      INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, status, subtotal, discount_amount, total_amount, payment_method, created_by, created_at, approved_at)
      VALUES ('ORD-CR-TEST-003', v_cust2_id, 'employee', v_emp_id, 'approved', 180000, 0, 180000, 'credit', v_emp_id, v_now - interval '20 days', v_now - interval '19 days')
      RETURNING id INTO v_order_id;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES ('CI-20260515-001', v_cust2_id, v_order_id, 180000, (CURRENT_DATE - interval '20 days')::date, (CURRENT_DATE + interval '10 days')::date, 'open')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.credit_invoice_cheques (invoice_id, cheque_number, bank_name, amount, due_date, recorded_by)
      VALUES (v_invoice_id, 'CHQ-20001', 'بنك مصر', 180000, (CURRENT_DATE + interval '10 days')::date, v_emp_id);
    END IF;

    -- Customer 3: Overdue invoice (suspended)
    IF v_cust3_id IS NOT NULL THEN
      INSERT INTO public.orders (order_number, customer_id, owner_type, owner_id, status, subtotal, discount_amount, total_amount, payment_method, created_by, created_at, approved_at)
      VALUES ('ORD-CR-TEST-004', v_cust3_id, 'employee', v_emp_id, 'approved', 200000, 0, 200000, 'credit', v_emp_id, v_now - interval '40 days', v_now - interval '39 days')
      RETURNING id INTO v_order_id;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES ('CI-20260425-001', v_cust3_id, v_order_id, 200000, (CURRENT_DATE - interval '40 days')::date, (CURRENT_DATE - interval '10 days')::date, 'overdue')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.credit_invoice_cheques (invoice_id, cheque_number, bank_name, amount, due_date, recorded_by)
      VALUES (v_invoice_id, 'CHQ-30001', 'البنك التجاري الدولي', 200000, (CURRENT_DATE - interval '10 days')::date, v_emp_id);
    END IF;
  END IF;

  -- ==========================================================================
  -- CREATE CREDIT APPLICATION for pending customer
  -- ==========================================================================
  IF v_pending_cust_id IS NOT NULL AND v_prog1_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.credit_applications WHERE customer_id = v_pending_cust_id AND status = 'submitted') THEN
      INSERT INTO public.credit_applications (customer_id, program_id, status, created_by, submitted_at)
      VALUES (v_pending_cust_id, v_prog1_id, 'submitted', v_emp_id, v_now - interval '2 days');
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- END OF CREDIT PROGRAM MODULE V2
-- ============================================================================
