-- ============================================================================
-- SAHL MODULE — التقارير المالية والتشغيلية (Financial & Operational Reports)
-- Stage 8
-- Read-only reporting layer over the canonical structures populated by the
-- سهل modules and AHRAM operations:
--
--   Daily report    → SAHL report-daily equivalent: sales of the day,
--     treasury movements by source (opening / in / out / closing).
--   Financial summary → cash flow by reference type over a range plus
--     balance-sheet style positions: receivables, payables, inventory value,
--     installment backlog, open cheques.
--   Top customers / products → operational rankings over a period using the
--     canonical statistics filter is_order_in_statistics().
--
-- All functions are STABLE and never mutate data.
-- ============================================================================

-- 1. Capability -----------------------------------------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.reports.read', 'عرض التقارير المالية والتشغيلية — سهل')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'الإدارة العليا';
  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role الإدارة العليا not found — capability grant skipped';
    RETURN;
  END IF;

  INSERT INTO public.role_capabilities (role_id, capability_id)
  SELECT v_role_id, c.id
  FROM public.capabilities c
  WHERE c.code = 'sahl.reports.read'
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. sahl_get_daily_report ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_daily_report(
  p_token text,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.reports.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.reports.read');
  END IF;

  RETURN jsonb_build_object(
    'date', p_date,

    -- Sales of the day (canonical statistics filter)
    'sales', (
      SELECT jsonb_build_object(
        'orders_count', count(*),
        'total', COALESCE(SUM(o.total_amount), 0))
      FROM public.orders o
      WHERE o.created_at::date = p_date
        AND public.is_order_in_statistics(o.status)
    ),

    -- Treasury: opening balance before the day, then movement within it
    'opening_balance', COALESCE((
      SELECT SUM(CASE WHEN transaction_type = 'inflow' THEN amount ELSE -amount END)
      FROM public.treasury_transactions
      WHERE created_at < p_date::timestamptz
    ), 0),

    'treasury_by_source', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.reference_type), '[]'::jsonb)
      FROM (
        SELECT t.reference_type,
               SUM(CASE WHEN t.transaction_type = 'inflow' THEN t.amount ELSE 0 END) AS inflow,
               SUM(CASE WHEN t.transaction_type = 'outflow' THEN t.amount ELSE 0 END) AS outflow,
               count(*) AS movements
        FROM public.treasury_transactions t
        WHERE t.created_at::date = p_date
        GROUP BY t.reference_type
      ) t
    ),

    'inflow_total', COALESCE((
      SELECT SUM(amount) FROM public.treasury_transactions
      WHERE transaction_type = 'inflow' AND created_at::date = p_date
    ), 0),

    'outflow_total', COALESCE((
      SELECT SUM(amount) FROM public.treasury_transactions
      WHERE transaction_type = 'outflow' AND created_at::date = p_date
    ), 0),

    -- Operational counts of documents raised during the day
    'collections_count', (SELECT count(*)::int FROM public.collections
      WHERE created_at::date = p_date AND status = 'treasury_posted'),
    'expenses_count', (SELECT count(*)::int FROM public.expenses
      WHERE created_at::date = p_date),
    'purchases_count', (SELECT count(*)::int FROM public.purchases
      WHERE created_at::date = p_date AND status = 'treasury_posted'),
    'sales_returns_count', (SELECT count(*)::int FROM public.returns
      WHERE created_at::date = p_date),
    'purchase_returns_count', (SELECT count(*)::int FROM public.purchase_returns
      WHERE created_at::date = p_date),
    'advances_count', (SELECT count(*)::int FROM public.employee_advances
      WHERE created_at::date = p_date),

    -- Cheques settled during the day
    'cheques_cleared_in', COALESCE((SELECT SUM(amount) FROM public.sahl_cheques
      WHERE direction = 'incoming' AND status = 'cleared' AND cleared_at::date = p_date), 0),
    'cheques_cleared_out', COALESCE((SELECT SUM(amount) FROM public.sahl_cheques
      WHERE direction = 'outgoing' AND status = 'cleared' AND cleared_at::date = p_date), 0)
  );
END;
$$;

-- 3. sahl_get_financial_summary --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_financial_summary(
  p_token text,
  p_from date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.reports.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.reports.read');
  END IF;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,

    -- Cash flow across the period
    'inflow_total', COALESCE((
      SELECT SUM(amount) FROM public.treasury_transactions
      WHERE transaction_type = 'inflow' AND created_at::date BETWEEN p_from AND p_to
    ), 0),
    'outflow_total', COALESCE((
      SELECT SUM(amount) FROM public.treasury_transactions
      WHERE transaction_type = 'outflow' AND created_at::date BETWEEN p_from AND p_to
    ), 0),

    'treasury_by_source', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.inflow + t.outflow DESC), '[]'::jsonb)
      FROM (
        SELECT t.reference_type,
               SUM(CASE WHEN t.transaction_type = 'inflow' THEN t.amount ELSE 0 END) AS inflow,
               SUM(CASE WHEN t.transaction_type = 'outflow' THEN t.amount ELSE 0 END) AS outflow
        FROM public.treasury_transactions t
        WHERE t.created_at::date BETWEEN p_from AND p_to
        GROUP BY t.reference_type
      ) t
    ),

    'sales_total', COALESCE((
      SELECT SUM(o.total_amount) FROM public.orders o
      WHERE o.created_at::date BETWEEN p_from AND p_to
        AND public.is_order_in_statistics(o.status)
    ), 0),
    'orders_count', (
      SELECT count(*)::int FROM public.orders o
      WHERE o.created_at::date BETWEEN p_from AND p_to
        AND public.is_order_in_statistics(o.status)
    ),
    'expenses_total', COALESCE((
      SELECT SUM(e.amount) FROM public.expenses e
      WHERE e.created_at::date BETWEEN p_from AND p_to
    ), 0),

    -- Positions (as of "to" date)
    'receivables', COALESCE((
      SELECT SUM(a.outstanding_credit) FROM public.customer_credit_accounts a
    ), 0),
    'payables', COALESCE((
      SELECT SUM(a.outstanding_credit) FROM public.supplier_credit_accounts a
    ), 0),
    'inventory_value', COALESCE((
      SELECT SUM(i.quantity * COALESCE(p.avg_cost, 0))
      FROM public.inventory i JOIN public.products p ON p.id = i.product_id
    ), 0),
    'installments_outstanding', COALESCE((
      SELECT SUM(pl.total_amount - pl.paid_total) FROM public.sahl_installment_plans pl
      WHERE pl.status = 'active'
    ), 0),
    'installments_overdue_parts', (
      SELECT count(*)::int FROM public.sahl_installment_parts pt
      JOIN public.sahl_installment_plans pl ON pl.id = pt.plan_id
      WHERE pl.status = 'active' AND pt.paid_amount < pt.amount AND pt.due_date < CURRENT_DATE
    ),
    'cheques_incoming_open', COALESCE((
      SELECT SUM(q.amount) FROM public.sahl_cheques q
      WHERE q.direction = 'incoming' AND q.status IN ('pending', 'deposited')
    ), 0),
    'cheques_outgoing_open', COALESCE((
      SELECT SUM(q.amount) FROM public.sahl_cheques q
      WHERE q.direction = 'outgoing' AND q.status IN ('pending', 'deposited')
    ), 0)
  );
END;
$$;

-- 4. sahl_get_top_customers ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_top_customers(
  p_token text,
  p_from date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_to date DEFAULT CURRENT_DATE
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
  IF NOT public.check_capability(p_token, 'sahl.reports.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.reports.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT o.customer_id,
           c.company_name AS customer_name,
           count(*)::int AS orders_count,
           SUM(o.total_amount) AS total
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.created_at::date BETWEEN p_from AND p_to
      AND public.is_order_in_statistics(o.status)
    GROUP BY o.customer_id, c.company_name
    ORDER BY SUM(o.total_amount) DESC
    LIMIT 10
  ) t;

  RETURN v_result;
END;
$$;

-- 5. sahl_get_top_products -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_top_products(
  p_token text,
  p_from date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_to date DEFAULT CURRENT_DATE
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
  IF NOT public.check_capability(p_token, 'sahl.reports.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.reports.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT it.product_id,
           p.product_name,
           SUM(it.piece_quantity) AS pieces_sold,
           SUM(it.total_price) AS total
    FROM public.order_items it
    JOIN public.orders o ON o.id = it.order_id
    JOIN public.products p ON p.id = it.product_id
    WHERE o.created_at::date BETWEEN p_from AND p_to
      AND public.is_order_in_statistics(o.status)
    GROUP BY it.product_id, p.product_name
    ORDER BY SUM(it.total_price) DESC
    LIMIT 10
  ) t;

  RETURN v_result;
END;
$$;

-- 6. Grants & schema reload -----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_get_daily_report(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_financial_summary(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_top_customers(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_top_products(text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL التقارير Module (Stage 8)
-- ============================================================================
