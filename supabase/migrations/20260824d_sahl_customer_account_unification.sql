-- ============================================================================
-- SAHL — CUSTOMER ACCOUNT UNIFICATION (one coherent customer balance)
-- تصحيح حساب العميل: مصدر واحد للحقيقة
--
-- ROOT CAUSE BEING FIXED
-- ----------------------
-- Two independent "customer balance" paths existed:
--
--   1) Display path: get_governed_customers.current_balance
--      = orders_total (AHRAM orders, statistical) - collections(NULL/'approved')
--      Defects: never saw SAHL sale-invoice credit portions or approved sales
--      returns; and receipts LEFT the sum once they reached their terminal
--      real state ('treasury_posted') — i.e. posting money into the treasury
--      re-inflated the displayed debt.
--
--   2) Internal path: customer_credit_accounts.outstanding_credit
--      A mutable counter incremented/decremented only by SAHL module functions
--      using LEAST(amount, outstanding). It knew nothing about AHRAM orders,
--      drifted whenever an account row was missing (applied=0), and produced
--      the anomaly "المبلغ يتجاوز الرصيد المطبق على الحساب الائتماني"
--      (seen on COL-2026-000022 / CUS-2026-000187).
--
-- THE FIX (business meaning unchanged)
-- ------------------------------------
-- ONE canonical calculation derived from REAL records:
--
--   sahl_customer_current_balance(customer) =
--       + statistical AHRAM orders (is_order_in_statistics)
--       + credit portion of posted SAHL sale invoices (paid_credit)
--       - approved sales returns (credit_note_amount)
--       - real customer receipts (collections approved/treasury_posted/legacy NULL)
--       - incoming customer cheques not yet bounced/cancelled and not already
--         represented by a settled linked receipt
--
--   * Every mutation now writes its document FIRST, then calls
--     _sahl_recalc_customer_outstanding() which re-derives the balance and
--     syncs it into customer_credit_accounts.outstanding_credit.
--     The stored column becomes a projection of the single calculation —
--     not a competing source of truth.
--   * get_governed_customers.current_balance uses the same function, so the
--     customer account ↔ sales ↔ returns ↔ receipts ↔ movements all agree.
-- ============================================================================

-- 1. Canonical balance derivation (single source of truth) --------------------

CREATE OR REPLACE FUNCTION public.sahl_customer_current_balance(p_customer_id uuid)
RETURNS numeric(12,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    -- فواتير الطلبات المعتمدة (أهرام)
    COALESCE((SELECT SUM(o.total_amount)
                FROM public.orders o
               WHERE o.customer_id = p_customer_id
                 AND public.is_order_in_statistics(o.status)), 0::numeric)
    -- الجزء الآجل من فواتير بيع سهل المرحّلة
    + COALESCE((SELECT SUM(v.paid_credit)
                  FROM public.sahl_invoices v
                 WHERE v.customer_id = p_customer_id
                   AND v.kind = 'sale' AND v.status = 'posted'), 0::numeric)
    -- مرتجعات البيع المعتمدة
    - COALESCE((SELECT SUM(r.credit_note_amount)
                  FROM public.returns r
                 WHERE r.customer_id = p_customer_id
                   AND r.status = 'approved'), 0::numeric)
    -- سندات القبض الحقيقية (معتمدة أو مرحّلة للخزينة أو قديمة بلا حالة)
    - COALESCE((SELECT SUM(cl.amount)
                  FROM public.collections cl
                 WHERE cl.customer_id = p_customer_id
                   AND (cl.status IS NULL OR cl.status IN ('approved','treasury_posted'))), 0::numeric)
    -- شيكات واردة مسجلة على العميل لم ترتد/تُلغَ ولم يمثلها سند مقيد بالفعل
    - COALESCE((SELECT SUM(ch.amount)
                  FROM public.sahl_cheques ch
                 WHERE ch.party_type = 'customer'
                   AND ch.party_id = p_customer_id
                   AND ch.direction = 'incoming'
                   AND ch.status IN ('pending','deposited','cleared')
                   AND NOT EXISTS (
                     SELECT 1 FROM public.collections cl2
                      WHERE cl2.id = ch.linked_collection_id
                        AND (cl2.status IS NULL OR cl2.status IN ('approved','treasury_posted'))
                   )), 0::numeric)
$$;

COMMENT ON FUNCTION public.sahl_customer_current_balance(uuid) IS
'سهل: الرصيد الحقيقي للعميل مشتق من مستنداته الفعلية (طلبات معتمدة + فواتير آجل − مرتجعات معتمدة − سندات قبض فعلية − شيكات واردة سارية). المصدر الوحيد لحساب رصيد العميل في كل الشاشات والمسارات.';

-- 2. Recalc helper: re-derive and project into customer_credit_accounts -------

CREATE OR REPLACE FUNCTION public._sahl_recalc_customer_outstanding(
  p_customer_id  uuid,
  p_activated_by uuid DEFAULT NULL
)
RETURNS numeric(12,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_balance numeric(12,2);
  v_stored  numeric(12,2);
  v_by      uuid;
BEGIN
  -- Serialize concurrent writers on the same account row when it exists.
  BEGIN
    PERFORM 1 FROM public.customer_credit_accounts
     WHERE customer_id = p_customer_id FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_balance := GREATEST(public.sahl_customer_current_balance(p_customer_id), 0);

  IF p_activated_by IS NULL THEN
    SELECT created_by INTO v_by FROM public.collections
     WHERE customer_id = p_customer_id ORDER BY created_at DESC LIMIT 1;
    IF v_by IS NULL THEN
      SELECT owner_id INTO v_by FROM public.orders
       WHERE customer_id = p_customer_id ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_by IS NULL THEN
      SELECT id INTO v_by FROM public.employees ORDER BY created_at ASC LIMIT 1;
    END IF;
  ELSE
    v_by := p_activated_by;
  END IF;

  INSERT INTO public.customer_credit_accounts AS cca
    (customer_id, credit_program_id, credit_limit, payment_term_days,
     outstanding_credit, activated_by)
  VALUES (p_customer_id, NULL, 0, 0, v_balance, v_by)
  ON CONFLICT (customer_id) DO UPDATE
    SET outstanding_credit = EXCLUDED.outstanding_credit,
        updated_at = now()
  RETURNING outstanding_credit INTO v_stored;

  RETURN COALESCE(v_stored, v_balance);
END;
$$;

COMMENT ON FUNCTION public._sahl_recalc_customer_outstanding(uuid, uuid) IS
'سهل: إعادة اشتقاق رصيد العميل من مستنداته الفعلية ومزامنة عمود outstanding_credit داخلياً (إسقاط للحساب الواحد وليس مصدر حقيقة منفصلاً).';

-- 3. sahl_post_receipt(text,uuid) — legacy signature ---------------------------

CREATE OR REPLACE FUNCTION public.sahl_post_receipt(
  p_token text,
  p_collection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_col               public.collections;
  v_outstanding_after numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.receipts.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.receipts.post');
  END IF;

  SELECT * INTO v_col FROM public.collections WHERE id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_col.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;
  IF v_col.status NOT IN ('pending', 'approved') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- Treasury movement: money IN. The unique index uq_treasury_reference
  -- guarantees one treasury row per collection.
  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'inflow', v_col.amount, 'collection', v_col.id,
    'سند قبض ' || v_col.code || CASE WHEN v_col.reference_number IS NOT NULL THEN ' — مرجع: ' || v_col.reference_number ELSE '' END,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  -- Settle the receipt document first, then derive the balance from records.
  UPDATE public.collections SET
    status       = 'treasury_posted',
    collected_at = COALESCE(collected_at, now()),
    approved_by  = COALESCE(approved_by, v_session.employee_id),
    approved_at  = COALESCE(approved_at, now()),
    updated_at   = now()
  WHERE id = v_col.id;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_col.customer_id, v_session.employee_id);

  -- Financial movement on the customer account (INSERT-only audit table).
  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_col.customer_id,
    'debit',
    v_col.amount,
    v_outstanding_after,
    'collection',
    v_col.id,
    'قبض ' || v_col.code || ' — ' || v_col.method,
    v_session.employee_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'collection_id', v_col.id,
    'code', v_col.code,
    'amount', v_col.amount,
    'applied_to_credit_account', v_col.amount,
    'outstanding_after', v_outstanding_after
  );
END;
$$;

-- 4. sahl_post_receipt(text,uuid,uuid) — drawer-aware signature -----------------

CREATE OR REPLACE FUNCTION public.sahl_post_receipt(
  p_token text,
  p_collection_id uuid,
  p_treasury_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_col               public.collections;
  v_outstanding_after numeric(12,2);
  v_treasury_id       uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.receipts.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.receipts.post');
  END IF;

  SELECT * INTO v_col FROM public.collections WHERE id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_col.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;
  IF v_col.status NOT IN ('pending', 'approved') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

  -- Treasury movement: money IN, attributed to the chosen drawer.
  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
  ) VALUES (
    'inflow', v_col.amount, 'collection', v_col.id,
    'سند قبض ' || v_col.code || CASE WHEN v_col.reference_number IS NOT NULL THEN ' — مرجع: ' || v_col.reference_number ELSE '' END,
    v_session.employee_id,
    v_treasury_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  UPDATE public.collections SET status = 'treasury_posted' WHERE id = v_col.id;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_col.customer_id, v_session.employee_id);

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_col.customer_id,
    'debit',
    v_col.amount,
    v_outstanding_after,
    'collection',
    v_col.id,
    'قبض ' || v_col.code || ' — ' || v_col.method,
    v_session.employee_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_col.id,
    'code', v_col.code,
    'amount', v_col.amount,
    'applied_to_account', v_col.amount,
    'outstanding_after', v_outstanding_after,
    'status', 'treasury_posted',
    'treasury_id', v_treasury_id
  );
END;
$$;

-- 5. sahl_approve_sales_return(text,uuid) --------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_approve_sales_return(
  p_token text,
  p_return_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_ret               public.returns;
  v_oi                record;
  v_price             numeric(12,2);
  v_mult              integer;
  v_pieces            integer;
  v_condition         text;
  v_line_val          numeric(12,2);
  v_total             numeric(12,2) := 0;
  v_outstanding_after numeric(12,2);
  v_cn                varchar(30);
  v_cust_name         text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.post');
  END IF;

  SELECT * INTO v_ret FROM public.returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_ret.status = 'approved' THEN RETURN jsonb_build_object('error', 'ALREADY_APPROVED'); END IF;
  IF v_ret.status NOT IN ('pending', 'inspecting') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  SELECT company_name INTO v_cust_name FROM public.customers WHERE id = v_ret.customer_id;

  FOR v_oi IN
    SELECT ri.id, ri.product_id, ri.unit_type, ri.quantity,
           COALESCE(i.condition, 'saleable') AS condition
    FROM public.return_items ri
    LEFT JOIN LATERAL (
      SELECT condition FROM public.return_inspection x
      WHERE x.return_item_id = ri.id ORDER BY x.inspected_at DESC LIMIT 1
    ) i ON true
    WHERE ri.return_id = p_return_id
  LOOP
    SELECT unit_price INTO v_price
    FROM public.order_items
    WHERE order_id = v_ret.order_id AND product_id = v_oi.product_id AND unit_type = v_oi.unit_type
    ORDER BY id LIMIT 1;

    v_line_val := ROUND(COALESCE(v_price, 0) * v_oi.quantity, 2);
    v_total := v_total + v_line_val;

    IF v_oi.condition = 'saleable' THEN
      v_mult := public.piece_multiplier(v_oi.unit_type, v_oi.product_id);
      v_pieces := v_oi.quantity * v_mult;

      INSERT INTO public.inventory (product_id, quantity)
      VALUES (v_oi.product_id, v_pieces)
      ON CONFLICT (product_id) DO UPDATE
        SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = now();
    END IF;
    -- damaged/expired/unsaleable → write-off: no stock reentry
  END LOOP;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('error', 'ZERO_VALUE_RETURN');
  END IF;

  v_cn := public.generate_credit_note_number();

  -- Approve the return document first, then derive the balance from records.
  UPDATE public.returns SET
    status = 'approved',
    credit_note_number = v_cn,
    credit_note_amount = v_total,
    updated_at = now()
  WHERE id = v_ret.id;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_ret.customer_id, v_session.employee_id);

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_ret.customer_id, 'debit', v_total, v_outstanding_after,
    'sales_return', v_ret.id,
    'مرتجع بيع ' || v_ret.code || CASE WHEN v_cust_name IS NOT NULL THEN ' — ' || v_cust_name ELSE '' END,
    v_session.employee_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_ret.id,
    'code', v_ret.code,
    'credit_note_number', v_cn,
    'credit_note_amount', v_total,
    'applied_to_account', v_total,
    'outstanding_after', v_outstanding_after
  );
END;
$$;

-- 6. sahl_approve_sales_return(text,uuid,uuid) — store-aware signature ----------

CREATE OR REPLACE FUNCTION public.sahl_approve_sales_return(
  p_token text,
  p_return_id uuid,
  p_store_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_ret               public.returns;
  v_oi                record;
  v_price             numeric(12,2);
  v_mult              integer;
  v_pieces            integer;
  v_condition         text;
  v_line_val          numeric(12,2);
  v_total             numeric(12,2) := 0;
  v_outstanding_after numeric(12,2);
  v_cn                varchar(30);
  v_cust_name         text;
  v_store_id          uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.post');
  END IF;

  SELECT * INTO v_ret FROM public.returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_ret.status = 'approved' THEN RETURN jsonb_build_object('error', 'ALREADY_APPROVED'); END IF;
  IF v_ret.status NOT IN ('pending', 'inspecting') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  v_store_id := public.sahl_resolve_store(p_store_id);

  SELECT company_name INTO v_cust_name FROM public.customers WHERE id = v_ret.customer_id;

  PERFORM set_config('app.sahl_store_guard', 'sahl', true);
  FOR v_oi IN
    SELECT ri.id, ri.product_id, ri.unit_type, ri.quantity,
           COALESCE(i.condition, 'saleable') AS condition
    FROM public.return_items ri
    LEFT JOIN LATERAL (
      SELECT condition FROM public.return_inspection x
      WHERE x.return_item_id = ri.id ORDER BY x.inspected_at DESC LIMIT 1
    ) i ON true
    WHERE ri.return_id = p_return_id
  LOOP
    SELECT unit_price INTO v_price
    FROM public.order_items
    WHERE order_id = v_ret.order_id AND product_id = v_oi.product_id AND unit_type = v_oi.unit_type
    ORDER BY id LIMIT 1;

    v_line_val := ROUND(COALESCE(v_price, 0) * v_oi.quantity, 2);
    v_total := v_total + v_line_val;

    IF v_oi.condition = 'saleable' THEN
      v_mult := public.piece_multiplier(v_oi.unit_type, v_oi.product_id);
      v_pieces := v_oi.quantity * v_mult;

      INSERT INTO public.inventory (product_id, quantity)
      VALUES (v_oi.product_id, v_pieces)
      ON CONFLICT (product_id) DO UPDATE
        SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = now();

      INSERT INTO public.sahl_store_moves (
        product_id, store_id, delta, reason, reference_type, reference_id, created_by
      ) VALUES (
        v_oi.product_id, v_store_id, v_pieces, 'sales_return',
        'sales_return', v_ret.id, v_session.employee_id
      );
    END IF;
    -- damaged/expired/unsaleable → write-off: no stock reentry
  END LOOP;
  PERFORM set_config('app.sahl_store_guard', '', false);

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('error', 'ZERO_VALUE_RETURN');
  END IF;

  v_cn := public.generate_credit_note_number();

  UPDATE public.returns SET
    status = 'approved',
    credit_note_number = v_cn,
    credit_note_amount = v_total,
    updated_at = now()
  WHERE id = v_ret.id;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_ret.customer_id, v_session.employee_id);

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_ret.customer_id, 'debit', v_total, v_outstanding_after,
    'sales_return', v_ret.id,
    'مرتجع بيع ' || v_ret.code || CASE WHEN v_cust_name IS NOT NULL THEN ' — ' || v_cust_name ELSE '' END,
    v_session.employee_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_ret.id,
    'code', v_ret.code,
    'credit_note_number', v_cn,
    'credit_note_amount', v_total,
    'applied_to_account', v_total,
    'outstanding_after', v_outstanding_after,
    'store_id', v_store_id
  );
END;
$$;

-- 7. sahl_register_cheque — customer side derives; supplier side unchanged ------

CREATE OR REPLACE FUNCTION public.sahl_register_cheque(
  p_token text,
  p_direction text,
  p_party_id uuid,
  p_amount numeric,
  p_bank_name text,
  p_cheque_number text,
  p_due_date date,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_id                uuid;
  v_code              varchar(30);
  v_outstanding       numeric(12,2);
  v_applied           numeric(12,2);
  v_new_out           numeric(12,2);
  v_party_name        text;
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
    -- Customer cheque: registration reduces the derived balance automatically
    -- (the cheque is part of the canonical derivation until bounced/cancelled).
    SELECT company_name INTO v_party_name FROM public.customers WHERE id = p_party_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND'); END IF;
    v_applied := p_amount;
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

  IF p_direction = 'incoming' THEN
    v_new_out := public._sahl_recalc_customer_outstanding(p_party_id, v_session.employee_id);

    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      p_party_id, 'debit', p_amount, COALESCE(v_new_out, 0),
      'cheque', v_id,
      'شيك وارد ' || v_code || ' — رقم ' || btrim(p_cheque_number) || ' (' || btrim(p_bank_name) || ')',
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

-- 8. sahl_cheque_action(text,uuid,text) — legacy signature -----------------------

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
      CASE WHEN v_chq.direction = 'incoming' THEN 'تحصيل شيك وارد رقم ' ELSE 'صرف شيك صادر رقم ' END
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

    -- Close the cheque first: the derivation stops counting it automatically.
    UPDATE public.sahl_cheques SET
      status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
      closed_at = now(), updated_at = now()
    WHERE id = p_cheque_id;

    IF v_chq.direction = 'incoming' THEN
      v_new_out := public._sahl_recalc_customer_outstanding(v_chq.party_id, v_session.employee_id);

      INSERT INTO public.customer_credit_ledger (
        customer_id, transaction_type, amount, running_balance,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_chq.party_id, 'credit', v_chq.amount, COALESCE(v_new_out, 0),
        'cheque', v_chq.id,
        CASE WHEN p_action = 'bounce' THEN 'ارتجاع شيك وارد رقم ' ELSE 'إلغاء شيك وارد رقم ' END
          || v_chq.code || ' — أعيد أثره على حساب العميل',
        v_session.employee_id
      );

      RETURN jsonb_build_object('success', true,
                                'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                'restored_amount', v_chq.amount);
    ELSE
      -- Supplier side keeps its own counter (نظام الموردين).
      IF v_chq.applied_amount > 0 THEN
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
          CASE WHEN p_action = 'bounce' THEN 'ارتجاع شيك صادر رقم ' ELSE 'إلغاء شيك صادر رقم ' END
            || v_chq.code || ' — أعيد أثره على حساب المورد',
          v_session.employee_id
        );
      END IF;

      RETURN jsonb_build_object('success', true,
                                'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                'restored_amount', v_chq.applied_amount);
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;
END;
$$;

-- 8b. sahl_cheque_action(text,uuid,text,uuid) — drawer-aware signature ------------
-- Same contract as section 8 plus: treasury attribution on clear and full
-- reversal of a linked installment plan (parts + totals) before the balance is
-- re-derived once from records.

CREATE OR REPLACE FUNCTION public.sahl_cheque_action(
  p_token text,
  p_cheque_id uuid,
  p_action text,
  p_treasury_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session     app.sessions;
  v_chq         public.sahl_cheques;
  v_new_out     numeric(12,2);
  v_treasury_id uuid;
  v_left        numeric(12,2);
  v_take        numeric(12,2);
  v_plan_code   varchar(40);
  r             record;
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

    v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
    ) VALUES (
      CASE WHEN v_chq.direction = 'incoming' THEN 'inflow' ELSE 'outflow' END,
      v_chq.amount, 'cheque', v_chq.id,
      CASE WHEN v_chq.direction = 'incoming' THEN 'تحصيل شيك وارد رقم ' ELSE 'صرف شيك صادر رقم ' END
        || v_chq.code || ' — رقم ' || v_chq.cheque_number,
      v_session.employee_id,
      v_treasury_id
    )
    ON CONFLICT (reference_type, reference_id) DO NOTHING;

    UPDATE public.sahl_cheques SET status = 'cleared', cleared_at = now(), updated_at = now()
    WHERE id = p_cheque_id;

    -- A cleared installment cheque also finalizes its linked receipt.
    IF v_chq.linked_collection_id IS NOT NULL THEN
      UPDATE public.collections SET
        status = 'treasury_posted',
        approved_by = COALESCE(approved_by, v_session.employee_id),
        approved_at = COALESCE(approved_at, now()),
        updated_at = now()
      WHERE id = v_chq.linked_collection_id AND status = 'pending';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'cleared',
                              'treasury', CASE WHEN v_chq.direction = 'incoming' THEN 'inflow' ELSE 'outflow' END,
                              'treasury_id', v_treasury_id);

  ELSIF p_action IN ('bounce', 'cancel') THEN
    IF v_chq.status NOT IN ('pending', 'deposited') THEN RETURN jsonb_build_object('error', 'ALREADY_CLOSED'); END IF;

    IF v_chq.linked_plan_id IS NOT NULL AND v_chq.direction = 'incoming' THEN
      -- Linked installment cheque: reverse allocation + plan totals first.
      SELECT code INTO v_plan_code FROM public.sahl_installment_plans WHERE id = v_chq.linked_plan_id;

      v_left := v_chq.amount;
      FOR r IN
        SELECT id, amount, paid_amount FROM public.sahl_installment_parts
        WHERE plan_id = v_chq.linked_plan_id AND paid_amount > 0
        ORDER BY part_number DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, r.paid_amount);
        UPDATE public.sahl_installment_parts
        SET paid_amount = paid_amount - v_take,
            settled_at = CASE WHEN paid_amount - v_take < amount THEN NULL ELSE settled_at END
        WHERE id = r.id;
        v_left := v_left - v_take;
      END LOOP;

      UPDATE public.sahl_installment_plans SET
        paid_total = GREATEST(paid_total - v_chq.amount, 0),
        status = CASE WHEN status = 'completed'
                        AND GREATEST(paid_total - v_chq.amount, 0) < total_amount
                      THEN 'active' ELSE status END,
        updated_at = now()
      WHERE id = v_chq.linked_plan_id;

      IF v_chq.linked_collection_id IS NOT NULL THEN
        UPDATE public.collections SET
          notes = COALESCE(notes, '') || CASE WHEN p_action = 'bounce' THEN ' — شيك القسط مرتد' ELSE ' — شيك القسط ملغي' END,
          updated_at = now()
        WHERE id = v_chq.linked_collection_id;
      END IF;

      -- Close the cheque first: the derivation stops counting it automatically.
      UPDATE public.sahl_cheques SET
        status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
        closed_at = now(), updated_at = now()
      WHERE id = p_cheque_id;

      v_new_out := public._sahl_recalc_customer_outstanding(v_chq.party_id, v_session.employee_id);

      INSERT INTO public.customer_credit_ledger (
        customer_id, transaction_type, amount, running_balance,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_chq.party_id, 'credit', v_chq.amount, COALESCE(v_new_out, 0),
        'cheque', v_chq.id,
        CASE WHEN p_action = 'bounce' THEN 'ارتداد شيك قسط ' ELSE 'إلغاء شيك قسط ' END
          || v_chq.code || ' — خطة ' || COALESCE(v_plan_code, '?') || ' — عكس التحصيل واسترداد الرصيد',
        v_session.employee_id
      );

      RETURN jsonb_build_object('success', true,
                                'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                'restored_amount', v_chq.amount,
                                'plan_reversed', true);

    ELSE
      -- Generic path: close the cheque, then derive (customer) / restore counter (supplier).
      UPDATE public.sahl_cheques SET
        status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
        closed_at = now(), updated_at = now()
      WHERE id = p_cheque_id;

      IF v_chq.direction = 'incoming' THEN
        v_new_out := public._sahl_recalc_customer_outstanding(v_chq.party_id, v_session.employee_id);

        INSERT INTO public.customer_credit_ledger (
          customer_id, transaction_type, amount, running_balance,
          reference_type, reference_id, notes, created_by
        ) VALUES (
          v_chq.party_id, 'credit', v_chq.amount, COALESCE(v_new_out, 0),
          'cheque', v_chq.id,
          CASE WHEN p_action = 'bounce' THEN 'ارتجاع شيك وارد رقم ' ELSE 'إلغاء شيك وارد رقم ' END
            || v_chq.code || ' — أعيد أثره على حساب العميل',
          v_session.employee_id
        );

        RETURN jsonb_build_object('success', true,
                                  'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                  'restored_amount', v_chq.amount);
      ELSE
        -- Supplier side keeps its own counter (نظام الموردين).
        IF v_chq.applied_amount > 0 THEN
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
            CASE WHEN p_action = 'bounce' THEN 'ارتجاع شيك صادر رقم ' ELSE 'إلغاء شيك صادر رقم ' END
              || v_chq.code || ' — أعيد أثره على حساب المورد',
            v_session.employee_id
          );
        END IF;

        RETURN jsonb_build_object('success', true,
                                  'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                  'restored_amount', v_chq.applied_amount);
      END IF;
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;
END;
$$;

-- 9. sahl_receive_installment(text,uuid,numeric,text,text,text) ------------------

CREATE OR REPLACE FUNCTION public.sahl_receive_installment(
  p_token text,
  p_plan_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash'::text,
  p_reference_number text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_plan              public.sahl_installment_plans;
  v_col               public.collections%ROWTYPE;
  v_remaining         numeric(12,2);
  v_left              numeric(12,2);
  v_applied_part      numeric(12,2);
  r                   record;
  v_allocations       jsonb := '[]'::jsonb;
  v_outstanding_after numeric(12,2);
  v_col_seq           integer;
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

  -- Canonical receipt document (same family as القبض).
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

  -- Settle the receipt document first, then derive the balance from records.
  UPDATE public.collections SET
    status = 'treasury_posted',
    approved_by = v_session.employee_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = v_col.id;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_plan.customer_id, v_session.employee_id);

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_plan.customer_id, 'debit', v_col.amount, v_outstanding_after,
    'collection', v_col.id,
    'قبض ' || v_col.code || ' — قسط ' || v_plan.code,
    v_session.employee_id
  );

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
    'outstanding_after', v_outstanding_after
  );
END;
$$;

-- 10. sahl_receive_installment(...9 args) — with drawer + linked cheque ----------

CREATE OR REPLACE FUNCTION public.sahl_receive_installment(
  p_token text,
  p_plan_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash'::text,
  p_reference_number text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_treasury_id uuid DEFAULT NULL::uuid,
  p_cheque_bank_name text DEFAULT NULL::text,
  p_cheque_due_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session           app.sessions;
  v_plan              public.sahl_installment_plans;
  v_col               public.collections%ROWTYPE;
  v_remaining         numeric(12,2);
  v_left              numeric(12,2);
  v_applied_part      numeric(12,2);
  r                   record;
  v_allocations       jsonb := '[]'::jsonb;
  v_outstanding_after numeric(12,2);
  v_col_seq           integer;
  v_is_cheque         boolean;
  v_treasury_id       uuid;
  v_chq_id            uuid;
  v_chq_code          varchar(30);
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

  v_is_cheque := (p_method = 'cheque');

  -- A cheque receipt MUST carry full cheque metadata so a linked cheque
  -- document can be registered (real سهل behavior).
  IF v_is_cheque THEN
    IF NULLIF(btrim(COALESCE(p_reference_number, '')), '') IS NULL THEN
      RETURN jsonb_build_object('error', 'CHEQUE_NUMBER_REQUIRED');
    END IF;
    IF NULLIF(btrim(COALESCE(p_cheque_bank_name, '')), '') IS NULL THEN
      RETURN jsonb_build_object('error', 'BANK_REQUIRED');
    END IF;
    IF p_cheque_due_date IS NULL THEN
      RETURN jsonb_build_object('error', 'DUE_DATE_REQUIRED');
    END IF;
  END IF;

  -- Canonical receipt document (same family as القبض).
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
    'تحصيل قسط ' || v_plan.code || CASE WHEN NULLIF(btrim(COALESCE(p_notes, '')), '') IS NOT NULL THEN ' — ' || btrim(p_notes) ELSE '' END,
    now(), v_session.employee_id
  )
  RETURNING * INTO v_col;

  IF NOT v_is_cheque THEN
    -- Treasury movement only when cash is actually received NOW.
    v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
    ) VALUES (
      'inflow', v_col.amount, 'collection', v_col.id,
      'سند قبض ' || v_col.code || ' — تحصيل قسط ' || v_plan.code,
      v_session.employee_id,
      v_treasury_id
    )
    ON CONFLICT (reference_type, reference_id) DO NOTHING;

    UPDATE public.collections SET
      status = 'treasury_posted',
      approved_by = v_session.employee_id,
      approved_at = now(),
      updated_at = now()
    WHERE id = v_col.id;
  ELSE
    -- Linked incoming cheque (appears in الشيكات; clearing posts the treasury).
    INSERT INTO public.sahl_cheques (
      code, direction, party_type, party_id, amount, applied_amount,
      bank_name, cheque_number, due_date, notes, created_by,
      linked_collection_id, linked_plan_id
    ) VALUES (
      public.generate_cheque_number(), 'incoming', 'customer', v_plan.customer_id,
      p_amount, p_amount,
      btrim(p_cheque_bank_name), btrim(p_reference_number), p_cheque_due_date,
      'شيك تحصيل قسط ' || v_plan.code || ' (' || v_col.code || ')',
      v_session.employee_id,
      v_col.id, v_plan.id
    )
    RETURNING id, code INTO v_chq_id, v_chq_code;
  END IF;

  v_outstanding_after := public._sahl_recalc_customer_outstanding(v_plan.customer_id, v_session.employee_id);

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_plan.customer_id, 'debit', v_col.amount, v_outstanding_after,
    'collection', v_col.id,
    'قبض ' || v_col.code || ' — قسط ' || v_plan.code,
    v_session.employee_id
  );

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
    'outstanding_after', v_outstanding_after
  ) || CASE WHEN v_is_cheque
        THEN jsonb_build_object('cheque_code', v_chq_code,
                                'note', 'لم تُقيَّد بالخزينة — بانتظار تحصيل الشيك')
        ELSE '{}'::jsonb END;
END;
$$;

-- 11. _sahl_post_invoice_core — credit portion via derivation ---------------------

CREATE OR REPLACE FUNCTION public._sahl_post_invoice_core(
  p_invoice_id uuid,
  p_store_id uuid,
  p_cash_treasury_id uuid,
  p_card_treasury_id uuid,
  p_items jsonb,
  p_customer_id uuid,
  p_employee_id uuid,
  p_doc_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  r               record;
  v_avail         integer;
  v_needed        numeric(14,3);
  v_carton_qty    integer;
  v_ppu           integer;
  v_cash          numeric(12,2);
  v_card          numeric(12,2);
  v_credit        numeric(12,2);
  v_grand         numeric(12,2);
  v_new_out       numeric(12,2);
BEGIN
  PERFORM set_config('app.sahl_store_guard', 'sahl', true);

  -- ---- validate & price lines ----------------------------------------------
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(p_items)
             AS x(product_id uuid, unit_type text, qty numeric, unit_price numeric)
  LOOP
    IF r.product_id IS NULL OR r.qty IS NULL OR r.qty <= 0 THEN RAISE EXCEPTION 'BAD_ITEM'; END IF;
    IF r.unit_type IS NOT NULL AND r.unit_type NOT IN ('piece','dozen','carton') THEN RAISE EXCEPTION 'BAD_UNIT'; END IF;
    IF COALESCE(r.unit_price, 0) < 0 THEN RAISE EXCEPTION 'BAD_PRICE'; END IF;

    SELECT carton_quantity INTO v_carton_qty FROM public.products WHERE id = r.product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

    v_ppu := CASE COALESCE(r.unit_type, 'piece')
               WHEN 'dozen' THEN 12
               WHEN 'carton' THEN v_carton_qty
               ELSE 1 END;

    INSERT INTO public.sahl_invoice_items (
      invoice_id, product_id, unit_type, unit_label, pieces_per_unit,
      qty, qty_pieces, unit_price, line_total
    ) VALUES (
      p_invoice_id, r.product_id, COALESCE(r.unit_type,'piece'),
      CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 'دستة' WHEN 'carton' THEN 'كرتونة' ELSE 'قطعة' END,
      v_ppu, r.qty, r.qty * v_ppu, COALESCE(r.unit_price,0), ROUND(r.qty * COALESCE(r.unit_price,0), 2)
    );
  END LOOP;

  -- ---- money -----------------------------------------------------------------
  SELECT grand_total, paid_cash, paid_card INTO v_grand, v_cash, v_card
  FROM public.sahl_invoices WHERE id = p_invoice_id;

  -- ---- stock: lock, verify per-store availability, deduct + journal ----------
  FOR r IN
    SELECT it.product_id, SUM(it.qty_pieces) AS needed
    FROM public.sahl_invoice_items it
    WHERE it.invoice_id = p_invoice_id
    GROUP BY it.product_id
    ORDER BY it.product_id
  LOOP
    SELECT quantity INTO v_avail FROM public.inventory WHERE product_id = r.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    v_needed := FLOOR(r.needed);
    IF v_avail < v_needed THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK:%:%', r.product_id, v_avail;
    END IF;

    UPDATE public.inventory
    SET quantity = quantity - v_needed::int, updated_at = now()
    WHERE product_id = r.product_id;

    INSERT INTO public.sahl_store_moves (product_id, store_id, delta, reason, reference_type, reference_id, created_by)
    VALUES (r.product_id, p_store_id, -v_needed::int, 'sale', 'sahl_invoice', p_invoice_id, p_employee_id);
  END LOOP;

  -- ---- money -----------------------------------------------------------------
  v_credit := ROUND(v_grand - v_cash - v_card, 2);

  IF v_cash > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, treasury_id, notes, created_by
    ) VALUES ('inflow', v_cash, 'sale', p_invoice_id, p_cash_treasury_id,
              'مبيعات ' || p_doc_code || ' — نقدية', p_employee_id);
  END IF;

  IF v_card > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, treasury_id, notes, created_by
    ) VALUES ('inflow', v_card, 'sale_card', p_invoice_id, p_card_treasury_id,
              'مبيعات ' || p_doc_code || ' — بطاقة', p_employee_id);
  END IF;

  -- Record the credit portion on the invoice first so the derivation sees it.
  UPDATE public.sahl_invoices SET paid_credit = v_credit, updated_at = now()
  WHERE id = p_invoice_id;

  IF v_credit > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_CREDIT'; END IF;

    -- Open store credit (سهل آجل): account may outlive any formal program.
    INSERT INTO public.customer_credit_accounts (
      customer_id, outstanding_credit, credit_limit, payment_term_days, activated_by
    )
    VALUES (p_customer_id, 0, 0, 0, p_employee_id)
    ON CONFLICT (customer_id) DO NOTHING;

    v_new_out := public._sahl_recalc_customer_outstanding(p_customer_id, p_employee_id);

    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      p_customer_id, 'debit', v_credit, v_new_out,
      'sahl_invoice', p_invoice_id,
      'فاتورة بيع آجل ' || p_doc_code, p_employee_id
    );
  END IF;
END;
$$;

-- 12. sahl_void_invoice — reversal via derivation --------------------------------

CREATE OR REPLACE FUNCTION public.sahl_void_invoice(
  p_token text,
  p_invoice_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_inv     public.sahl_invoices;
  r         record;
  v_new_out numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.manage');
  END IF;

  SELECT * INTO v_inv FROM public.sahl_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_inv.kind != 'sale' THEN RETURN jsonb_build_object('error', 'NOT_A_SALE'); END IF;
  IF v_inv.status = 'voided' THEN RETURN jsonb_build_object('error', 'ALREADY_VOIDED'); END IF;

  PERFORM set_config('app.sahl_store_guard', 'sahl', true);

  -- Void the invoice first: the derivation stops counting its credit portion.
  UPDATE public.sahl_invoices SET
    status = 'voided', voided_by = v_session.employee_id, voided_at = now(),
    void_reason = NULLIF(btrim(COALESCE(p_reason,'')), ''), updated_at = now()
  WHERE id = p_invoice_id;

  -- stock back
  FOR r IN
    SELECT product_id, SUM(qty_pieces)::numeric(14,3) AS pieces
    FROM public.sahl_invoice_items WHERE invoice_id = p_invoice_id
    GROUP BY product_id ORDER BY product_id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity + FLOOR(r.pieces)::int, updated_at = now()
    WHERE product_id = r.product_id;

    INSERT INTO public.sahl_store_moves (product_id, store_id, delta, reason, reference_type, reference_id, created_by)
    VALUES (r.product_id, v_inv.store_id, FLOOR(r.pieces)::int, 'sale_void', 'sahl_invoice', p_invoice_id, v_session.employee_id);
  END LOOP;

  -- treasury reversal
  IF v_inv.paid_cash > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, treasury_id, notes, created_by
    ) VALUES ('outflow', v_inv.paid_cash, 'sale_void', p_invoice_id, v_inv.cash_treasury_id,
              'إلغاء مبيعات ' || v_inv.code || ' — نقدية', v_session.employee_id);
  END IF;
  IF v_inv.paid_card > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, treasury_id, notes, created_by
    ) VALUES ('outflow', v_inv.paid_card, 'sale_void_card', p_invoice_id, v_inv.card_treasury_id,
              'إلغاء مبيعات ' || v_inv.code || ' — بطاقة', v_session.employee_id);
  END IF;

  -- customer balance restoration (derived)
  IF v_inv.paid_credit > 0 AND v_inv.customer_id IS NOT NULL THEN
    v_new_out := public._sahl_recalc_customer_outstanding(v_inv.customer_id, v_session.employee_id);

    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      v_inv.customer_id, 'credit', v_inv.paid_credit, v_new_out,
      'sahl_invoice', p_invoice_id,
      'إلغاء فاتورة بيع ' || v_inv.code, v_session.employee_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'code', v_inv.code, 'status', 'voided');
END;
$$;

-- 13. get_governed_customers — same canonical balance in the display path --------
-- Regenerated from the live definition with two changes per branch:
--   a) current_balance now calls sahl_customer_current_balance(c.id)
--   b) the obsolete collections lateral (NULL/'approved' only) is removed

CREATE OR REPLACE FUNCTION public.get_governed_customers(
  p_token text,
  p_search text DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_no_orders boolean DEFAULT false,
  p_no_visits boolean DEFAULT false,
  p_no_location boolean DEFAULT false,
  p_governorate_id uuid DEFAULT NULL,
  p_needs_address_correction boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_emp_id uuid;
  v_is_customer boolean;
  v_filter_no_orders boolean;
  v_filter_no_visits boolean;
  v_filter_no_location boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM set_config('app.identity_id', v_session.identity_id::text, true);

  v_emp_id := app.current_employee_id();
  v_is_customer := (v_session.identity_type = 'customer');
  v_filter_no_orders := COALESCE(p_no_orders, false);
  v_filter_no_visits := COALESCE(p_no_visits, false);
  v_filter_no_location := COALESCE(p_no_location, false);

  -- Customer sessions: show only their own customer record
  IF v_is_customer THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_address', addr.registered_address,
      'location_address', loc.formatted_address,
      'needs_address_correction', COALESCE(c.needs_address_correction, false),
      'manual_governorate_id', addr.manual_governorate_id,
      'registered_at', c.registered_at, 'created_at', c.created_at,
      'previous_order_count', ps.order_count,
      'previous_orders_total', ps.orders_total,
      'last_order_number', ps.last_order_number,
      'last_order_date', ps.last_order_date,
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', public.sahl_customer_current_balance(c.id)
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    LEFT JOIN LATERAL (
      SELECT
        trim(both '- ' from concat_ws(' - ',
          NULLIF(TRIM(ca3.governorate), ''),
          NULLIF(TRIM(ca3.city), ''),
          NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
        )) AS registered_address,
        ca3.governorate_id AS manual_governorate_id
      FROM customer_addresses ca3
      WHERE ca3.customer_id = c.id AND ca3.is_default = true
      LIMIT 1
    ) addr ON true
    LEFT JOIN LATERAL (
      SELECT formatted_address
      FROM public.unified_locations ul
      WHERE ul.id = c.location_id
      LIMIT 1
    ) loc ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
      FROM public.orders o2
      WHERE o2.customer_id = c.id
        AND public.is_order_in_statistics(o2.status)
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    WHERE c.identity_id = v_session.identity_id
      AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees with customers.read capability: all customers
  IF app.has_capability('customers.read') THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'company_name', c.company_name,
      'responsible_name', c.responsible_name, 'business_type', c.business_type,
      'email', c.email, 'phone', i.phone,
      'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
      'owner_id', c.owner_id, 'owner_name', e.full_name,
      'is_active', c.is_active, 'location_id', c.location_id,
      'registered_address', addr.registered_address,
      'location_address', loc.formatted_address,
      'needs_address_correction', COALESCE(c.needs_address_correction, false),
      'manual_governorate_id', addr.manual_governorate_id,
      'registered_at', c.registered_at, 'created_at', c.created_at,
      'previous_order_count', ps.order_count,
      'previous_orders_total', ps.orders_total,
      'last_order_number', ps.last_order_number,
      'last_order_date', ps.last_order_date,
      'last_order_total', ps.last_order_total,
      'delivered_total', ps.delivered_total,
      'last_visit_date', vs.last_visit_date,
      'visit_count', vs.visit_count,
      'current_balance', public.sahl_customer_current_balance(c.id)
    )) INTO v_result
    FROM customers c
    JOIN identities i ON i.id = c.identity_id
    LEFT JOIN employees e ON e.id = c.owner_id
    LEFT JOIN LATERAL (
      SELECT
        trim(both '- ' from concat_ws(' - ',
          NULLIF(TRIM(ca3.governorate), ''),
          NULLIF(TRIM(ca3.city), ''),
          NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
        )) AS registered_address,
        ca3.governorate_id AS manual_governorate_id
      FROM customer_addresses ca3
      WHERE ca3.customer_id = c.id AND ca3.is_default = true
      LIMIT 1
    ) addr ON true
    LEFT JOIN LATERAL (
      SELECT formatted_address
      FROM public.unified_locations ul
      WHERE ul.id = c.location_id
      LIMIT 1
    ) loc ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS order_count,
        COALESCE(sum(total_amount), 0) AS orders_total,
        (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
        max(created_at) AS last_order_date,
        (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
        COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
      FROM public.orders o2
      WHERE o2.customer_id = c.id
        AND public.is_order_in_statistics(o2.status)
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(v.check_in_at) AS last_visit_date,
        COUNT(*)::bigint AS visit_count
      FROM public.visits v
      WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
    ) vs ON true
    WHERE (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
      AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
      AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
      AND (NOT v_filter_no_location OR c.location_id IS NULL)
      AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
      AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Employees without customers.read: own + reports' customers
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'company_name', c.company_name,
    'responsible_name', c.responsible_name, 'business_type', c.business_type,
    'email', c.email, 'phone', i.phone,
    'credit_limit', c.credit_limit, 'credit_days', c.credit_days,
    'owner_id', c.owner_id, 'owner_name', e.full_name,
    'is_active', c.is_active, 'location_id', c.location_id,
    'registered_address', addr.registered_address,
    'location_address', loc.formatted_address,
    'needs_address_correction', COALESCE(c.needs_address_correction, false),
    'manual_governorate_id', addr.manual_governorate_id,
    'registered_at', c.registered_at, 'created_at', c.created_at,
    'previous_order_count', ps.order_count,
    'previous_orders_total', ps.orders_total,
    'last_order_number', ps.last_order_number,
    'last_order_date', ps.last_order_date,
    'last_order_total', ps.last_order_total,
    'delivered_total', ps.delivered_total,
    'last_visit_date', vs.last_visit_date,
    'visit_count', vs.visit_count,
    'current_balance', public.sahl_customer_current_balance(c.id)
  )) INTO v_result
  FROM customers c
  JOIN identities i ON i.id = c.identity_id
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN LATERAL (
    SELECT
      trim(both '- ' from concat_ws(' - ',
        NULLIF(TRIM(ca3.governorate), ''),
        NULLIF(TRIM(ca3.city), ''),
        NULLIF(TRIM(COALESCE(ca3.street_address, ca3.address_line1, '')), '')
      )) AS registered_address,
      ca3.governorate_id AS manual_governorate_id
    FROM customer_addresses ca3
    WHERE ca3.customer_id = c.id AND ca3.is_default = true
    LIMIT 1
  ) addr ON true
  LEFT JOIN LATERAL (
    SELECT formatted_address
    FROM public.unified_locations ul
    WHERE ul.id = c.location_id
    LIMIT 1
  ) loc ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*)::bigint AS order_count,
      COALESCE(sum(total_amount), 0) AS orders_total,
      (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
      max(created_at) AS last_order_date,
      (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total,
      COALESCE(sum(total_amount) FILTER (WHERE o2.status = 'delivered'), 0) AS delivered_total
    FROM public.orders o2
    WHERE o2.customer_id = c.id
      AND public.is_order_in_statistics(o2.status)
  ) ps ON true
  LEFT JOIN LATERAL (
    SELECT
      MAX(v.check_in_at) AS last_visit_date,
      COUNT(*)::bigint AS visit_count
    FROM public.visits v
    WHERE v.customer_id = c.id AND v.check_in_at IS NOT NULL
  ) vs ON true
  WHERE c.owner_id = ANY(app.get_subtree_ids(v_emp_id))
    AND (p_search IS NULL OR c.company_name ILIKE '%' || p_search || '%' OR c.code ILIKE '%' || p_search || '%' OR i.phone ILIKE '%' || p_search || '%' OR EXISTS (SELECT 1 FROM customer_addresses ca2 WHERE ca2.customer_id = c.id AND (ca2.address_line1 ILIKE '%' || p_search || '%' OR ca2.address_line2 ILIKE '%' || p_search || '%' OR ca2.city ILIKE '%' || p_search || '%' OR ca2.governorate ILIKE '%' || p_search || '%')))
    AND (p_employee_id IS NULL OR c.owner_id = p_employee_id)
    AND (p_date_from IS NULL OR c.created_at >= p_date_from)
    AND (p_date_to IS NULL OR c.created_at <= p_date_to)
    AND (NOT v_filter_no_orders OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id AND public.is_order_in_statistics(o.status)))
    AND (NOT v_filter_no_visits OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.customer_id = c.id))
    AND (NOT v_filter_no_location OR c.location_id IS NULL)
    AND (p_governorate_id IS NULL OR addr.manual_governorate_id = p_governorate_id)
    AND (p_needs_address_correction IS NULL OR c.needs_address_correction = p_needs_address_correction);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- 14. Traceability RPC — كشف حساب العميل بمصادر تكوين الرصيد ----------------------

CREATE OR REPLACE FUNCTION public.sahl_get_customer_account_statement(
  p_token text,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_moves   jsonb := '[]'::jsonb;
  v_run     numeric(12,2) := 0;
  r         record;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT (
    public.check_capability(p_token, 'sahl.receipts.read')
    OR public.check_capability(p_token, 'sahl.sales.read')
    OR public.check_capability(p_token, 'customers.read')
  ) THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY');
  END IF;

  -- Unified chronological movements built ONLY from real records — the same
  -- record families that compose sahl_customer_current_balance().
  FOR r IN
    SELECT * FROM (
      SELECT 'order'::text AS doc_type, o.id::uuid AS id,
             o.order_number AS code, 'طلب بيع معتمد'::text AS label,
             o.total_amount AS amount, 1 AS direction, o.status::text AS status,
             o.created_at
      FROM public.orders o
      WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
      UNION ALL
      SELECT 'invoice', v.id, v.code, 'فاتورة بيع آجل (سهل)',
             v.paid_credit, 1, v.status, v.created_at
      FROM public.sahl_invoices v
      WHERE v.customer_id = p_customer_id AND v.kind = 'sale' AND v.status = 'posted' AND v.paid_credit > 0
      UNION ALL
      SELECT 'return', rt.id, rt.code, 'مرتجع بيع',
             rt.credit_note_amount, -1, rt.status, rt.created_at
      FROM public.returns rt
      WHERE rt.customer_id = p_customer_id AND rt.status = 'approved'
      UNION ALL
      SELECT 'collection', cl.id, cl.code,
             'سند قبض — ' || CASE cl.method WHEN 'cash' THEN 'نقداً' WHEN 'bank_transfer' THEN 'تحويل بنكي' WHEN 'cheque' THEN 'شيك' WHEN 'deposit' THEN 'إيداع' ELSE cl.method END,
             cl.amount, -1, cl.status, cl.created_at
      FROM public.collections cl
      WHERE cl.customer_id = p_customer_id
        AND (cl.status IS NULL OR cl.status IN ('approved','treasury_posted'))
      UNION ALL
      SELECT 'cheque', ch.id, ch.code, 'شيك وارد (' || ch.bank_name || ')',
             ch.amount, -1, ch.status, ch.created_at
      FROM public.sahl_cheques ch
      WHERE ch.party_type = 'customer' AND ch.party_id = p_customer_id
        AND ch.direction = 'incoming'
        AND ch.status IN ('pending','deposited','cleared')
        AND NOT EXISTS (
          SELECT 1 FROM public.collections cl2
          WHERE cl2.id = ch.linked_collection_id
            AND (cl2.status IS NULL OR cl2.status IN ('approved','treasury_posted'))
        )
    ) m
    ORDER BY m.created_at ASC, m.doc_type ASC
  LOOP
    v_run := ROUND(v_run + (r.direction * r.amount), 2);
    v_moves := v_moves || to_jsonb(jsonb_build_object(
      'doc_type', r.doc_type,
      'id', r.id,
      'code', r.code,
      'label', r.label,
      'amount', r.amount,
      'direction', r.direction,
      'status', r.status,
      'created_at', r.created_at,
      'running_balance', v_run
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id, 'code', c.code, 'company_name', c.company_name,
        'phone', i.phone
      )
      FROM public.customers c JOIN public.identities i ON i.id = c.identity_id
      WHERE c.id = p_customer_id
    ),
    'components', jsonb_build_object(
      'sales_orders', COALESCE((SELECT SUM(o.total_amount) FROM public.orders o
         WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)), 0),
      'sales_invoices_credit', COALESCE((SELECT SUM(v.paid_credit) FROM public.sahl_invoices v
         WHERE v.customer_id = p_customer_id AND v.kind = 'sale' AND v.status = 'posted'), 0),
      'sales_returns', COALESCE((SELECT SUM(rt.credit_note_amount) FROM public.returns rt
         WHERE rt.customer_id = p_customer_id AND rt.status = 'approved'), 0),
      'receipts', COALESCE((SELECT SUM(cl.amount) FROM public.collections cl
         WHERE cl.customer_id = p_customer_id
           AND (cl.status IS NULL OR cl.status IN ('approved','treasury_posted'))), 0),
      'incoming_cheques', COALESCE((SELECT SUM(ch.amount) FROM public.sahl_cheques ch
         WHERE ch.party_type = 'customer' AND ch.party_id = p_customer_id
           AND ch.direction = 'incoming'
           AND ch.status IN ('pending','deposited','cleared')
           AND NOT EXISTS (
             SELECT 1 FROM public.collections cl2
             WHERE cl2.id = ch.linked_collection_id
               AND (cl2.status IS NULL OR cl2.status IN ('approved','treasury_posted'))
           )), 0),
      'current_balance', public.sahl_customer_current_balance(p_customer_id),
      'stored_outstanding', COALESCE((SELECT outstanding_credit FROM public.customer_credit_accounts
         WHERE customer_id = p_customer_id LIMIT 1), 0)
    ),
    'movements', v_moves
  );
END;
$$;

COMMENT ON FUNCTION public.sahl_get_customer_account_statement(text, uuid) IS
'سهل: كشف حساب العميل التتبعي — مصادر تكوين الرصيد والحركات الزمنية بالرصيد الجاري، كل حركة قابلة للتتبع لمستندها الأصلي.';

-- 15. Grants ----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_customer_current_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_customer_account_statement(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_receipt(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_receipt(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_approve_sales_return(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_approve_sales_return(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_register_cheque(text, text, uuid, numeric, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cheque_action(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cheque_action(text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_receive_installment(text, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_receive_installment(text, uuid, numeric, text, text, text, uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_void_invoice(text, uuid, text) TO authenticated;

-- 16. One-time internal sync: project every customer's real balance into the
--     internal account table (no business documents are touched). ---------------

DO $sync$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT customer_id FROM (
      SELECT o.customer_id AS customer_id FROM public.orders o
       WHERE o.customer_id IS NOT NULL AND public.is_order_in_statistics(o.status)
      UNION
      SELECT v.customer_id FROM public.sahl_invoices v
       WHERE v.kind = 'sale' AND v.status = 'posted' AND v.paid_credit > 0 AND v.customer_id IS NOT NULL
      UNION
      SELECT rt.customer_id FROM public.returns rt WHERE rt.status = 'approved'
      UNION
      SELECT cl.customer_id FROM public.collections cl
       WHERE cl.status IS NULL OR cl.status IN ('approved','treasury_posted')
      UNION
      SELECT ch.party_id FROM public.sahl_cheques ch
       WHERE ch.party_type = 'customer' AND ch.direction = 'incoming'
         AND ch.status IN ('pending','deposited','cleared')
      UNION
      -- stale stored counters with no documents left behind: re-derive them too
      SELECT a.customer_id FROM public.customer_credit_accounts a
       WHERE COALESCE(a.outstanding_credit, 0) <> 0
    ) s
  LOOP
    PERFORM public._sahl_recalc_customer_outstanding(r.customer_id);
  END LOOP;
END;
$sync$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL Customer Account Unification
-- ============================================================================
