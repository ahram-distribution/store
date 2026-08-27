-- ============================================================================
-- SAHL GLOBAL LIFECYCLE + TRACEABILITY — Stage G7
--
-- Maps SAHL's per-document {type}_edit / {type}_del permission model onto
-- AHRAM corrective actions, respecting each document's posting state:
--
--   PRE-POSTING (no financial/inventory effects yet):
--     purchases, supplier_payments, expenses, receipts(collections),
--     purchase_returns, employee_advances, quotes
--       → CANCEL (soft state, never physical delete) and, where SAHL's
--         {type}_edit applies, EDIT (purchases, quotes, suppliers master data).
--
--   POSTED (real effects on stock/treasury/balances):
--     locked in place. Corrections follow the reversal instruments that
--     already exist: void sale invoice, sales return, purchase return,
--     cheque bounce/cancel. No SQL DELETE of posted evidence.
--
--   Treasury transfers are internal two-leg movements; cancelling removes
--   both legs (no external evidence) and marks the transfer document.
--
-- TRACEABILITY support:
--   sahl_get_treasury_summary now resolves doc_code + party + drawer for EVERY
--   movement family, so any treasury number drills down to its source record.
--   sahl_get_advance_settlements exposes the sources of settled amounts.
--
-- Collections gains 'cancelled' as an additive status value; canonical
-- customer balance/statement already count only approved/treasury_posted/
-- legacy-NULL, so cancellation automatically removes a voucher from every
-- derived number. Cancelling an APPROVED receipt additionally re-runs the
-- projection recalc (_sahl_recalc_customer_outstanding).
-- ============================================================================

-- 1. Additive status values -------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchases_status') THEN
    ALTER TABLE public.purchases DROP CONSTRAINT ck_purchases_status;
  END IF;
  ALTER TABLE public.purchases ADD CONSTRAINT ck_purchases_status
    CHECK (status IN ('pending', 'treasury_posted', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_supplier_payments_status') THEN
    ALTER TABLE public.supplier_payments DROP CONSTRAINT ck_supplier_payments_status;
  END IF;
  ALTER TABLE public.supplier_payments ADD CONSTRAINT ck_supplier_payments_status
    CHECK (status IN ('pending', 'treasury_posted', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_returns_status') THEN
    ALTER TABLE public.purchase_returns DROP CONSTRAINT ck_purchase_returns_status;
  END IF;
  ALTER TABLE public.purchase_returns ADD CONSTRAINT ck_purchase_returns_status
    CHECK (status IN ('pending', 'treasury_posted', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_expenses_status') THEN
    ALTER TABLE public.expenses DROP CONSTRAINT ck_expenses_status;
  END IF;
  ALTER TABLE public.expenses ADD CONSTRAINT ck_expenses_status
    CHECK (status IN ('pending', 'treasury_posted', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_collections_status') THEN
    ALTER TABLE public.collections DROP CONSTRAINT ck_collections_status;
  END IF;
  ALTER TABLE public.collections ADD CONSTRAINT ck_collections_status
    CHECK (status IN ('pending', 'approved', 'treasury_posted', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sahl_transfers_status') THEN
    ALTER TABLE public.sahl_treasury_transfers DROP CONSTRAINT ck_sahl_transfers_status;
  END IF;
  ALTER TABLE public.sahl_treasury_transfers ADD CONSTRAINT ck_sahl_transfers_status
    CHECK (status IN ('posted', 'cancelled'));
END;
$$;

COMMENT ON COLUMN public.collections.status IS
'pending → approved → treasury_posted; pending/approved may become cancelled (سهل: إلغاء سند قبل الترحيل).';

-- 2. Employee advances: cancellation markers --------------------------------

ALTER TABLE public.employee_advances ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.employee_advances ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.employees (id);

-- Cancelled advances leave the operational register entirely.
CREATE OR REPLACE FUNCTION public.sahl_get_advances(
  p_token text,
  p_include_settled boolean DEFAULT false
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
  IF NOT public.check_capability(p_token, 'sahl.advances.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT a.id, a.employee_id, e.full_name AS employee_name,
           a.amount, a.outstanding_amount, a.reason,
           a.is_settled, a.approved_at, a.created_at,
           (a.amount - a.outstanding_amount) AS settled_amount,
           (SELECT count(*)::int FROM public.sahl_advance_settlements s WHERE s.advance_id = a.id) AS settlement_count
    FROM public.employee_advances a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.cancelled_at IS NULL
      AND (p_include_settled OR NOT a.is_settled)
  ) t;

  RETURN v_result;
END;
$$;

-- 3. Purchases: cancel + edit BEFORE posting ----------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_purchase(
  p_token text,
  p_purchase_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_pur public.purchases;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.purchases.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.purchases.create');
  END IF;

  SELECT * INTO v_pur FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_pur.status = 'treasury_posted' THEN
    RETURN jsonb_build_object('error', 'ALREADY_POSTED',
      'hint', 'فاتورة مرحّلة لا تُلغى — استخدم مرتجع شراء لتصحيحها');
  END IF;
  IF v_pur.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;

  UPDATE public.purchases SET
    status = 'cancelled',
    notes = NULLIF(btrim(COALESCE(v_pur.notes, '')
      || ' — أُلغيت قبل الترحيل'
      || CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
              THEN ': ' || btrim(p_reason) ELSE '' END), ''),
    updated_at = now()
  WHERE id = v_pur.id;

  RETURN jsonb_build_object('success', true, 'code', v_pur.code, 'status', 'cancelled');
END;
$$;

-- Edit mirrors SAHL purchase_edit: allowed while the document never posted,
-- i.e. zero effects exist to reconcile. Items are replaced wholesale and the
-- total recomputed server-side.
CREATE OR REPLACE FUNCTION public.sahl_update_purchase(
  p_token text,
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text DEFAULT 'credit',
  p_paid_amount numeric DEFAULT 0,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_pur public.purchases;
  v_item jsonb;
  v_product public.products;
  v_multiplier numeric;
  v_pieces integer;
  v_line_total numeric(12,2);
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.purchases.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.purchases.create');
  END IF;

  SELECT * INTO v_pur FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_pur.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'NOT_EDITABLE',
      'hint', 'تعديل فاتورة الشراء مسموح فقط قبل الترحيل — بعد الترحيل استخدم مرتجع شراء');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('error', 'SUPPLIER_NOT_FOUND');
  END IF;
  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'cheque', 'deposit', 'credit') THEN
    RETURN jsonb_build_object('error', 'INVALID_PAYMENT_METHOD');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_ITEMS');
  END IF;

  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PAID_AMOUNT'); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'product_id' IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_ITEM: missing product_id'); END IF;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_item->>'product_id')); END IF;
    IF NOT v_product.is_active THEN RETURN jsonb_build_object('error', 'PRODUCT_INACTIVE: ' || v_product.product_name); END IF;
    IF (v_item->>'unit_type') NOT IN ('piece', 'dozen', 'carton') THEN
      RETURN jsonb_build_object('error', 'INVALID_UNIT: ' || COALESCE(v_item->>'unit_type', 'null'));
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 OR (v_item->>'quantity')::numeric != floor((v_item->>'quantity')::numeric) THEN
      RETURN jsonb_build_object('error', 'INVALID_QUANTITY');
    END IF;
    IF COALESCE((v_item->>'unit_cost')::numeric, -1) < 0 THEN
      RETURN jsonb_build_object('error', 'INVALID_COST');
    END IF;
    v_total := v_total + ROUND((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2);
  END LOOP;

  IF v_total <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_TOTAL'); END IF;
  IF v_paid > v_total THEN RETURN jsonb_build_object('error', 'PAID_EXCEEDS_TOTAL'); END IF;

  UPDATE public.purchases SET
    supplier_id = p_supplier_id,
    total_amount = v_total,
    payment_method = p_payment_method,
    paid_amount = v_paid,
    reference_number = NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = now()
  WHERE id = v_pur.id;

  DELETE FROM public.purchase_items WHERE purchase_id = v_pur.id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    v_multiplier := CASE v_item->>'unit_type'
      WHEN 'piece' THEN 1
      WHEN 'dozen' THEN 12
      ELSE v_product.carton_quantity
    END;
    v_pieces := ((v_item->>'quantity')::numeric * v_multiplier)::integer;
    v_line_total := ROUND((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2);

    INSERT INTO public.purchase_items (
      purchase_id, product_id, unit_type, unit_quantity, piece_quantity,
      unit_cost, line_total, cost_per_piece
    ) VALUES (
      v_pur.id, v_product.id, v_item->>'unit_type', (v_item->>'quantity')::int, v_pieces,
      ROUND((v_item->>'unit_cost')::numeric, 2), v_line_total,
      ROUND(v_line_total / v_pieces, 4)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_pur.id, 'code', v_pur.code, 'total', v_total);
END;
$$;

-- 4. Supplier payments: cancel before posting ---------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_supplier_payment(
  p_token text,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_pay public.supplier_payments;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.payments.suppliers.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.payments.suppliers.create');
  END IF;

  SELECT * INTO v_pay FROM public.supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_pay.status = 'treasury_posted' THEN
    RETURN jsonb_build_object('error', 'ALREADY_POSTED',
      'hint', 'سند مرحّل لا يُلغى — صحّحه بسند صرف معاكس أو مراجعة يدوية موثقة');
  END IF;
  IF v_pay.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;

  UPDATE public.supplier_payments SET status = 'cancelled', updated_at = now()
  WHERE id = v_pay.id;

  RETURN jsonb_build_object('success', true, 'code', v_pay.code, 'status', 'cancelled');
END;
$$;

-- 5. Expenses: cancel before posting --------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_expense(
  p_token text,
  p_expense_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_exp public.expenses;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.expenses.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.expenses.create');
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_exp.status = 'treasury_posted' THEN
    RETURN jsonb_build_object('error', 'ALREADY_POSTED',
      'hint', 'سند صرف مرحّل لا يُلغى — حركته جزء من تاريخ الخزينة');
  END IF;
  IF v_exp.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;

  UPDATE public.expenses SET status = 'cancelled', updated_at = now()
  WHERE id = v_exp.id;

  RETURN jsonb_build_object('success', true, 'code', v_exp.code, 'status', 'cancelled');
END;
$$;

-- 6. Receipts (collections): cancel before treasury posting ----------------------
-- Pending receipts carry no effects at all. Approved-but-unposted receipts ARE
-- counted by the canonical customer balance, so cancelling one re-runs the
-- projection recalc. Posted receipts are financial history — never cancellable.

CREATE OR REPLACE FUNCTION public.sahl_cancel_receipt(
  p_token text,
  p_collection_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_col public.collections;
  v_balance numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.receipts.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.receipts.post');
  END IF;

  SELECT * INTO v_col FROM public.collections WHERE id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_col.status = 'treasury_posted' THEN
    RETURN jsonb_build_object('error', 'ALREADY_POSTED',
      'hint', 'سند مرحّل للخزينة لا يُلغى — هو سجل مالي نهائي');
  END IF;
  IF v_col.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;
  IF v_col.status NOT IN ('pending', 'approved') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.collections SET
    status = 'cancelled',
    notes = NULLIF(btrim(COALESCE(v_col.notes, '')
      || ' — أُلغي السند قبل الترحيل'
      || CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
              THEN ': ' || btrim(p_reason) ELSE '' END), ''),
    updated_at = now()
  WHERE id = v_col.id;

  IF v_col.status = 'approved' THEN
    v_balance := public._sahl_recalc_customer_outstanding(v_col.customer_id, v_session.employee_id);
  ELSE
    v_balance := public.sahl_customer_current_balance(v_col.customer_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', v_col.code, 'status', 'cancelled',
                            'customer_balance_now', COALESCE(v_balance, 0));
END;
$$;

-- 7. Purchase returns: cancel before posting --------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_purchase_return(
  p_token text,
  p_purchase_return_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_prt public.purchase_returns;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.create');
  END IF;

  SELECT * INTO v_prt FROM public.purchase_returns WHERE id = p_purchase_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_prt.status = 'treasury_posted' THEN
    RETURN jsonb_build_object('error', 'ALREADY_POSTED',
      'hint', 'مرتجع مرحّل خرج مخزنه فعلياً ولا يُلغى');
  END IF;
  IF v_prt.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;

  UPDATE public.purchase_returns SET status = 'cancelled', updated_at = now()
  WHERE id = v_prt.id;

  RETURN jsonb_build_object('success', true, 'code', v_prt.code, 'status', 'cancelled');
END;
$$;

-- 8. Employee advances: cancel before disbursement ---------------------------------
-- Once approved, the money physically left the treasury — correction happens
-- through settlement, not cancellation.

CREATE OR REPLACE FUNCTION public.sahl_cancel_advance(
  p_token text,
  p_advance_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_adv public.employee_advances;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.advances.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.manage');
  END IF;

  SELECT * INTO v_adv FROM public.employee_advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_adv.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'ALREADY_CANCELLED'); END IF;
  IF v_adv.approved_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_APPROVED',
      'hint', 'السلفة صُرفت من الخزينة — التصحيح عبر التسوية وليس الإلغاء');
  END IF;
  IF EXISTS (SELECT 1 FROM public.sahl_advance_settlements WHERE advance_id = p_advance_id) THEN
    RETURN jsonb_build_object('error', 'HAS_SETTLEMENTS');
  END IF;

  UPDATE public.employee_advances
  SET cancelled_at = now(), cancelled_by = v_session.employee_id, updated_at = now()
  WHERE id = v_adv.id;

  RETURN jsonb_build_object('success', true, 'id', v_adv.id, 'status', 'cancelled');
END;
$$;

-- 9. Suppliers master data: edit / deactivate ---------------------------------------
-- SAHL accounts are editable master records; is_active=false is the soft delete
-- (history preserved everywhere).

CREATE OR REPLACE FUNCTION public.sahl_update_supplier(
  p_token text,
  p_supplier_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_cur public.suppliers;
  v_name text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.suppliers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.suppliers.manage');
  END IF;

  SELECT * INTO v_cur FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_name := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_cur.supplier_name);

  UPDATE public.suppliers SET
    supplier_name = v_name,
    phone = COALESCE(p_phone, v_cur.phone),
    address = COALESCE(p_address, v_cur.address),
    notes = COALESCE(p_notes, v_cur.notes),
    is_active = COALESCE(p_is_active, v_cur.is_active),
    updated_at = now()
  WHERE id = v_cur.id;

  RETURN jsonb_build_object('success', true, 'id', v_cur.id, 'supplier_name', v_name,
                            'is_active', COALESCE(p_is_active, v_cur.is_active));
END;
$$;

-- 10. Quotes: edit while open (SAHL salequote_edit) -----------------------------------
-- Open quotes have no financial or stock effect — only optional informational
-- reservations, which are rebuilt atomically here.

CREATE OR REPLACE FUNCTION public.sahl_update_quote(
  p_token text,
  p_quote_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_items jsonb DEFAULT NULL,
  p_discount_amount numeric DEFAULT NULL,
  p_additions_amount numeric DEFAULT NULL,
  p_additions_type text DEFAULT NULL,
  p_tax_amount numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reserve_stock boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_q public.sahl_invoices;
  r record;
  v_cq integer;
  v_ppu integer;
  v_subtotal numeric(12,2) := 0;
  v_disc numeric(12,2);
  v_adds numeric(12,2);
  v_tax numeric(12,2);
  v_grand numeric(12,2);
  v_reserve boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.manage');
  END IF;

  SELECT * INTO v_q FROM public.sahl_invoices WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_q.kind != 'quote' OR v_q.status != 'open' THEN
    RETURN jsonb_build_object('error', 'QUOTE_NOT_OPEN',
      'hint', 'تعديل عرض السعر مسموح فقط وهو مفتوح — المحوَّل أو الملغى مقفل');
  END IF;

  v_disc := COALESCE(p_discount_amount, v_q.discount_amount);
  v_adds := COALESCE(p_additions_amount, v_q.additions_amount);
  v_tax := COALESCE(p_tax_amount, v_q.tax_amount);
  IF v_disc < 0 OR v_adds < 0 OR v_tax < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_ADJUSTMENT');
  END IF;

  PERFORM set_config('app.sahl_store_guard', 'sahl', true);

  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('error', 'NO_ITEMS');
    END IF;
    FOR r IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, unit_type text, qty numeric, unit_price numeric)
    LOOP
      IF r.product_id IS NULL OR r.qty IS NULL OR r.qty <= 0 THEN RETURN jsonb_build_object('error', 'BAD_ITEM'); END IF;
      SELECT carton_quantity INTO v_cq FROM public.products WHERE id = r.product_id;
      IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;
      v_ppu := CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 12 WHEN 'carton' THEN v_cq ELSE 1 END;
      v_subtotal := v_subtotal + ROUND(r.qty * COALESCE(r.unit_price,0), 2);
    END LOOP;

    DELETE FROM public.sahl_invoice_items WHERE invoice_id = v_q.id;

    FOR r IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, unit_type text, qty numeric, unit_price numeric)
    LOOP
      SELECT carton_quantity INTO v_cq FROM public.products WHERE id = r.product_id;
      v_ppu := CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 12 WHEN 'carton' THEN v_cq ELSE 1 END;
      INSERT INTO public.sahl_invoice_items (
        invoice_id, product_id, unit_type, unit_label, pieces_per_unit,
        qty, qty_pieces, unit_price, line_total
      ) VALUES (
        v_q.id, r.product_id, COALESCE(r.unit_type,'piece'),
        CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 'دستة' WHEN 'carton' THEN 'كرتونة' ELSE 'قطعة' END,
        v_ppu, r.qty, r.qty * v_ppu, COALESCE(r.unit_price,0), ROUND(r.qty * COALESCE(r.unit_price,0), 2)
      );
    END LOOP;
  ELSE
    SELECT ROUND(COALESCE(SUM(line_total), 0), 2) INTO v_subtotal
    FROM public.sahl_invoice_items WHERE invoice_id = v_q.id;
  END IF;

  IF v_disc > v_subtotal THEN RETURN jsonb_build_object('error', 'DISCOUNT_EXCEEDS_SUBTOTAL'); END IF;
  v_grand := ROUND(v_subtotal - v_disc + v_adds + v_tax, 2);
  IF v_grand < 0 THEN RETURN jsonb_build_object('error', 'INVALID_TOTALS'); END IF;

  v_reserve := COALESCE(p_reserve_stock, v_q.reserve_stock);

  -- Rebuild informational reservations to match the edited lines.
  UPDATE public.sahl_stock_reservations
  SET active = false, released_at = now()
  WHERE quote_id = v_q.id AND active;

  IF v_reserve THEN
    IF COALESCE(p_customer_id, v_q.customer_id) IS NULL THEN
      RETURN jsonb_build_object('error', 'CUSTOMER_REQUIRED_FOR_RESERVATION');
    END IF;
    INSERT INTO public.sahl_stock_reservations (quote_id, product_id, store_id, qty_pieces)
    SELECT v_q.id, product_id, v_q.store_id, CEIL(qty_pieces)::int
    FROM public.sahl_invoice_items WHERE invoice_id = v_q.id;
  END IF;

  UPDATE public.sahl_invoices SET
    customer_id = COALESCE(p_customer_id, v_q.customer_id),
    subtotal = v_subtotal,
    discount_amount = v_disc,
    additions_amount = v_adds,
    additions_type = COALESCE(NULLIF(btrim(COALESCE(p_additions_type, '')), ''), v_q.additions_type),
    tax_amount = v_tax,
    grand_total = v_grand,
    notes = CASE WHEN p_notes IS NULL THEN v_q.notes
                 ELSE NULLIF(btrim(p_notes), '') END,
    reserve_stock = v_reserve,
    updated_at = now()
  WHERE id = v_q.id;

  RETURN jsonb_build_object('success', true, 'id', v_q.id, 'code', v_q.code,
                            'subtotal', v_subtotal, 'grand_total', v_grand, 'reserve_stock', v_reserve);
END;
$$;

-- 11. Advance settlements reader (sources of settled_amount) --------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_advance_settlements(
  p_token text,
  p_advance_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.advances.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT s.id, s.amount, s.notes, s.created_at, e.full_name AS created_by_name
    FROM public.sahl_advance_settlements s
    LEFT JOIN public.employees e ON e.id = s.created_by
    WHERE s.advance_id = p_advance_id
  ) t;

  RETURN v_result;
END;
$$;

-- 12. Treasury summary: full source resolution for EVERY movement family ---------------

CREATE OR REPLACE FUNCTION public.sahl_get_treasury_summary(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
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
        SELECT t.id, t.transaction_type, t.amount, t.reference_type, t.reference_id,
               t.treasury_id, t.notes, t.created_at,
               tr.name AS treasury_name,
               emp.full_name AS created_by_name,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT c.code FROM public.collections c WHERE c.id = t.reference_id)
                 WHEN 'expense' THEN (SELECT e.code FROM public.expenses e WHERE e.id = t.reference_id)
                 WHEN 'purchase' THEN (SELECT pu.code FROM public.purchases pu WHERE pu.id = t.reference_id)
                 WHEN 'supplier_payment' THEN (SELECT sp.code FROM public.supplier_payments sp WHERE sp.id = t.reference_id)
                 WHEN 'sale' THEN (SELECT v.code FROM public.sahl_invoices v WHERE v.id = t.reference_id)
                 WHEN 'sale_card' THEN (SELECT v.code FROM public.sahl_invoices v WHERE v.id = t.reference_id)
                 WHEN 'sale_void' THEN (SELECT v.code FROM public.sahl_invoices v WHERE v.id = t.reference_id)
                 WHEN 'sale_void_card' THEN (SELECT v.code FROM public.sahl_invoices v WHERE v.id = t.reference_id)
                 WHEN 'cheque' THEN (SELECT q.code FROM public.sahl_cheques q WHERE q.id = t.reference_id)
                 WHEN 'advance_settlement' THEN (SELECT st.code FROM public.sahl_treasury_transfers st WHERE false)
                 WHEN 'purchase_return' THEN (SELECT pr.code FROM public.purchase_returns pr WHERE pr.id = t.reference_id)
                 WHEN 'treasury_transfer_out' THEN (SELECT tf.code FROM public.sahl_treasury_transfers tf WHERE tf.id = t.reference_id)
                 WHEN 'treasury_transfer_in' THEN (SELECT tf.code FROM public.sahl_treasury_transfers tf WHERE tf.id = t.reference_id)
                 ELSE NULL
               END AS doc_code,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT cu.company_name FROM public.collections c
                                          JOIN public.customers cu ON cu.id = c.customer_id
                                          WHERE c.id = t.reference_id)
                 WHEN 'sale' THEN (SELECT cu.company_name FROM public.sahl_invoices v
                                    LEFT JOIN public.customers cu ON cu.id = v.customer_id
                                    WHERE v.id = t.reference_id)
                 WHEN 'sale_card' THEN (SELECT cu.company_name FROM public.sahl_invoices v
                                          LEFT JOIN public.customers cu ON cu.id = v.customer_id
                                          WHERE v.id = t.reference_id)
                 WHEN 'sale_void' THEN (SELECT cu.company_name FROM public.sahl_invoices v
                                          LEFT JOIN public.customers cu ON cu.id = v.customer_id
                                          WHERE v.id = t.reference_id)
                 WHEN 'sale_void_card' THEN (SELECT cu.company_name FROM public.sahl_invoices v
                                               LEFT JOIN public.customers cu ON cu.id = v.customer_id
                                               WHERE v.id = t.reference_id)
                 WHEN 'purchase' THEN (SELECT s.supplier_name FROM public.purchases pu
                                        JOIN public.suppliers s ON s.id = pu.supplier_id
                                        WHERE pu.id = t.reference_id)
                 WHEN 'supplier_payment' THEN (SELECT s.supplier_name FROM public.supplier_payments sp
                                                JOIN public.suppliers s ON s.id = sp.supplier_id
                                                WHERE sp.id = t.reference_id)
                 WHEN 'purchase_return' THEN (SELECT s.supplier_name FROM public.purchase_returns pr
                                               JOIN public.suppliers s ON s.id = pr.supplier_id
                                               WHERE pr.id = t.reference_id)
                 WHEN 'cheque' THEN (SELECT COALESCE(cu.company_name, s.supplier_name)
                                      FROM public.sahl_cheques q
                                      LEFT JOIN public.customers cu ON q.party_type='customer' AND cu.id = q.party_id
                                      LEFT JOIN public.suppliers s ON q.party_type='supplier' AND s.id = q.party_id
                                      WHERE q.id = t.reference_id)
                 WHEN 'employee_advance' THEN (SELECT e.full_name FROM public.employee_advances a
                                                JOIN public.employees e ON e.id = a.employee_id
                                                WHERE a.id = t.reference_id)
                 WHEN 'advance_settlement' THEN (SELECT e.full_name FROM public.sahl_advance_settlements st
                                                  JOIN public.employee_advances a ON a.id = st.advance_id
                                                  JOIN public.employees e ON e.id = a.employee_id
                                                  WHERE st.id = t.reference_id)
                 ELSE NULL
               END AS party_name
        FROM public.treasury_transactions t
        LEFT JOIN public.employees emp ON emp.id = t.created_by
        LEFT JOIN public.sahl_treasuries tr ON tr.id = t.treasury_id
        ORDER BY t.created_at DESC
        LIMIT 200
      ) x
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 13. Grants & reload ------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_get_advances(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_purchase(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_update_purchase(text, uuid, uuid, jsonb, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_supplier_payment(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_expense(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_receipt(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_purchase_return(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_advance(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_update_supplier(text, uuid, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_update_quote(text, uuid, uuid, jsonb, numeric, numeric, text, numeric, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_advance_settlements(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_treasury_summary(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL Global Lifecycle + Traceability (Stage G7)
-- ============================================================================
