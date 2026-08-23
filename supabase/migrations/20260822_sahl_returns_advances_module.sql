-- ============================================================================
-- SAHL MODULE — المرتجعات وسلف الموظفين (Returns & Employee Advances) — Stage 4
--
-- مرتجع البيع (Sales Returns) — built ON TOP of AHRAM's canonical phase-7
-- structures (returns / return_items / return_inspection) which existed with
-- zero RPCs and zero UI. This module activates the full canonical cycle:
--
--   pending → (فحص inspecting, optional per item) → approved / rejected
--   approval generates the credit note (CN-YYYY-NNNNNN) and:
--     • customer_credit_ledger debit entry + outstanding reduction (LEAST rule)
--     • inventory reentry for SALEABLE pieces only
--       (damaged/expired/unsaleable = write-off, no stock return)
--   value basis = order_items.unit_price captured at order time.
--   Uninspected items default to 'saleable' (documented business default).
--
-- مرتجع الشراء (Purchase Returns) — new tables mirroring the purchases module:
--   posting decreases inventory (guarded by available stock), refunds either to
--   the supplier account (credit note on supplier) or as cash from treasury.
--
-- سلف الموظفين (Employee Advances) — activates the dormant phase-6 table:
--   create → approve (treasury outflow) → settle (partial allowed, each
--   settlement is its own treasury inflow row via sahl_advance_settlements).
--
-- Ledger semantics (consistent across all SAHL modules):
--   customer ledger: 'debit' reduces what the customer owes
--   supplier ledger: 'debit' reduces what we owe the supplier
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.returns.read',          'عرض المرتجعات — سهل'),
  ('sahl.returns.create',        'إنشاء المرتجعات — سهل'),
  ('sahl.returns.post',          'اعتماد/ترحيل المرتجعات — سهل'),
  ('sahl.advances.read',         'عرض سلف الموظفين — سهل'),
  ('sahl.advances.manage',       'إدارة سلف الموظفين — سهل')
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
  WHERE c.code IN ('sahl.returns.read', 'sahl.returns.create', 'sahl.returns.post',
                   'sahl.advances.read', 'sahl.advances.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. Treasury reference types extension ---------------------------------------------

ALTER TABLE public.treasury_transactions DROP CONSTRAINT IF EXISTS ck_treasury_reference_type;
ALTER TABLE public.treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
  CHECK (reference_type IN ('collection', 'expense', 'employee_advance', 'purchase',
                            'supplier_payment', 'purchase_return', 'advance_settlement'));

-- 3. purchase_returns ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  status varchar(30) NOT NULL DEFAULT 'pending',
  total_amount numeric(12,2) NOT NULL,
  refund_method varchar(20) NOT NULL DEFAULT 'account',
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  posted_by uuid REFERENCES public.employees (id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_purchase_returns_code UNIQUE (code),
  CONSTRAINT ck_purchase_returns_status CHECK (status IN ('pending', 'treasury_posted')),
  CONSTRAINT ck_purchase_returns_total CHECK (total_amount > 0),
  CONSTRAINT ck_purchase_returns_method CHECK (refund_method IN ('account', 'cash'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON public.purchase_returns (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON public.purchase_returns (status);

COMMENT ON TABLE public.purchase_returns IS 'Goods returned to suppliers (مرتجع شراء — سهل). Posting removes stock and refunds account or cash.';
COMMENT ON COLUMN public.purchase_returns.code IS 'e.g., PRT-YYYY-NNNNNN';
COMMENT ON COLUMN public.purchase_returns.refund_method IS 'account = credit against supplier balance, cash = treasury inflow';

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id uuid NOT NULL REFERENCES public.purchase_returns (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  unit_type varchar(20) NOT NULL,
  unit_quantity integer NOT NULL,
  piece_quantity integer NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  cost_per_piece numeric(12,4) NOT NULL,
  CONSTRAINT ck_preturn_items_unit CHECK (unit_type IN ('piece', 'dozen', 'carton')),
  CONSTRAINT ck_preturn_items_qty CHECK (unit_quantity > 0 AND piece_quantity > 0),
  CONSTRAINT ck_preturn_items_cost CHECK (unit_cost > 0 AND line_total > 0 AND cost_per_piece > 0)
);

CREATE INDEX IF NOT EXISTS idx_preturn_items_return ON public.purchase_return_items (purchase_return_id);
CREATE INDEX IF NOT EXISTS idx_preturn_items_product ON public.purchase_return_items (product_id);

COMMENT ON TABLE public.purchase_return_items IS 'Purchase-return lines. Cost basis entered per unit; pieces computed server-side.';

-- 4. Advance settlements (supports partial settlements, each with its own
--    treasury reference id) ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_advance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id uuid NOT NULL REFERENCES public.employee_advances (id),
  amount numeric(12,2) NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_adv_settlements_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_adv_settlements_advance ON public.sahl_advance_settlements (advance_id);

COMMENT ON TABLE public.sahl_advance_settlements IS 'Partial/full repayments of employee advances (سهل). Each row backs one treasury inflow.';

-- 5. Document numbering -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_sales_return_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('sales_return', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'RET-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_credit_note_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('credit_note', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'CN-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_purchase_return_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('purchase_return', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'PRT-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 6. sahl_get_customer_orders ---------------------------------------------------------
-- Delivered orders of a customer (candidates for sales returns).

CREATE OR REPLACE FUNCTION public.sahl_get_customer_orders(
  p_token text,
  p_customer_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.returns.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.delivered_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT o.id, o.order_number, o.status, o.total_amount, o.delivered_at,
           (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM public.orders o
    WHERE o.customer_id = p_customer_id AND o.status = 'delivered'
  ) t;

  RETURN v_result;
END;
$$;

-- 7. sahl_get_order_returnable ----------------------------------------------------------
-- Order lines with per-(product,unit) already-returned units and remaining units.

CREATE OR REPLACE FUNCTION public.sahl_get_order_returnable(
  p_token text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_order   public.orders;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.read');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_order.status != 'delivered' THEN RETURN jsonb_build_object('error', 'ORDER_NOT_DELIVERED'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT oi.product_id, p.product_name, COALESCE(p.legacy_code, '') AS legacy_code,
           oi.unit_type,
           SUM(oi.unit_quantity)::int AS ordered_units,
           MIN(oi.unit_price)::numeric(12,2) AS unit_price,
           COALESCE((
             SELECT SUM(ri.quantity)::int
             FROM public.return_items ri
             JOIN public.returns r ON r.id = ri.return_id
             WHERE r.order_id = p_order_id
               AND r.status != 'rejected'
               AND ri.product_id = oi.product_id
               AND ri.unit_type = oi.unit_type
           ), 0) AS returned_units,
           public.piece_multiplier(oi.unit_type, oi.product_id) AS pieces_per_unit
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id, p.product_name, p.legacy_code, oi.unit_type
  ) t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.piece_multiplier(
  p_unit_type text,
  p_product_id uuid
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT CASE p_unit_type
    WHEN 'piece' THEN 1
    WHEN 'dozen' THEN 12
    WHEN 'carton' THEN GREATEST((SELECT carton_quantity FROM public.products WHERE id = p_product_id), 1)
    ELSE 1
  END;
$$;

-- 8. sahl_create_sales_return ------------------------------------------------------------
-- p_items jsonb: [{"product_id":"...","unit_type":"carton","quantity":2,"reason":"..."}]
-- Validates remaining returnable units per (product,unit) across prior returns.

CREATE OR REPLACE FUNCTION public.sahl_create_sales_return(
  p_token text,
  p_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session      app.sessions;
  v_order        public.orders;
  v_return_id    uuid;
  v_return_code  varchar(30);
  v_item         jsonb;
  v_ordered      integer;
  v_prior        integer;
  v_qty          integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.create');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status != 'delivered' THEN RETURN jsonb_build_object('error', 'ORDER_NOT_DELIVERED'); END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'EMPTY_ITEMS');
  END IF;

  -- Pre-validate every line before creating anything
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RETURN jsonb_build_object('error', 'INVALID_QUANTITY');
    END IF;
    IF NOT (v_item->>'unit_type') IN ('piece', 'dozen', 'carton') THEN
      RETURN jsonb_build_object('error', 'INVALID_UNIT_TYPE');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.product_id = (v_item->>'product_id')::uuid
        AND oi.unit_type = v_item->>'unit_type'
    ) THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_IN_ORDER');
    END IF;

    SELECT COALESCE(SUM(unit_quantity), 0)::int INTO v_ordered
    FROM public.order_items
    WHERE order_id = p_order_id
      AND product_id = (v_item->>'product_id')::uuid
      AND unit_type = v_item->>'unit_type';

    SELECT COALESCE(SUM(ri.quantity), 0)::int INTO v_prior
    FROM public.return_items ri
    JOIN public.returns r ON r.id = ri.return_id
    WHERE r.order_id = p_order_id
      AND r.status != 'rejected'
      AND ri.product_id = (v_item->>'product_id')::uuid
      AND ri.unit_type = v_item->>'unit_type';

    IF v_qty > v_ordered - v_prior THEN
      RETURN jsonb_build_object('error', 'QUANTITY_EXCEEDS_REMAINING',
                                'remaining', v_ordered - v_prior,
                                'product_id', v_item->>'product_id');
    END IF;
  END LOOP;

  -- Create document
  INSERT INTO public.returns (code, order_id, customer_id, owner_type, owner_id, status, notes, created_by)
  VALUES (public.generate_sales_return_number(), p_order_id, v_order.customer_id,
          'employee', v_session.employee_id, 'pending',
          NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
  RETURNING id, code INTO v_return_id, v_return_code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.return_items (return_id, product_id, unit_type, quantity, reason)
    VALUES (
      v_return_id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'quantity')::int,
      NULLIF(btrim(COALESCE(v_item->>'reason', '')), '')
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_return_id, 'code', v_return_code, 'status', 'pending');
END;
$$;

-- 9. sahl_record_return_inspection --------------------------------------------------------
-- p_inspections jsonb: [{"return_item_id":"...","condition":"saleable|damaged|expired|unsaleable","notes":"..."}]

CREATE OR REPLACE FUNCTION public.sahl_record_return_inspection(
  p_token text,
  p_return_id uuid,
  p_inspections jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_ret     public.returns;
  v_item    jsonb;
  v_cond    text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.create');
  END IF;

  SELECT * INTO v_ret FROM public.returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_ret.status NOT IN ('pending', 'inspecting') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;
  IF p_inspections IS NULL OR jsonb_typeof(p_inspections) != 'array' OR jsonb_array_length(p_inspections) = 0 THEN
    RETURN jsonb_build_object('error', 'EMPTY_INSPECTIONS');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inspections) LOOP
    v_cond := v_item->>'condition';
    IF v_cond NOT IN ('saleable', 'damaged', 'expired', 'unsaleable') THEN
      RETURN jsonb_build_object('error', 'INVALID_CONDITION');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.return_items ri
      WHERE ri.id = (v_item->>'return_item_id')::uuid AND ri.return_id = p_return_id
    ) THEN
      RETURN jsonb_build_object('error', 'ITEM_NOT_IN_RETURN');
    END IF;

    INSERT INTO public.return_inspection (return_item_id, condition, inspected_by, notes)
    VALUES ((v_item->>'return_item_id')::uuid, v_cond, v_session.employee_id,
            NULLIF(btrim(COALESCE(v_item->>'notes', '')), ''));
  END LOOP;

  UPDATE public.returns SET status = 'inspecting', updated_at = now() WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true, 'status', 'inspecting');
END;
$$;

-- 10. sahl_approve_sales_return -------------------------------------------------------------
-- Generates the credit note, reduces the customer's outstanding (LEAST rule),
-- writes the ledger entry, and returns saleable pieces to inventory.

CREATE OR REPLACE FUNCTION public.sahl_approve_sales_return(
  p_token text,
  p_return_id uuid
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

  -- Value computation from order-time prices + inventory reentry of saleable pieces
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

  -- Financial movement on the customer account (INSERT-only audit)
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

  -- Note: the canonical returns table has no approved_by column; approver is
  -- recorded via the ledger entry above.

  RETURN jsonb_build_object(
    'success', true,
    'id', v_ret.id,
    'code', v_ret.code,
    'credit_note_number', v_cn,
    'credit_note_amount', v_total,
    'applied_to_account', v_applied,
    'outstanding_after', COALESCE(v_new_out, 0)
  );
END;
$$;

-- 11. sahl_reject_sales_return ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_reject_sales_return(
  p_token text,
  p_return_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_ret     public.returns;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.post');
  END IF;

  SELECT * INTO v_ret FROM public.returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_ret.status NOT IN ('pending', 'inspecting') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.returns SET status = 'rejected', updated_at = now() WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true, 'id', p_return_id, 'status', 'rejected');
END;
$$;

-- 12. sahl_get_returns -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_returns(
  p_token text,
  p_status text DEFAULT NULL
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
  IF NOT public.check_capability(p_token, 'sahl.returns.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT r.id, r.code, r.status, r.credit_note_number, r.credit_note_amount,
           r.notes, r.created_at,
           r.order_id, o.order_number,
           r.customer_id, c.company_name AS customer_name,
           (SELECT count(*)::int FROM public.return_items ri WHERE ri.return_id = r.id) AS item_count,
           (SELECT count(*)::int FROM public.return_inspection x
            JOIN public.return_items ri2 ON ri2.id = x.return_item_id
            WHERE ri2.return_id = r.id) AS inspected_count
    FROM public.returns r
    JOIN public.orders o ON o.id = r.order_id
    JOIN public.customers c ON c.id = r.customer_id
    WHERE (p_status IS NULL OR r.status = p_status)
  ) t;

  RETURN v_result;
END;
$$;

-- 13. sahl_get_return_items --------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_return_items(
  p_token text,
  p_return_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.returns.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT ri.id, ri.product_id, p.product_name, ri.unit_type, ri.quantity, ri.reason,
           public.piece_multiplier(ri.unit_type, ri.product_id) AS pieces_per_unit,
           (ri.quantity * public.piece_multiplier(ri.unit_type, ri.product_id)) AS total_pieces,
           (SELECT i.condition FROM public.return_inspection i
            WHERE i.return_item_id = ri.id ORDER BY i.inspected_at DESC LIMIT 1) AS inspection_condition,
           (SELECT o.unit_price FROM public.order_items o
            JOIN public.returns r ON r.order_id = o.order_id
            WHERE r.id = ri.return_id AND o.product_id = ri.product_id AND o.unit_type = ri.unit_type
            ORDER BY o.id LIMIT 1) AS unit_price
    FROM public.return_items ri
    JOIN public.products p ON p.id = ri.product_id
    WHERE ri.return_id = p_return_id
  ) t;

  RETURN v_result;
END;
$$;

-- 14. sahl_create_purchase_return --------------------------------------------------------------
-- p_items jsonb: [{"product_id":"...","unit_type":"carton","quantity":3,"unit_cost":150}]
-- unit_cost is PER CHOSEN UNIT (mirrors purchases builder).

CREATE OR REPLACE FUNCTION public.sahl_create_purchase_return(
  p_token text,
  p_supplier_id uuid,
  p_items jsonb,
  p_refund_method text DEFAULT 'account',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_return_id uuid;
  v_code      varchar(30);
  v_item      jsonb;
  v_product   public.products;
  v_mult      integer;
  v_pieces    integer;
  v_line_tot  numeric(12,2);
  v_total     numeric(12,2) := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.returns.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.create');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('error', 'SUPPLIER_NOT_FOUND');
  END IF;
  IF p_refund_method NOT IN ('account', 'cash') THEN
    RETURN jsonb_build_object('error', 'INVALID_REFUND_METHOD');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'EMPTY_ITEMS');
  END IF;

  -- Validate + compute totals server-side (never trust client totals)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;

    v_mult := CASE v_item->>'unit_type'
      WHEN 'piece' THEN 1
      WHEN 'dozen' THEN 12
      WHEN 'carton' THEN GREATEST(COALESCE(v_product.carton_quantity, 1), 1)
      ELSE 0
    END;
    IF v_mult = 0 THEN RETURN jsonb_build_object('error', 'INVALID_UNIT_TYPE'); END IF;

    IF COALESCE((v_item->>'quantity')::int, 0) <= 0 THEN
      RETURN jsonb_build_object('error', 'INVALID_QUANTITY');
    END IF;
    IF COALESCE((v_item->>'unit_cost')::numeric, 0) <= 0 THEN
      RETURN jsonb_build_object('error', 'INVALID_COST');
    END IF;

    v_pieces := (v_item->>'quantity')::int * v_mult;
    v_line_tot := ROUND((v_item->>'unit_cost')::numeric * (v_item->>'quantity')::numeric, 2);
    v_total := v_total + v_line_tot;
  END LOOP;

  v_code := public.generate_purchase_return_number();

  INSERT INTO public.purchase_returns (code, supplier_id, total_amount, refund_method, notes, created_by)
  VALUES (v_code, p_supplier_id, v_total, p_refund_method,
          NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    v_mult := CASE v_item->>'unit_type'
      WHEN 'piece' THEN 1
      WHEN 'dozen' THEN 12
      WHEN 'carton' THEN GREATEST(COALESCE(v_product.carton_quantity, 1), 1)
      ELSE 1
    END;

    INSERT INTO public.purchase_return_items (
      purchase_return_id, product_id, unit_type, unit_quantity, piece_quantity,
      unit_cost, line_total, cost_per_piece
    ) VALUES (
      v_return_id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'quantity')::int,
      (v_item->>'quantity')::int * v_mult,
      (v_item->>'unit_cost')::numeric(12,2),
      ROUND((v_item->>'unit_cost')::numeric * (v_item->>'quantity')::numeric, 2),
      ROUND((v_item->>'unit_cost')::numeric / v_mult, 4)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_return_id, 'code', v_code, 'total', v_total);
END;
$$;

-- 15. sahl_post_purchase_return --------------------------------------------------------------
-- Stock OUT (guarded), then refund to supplier account or cash from treasury.

CREATE OR REPLACE FUNCTION public.sahl_post_purchase_return(
  p_token text,
  p_purchase_return_id uuid
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

  -- Stock OUT
  FOR v_li IN
    SELECT product_id, piece_quantity FROM public.purchase_return_items
    WHERE purchase_return_id = v_prt.id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity - v_li.piece_quantity, updated_at = now()
    WHERE product_id = v_li.product_id;
  END LOOP;

  -- Refund path
  IF v_prt.refund_method = 'cash' THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by
    ) VALUES (
      'inflow', v_prt.total_amount, 'purchase_return', v_prt.id,
      'مرتجع شراء ' || v_prt.code || ' — ' || v_sup_name,
      v_session.employee_id
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
    'outstanding_after', COALESCE(v_new_out, 0)
  );
END;
$$;

-- 16. sahl_get_purchase_returns ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_purchase_returns(
  p_token text
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
  IF NOT public.check_capability(p_token, 'sahl.returns.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.returns.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT pr.id, pr.code, pr.status, pr.total_amount, pr.refund_method, pr.notes, pr.created_at, pr.posted_at,
           s.id AS supplier_id, s.supplier_name,
           (SELECT count(*)::int FROM public.purchase_return_items x WHERE x.purchase_return_id = pr.id) AS item_count
    FROM public.purchase_returns pr
    JOIN public.suppliers s ON s.id = pr.supplier_id
  ) t;

  RETURN v_result;
END;
$$;

-- 17. sahl_create_advance ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_advance(
  p_token text,
  p_employee_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.advances.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.manage');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id) THEN
    RETURN jsonb_build_object('error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  INSERT INTO public.employee_advances (employee_id, amount, outstanding_amount, reason, created_by)
  VALUES (p_employee_id, round(p_amount, 2), round(p_amount, 2),
          NULLIF(btrim(COALESCE(p_reason, '')), ''), v_session.employee_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- 18. sahl_approve_advance ---------------------------------------------------------------------------
-- Pays the advance out of the treasury. Idempotent-safe.

CREATE OR REPLACE FUNCTION public.sahl_approve_advance(
  p_token text,
  p_advance_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_adv     public.employee_advances;
  v_emp     record;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.advances.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.manage');
  END IF;

  SELECT * INTO v_adv FROM public.employee_advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_adv.approved_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'ALREADY_APPROVED'); END IF;

  SELECT e.full_name AS employee_name INTO v_emp
  FROM public.employees e WHERE e.id = v_adv.employee_id;

  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'outflow', v_adv.amount, 'employee_advance', v_adv.id,
    'سلفة موظف — ' || COALESCE(v_emp.employee_name, '')
      || CASE WHEN v_adv.reason IS NOT NULL THEN ' — ' || v_adv.reason ELSE '' END,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  UPDATE public.employee_advances SET approved_by = v_session.employee_id, approved_at = now(), updated_at = now()
  WHERE id = v_adv.id;

  RETURN jsonb_build_object('success', true, 'id', v_adv.id, 'amount', v_adv.amount);
END;
$$;

-- 19. sahl_settle_advance -------------------------------------------------------------------------------
-- Repayment (partial allowed). Each settlement creates its own treasury inflow.

CREATE OR REPLACE FUNCTION public.sahl_settle_advance(
  p_token text,
  p_advance_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_adv     public.employee_advances;
  v_settle_id uuid;
  v_new_out numeric(12,2);
  v_applied numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.advances.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.advances.manage');
  END IF;

  SELECT * INTO v_adv FROM public.employee_advances WHERE id = p_advance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_adv.is_settled THEN RETURN jsonb_build_object('error', 'ALREADY_SETTLED'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_amount > v_adv.outstanding_amount THEN
    RETURN jsonb_build_object('error', 'AMOUNT_EXCEEDS_OUTSTANDING', 'outstanding', v_adv.outstanding_amount);
  END IF;

  v_applied := LEAST(round(p_amount, 2), v_adv.outstanding_amount);
  v_new_out := v_adv.outstanding_amount - v_applied;

  INSERT INTO public.sahl_advance_settlements (advance_id, amount, notes, created_by)
  VALUES (v_adv.id, v_applied, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
  RETURNING id INTO v_settle_id;

  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'inflow', v_applied, 'advance_settlement', v_settle_id,
    'تسوية سلفة موظف' || CASE WHEN v_adv.reason IS NOT NULL THEN ' — ' || v_adv.reason ELSE '' END,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  UPDATE public.employee_advances SET
    outstanding_amount = v_new_out,
    is_settled = (v_new_out = 0),
    updated_at = now()
  WHERE id = v_adv.id;

  RETURN jsonb_build_object('success', true, 'id', v_adv.id,
                            'applied', v_applied, 'outstanding_after', v_new_out);
END;
$$;

-- 20. sahl_get_advances ------------------------------------------------------------------------------------

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
    WHERE (p_include_settled OR NOT a.is_settled)
  ) t;

  RETURN v_result;
END;
$$;

-- 21. Grants & schema reload ------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_get_customer_orders(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_order_returnable(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_sales_return(text, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_record_return_inspection(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_approve_sales_return(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_reject_sales_return(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_returns(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_return_items(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_purchase_return(text, uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_purchase_return(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_purchase_returns(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_advance(text, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_approve_advance(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_settle_advance(text, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_advances(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.piece_multiplier(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL المرتجعات وسلف الموظفين Module (Stage 4)
-- ============================================================================
