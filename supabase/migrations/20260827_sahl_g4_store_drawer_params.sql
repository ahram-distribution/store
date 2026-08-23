-- =====================================================================
-- SAHL G4 — Wire purchases/returns/receipts/expenses to store + drawer
-- =====================================================================
-- Adds OPTIONAL parameters (with defaults) to the posting RPCs so every
-- money movement can target a specific drawer/bank and every stock
-- movement is journalled against a specific store:
--   sahl_post_receipt        (+ p_treasury_id)
--   sahl_post_expense        (+ p_treasury_id)
--   sahl_post_purchase       (+ p_store_id, p_treasury_id)
--   sahl_approve_sales_return(+ p_store_id)
--   sahl_post_purchase_return(+ p_store_id, p_treasury_id)
-- NULL parameters resolve through sahl_settings defaults (MAIN fallback).
-- Old call sites remain valid thanks to parameter defaults.
-- =====================================================================

-- 1. Resolution helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_resolve_store(p_store_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_id uuid;
BEGIN
  IF p_store_id IS NOT NULL THEN RETURN p_store_id; END IF;
  SELECT value #>> '{}' INTO v_code FROM public.sahl_settings WHERE key = 'default_store_code';
  SELECT id INTO v_id FROM public.sahl_stores
    WHERE code = COALESCE(NULLIF(trim(v_code), ''), 'MAIN') AND is_active LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.sahl_stores WHERE code = 'MAIN' LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_resolve_treasury(p_treasury_id uuid DEFAULT NULL, p_kind text DEFAULT 'cash')
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_id uuid;
BEGIN
  IF p_treasury_id IS NOT NULL THEN RETURN p_treasury_id; END IF;
  SELECT value #>> '{}' INTO v_code FROM public.sahl_settings WHERE key = 'default_drawer_code';
  SELECT id INTO v_id FROM public.sahl_treasuries
    WHERE code = COALESCE(NULLIF(trim(v_code), ''), 'MAIN') AND is_active LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.sahl_treasuries WHERE code = 'MAIN' LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- 2. sahl_post_receipt (+ drawer) ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_post_receipt(
  p_token text,
  p_collection_id uuid,
  p_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session     app.sessions;
  v_col         public.collections;
  v_outstanding numeric(12,2);
  v_applied     numeric(12,2);
  v_new_outstanding numeric(12,2);
  v_treasury_id uuid;
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

  -- Customer outstanding settlement (canonical: customer_credit_accounts).
  SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
  FROM public.customer_credit_accounts
  WHERE customer_id = v_col.customer_id
  FOR UPDATE;

  IF FOUND THEN
    v_applied := LEAST(v_col.amount, GREATEST(v_outstanding, 0));
    v_new_outstanding := v_outstanding - v_applied;

    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_outstanding, updated_at = now()
    WHERE customer_id = v_col.customer_id;
  ELSE
    v_applied := 0;
    v_new_outstanding := NULL;
  END IF;

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_col.customer_id,
    'debit',
    v_col.amount,
    COALESCE(v_new_outstanding, 0),
    'collection',
    v_col.id,
    'قبض ' || v_col.code || ' — ' || v_col.method
      || CASE WHEN v_applied < v_col.amount THEN ' — المبلغ يتجاوز الرصيد المطبق على الحساب الائتماني' ELSE '' END,
    v_session.employee_id
  );

  UPDATE public.collections SET status = 'treasury_posted' WHERE id = v_col.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_col.id,
    'code', v_col.code,
    'amount', v_col.amount,
    'applied_to_account', COALESCE(v_applied, 0),
    'status', 'treasury_posted',
    'treasury_id', v_treasury_id
  );
END;
$$;

-- 3. sahl_post_expense (+ drawer) ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_post_expense(
  p_token text,
  p_expense_id uuid,
  p_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_exp     public.expenses;
  v_treasury_id uuid;
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

  v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
  ) VALUES (
    'outflow', v_exp.amount, 'expense', v_exp.id,
    'سند صرف ' || v_exp.code || ' — ' || v_exp.expense_type
      || CASE WHEN v_exp.description IS NOT NULL THEN ' — ' || v_exp.description ELSE '' END,
    v_session.employee_id,
    v_treasury_id
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
    'status', 'treasury_posted',
    'treasury_id', v_treasury_id
  );
END;
$$;

-- 4. sahl_post_purchase (+ store, drawer) ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_post_purchase(
  p_token text,
  p_purchase_id uuid,
  p_store_id uuid DEFAULT NULL,
  p_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_pur public.purchases;
  v_sup_name varchar;
  v_li record;
  v_cur_qty integer;
  v_old_avg numeric;
  v_new_avg numeric(12,4);
  v_outstanding numeric(12,2);
  v_to_account numeric(12,2);
  v_store_id uuid;
  v_treasury_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.purchases.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.purchases.post');
  END IF;

  SELECT * INTO v_pur FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_pur.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;

  v_store_id    := public.sahl_resolve_store(p_store_id);
  v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

  SELECT supplier_name INTO v_sup_name FROM public.suppliers WHERE id = v_pur.supplier_id;

  -- Inventory IN + weighted-average cost effect per line (+ store journal)
  PERFORM set_config('app.sahl_store_guard', 'sahl', true);
  FOR v_li IN
    SELECT pi.product_id, pi.piece_quantity, pi.cost_per_piece, p.avg_cost
    FROM public.purchase_items pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.purchase_id = v_pur.id
  LOOP
    SELECT quantity INTO v_cur_qty FROM public.inventory WHERE product_id = v_li.product_id FOR UPDATE;
    v_cur_qty := COALESCE(v_cur_qty, 0);
    v_old_avg := v_li.avg_cost;

    IF v_cur_qty > 0 AND v_old_avg IS NOT NULL THEN
      v_new_avg := ROUND(((v_old_avg * v_cur_qty) + (v_li.cost_per_piece * v_li.piece_quantity))
                   / (v_cur_qty + v_li.piece_quantity), 4);
    ELSE
      v_new_avg := v_li.cost_per_piece;
    END IF;

    UPDATE public.products
    SET avg_cost = v_new_avg, last_cost = v_li.cost_per_piece, last_purchased_at = now()
    WHERE id = v_li.product_id;

    INSERT INTO public.inventory (product_id, quantity)
    VALUES (v_li.product_id, v_li.piece_quantity)
    ON CONFLICT (product_id) DO UPDATE
      SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = now();

    INSERT INTO public.sahl_store_moves (
      product_id, store_id, delta, reason, reference_type, reference_id, created_by
    ) VALUES (
      v_li.product_id, v_store_id, v_li.piece_quantity, 'purchase',
      'purchase', v_pur.id, v_session.employee_id
    );
  END LOOP;
  PERFORM set_config('app.sahl_store_guard', '', false);

  -- Supplier account charge for the un-paid portion
  v_to_account := v_pur.total_amount - v_pur.paid_amount;
  INSERT INTO public.supplier_credit_accounts (supplier_id, outstanding_credit)
  VALUES (v_pur.supplier_id, 0)
  ON CONFLICT (supplier_id) DO NOTHING;

  SELECT outstanding_credit INTO v_outstanding
  FROM public.supplier_credit_accounts WHERE supplier_id = v_pur.supplier_id FOR UPDATE;

  IF v_to_account > 0 THEN
    v_outstanding := v_outstanding + v_to_account;
    UPDATE public.supplier_credit_accounts SET outstanding_credit = v_outstanding, updated_at = now()
    WHERE supplier_id = v_pur.supplier_id;

    INSERT INTO public.supplier_credit_ledger (
      supplier_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by
    ) VALUES (
      v_pur.supplier_id, 'credit', v_to_account, v_outstanding, 'purchase', v_pur.id,
      'فاتورة شراء ' || v_pur.code || CASE WHEN v_pur.reference_number IS NOT NULL THEN ' — مرجع: ' || v_pur.reference_number ELSE '' END,
      v_session.employee_id
    );
  END IF;

  -- Immediate settlement portion → money OUT of the chosen drawer.
  IF v_pur.paid_amount > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
    ) VALUES (
      'outflow', v_pur.paid_amount, 'purchase', v_pur.id,
      'فاتورة شراء ' || v_pur.code || ' — ' || v_sup_name,
      v_session.employee_id,
      v_treasury_id
    )
    ON CONFLICT (reference_type, reference_id) DO NOTHING;
  END IF;

  UPDATE public.purchases SET
    status = 'treasury_posted',
    approved_by = COALESCE(approved_by, v_session.employee_id),
    approved_at = COALESCE(approved_at, now()),
    posted_at = now(),
    updated_at = now()
  WHERE id = v_pur.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_pur.id,
    'code', v_pur.code,
    'total', v_pur.total_amount,
    'paid_from_treasury', v_pur.paid_amount,
    'added_to_supplier_account', v_to_account,
    'store_id', v_store_id,
    'treasury_id', v_treasury_id
  );
END;
$$;

-- 5. sahl_approve_sales_return (+ store reentry) ----------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_approve_sales_return(
  p_token text,
  p_return_id uuid,
  p_store_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session   app.sessions;
  v_ret       public.returns;
  v_oi        record;
  v_price     numeric(12,2);
  v_mult      integer;
  v_pieces    integer;
  v_condition text;
  v_line_val  numeric(12,2);
  v_total     numeric(12,2) := 0;
  v_outstanding numeric(12,2);
  v_applied   numeric(12,2);
  v_new_out   numeric(12,2);
  v_cn        varchar(30);
  v_cust_name text;
  v_store_id  uuid;
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

  -- Value computation from order-time prices + inventory reentry of saleable pieces
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

  -- Customer outstanding reduction (canonical LEAST rule, mirrors receipts)
  SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
  FROM public.customer_credit_accounts
  WHERE customer_id = v_ret.customer_id
  FOR UPDATE;

  IF FOUND THEN
    v_applied := LEAST(v_total, GREATEST(v_outstanding, 0));
    v_new_out := v_outstanding - v_applied;
    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_out, updated_at = now()
    WHERE customer_id = v_ret.customer_id;
  ELSE
    v_applied := 0;
    v_new_out := NULL;
  END IF;

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_ret.customer_id, 'debit', v_total, COALESCE(v_new_out, 0),
    'sales_return', v_ret.id,
    'مرتجع بيع ' || v_ret.code || CASE WHEN v_cust_name IS NOT NULL THEN ' — ' || v_cust_name ELSE '' END
      || CASE WHEN COALESCE(v_applied, 0) < v_total THEN ' — القيمة تتجاوز الرصيد المطبق على الحساب الائتماني' ELSE '' END,
    v_session.employee_id
  );

  v_cn := public.generate_credit_note_number();

  UPDATE public.returns SET
    status = 'approved',
    credit_note_number = v_cn,
    credit_note_amount = v_total,
    updated_at = now()
  WHERE id = v_ret.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_ret.id,
    'code', v_ret.code,
    'credit_note_number', v_cn,
    'credit_note_amount', v_total,
    'applied_to_account', COALESCE(v_applied, 0),
    'outstanding_after', COALESCE(v_new_out, 0),
    'store_id', v_store_id
  );
END;
$$;

-- 6. sahl_post_purchase_return (+ store, drawer) ------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_post_purchase_return(
  p_token text,
  p_purchase_return_id uuid,
  p_store_id uuid DEFAULT NULL,
  p_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session  app.sessions;
  v_prt      public.purchase_returns;
  v_li       record;
  v_cur_qty  integer;
  v_sup_name text;
  v_outstanding numeric(12,2);
  v_applied  numeric(12,2);
  v_new_out  numeric(12,2);
  v_store_id uuid;
  v_treasury_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.post');
  END IF;

  SELECT * INTO v_prt FROM public.purchase_returns WHERE id = p_purchase_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_prt.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;
  IF v_prt.status != 'pending' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  v_store_id    := public.sahl_resolve_store(p_store_id);
  v_treasury_id := public.sahl_resolve_treasury(p_treasury_id, 'cash');

  SELECT supplier_name INTO v_sup_name FROM public.suppliers WHERE id = v_prt.supplier_id;

  -- Stock availability pre-check (all-or-nothing posting)
  FOR v_li IN
    SELECT pri.product_id, pri.piece_quantity, p.product_name
    FROM public.purchase_return_items pri
    JOIN public.products p ON p.id = pri.product_id
    WHERE pri.purchase_return_id = v_prt.id
  LOOP
    SELECT quantity INTO v_cur_qty FROM public.inventory WHERE product_id = v_li.product_id FOR UPDATE;
    IF COALESCE(v_cur_qty, 0) < v_li.piece_quantity THEN
      RETURN jsonb_build_object('error', 'INSUFFICIENT_STOCK',
                                'product_id', v_li.product_id,
                                'product_name', v_li.product_name,
                                'available', COALESCE(v_cur_qty, 0),
                                'required', v_li.piece_quantity);
    END IF;
  END LOOP;

  -- Stock OUT (+ store journal)
  PERFORM set_config('app.sahl_store_guard', 'sahl', true);
  FOR v_li IN
    SELECT product_id, piece_quantity FROM public.purchase_return_items
    WHERE purchase_return_id = v_prt.id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity - v_li.piece_quantity, updated_at = now()
    WHERE product_id = v_li.product_id;

    INSERT INTO public.sahl_store_moves (
      product_id, store_id, delta, reason, reference_type, reference_id, created_by
    ) VALUES (
      v_li.product_id, v_store_id, -v_li.piece_quantity, 'purchase_return',
      'purchase_return', v_prt.id, v_session.employee_id
    );
  END LOOP;
  PERFORM set_config('app.sahl_store_guard', '', false);

  -- Refund path
  IF v_prt.refund_method = 'cash' THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by, treasury_id
    ) VALUES (
      'inflow', v_prt.total_amount, 'purchase_return', v_prt.id,
      'مرتجع شراء ' || v_prt.code || ' — ' || v_sup_name,
      v_session.employee_id,
      v_treasury_id
    )
    ON CONFLICT (reference_type, reference_id) DO NOTHING;
    v_applied := 0;
    v_new_out := NULL;
  ELSE
    -- Account credit: reduce what we owe the supplier (LEAST rule)
    SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
    FROM public.supplier_credit_accounts
    WHERE supplier_id = v_prt.supplier_id
    FOR UPDATE;

    IF FOUND THEN
      v_applied := LEAST(v_prt.total_amount, GREATEST(v_outstanding, 0));
      v_new_out := v_outstanding - v_applied;
      UPDATE public.supplier_credit_accounts
      SET outstanding_credit = v_new_out, updated_at = now()
      WHERE supplier_id = v_prt.supplier_id;
    ELSE
      v_applied := 0;
      v_new_out := NULL;
    END IF;

    INSERT INTO public.supplier_credit_ledger (
      supplier_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      v_prt.supplier_id, 'debit', v_prt.total_amount, COALESCE(v_new_out, 0),
      'purchase_return', v_prt.id,
      'مرتجع شراء ' || v_prt.code || ' — ' || v_sup_name
        || CASE WHEN v_applied < v_prt.total_amount THEN ' — القيمة تتجاوز الرصيد المستحق للمورد' ELSE '' END,
      v_session.employee_id
    );
  END IF;

  UPDATE public.purchase_returns SET
    status = 'treasury_posted', posted_by = v_session.employee_id, posted_at = now(), updated_at = now()
  WHERE id = v_prt.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_prt.id,
    'code', v_prt.code,
    'total', v_prt.total_amount,
    'refunded_to_account', COALESCE(v_applied, 0),
    'refunded_from_treasury', CASE WHEN v_prt.refund_method = 'cash' THEN v_prt.total_amount ELSE 0 END,
    'outstanding_after', COALESCE(v_new_out, 0),
    'store_id', v_store_id,
    'treasury_id', v_treasury_id
  );
END;
$$;

-- 7. Grants (new signatures) ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_resolve_store(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_resolve_treasury(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_receipt(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_expense(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_purchase(text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_approve_sales_return(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_purchase_return(text, uuid, uuid, uuid) TO authenticated;
