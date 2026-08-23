-- ============================================================================
-- SAHL MODULE — الموردين والمشتريات (Suppliers & Purchases) — Stage 3
-- Reproduces SAHL's supplier/purchase business cycle inside AHRAM:
--
--   SAHL supplier account   → suppliers + supplier_credit_accounts
--   SAHL supplier ledger    → supplier_credit_ledger (INSERT-only audit)
--   SAHL purchase invoice   → purchases + purchase_items (PUR-YYYY-NNNNNN)
--   SAHL cost effect        → products.avg_cost / last_cost (weighted avg)
--   SAHL inventory effect   → inventory.quantity += piece_quantity
--   SAHL payment voucher    → supplier_payments (PAY-YYYY-NNNNNN)
--   SAHL cash-out           → treasury_transactions outflow
--                             ('purchase' cash portion / 'supplier_payment')
--
-- Ledger semantics (supplier = we owe THEM):
--   'credit' entry → increases payable (posted purchase invoice)
--   'debit'  entry → decreases payable (payment voucher)
--
-- Business rule (consistent with receipts decision):
--   Overpayment beyond outstanding is recorded fully in treasury/ledger but
--   only LEAST(amount, outstanding) reduces the account (CHECK >= 0);
--   the excess is explicitly noted on the ledger entry.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.suppliers.read',            'عرض الموردين — سهل'),
  ('sahl.suppliers.manage',          'إدارة الموردين — سهل'),
  ('sahl.purchases.read',            'عرض فواتير الشراء — سهل'),
  ('sahl.purchases.create',          'إنشاء فواتير شراء — سهل'),
  ('sahl.purchases.post',            'ترحيل فواتير الشراء — سهل'),
  ('sahl.payments.suppliers.create', 'إنشاء سندات صرف للموردين — سهل'),
  ('sahl.payments.suppliers.post',   'ترحيل سندات الصرف للموردين — سهل')
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
  WHERE c.code IN ('sahl.access', 'sahl.receipts.read', 'sahl.receipts.post',
                   'sahl.expenses.read', 'sahl.expenses.create', 'sahl.expenses.post',
                   'sahl.treasury.read',
                   'sahl.suppliers.read', 'sahl.suppliers.manage',
                   'sahl.purchases.read', 'sahl.purchases.create', 'sahl.purchases.post',
                   'sahl.payments.suppliers.create', 'sahl.payments.suppliers.post')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. Additive: product cost tracking (SAHL costing concept) -----------------------

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS avg_cost numeric(12,4);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_cost numeric(12,4);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_purchased_at timestamptz;

COMMENT ON COLUMN public.products.avg_cost IS 'Weighted-average purchase cost per piece (سهل المشتريات). Recalculated at purchase posting.';
COMMENT ON COLUMN public.products.last_cost IS 'Last purchase cost per piece (سهل المشتريات).';
COMMENT ON COLUMN public.products.last_purchased_at IS 'Timestamp of last posted purchase containing this product.';

-- 3. Treasury reference types extension ---------------------------------------------

ALTER TABLE public.treasury_transactions DROP CONSTRAINT IF EXISTS ck_treasury_reference_type;
ALTER TABLE public.treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
  CHECK (reference_type IN ('collection', 'expense', 'employee_advance', 'purchase', 'supplier_payment'));

-- 4. suppliers ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  supplier_name varchar(255) NOT NULL,
  phone varchar(30),
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_code ON public.suppliers (code);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON public.suppliers (is_active);

COMMENT ON TABLE public.suppliers IS 'Suppliers master data (سهل).';
COMMENT ON COLUMN public.suppliers.code IS 'e.g., SUP-YYYY-NNNNNN';

-- 5. supplier_credit_accounts ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_credit_accounts (
  supplier_id uuid PRIMARY KEY REFERENCES public.suppliers (id),
  outstanding_credit numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_supplier_accounts_outstanding CHECK (outstanding_credit >= 0)
);

COMMENT ON TABLE public.supplier_credit_accounts IS 'What we owe each supplier (سهل). Mirrors customer_credit_accounts.';
COMMENT ON COLUMN public.supplier_credit_accounts.outstanding_credit IS 'Current payable balance to the supplier. Must be >= 0.';

-- 6. supplier_credit_ledger ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  transaction_type varchar(10) NOT NULL,
  amount numeric(12,2) NOT NULL,
  running_balance numeric(12,2) NOT NULL,
  reference_type varchar(50) NOT NULL,
  reference_id uuid NOT NULL,
  notes text,
  created_by uuid REFERENCES public.employees (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_supplier_ledger_type CHECK (transaction_type IN ('debit', 'credit')),
  CONSTRAINT ck_supplier_ledger_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON public.supplier_credit_ledger (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_reference ON public.supplier_credit_ledger (reference_type, reference_id);

COMMENT ON TABLE public.supplier_credit_ledger IS 'INSERT-only audit of supplier account movements (سهل). credit=increases payable, debit=decreases.';

-- 7. purchases --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  status varchar(30) NOT NULL DEFAULT 'pending',
  total_amount numeric(12,2) NOT NULL,
  payment_method varchar(20) NOT NULL DEFAULT 'credit',
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  reference_number varchar(100),
  notes text,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  approved_by uuid REFERENCES public.employees (id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_purchases_status CHECK (status IN ('pending', 'treasury_posted')),
  CONSTRAINT ck_purchases_total CHECK (total_amount > 0),
  CONSTRAINT ck_purchases_paid CHECK (paid_amount >= 0 AND paid_amount <= total_amount),
  CONSTRAINT ck_purchases_method CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'deposit', 'credit'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_code ON public.purchases (code);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.purchases (status);

COMMENT ON TABLE public.purchases IS 'Purchase invoices from suppliers (سهل). Posting adds stock, updates weighted-average cost, and charges the supplier account.';
COMMENT ON COLUMN public.purchases.code IS 'e.g., PUR-YYYY-NNNNNN';
COMMENT ON COLUMN public.purchases.paid_amount IS 'Amount settled from treasury at posting time; remainder goes to the supplier account.';
COMMENT ON COLUMN public.purchases.status IS 'pending → treasury_posted';

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  unit_type varchar(20) NOT NULL,
  unit_quantity integer NOT NULL,
  piece_quantity integer NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  cost_per_piece numeric(12,4) NOT NULL,
  CONSTRAINT ck_purchase_items_unit CHECK (unit_type IN ('piece', 'dozen', 'carton')),
  CONSTRAINT ck_purchase_items_qty CHECK (unit_quantity > 0 AND piece_quantity > 0),
  CONSTRAINT ck_purchase_items_cost CHECK (unit_cost >= 0 AND line_total >= 0 AND cost_per_piece >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items (product_id);

COMMENT ON TABLE public.purchase_items IS 'Purchase invoice lines. unit_cost is per chosen unit; piece quantities are computed server-side from products.carton_quantity.';

-- 8. supplier_payments ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  amount numeric(12,2) NOT NULL,
  method varchar(20) NOT NULL,
  reference_number varchar(100),
  notes text,
  status varchar(30) NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL REFERENCES public.employees (id),
  approved_by uuid REFERENCES public.employees (id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_supplier_payments_amount CHECK (amount > 0),
  CONSTRAINT ck_supplier_payments_method CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'deposit')),
  CONSTRAINT ck_supplier_payments_status CHECK (status IN ('pending', 'treasury_posted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payments_code ON public.supplier_payments (code);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments (supplier_id);

COMMENT ON TABLE public.supplier_payments IS 'Payment vouchers to suppliers (سندات صرف للموردين — سهل).';
COMMENT ON COLUMN public.supplier_payments.code IS 'e.g., PAY-YYYY-NNNNNN';

-- 9. Document numbering ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_supplier_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('supplier', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'SUP-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_purchase_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('purchase', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'PUR-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_payment_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('supplier_payment', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'PAY-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 10. sahl_create_supplier -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_supplier(
  p_token text,
  p_supplier_name text,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
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
  IF NOT public.check_capability(p_token, 'sahl.suppliers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.suppliers.manage');
  END IF;

  IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
    RETURN jsonb_build_object('error', 'INVALID_NAME');
  END IF;

  INSERT INTO public.suppliers (code, supplier_name, phone, address, notes, created_by)
  VALUES (public.generate_supplier_number(), btrim(p_supplier_name),
          NULLIF(btrim(COALESCE(p_phone, '')), ''), NULLIF(btrim(COALESCE(p_address, '')), ''),
          NULLIF(btrim(COALESCE(p_notes, '')), ''), v_session.employee_id)
  RETURNING id INTO v_id;

  INSERT INTO public.supplier_credit_accounts (supplier_id) VALUES (v_id) ON CONFLICT (supplier_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- 11. sahl_get_suppliers ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_suppliers(
  p_token text
)
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
  IF NOT public.check_capability(p_token, 'sahl.suppliers.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.suppliers.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.outstanding_credit DESC, t.supplier_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT s.id, s.code, s.supplier_name, s.phone, s.address, s.notes, s.is_active, s.created_at,
           COALESCE(a.outstanding_credit, 0) AS outstanding_credit
    FROM public.suppliers s
    LEFT JOIN public.supplier_credit_accounts a ON a.supplier_id = s.id
  ) t;

  RETURN v_result;
END;
$$;

-- 12. sahl_create_purchase ------------------------------------------------------------
-- p_items jsonb array: [{"product_id":"...","unit_type":"carton","quantity":3,"unit_cost":150.00}]

CREATE OR REPLACE FUNCTION public.sahl_create_purchase(
  p_token text,
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
  v_purchase_id uuid;
  v_purchase_code varchar(30);
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

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('error', 'SUPPLIER_NOT_FOUND');
  END IF;

  IF p_payment_method NOT IN ('cash', 'bank_transfer', 'cheque', 'deposit', 'credit') THEN
    RETURN jsonb_build_object('error', 'INVALID_PAYMENT_METHOD');
  END IF;

  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PAID_AMOUNT'); END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_ITEMS');
  END IF;

  -- Validate all lines and compute total before writing anything
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

  -- Create document
  INSERT INTO public.purchases (code, supplier_id, total_amount, payment_method, paid_amount,
                                reference_number, notes, created_by)
  VALUES (public.generate_purchase_number(), p_supplier_id, v_total, p_payment_method, v_paid,
          NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
          NULLIF(btrim(COALESCE(p_notes, '')), ''),
          v_session.employee_id)
  RETURNING id, code INTO v_purchase_id, v_purchase_code;

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
      v_purchase_id, v_product.id, v_item->>'unit_type', (v_item->>'quantity')::int, v_pieces,
      ROUND((v_item->>'unit_cost')::numeric, 2), v_line_total,
      ROUND(v_line_total / v_pieces, 4)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_purchase_id, 'code', v_purchase_code, 'total', v_total);
END;
$$;

-- 13. sahl_post_purchase -----------------------------------------------------------------
-- Posts a pending purchase: stock IN, weighted-average cost update, supplier account
-- charge, optional immediate cash OUT. Idempotent-safe.

CREATE OR REPLACE FUNCTION public.sahl_post_purchase(
  p_token text,
  p_purchase_id uuid
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

  SELECT supplier_name INTO v_sup_name FROM public.suppliers WHERE id = v_pur.supplier_id;

  -- Inventory IN + weighted-average cost effect per line
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
  END LOOP;

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

  -- Immediate settlement portion → money OUT of the treasury.
  -- NOTE: this portion never touched the supplier account (only total-paid is
  -- charged), so no ledger entry is needed here — treasury movement only.
  IF v_pur.paid_amount > 0 THEN
    INSERT INTO public.treasury_transactions (
      transaction_type, amount, reference_type, reference_id, notes, created_by
    ) VALUES (
      'outflow', v_pur.paid_amount, 'purchase', v_pur.id,
      'فاتورة شراء ' || v_pur.code || ' — ' || v_sup_name,
      v_session.employee_id
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
    'added_to_supplier_account', v_to_account
  );
END;
$$;

-- 14. sahl_create_supplier_payment ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_create_supplier_payment(
  p_token text,
  p_supplier_id uuid,
  p_amount numeric,
  p_method text,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_id uuid;
  v_code varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.payments.suppliers.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.payments.suppliers.create');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('error', 'SUPPLIER_NOT_FOUND');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_AMOUNT'); END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'cheque', 'deposit') THEN
    RETURN jsonb_build_object('error', 'INVALID_METHOD');
  END IF;

  v_code := public.generate_payment_number();

  INSERT INTO public.supplier_payments (code, supplier_id, amount, method, reference_number, notes, created_by)
  VALUES (v_code, p_supplier_id, round(p_amount, 2), p_method,
          NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
          NULLIF(btrim(COALESCE(p_notes, '')), ''),
          v_session.employee_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code, 'status', 'pending');
END;
$$;

-- 15. sahl_post_supplier_payment ---------------------------------------------------------------
-- Pays a supplier: reduces what we owe (LEAST clamp rule) and takes money OUT
-- of the treasury. Idempotent-safe.

CREATE OR REPLACE FUNCTION public.sahl_post_supplier_payment(
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
  v_outstanding numeric(12,2);
  v_applied numeric(12,2);
  v_new_outstanding numeric(12,2);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.payments.suppliers.post') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.payments.suppliers.post');
  END IF;

  SELECT * INTO v_pay FROM public.supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_pay.status = 'treasury_posted' THEN RETURN jsonb_build_object('error', 'ALREADY_POSTED'); END IF;

  SELECT outstanding_credit INTO v_outstanding
  FROM public.supplier_credit_accounts WHERE supplier_id = v_pay.supplier_id FOR UPDATE;
  v_outstanding := COALESCE(v_outstanding, 0);

  v_applied := LEAST(v_pay.amount, GREATEST(v_outstanding, 0));
  v_new_outstanding := v_outstanding - v_applied;

  UPDATE public.supplier_credit_accounts SET outstanding_credit = v_new_outstanding, updated_at = now()
  WHERE supplier_id = v_pay.supplier_id;

  INSERT INTO public.supplier_credit_ledger (
    supplier_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by
  ) VALUES (
    v_pay.supplier_id, 'debit', v_pay.amount, v_new_outstanding, 'supplier_payment', v_pay.id,
    'سند صرف ' || v_pay.code || ' — ' || v_pay.method
      || CASE WHEN v_applied < v_pay.amount THEN ' — المبلغ يتجاوز المستحق للمورد' ELSE '' END,
    v_session.employee_id
  );

  INSERT INTO public.treasury_transactions (
    transaction_type, amount, reference_type, reference_id, notes, created_by
  ) VALUES (
    'outflow', v_pay.amount, 'supplier_payment', v_pay.id,
    'سند صرف ' || v_pay.code || CASE WHEN v_pay.reference_number IS NOT NULL THEN ' — مرجع: ' || v_pay.reference_number ELSE '' END,
    v_session.employee_id
  )
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  UPDATE public.supplier_payments SET
    status = 'treasury_posted',
    approved_by = COALESCE(approved_by, v_session.employee_id),
    approved_at = COALESCE(approved_at, now()),
    posted_at = now(),
    updated_at = now()
  WHERE id = v_pay.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_pay.id,
    'code', v_pay.code,
    'amount', v_pay.amount,
    'applied_to_account', v_applied,
    'outstanding_after', v_new_outstanding
  );
END;
$$;

-- 16. List/detail RPCs --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_purchases(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.purchases.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.purchases.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT pu.id, pu.code, pu.supplier_id, s.supplier_name, pu.status, pu.total_amount,
           pu.payment_method, pu.paid_amount, pu.reference_number, pu.notes, pu.created_at, pu.posted_at,
           (SELECT count(*)::int FROM public.purchase_items x WHERE x.purchase_id = pu.id) AS item_count,
           e.full_name AS created_by_name
    FROM public.purchases pu
    LEFT JOIN public.suppliers s ON s.id = pu.supplier_id
    LEFT JOIN public.employees e ON e.id = pu.created_by
    LIMIT 50
  ) t;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_purchase_items(p_token text, p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.purchases.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.purchases.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.line_no), '[]'::jsonb) INTO v_result
  FROM (
    SELECT row_number() OVER () AS line_no,
           pi.unit_type, pi.unit_quantity, pi.piece_quantity, pi.unit_cost, pi.line_total, pi.cost_per_piece,
           p.product_name, p.legacy_code
    FROM public.purchase_items pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.purchase_id = p_purchase_id
  ) t;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_supplier_payments(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.payments.suppliers.create') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.payments.suppliers.create');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT sp.id, sp.code, sp.supplier_id, s.supplier_name, sp.amount, sp.method,
           sp.reference_number, sp.status, sp.created_at, sp.posted_at,
           e.full_name AS created_by_name
    FROM public.supplier_payments sp
    LEFT JOIN public.suppliers s ON s.id = sp.supplier_id
    LEFT JOIN public.employees e ON e.id = sp.created_by
    LIMIT 50
  ) t;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_supplier_ledger(p_token text, p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.suppliers.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.suppliers.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT l.id, l.transaction_type, l.amount, l.running_balance,
           l.reference_type, l.reference_id, l.notes, l.created_at
    FROM public.supplier_credit_ledger l
    WHERE l.supplier_id = p_supplier_id
    ORDER BY l.created_at DESC
    LIMIT 100
  ) t;
  RETURN v_result;
END;
$$;

-- 17. Treasury summary: include new movement kinds -----------------------------------

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
        SELECT t.id, t.transaction_type, t.amount, t.reference_type, t.notes, t.created_at,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT c.code FROM public.collections c WHERE c.id = t.reference_id)
                 WHEN 'expense'    THEN (SELECT e.code FROM public.expenses e WHERE e.id = t.reference_id)
                 WHEN 'purchase'   THEN (SELECT pu.code FROM public.purchases pu WHERE pu.id = t.reference_id)
                 WHEN 'supplier_payment' THEN (SELECT sp.code FROM public.supplier_payments sp WHERE sp.id = t.reference_id)
                 ELSE NULL
               END AS doc_code,
               CASE t.reference_type
                 WHEN 'collection' THEN (SELECT cu.company_name FROM public.collections c
                                          JOIN public.customers cu ON cu.id = c.customer_id
                                          WHERE c.id = t.reference_id)
                 WHEN 'purchase' THEN (SELECT s.supplier_name FROM public.purchases pu
                                        JOIN public.suppliers s ON s.id = pu.supplier_id
                                        WHERE pu.id = t.reference_id)
                 WHEN 'supplier_payment' THEN (SELECT s.supplier_name FROM public.supplier_payments sp
                                                JOIN public.suppliers s ON s.id = sp.supplier_id
                                                WHERE sp.id = t.reference_id)
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

-- 18. Grants & schema reload ---------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.generate_supplier_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_purchase_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_supplier(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_suppliers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_purchase(text, uuid, jsonb, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_purchase(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_create_supplier_payment(text, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_post_supplier_payment(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_purchases(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_purchase_items(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_supplier_payments(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_supplier_ledger(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_treasury_summary(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL الموردين والمشتريات Module (Stage 3)
-- ============================================================================
