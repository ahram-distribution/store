-- ============================================================================
-- SAHL MODULE — المبيعات: فواتير البيع وعروض الأسعار — Stage 10 (G3)
--
-- Maps SAHL's sales cycle onto AHRAM:
--   • فاتورة بيع (cash/card/آجل split) → sahl_invoices kind='sale'
--       - stock leaves the chosen store (canonical inventory stays authoritative;
--         per-store moves journalled under app.sahl_store_guard)
--       - cash portion → drawer treasury inflow ('sale'), card portion → bank
--         treasury inflow ('sale_card')
--       - remaining balance → customer_credit_accounts (+ledger 'debit')
--   • عرض سعر → sahl_invoices kind='quote' (no financial/inventory effect);
--       حجز البضاعة creates sahl_stock_reservations released on
--       convert/cancel.
--   • حذف/إلغاء فاتورة → sahl_void_invoice fully reverses every effect
--       ('sale_void'/'sale_void_card' treasury legs, ledger 'credit').
--
-- Shared posting logic lives in _sahl_post_invoice_core so create and
-- convert cannot drift apart.
-- ============================================================================

-- 1. Capabilities ---------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.sales.read',   'عرض فواتير البيع وعروض الأسعار — سهل'),
  ('sahl.sales.manage', 'إنشاء وترحيل وإلغاء الفواتير — سهل')
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
  WHERE c.code IN ('sahl.sales.read', 'sahl.sales.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. Treasury reference types ------------------------------------------------------

ALTER TABLE public.treasury_transactions DROP CONSTRAINT IF EXISTS ck_treasury_reference_type;
ALTER TABLE public.treasury_transactions ADD CONSTRAINT ck_treasury_reference_type
  CHECK (reference_type IN ('collection', 'expense', 'employee_advance', 'purchase',
                            'supplier_payment', 'purchase_return', 'advance_settlement',
                            'cheque', 'treasury_transfer_out', 'treasury_transfer_in',
                            'sale', 'sale_card', 'sale_void', 'sale_void_card'));

-- 3. Document numbering ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_sahl_sale_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('sahl_sale', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'INV-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sahl_quote_number()
RETURNS varchar(30)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_seq integer;
BEGIN
  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('sahl_quote', EXTRACT(YEAR FROM now())::int, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN 'QUO-' || EXTRACT(YEAR FROM now())::int::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- 4. Tables ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sahl_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  kind varchar(10) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'posted',
  customer_id uuid REFERENCES public.customers (id),
  store_id uuid NOT NULL REFERENCES public.sahl_stores (id),
  cash_treasury_id uuid REFERENCES public.sahl_treasuries (id),
  card_treasury_id uuid REFERENCES public.sahl_treasuries (id),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  additions_amount numeric(12,2) NOT NULL DEFAULT 0,
  additions_type text,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  grand_total numeric(12,2) NOT NULL DEFAULT 0,
  paid_cash numeric(12,2) NOT NULL DEFAULT 0,
  paid_card numeric(12,2) NOT NULL DEFAULT 0,
  paid_credit numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  reserve_stock boolean NOT NULL DEFAULT false,
  source_quote_id uuid,
  created_by uuid NOT NULL REFERENCES public.employees (id),
  posted_at timestamptz,
  voided_by uuid REFERENCES public.employees (id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sahl_invoices_code UNIQUE (code),
  CONSTRAINT ck_sahl_invoices_kind CHECK (kind IN ('sale', 'quote')),
  CONSTRAINT ck_sahl_invoices_status CHECK (
    (kind = 'sale'   AND status IN ('posted', 'voided')) OR
    (kind = 'quote'  AND status IN ('open', 'converted', 'cancelled'))
  ),
  CONSTRAINT ck_sahl_invoices_discount CHECK (discount_amount >= 0 AND subtotal - discount_amount >= 0),
  CONSTRAINT ck_sahl_invoices_additions CHECK (additions_amount >= 0),
  CONSTRAINT ck_sahl_invoices_tax CHECK (tax_amount >= 0),
  CONSTRAINT ck_sahl_invoices_totals CHECK (grand_total >= 0),
  CONSTRAINT ck_sahl_invoices_paid CHECK (
    kind = 'quote' OR (
      paid_cash >= 0 AND paid_card >= 0 AND paid_credit >= 0
      AND paid_cash + paid_card + paid_credit = grand_total
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_sahl_invoices_kind_status ON public.sahl_invoices (kind, status);
CREATE INDEX IF NOT EXISTS idx_sahl_invoices_customer ON public.sahl_invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_sahl_invoices_created ON public.sahl_invoices (created_at);

COMMENT ON TABLE public.sahl_invoices IS 'فواتير البيع وعروض الأسعار (سهل). Sale: atomic stock/money/customer effects. Quote: reservation-only.';
COMMENT ON COLUMN public.sahl_invoices.paid_credit IS 'grand_total - paid_cash - paid_card; requires customer_id when > 0.';

CREATE TABLE IF NOT EXISTS public.sahl_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.sahl_invoices (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  unit_type varchar(10) NOT NULL DEFAULT 'piece',
  unit_label text,
  pieces_per_unit integer NOT NULL DEFAULT 1,
  qty numeric(12,3) NOT NULL,
  qty_pieces numeric(12,3) NOT NULL,
  unit_price numeric(12,4) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT ck_sahl_inv_items_unit CHECK (unit_type IN ('piece', 'dozen', 'carton')),
  CONSTRAINT ck_sahl_inv_items_qty CHECK (qty > 0 AND qty_pieces > 0),
  CONSTRAINT ck_sahl_inv_items_price CHECK (unit_price >= 0 AND line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sahl_inv_items_invoice ON public.sahl_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sahl_inv_items_product ON public.sahl_invoice_items (product_id);

COMMENT ON COLUMN public.sahl_invoice_items.qty IS 'Quantity in the sold unit (piece/dozen/carton).';
COMMENT ON COLUMN public.sahl_invoice_items.qty_pieces IS 'Total pieces = qty * pieces_per_unit; canonical stock dimension.';

CREATE TABLE IF NOT EXISTS public.sahl_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.sahl_invoices (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  store_id uuid NOT NULL REFERENCES public.sahl_stores (id),
  qty_pieces integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sahl_res_qty CHECK (qty_pieces > 0)
);

CREATE INDEX IF NOT EXISTS idx_sahl_res_quote ON public.sahl_stock_reservations (quote_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_sahl_res_product ON public.sahl_stock_reservations (product_id) WHERE active;

COMMENT ON TABLE public.sahl_stock_reservations IS 'حجز البضاعة من عروض الأسعار — informational hold; canonical stock is untouched until conversion.';

-- 5. Internal helpers ------------------------------------------------------------------------

-- Releases (deactivates) a quote's reservations.
CREATE OR REPLACE FUNCTION public._sahl_release_quote_reservations(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.sahl_stock_reservations
  SET active = false, released_at = now()
  WHERE quote_id = p_quote_id AND active;
END;
$$;

-- Applies a posted sale's stock / treasury / customer effects atomically.
-- p_items: jsonb array [{product_id, unit_type, qty, unit_price}]
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
  v_outstanding   numeric(12,2);
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

  IF v_credit > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_REQUIRED_FOR_CREDIT'; END IF;

    -- Open store credit (سهل آجل): account may outlive any formal program.
    -- credit_program_id NULL + zero limit/days = unprogrammed open credit.
    INSERT INTO public.customer_credit_accounts (
      customer_id, outstanding_credit, credit_limit, payment_term_days, activated_by
    )
    VALUES (p_customer_id, 0, 0, 0, p_employee_id)
    ON CONFLICT (customer_id) DO NOTHING;

    SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
    FROM public.customer_credit_accounts WHERE customer_id = p_customer_id FOR UPDATE;

    v_new_out := v_outstanding + v_credit;
    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_out, updated_at = now()
    WHERE customer_id = p_customer_id;

    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      p_customer_id, 'debit', v_credit, v_new_out,
      'sahl_invoice', p_invoice_id,
      'فاتورة بيع آجل ' || p_doc_code, p_employee_id
    );
  END IF;

  UPDATE public.sahl_invoices SET paid_credit = v_credit, updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

-- 6. sahl_create_invoice ---------------------------------------------------------------
-- p_kind: 'sale' | 'quote'

CREATE OR REPLACE FUNCTION public.sahl_create_invoice(
  p_token text,
  p_kind text,
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,
  p_additions_amount numeric DEFAULT 0,
  p_additions_type text DEFAULT NULL,
  p_tax_amount numeric DEFAULT 0,
  p_paid_cash numeric DEFAULT 0,
  p_paid_card numeric DEFAULT 0,
  p_cash_treasury_id uuid DEFAULT NULL,
  p_card_treasury_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reserve_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session   app.sessions;
  v_id        uuid;
  v_code      varchar(30);
  v_store     uuid;
  v_cash_tr   uuid;
  v_card_tr   uuid;
  v_subtotal  numeric(12,2) := 0;
  v_disc      numeric(12,2) := COALESCE(p_discount_amount, 0);
  v_adds      numeric(12,2) := COALESCE(p_additions_amount, 0);
  v_tax       numeric(12,2) := COALESCE(p_tax_amount, 0);
  v_grand     numeric(12,2);
  v_cash      numeric(12,2) := COALESCE(p_paid_cash, 0);
  v_card      numeric(12,2) := COALESCE(p_paid_card, 0);
  r           record;
  v_ppu       integer;
  v_cq        integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.manage');
  END IF;

  IF p_kind NOT IN ('sale', 'quote') THEN RETURN jsonb_build_object('error', 'INVALID_KIND'); END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('error', 'NO_ITEMS');
  END IF;
  IF v_disc < 0 OR v_adds < 0 OR v_tax < 0 THEN RETURN jsonb_build_object('error', 'INVALID_ADJUSTMENT'); END IF;
  IF v_cash < 0 OR v_card < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PAYMENT'); END IF;

  -- defaults from settings (real consumption of sahl_settings)
  v_store := p_store_id;
  IF v_store IS NULL THEN
    SELECT id INTO v_store FROM public.sahl_stores s
    WHERE s.code = COALESCE(NULLIF((SELECT value #>> '{}' FROM public.sahl_settings WHERE key = 'default_store_code'), ''), 'MAIN');
  END IF;
  IF v_store IS NULL THEN
    SELECT id INTO v_store FROM public.sahl_stores WHERE code = 'MAIN';
  END IF;
  IF v_store IS NULL THEN RETURN jsonb_build_object('error', 'NO_STORE'); END IF;

  IF p_cash_treasury_id IS NOT NULL THEN
    v_cash_tr := p_cash_treasury_id;
  ELSE
    SELECT id INTO v_cash_tr FROM public.sahl_treasuries t
    WHERE t.code = COALESCE(NULLIF((SELECT value #>> '{}' FROM public.sahl_settings WHERE key = 'default_drawer_code'), ''), 'MAIN');
  END IF;
  v_card_tr := p_card_treasury_id;

  -- pre-compute totals for validation
  FOR r IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, unit_type text, qty numeric, unit_price numeric)
  LOOP
    IF r.product_id IS NULL OR r.qty IS NULL OR r.qty <= 0 THEN RETURN jsonb_build_object('error', 'BAD_ITEM'); END IF;
    SELECT carton_quantity INTO v_cq FROM public.products WHERE id = r.product_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND'); END IF;
    v_ppu := CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 12 WHEN 'carton' THEN v_cq ELSE 1 END;
    v_subtotal := v_subtotal + ROUND(r.qty * COALESCE(r.unit_price,0), 2);
  END LOOP;
  v_subtotal := ROUND(v_subtotal, 2);
  IF v_disc > v_subtotal THEN RETURN jsonb_build_object('error', 'DISCOUNT_EXCEEDS_SUBTOTAL'); END IF;
  v_grand := ROUND(v_subtotal - v_disc + v_adds + v_tax, 2);
  IF v_cash + v_card > v_grand THEN RETURN jsonb_build_object('error', 'PAID_EXCEEDS_TOTAL'); END IF;
  IF v_cash > 0 AND v_cash_tr IS NULL THEN RETURN jsonb_build_object('error', 'CASH_TREASURY_REQUIRED'); END IF;
  IF v_card > 0 AND v_card_tr IS NULL THEN RETURN jsonb_build_object('error', 'CARD_TREASURY_REQUIRED'); END IF;
  IF v_cash + v_card < v_grand AND p_customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'CUSTOMER_REQUIRED_FOR_CREDIT');
  END IF;

  INSERT INTO public.sahl_invoices (
    code, kind, status, customer_id, store_id, cash_treasury_id, card_treasury_id,
    subtotal, discount_amount, additions_amount, additions_type, tax_amount, grand_total,
    paid_cash, paid_card, paid_credit, notes, reserve_stock, created_by, posted_at
  ) VALUES (
    CASE WHEN p_kind = 'sale' THEN public.generate_sahl_sale_number() ELSE public.generate_sahl_quote_number() END,
    p_kind,
    CASE WHEN p_kind = 'sale' THEN 'posted' ELSE 'open' END,
    p_customer_id, v_store, v_cash_tr, v_card_tr,
    v_subtotal, v_disc, v_adds, NULLIF(btrim(COALESCE(p_additions_type,'')),''), v_tax, v_grand,
    CASE WHEN p_kind = 'sale' THEN v_cash ELSE 0 END,
    CASE WHEN p_kind = 'sale' THEN v_card ELSE 0 END,
    CASE WHEN p_kind = 'sale' THEN ROUND(v_grand - v_cash - v_card, 2) ELSE 0 END,
    NULLIF(btrim(COALESCE(p_notes,'')),''), COALESCE(p_reserve_stock,false), v_session.employee_id,
    CASE WHEN p_kind = 'sale' THEN now() ELSE NULL END
  )
  RETURNING id, code INTO v_id, v_code;

  IF p_kind = 'sale' THEN
    PERFORM public._sahl_post_invoice_core(
      v_id, v_store, v_cash_tr, v_card_tr, p_items, p_customer_id, v_session.employee_id, v_code);
  ELSE
    -- quote: price the lines only (no money / no stock movement)
    PERFORM set_config('app.sahl_store_guard', 'sahl', true);
    FOR r IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, unit_type text, qty numeric, unit_price numeric)
    LOOP
      SELECT carton_quantity INTO v_cq FROM public.products WHERE id = r.product_id;
      v_ppu := CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 12 WHEN 'carton' THEN v_cq ELSE 1 END;
      INSERT INTO public.sahl_invoice_items (
        invoice_id, product_id, unit_type, unit_label, pieces_per_unit,
        qty, qty_pieces, unit_price, line_total
      ) VALUES (
        v_id, r.product_id, COALESCE(r.unit_type,'piece'),
        CASE COALESCE(r.unit_type,'piece') WHEN 'dozen' THEN 'دستة' WHEN 'carton' THEN 'كرتونة' ELSE 'قطعة' END,
        v_ppu, r.qty, r.qty * v_ppu, COALESCE(r.unit_price,0), ROUND(r.qty * COALESCE(r.unit_price,0), 2)
      );
    END LOOP;

    IF COALESCE(p_reserve_stock, false) THEN
      IF p_customer_id IS NULL THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_REQUIRED_FOR_RESERVATION');
      END IF;
      INSERT INTO public.sahl_stock_reservations (quote_id, product_id, store_id, qty_pieces)
      SELECT v_id, product_id, v_store, CEIL(qty_pieces)::int
      FROM public.sahl_invoice_items WHERE invoice_id = v_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code, 'kind', p_kind,
                            'grand_total', v_grand, 'subtotal', v_subtotal);
END;
$$;

-- 7. sahl_convert_quote --------------------------------------------------------------------
-- Converts an open quote into a posted sale using its own priced lines.

CREATE OR REPLACE FUNCTION public.sahl_convert_quote(
  p_token text,
  p_quote_id uuid,
  p_paid_cash numeric DEFAULT 0,
  p_paid_card numeric DEFAULT 0,
  p_cash_treasury_id uuid DEFAULT NULL,
  p_card_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session  app.sessions;
  v_q        public.sahl_invoices;
  v_id       uuid;
  v_code     varchar(30);
  v_cash     numeric(12,2) := COALESCE(p_paid_cash, 0);
  v_card     numeric(12,2) := COALESCE(p_paid_card, 0);
  v_items    jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.manage');
  END IF;

  SELECT * INTO v_q FROM public.sahl_invoices WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_q.kind != 'quote' THEN RETURN jsonb_build_object('error', 'NOT_A_QUOTE'); END IF;
  IF v_q.status != 'open' THEN RETURN jsonb_build_object('error', 'QUOTE_NOT_OPEN'); END IF;

  IF v_cash < 0 OR v_card < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PAYMENT'); END IF;
  IF v_cash + v_card > v_q.grand_total THEN RETURN jsonb_build_object('error', 'PAID_EXCEEDS_TOTAL'); END IF;
  IF v_cash > 0 AND COALESCE(p_cash_treasury_id, v_q.cash_treasury_id) IS NULL THEN
    RETURN jsonb_build_object('error', 'CASH_TREASURY_REQUIRED');
  END IF;
  IF v_card > 0 AND COALESCE(p_card_treasury_id, v_q.card_treasury_id) IS NULL THEN
    RETURN jsonb_build_object('error', 'CARD_TREASURY_REQUIRED');
  END IF;
  IF v_cash + v_card < v_q.grand_total AND v_q.customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'CUSTOMER_REQUIRED_FOR_CREDIT');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', it.product_id, 'unit_type', it.unit_type,
           'qty', it.qty, 'unit_price', it.unit_price)), '[]'::jsonb)
    INTO v_items
  FROM public.sahl_invoice_items it WHERE it.invoice_id = p_quote_id;

  INSERT INTO public.sahl_invoices (
    code, kind, status, customer_id, store_id, cash_treasury_id, card_treasury_id,
    subtotal, discount_amount, additions_amount, additions_type, tax_amount, grand_total,
    paid_cash, paid_card, paid_credit, notes, source_quote_id, created_by, posted_at
  ) VALUES (
    public.generate_sahl_sale_number(), 'sale', 'posted',
    v_q.customer_id, v_q.store_id,
    COALESCE(p_cash_treasury_id, v_q.cash_treasury_id),
    COALESCE(p_card_treasury_id, v_q.card_treasury_id),
    v_q.subtotal, v_q.discount_amount, v_q.additions_amount, v_q.additions_type,
    v_q.tax_amount, v_q.grand_total, v_cash, v_card,
    ROUND(v_q.grand_total - v_cash - v_card, 2),
    'تحويل من عرض سعر ' || v_q.code, p_quote_id, v_session.employee_id, now()
  )
  RETURNING id, code INTO v_id, v_code;

  PERFORM public._sahl_post_invoice_core(
    v_id, v_q.store_id,
    COALESCE(p_cash_treasury_id, v_q.cash_treasury_id),
    COALESCE(p_card_treasury_id, v_q.card_treasury_id),
    v_items, v_q.customer_id, v_session.employee_id, v_code);

  UPDATE public.sahl_invoices SET status = 'converted', updated_at = now()
  WHERE id = p_quote_id;

  PERFORM public._sahl_release_quote_reservations(p_quote_id);

  RETURN jsonb_build_object('success', true, 'invoice_id', v_id, 'invoice_code', v_code,
                            'quote_code', v_q.code);
END;
$$;

-- 8. sahl_cancel_quote -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cancel_quote(
  p_token text,
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_q public.sahl_invoices;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.manage');
  END IF;

  SELECT * INTO v_q FROM public.sahl_invoices WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_q.kind != 'quote' OR v_q.status != 'open' THEN RETURN jsonb_build_object('error', 'QUOTE_NOT_OPEN'); END IF;

  UPDATE public.sahl_invoices SET status = 'cancelled', updated_at = now() WHERE id = p_quote_id;
  PERFORM public._sahl_release_quote_reservations(p_quote_id);

  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$;

-- 9. sahl_void_invoice --------------------------------------------------------------------------
-- Full reversal of a posted sale: stock back, customer balance restored,
-- treasury outflow legs (distinct reference types keep the unique index happy).

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
  v_out     numeric(12,2);
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

  -- customer balance restoration
  IF v_inv.paid_credit > 0 AND v_inv.customer_id IS NOT NULL THEN
    SELECT COALESCE(outstanding_credit, 0) INTO v_out
    FROM public.customer_credit_accounts WHERE customer_id = v_inv.customer_id FOR UPDATE;

    v_new_out := v_out - v_inv.paid_credit;
    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_out, updated_at = now()
    WHERE customer_id = v_inv.customer_id;

    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount, running_balance,
      reference_type, reference_id, notes, created_by
    ) VALUES (
      v_inv.customer_id, 'credit', v_inv.paid_credit, v_new_out,
      'sahl_invoice', p_invoice_id,
      'إلغاء فاتورة بيع ' || v_inv.code, v_session.employee_id
    );
  END IF;

  UPDATE public.sahl_invoices SET
    status = 'voided', voided_by = v_session.employee_id, voided_at = now(),
    void_reason = NULLIF(btrim(COALESCE(p_reason,'')), ''), updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('success', true, 'code', v_inv.code, 'status', 'voided');
END;
$$;

-- 10. Read RPCs -----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_invoices(
  p_token text,
  p_kind text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
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
  IF NOT public.check_capability(p_token, 'sahl.sales.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT v.id, v.code, v.kind, v.status, v.customer_id,
           c.company_name AS customer_name,
           st.name AS store_name, st.id AS store_id,
           tr1.name AS cash_treasury_name, tr2.name AS card_treasury_name,
           v.subtotal, v.discount_amount, v.additions_amount, v.additions_type,
           v.tax_amount, v.grand_total,
           v.paid_cash, v.paid_card, v.paid_credit,
           v.notes, v.reserve_stock, v.source_quote_id,
           v.posted_at, v.voided_at, v.void_reason,
           e.full_name AS created_by_name,
           v.created_at,
           (SELECT count(*)::int FROM public.sahl_invoice_items x WHERE x.invoice_id = v.id) AS lines_count
    FROM public.sahl_invoices v
    LEFT JOIN public.customers c ON c.id = v.customer_id
    LEFT JOIN public.sahl_stores st ON st.id = v.store_id
    LEFT JOIN public.sahl_treasuries tr1 ON tr1.id = v.cash_treasury_id
    LEFT JOIN public.sahl_treasuries tr2 ON tr2.id = v.card_treasury_id
    LEFT JOIN public.employees e ON e.id = v.created_by
    WHERE (p_kind IS NULL OR v.kind = p_kind)
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_from IS NULL OR v.created_at >= p_from::timestamptz)
      AND (p_to IS NULL OR v.created_at < (p_to + 1)::timestamptz)
      AND (NULLIF(btrim(COALESCE(p_search,'')),'') IS NULL
           OR v.code ILIKE '%' || btrim(p_search) || '%'
           OR COALESCE(c.company_name,'') ILIKE '%' || btrim(p_search) || '%')
  ) t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_invoice_items(
  p_token text,
  p_invoice_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.sales.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.product_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT it.id, it.product_id, p.product_name, COALESCE(p.legacy_code,'') AS legacy_code,
           it.unit_type, it.unit_label, it.pieces_per_unit,
           it.qty, it.qty_pieces, it.unit_price, it.line_total
    FROM public.sahl_invoice_items it
    JOIN public.products p ON p.id = it.product_id
    WHERE it.invoice_id = p_invoice_id
  ) t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sahl_get_quote_reservations(
  p_token text,
  p_quote_id uuid
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
  IF NOT public.check_capability(p_token, 'sahl.sales.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_result
  FROM (
    SELECT rs.id, rs.product_id, p.product_name, rs.qty_pieces, rs.active, rs.released_at, rs.created_at
    FROM public.sahl_stock_reservations rs
    JOIN public.products p ON p.id = rs.product_id
    WHERE rs.quote_id = p_quote_id
  ) t;

  RETURN v_result;
END;
$$;

-- 11. Grants & schema reload -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_create_invoice(text, text, jsonb, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_convert_quote(text, uuid, numeric, numeric, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cancel_quote(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_void_invoice(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_invoices(text, text, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_invoice_items(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_quote_reservations(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL المبيعات Module (Stage 10)
-- ============================================================================
