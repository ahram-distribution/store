-- ============================================================================
-- Migration: Credit Collection Runtime (تحصيل الائتمان) — for ittiman orders
--
-- Self-contained runtime for ائتمان (ittiman) orders:
--   * credit_collection_invoices  — per-order credit info (due date / cheque)
--                                   entered by the collector, then LOCKED;
--                                   only upper management can edit afterwards.
--   * credit_collection_requests  — collection requests recorded in the field
--                                   with GPS; they do NOT reduce the balance
--                                   until approved by upper management.
--
-- Statuses (approved business values, no new enums introduced):
--   * request status  : pending | approved | rejected
--   * credit status   : uncollected | partially_collected | fully_collected
--
-- Role-based authorization:
--   * Collector role name: معتمد ائتماني (real role in public.roles).
--   * Upper management = the SAME role names the current application already
--     treats as Upper Management (both the app's recognized roles and the
--     existing DB super-admin roles used by upper-management RPCs).
-- ============================================================================

-- 0. Helper: is upper management (existing role names only) -------------------

CREATE OR REPLACE FUNCTION public.is_upper_management_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_employee_id
    AND r.name IN (
      'الإدارة العليا', 'الرئيس التنفيذي', 'executive_director',
      'سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن'
    )
  )
$$;

-- 1. Helper: is credit collector (معتمد ائتماني) -----------------------------

CREATE OR REPLACE FUNCTION public.is_credit_collector_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_employee_id AND r.name = 'معتمد ائتماني'
  )
$$;

-- 2. credit_collection_invoices ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_collection_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL UNIQUE,
    customer_id uuid NOT NULL,
    invoice_amount decimal(12,2) NOT NULL,
    collected_amount decimal(12,2) NOT NULL DEFAULT 0,
    due_date date,
    check_number varchar(100),
    bank_name varchar(255),
    check_holder varchar(255),
    notes text,
    credit_status varchar(30) NOT NULL DEFAULT 'uncollected',
    info_locked boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_collection_invoices DROP CONSTRAINT IF EXISTS fk_cci_order;
ALTER TABLE public.credit_collection_invoices ADD CONSTRAINT fk_cci_order FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE public.credit_collection_invoices DROP CONSTRAINT IF EXISTS fk_cci_customer;
ALTER TABLE public.credit_collection_invoices ADD CONSTRAINT fk_cci_customer FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE public.credit_collection_invoices DROP CONSTRAINT IF EXISTS fk_cci_created_by;
ALTER TABLE public.credit_collection_invoices ADD CONSTRAINT fk_cci_created_by FOREIGN KEY (created_by) REFERENCES employees (id);
ALTER TABLE public.credit_collection_invoices DROP CONSTRAINT IF EXISTS ck_cci_amounts;
ALTER TABLE public.credit_collection_invoices ADD CONSTRAINT ck_cci_amounts
    CHECK (invoice_amount >= 0 AND collected_amount >= 0 AND collected_amount <= invoice_amount);
ALTER TABLE public.credit_collection_invoices DROP CONSTRAINT IF EXISTS ck_cci_status;
ALTER TABLE public.credit_collection_invoices ADD CONSTRAINT ck_cci_status
    CHECK (credit_status IN ('uncollected', 'partially_collected', 'fully_collected'));

CREATE INDEX IF NOT EXISTS idx_cci_order_id ON public.credit_collection_invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_cci_customer_id ON public.credit_collection_invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_cci_status ON public.credit_collection_invoices (credit_status);

COMMENT ON TABLE public.credit_collection_invoices IS 'بيانات الائتمان لكل طلب ائتمان (ittiman) بعد تسليمه — تُقفل بعد أول حفظ ولا يعدلها إلا الإدارة العليا';

-- 3. credit_collection_requests ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_collection_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    collected_at timestamptz NOT NULL DEFAULT now(),
    latitude numeric(10,7),
    longitude numeric(10,7),
    collector_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    notes text,
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_collection_requests DROP CONSTRAINT IF EXISTS fk_ccr_invoice;
ALTER TABLE public.credit_collection_requests ADD CONSTRAINT fk_ccr_invoice
    FOREIGN KEY (invoice_id) REFERENCES public.credit_collection_invoices (id);
ALTER TABLE public.credit_collection_requests DROP CONSTRAINT IF EXISTS fk_ccr_collector;
ALTER TABLE public.credit_collection_requests ADD CONSTRAINT fk_ccr_collector
    FOREIGN KEY (collector_id) REFERENCES employees (id);
ALTER TABLE public.credit_collection_requests DROP CONSTRAINT IF EXISTS fk_ccr_decided_by;
ALTER TABLE public.credit_collection_requests ADD CONSTRAINT fk_ccr_decided_by
    FOREIGN KEY (decided_by) REFERENCES employees (id);
ALTER TABLE public.credit_collection_requests DROP CONSTRAINT IF EXISTS ck_ccr_amount;
ALTER TABLE public.credit_collection_requests ADD CONSTRAINT ck_ccr_amount
    CHECK (amount > 0);
ALTER TABLE public.credit_collection_requests DROP CONSTRAINT IF EXISTS ck_ccr_status;
ALTER TABLE public.credit_collection_requests ADD CONSTRAINT ck_ccr_status
    CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_ccr_invoice_id ON public.credit_collection_requests (invoice_id);
CREATE INDEX IF NOT EXISTS idx_ccr_status ON public.credit_collection_requests (status);
CREATE INDEX IF NOT EXISTS idx_ccr_collector_id ON public.credit_collection_requests (collector_id);

COMMENT ON TABLE public.credit_collection_requests IS 'طلبات تحصيل الائتمان — لا تنقص الرصيد حتى يعتمدها الإدارة العليا';

-- 4. get_credit_collection_invoices ------------------------------------------
-- Collector view: ittiman + delivered invoices with credit info / balances.

DROP FUNCTION IF EXISTS public.get_credit_collection_invoices(text);

CREATE OR REPLACE FUNCTION public.get_credit_collection_invoices(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_allowed boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_credit_collector_employee(v_session.employee_id)
      OR public.is_upper_management_employee(v_session.employee_id)
  INTO v_allowed;
  IF NOT v_allowed THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.due_order ASC, sub.order_number ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      o.id AS order_id,
      ci.id AS invoice_id,
      o.order_number,
      o.reference_number,
      o.customer_id,
      c.company_name AS customer_name,
      COALESCE(NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''), o.snapshot_customer_address) AS address,
      COALESCE(o.snapshot_customer_phone, cc.phone, i.phone) AS phone,
      ca.latitude AS location_latitude,
      ca.longitude AS location_longitude,
      o.total_amount AS invoice_amount,
      COALESCE(ci.collected_amount, 0) AS collected_amount,
      GREATEST(0, o.total_amount - COALESCE(ci.collected_amount, 0)) AS balance,
      ci.due_date,
      ci.check_number,
      ci.bank_name,
      ci.check_holder,
      ci.notes,
      COALESCE(ci.credit_status, 'uncollected') AS credit_status,
      COALESCE(ci.info_locked, false) AS info_locked,
      o.delivered_at,
      CASE WHEN ci.due_date IS NOT NULL AND ci.due_date < CURRENT_DATE
           AND GREATEST(0, o.total_amount - COALESCE(ci.collected_amount, 0)) > 0
      THEN true ELSE false END AS overdue,
      COALESCE((
        SELECT SUM(r.amount) FROM public.credit_collection_requests r
        JOIN public.credit_collection_invoices ci2 ON ci2.id = r.invoice_id
        WHERE ci2.order_id = o.id AND r.status = 'pending'
      ), 0) AS pending_amount,
      COALESCE((
        SELECT COUNT(*) FROM public.credit_collection_requests r
        JOIN public.credit_collection_invoices ci3 ON ci3.id = r.invoice_id
        WHERE ci3.order_id = o.id AND r.status = 'pending'
      ), 0) AS pending_count,
      COALESCE(ci.due_date, o.delivered_at::date) AS due_order
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.credit_collection_invoices ci ON ci.order_id = o.id
    LEFT JOIN public.customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = true
    LEFT JOIN public.customer_contacts cc ON cc.customer_id = c.id AND cc.is_primary = true
    LEFT JOIN public.identities i ON i.id = c.identity_id
    WHERE o.order_type = 'ittiman' AND o.status = 'delivered'
  ) sub;

  RETURN v_result;
END;
$function$;

-- 5. save_credit_invoice_info -------------------------------------------------
-- Collector enters credit info on a delivered ittiman order (first save). The
-- info is LOCKED after first save; only upper management can edit afterwards.

DROP FUNCTION IF EXISTS public.save_credit_invoice_info(text, uuid, date, varchar, varchar, varchar, text);

CREATE OR REPLACE FUNCTION public.save_credit_invoice_info(
  p_token text,
  p_order_id uuid,
  p_due_date date,
  p_check_number varchar,
  p_bank_name varchar,
  p_check_holder varchar,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_upper boolean;
  v_collector boolean;
  v_invoice public.credit_collection_invoices;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_upper_management_employee(v_session.employee_id) INTO v_upper;
  SELECT public.is_credit_collector_employee(v_session.employee_id) INTO v_collector;
  IF NOT (v_upper OR v_collector) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.order_type <> 'ittiman' THEN RETURN jsonb_build_object('error', 'NOT_ITTIMAN_ORDER'); END IF;
  IF v_order.status <> 'delivered' THEN RETURN jsonb_build_object('error', 'ORDER_NOT_DELIVERED'); END IF;

  SELECT * INTO v_invoice FROM public.credit_collection_invoices WHERE order_id = p_order_id;

  IF NOT FOUND THEN
    INSERT INTO public.credit_collection_invoices (
      order_id, customer_id, invoice_amount, collected_amount,
      due_date, check_number, bank_name, check_holder, notes,
      credit_status, info_locked, created_by
    ) VALUES (
      v_order.id, v_order.customer_id, v_order.total_amount, 0,
      p_due_date, p_check_number, p_bank_name, p_check_holder, p_notes,
      'uncollected', true, v_session.employee_id
    ) RETURNING * INTO v_invoice;
  ELSE
    IF v_invoice.info_locked AND NOT v_upper THEN
      RETURN jsonb_build_object('error', 'INFO_LOCKED');
    END IF;
    UPDATE public.credit_collection_invoices SET
      due_date = COALESCE(p_due_date, due_date),
      check_number = COALESCE(p_check_number, check_number),
      bank_name = COALESCE(p_bank_name, bank_name),
      check_holder = COALESCE(p_check_holder, check_holder),
      notes = COALESCE(p_notes, notes),
      info_locked = true,
      updated_at = now()
    WHERE id = v_invoice.id
    RETURNING * INTO v_invoice;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice.id,
    'order_id', v_invoice.order_id,
    'due_date', v_invoice.due_date,
    'check_number', v_invoice.check_number,
    'bank_name', v_invoice.bank_name,
    'check_holder', v_invoice.check_holder,
    'notes', v_invoice.notes,
    'info_locked', v_invoice.info_locked,
    'credit_status', v_invoice.credit_status
  );
END;
$function$;

-- 6. submit_credit_collection_request -----------------------------------------
-- Collector records a field collection with GPS. Status = pending, the invoice
-- balance is NOT reduced until approved by upper management.

DROP FUNCTION IF EXISTS public.submit_credit_collection_request(text, uuid, numeric, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.submit_credit_collection_request(
  p_token text,
  p_invoice_id uuid,
  p_amount numeric,
  p_latitude numeric,
  p_longitude numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_upper boolean;
  v_collector boolean;
  v_invoice public.credit_collection_invoices;
  v_balance numeric;
  v_request public.credit_collection_requests;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_upper_management_employee(v_session.employee_id) INTO v_upper;
  SELECT public.is_credit_collector_employee(v_session.employee_id) INTO v_collector;
  IF NOT (v_upper OR v_collector) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT * INTO v_invoice FROM public.credit_collection_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVOICE_NOT_FOUND'); END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_AMOUNT');
  END IF;

  v_balance := v_invoice.invoice_amount - v_invoice.collected_amount;
  IF p_amount > v_balance THEN
    RETURN jsonb_build_object('error', 'AMOUNT_EXCEEDS_BALANCE');
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN jsonb_build_object('error', 'GPS_REQUIRED');
  END IF;

  INSERT INTO public.credit_collection_requests (
    invoice_id, amount, collected_at, latitude, longitude, collector_id, status, notes
  ) VALUES (
    v_invoice.id, p_amount, now(), p_latitude, p_longitude, v_session.employee_id, 'pending', p_notes
  ) RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'invoice_id', v_request.invoice_id,
    'amount', v_request.amount,
    'collected_at', v_request.collected_at,
    'latitude', v_request.latitude,
    'longitude', v_request.longitude,
    'status', v_request.status
  );
END;
$function$;

-- 7. decide_credit_collection_request -----------------------------------------
-- Upper management only. Approve reduces the invoice balance and recomputes the
-- credit status. Reject keeps the request in history with no balance change.

DROP FUNCTION IF EXISTS public.decide_credit_collection_request(text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.decide_credit_collection_request(
  p_token text,
  p_request_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_upper boolean;
  v_request public.credit_collection_requests;
  v_invoice public.credit_collection_invoices;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_upper_management_employee(v_session.employee_id) INTO v_upper;
  IF NOT v_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT * INTO v_request FROM public.credit_collection_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'REQUEST_NOT_FOUND'); END IF;
  IF v_request.status <> 'pending' THEN RETURN jsonb_build_object('error', 'ALREADY_DECIDED'); END IF;

  IF p_decision = 'approve' THEN
    SELECT * INTO v_invoice FROM public.credit_collection_invoices WHERE id = v_request.invoice_id;
    IF v_request.amount > (v_invoice.invoice_amount - v_invoice.collected_amount) THEN
      RETURN jsonb_build_object('error', 'AMOUNT_EXCEEDS_BALANCE');
    END IF;

    UPDATE public.credit_collection_requests SET
      status = 'approved', decided_by = v_session.employee_id, decided_at = now(),
      notes = COALESCE(p_notes, notes)
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    UPDATE public.credit_collection_invoices SET
      collected_amount = collected_amount + v_request.amount,
      credit_status = CASE
        WHEN collected_amount + v_request.amount >= invoice_amount THEN 'fully_collected'
        WHEN collected_amount + v_request.amount > 0 THEN 'partially_collected'
        ELSE 'uncollected'
      END,
      updated_at = now()
    WHERE id = v_request.invoice_id
    RETURNING * INTO v_invoice;

    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'invoice_id', v_invoice.id,
      'collected_amount', v_invoice.collected_amount,
      'credit_status', v_invoice.credit_status
    );
  ELSIF p_decision = 'reject' THEN
    UPDATE public.credit_collection_requests SET
      status = 'rejected', decided_by = v_session.employee_id, decided_at = now(),
      notes = COALESCE(p_notes, notes)
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    RETURN jsonb_build_object('request_id', v_request.id, 'status', v_request.status);
  ELSE
    RETURN jsonb_build_object('error', 'INVALID_DECISION');
  END IF;
END;
$function$;

-- 8. get_credit_invoices_management --------------------------------------------
-- Upper management screen: pending requests, invoice monitoring, summary and
-- permanent collection history.

DROP FUNCTION IF EXISTS public.get_credit_invoices_management(text);

CREATE OR REPLACE FUNCTION public.get_credit_invoices_management(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_upper boolean;
  v_invoices jsonb;
  v_pending jsonb;
  v_history jsonb;
  v_summary jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_upper_management_employee(v_session.employee_id) INTO v_upper;
  IF NOT v_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.due_date ASC NULLS LAST), '[]'::jsonb)
  INTO v_invoices
  FROM (
    SELECT
      ci.id AS invoice_id,
      ci.order_id,
      o.order_number,
      o.customer_id,
      c.company_name AS customer_name,
      ci.invoice_amount,
      ci.collected_amount,
      GREATEST(0, ci.invoice_amount - ci.collected_amount) AS balance,
      ci.due_date,
      ci.check_number,
      ci.bank_name,
      ci.check_holder,
      ci.notes,
      ci.credit_status,
      ci.info_locked,
      o.delivered_at,
      CASE WHEN ci.due_date < CURRENT_DATE AND GREATEST(0, ci.invoice_amount - ci.collected_amount) > 0
      THEN true ELSE false END AS overdue
    FROM public.credit_collection_invoices ci
    JOIN public.orders o ON o.id = ci.order_id
    JOIN public.customers c ON c.id = ci.customer_id
  ) sub;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.created_at ASC), '[]'::jsonb)
  INTO v_pending
  FROM (
    SELECT
      r.id AS request_id,
      r.invoice_id,
      o.id AS order_id,
      o.order_number,
      c.company_name AS customer_name,
      r.amount,
      r.collected_at,
      r.latitude,
      r.longitude,
      r.notes,
      e.full_name AS collector_name,
      r.created_at
    FROM public.credit_collection_requests r
    JOIN public.credit_collection_invoices ci ON ci.id = r.invoice_id
    JOIN public.orders o ON o.id = ci.order_id
    JOIN public.customers c ON c.id = ci.customer_id
    JOIN public.employees e ON e.id = r.collector_id
    WHERE r.status = 'pending'
  ) sub;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.decided_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT
      r.id AS request_id,
      r.invoice_id,
      o.order_number,
      c.company_name AS customer_name,
      r.amount,
      r.collected_at,
      r.status,
      r.notes,
      e.full_name AS collector_name,
      d.full_name AS decided_by_name,
      r.decided_at
    FROM public.credit_collection_requests r
    JOIN public.credit_collection_invoices ci ON ci.id = r.invoice_id
    JOIN public.orders o ON o.id = ci.order_id
    JOIN public.customers c ON c.id = ci.customer_id
    JOIN public.employees e ON e.id = r.collector_id
    LEFT JOIN public.employees d ON d.id = r.decided_by
    WHERE r.status IN ('approved', 'rejected')
  ) sub;

  SELECT jsonb_build_object(
    'collected_today', COALESCE((
      SELECT SUM(r.amount) FROM public.credit_collection_requests r
      WHERE r.status = 'approved' AND r.decided_at >= CURRENT_DATE
    ), 0),
    'outstanding', COALESCE((
      SELECT SUM(GREATEST(0, ci.invoice_amount - ci.collected_amount))
      FROM public.credit_collection_invoices ci
    ), 0),
    'overdue_count', (
      SELECT COUNT(*) FROM public.credit_collection_invoices ci
      WHERE ci.due_date < CURRENT_DATE
        AND GREATEST(0, ci.invoice_amount - ci.collected_amount) > 0
    ),
    'total_invoices', (SELECT COUNT(*) FROM public.credit_collection_invoices ci),
    'fully_collected_count', (
      SELECT COUNT(*) FROM public.credit_collection_invoices ci
      WHERE ci.credit_status = 'fully_collected'
    ),
    'pending_requests', (SELECT COUNT(*) FROM public.credit_collection_requests r WHERE r.status = 'pending')
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'invoices', v_invoices,
    'pending_requests', v_pending,
    'summary', v_summary,
    'history', v_history
  );
END;
$function$;

-- 9. get_credit_collection_history ---------------------------------------------
-- Collector / upper management: permanent per-invoice collection history with
-- amount, date/time, status, collector and approver names.

DROP FUNCTION IF EXISTS public.get_credit_collection_history(text, uuid);

CREATE OR REPLACE FUNCTION public.get_credit_collection_history(p_token text, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_allowed boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type <> 'employee' OR v_session.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT public.is_credit_collector_employee(v_session.employee_id)
      OR public.is_upper_management_employee(v_session.employee_id)
  INTO v_allowed;
  IF NOT v_allowed THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.collected_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      r.id AS request_id,
      r.invoice_id,
      o.order_number,
      c.company_name AS customer_name,
      r.amount,
      r.collected_at,
      r.status,
      r.notes,
      e.full_name AS collector_name,
      d.full_name AS decided_by_name,
      r.decided_at,
      r.latitude,
      r.longitude
    FROM public.credit_collection_requests r
    JOIN public.credit_collection_invoices ci ON ci.id = r.invoice_id
    JOIN public.orders o ON o.id = ci.order_id
    JOIN public.customers c ON c.id = ci.customer_id
    JOIN public.employees e ON e.id = r.collector_id
    LEFT JOIN public.employees d ON d.id = r.decided_by
    WHERE ci.order_id = p_order_id
  ) sub;

  RETURN v_result;
END;
$function$;
