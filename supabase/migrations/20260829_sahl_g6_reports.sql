-- =====================================================================
-- SAHL G6 — Reports expansion
-- =====================================================================
-- 1. sahl_get_sales_report: period sales analysis from سهل invoices
--    (totals + payment split + per-day series + top items).
-- 2. sahl_get_due_installments: unpaid installment parts due within N days
--    (overdue first), across active plans.
-- =====================================================================

-- 1. Sales report ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_sales_report(
  p_token text,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session app.sessions;
  v_totals  jsonb;
  v_by_day  jsonb;
  v_top     jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.sales.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.sales.read');
  END IF;

  SELECT jsonb_build_object(
    'invoices_count', COUNT(*) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'),
    'sales_total', COALESCE(SUM(i.grand_total) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0),
    'cash_total', COALESCE(SUM(i.paid_cash) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0),
    'card_total', COALESCE(SUM(i.paid_card) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0),
    'credit_total', COALESCE(SUM(i.paid_credit) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0),
    'quotes_open', COUNT(*) FILTER (WHERE i.kind = 'quote' AND i.status = 'open'),
    'quotes_value', COALESCE(SUM(i.grand_total) FILTER (WHERE i.kind = 'quote' AND i.status = 'open'), 0),
    'voided_count', COUNT(*) FILTER (WHERE i.status = 'voided'),
    'voided_total', COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'voided'), 0)
  ) INTO v_totals
  FROM public.sahl_invoices i
  WHERE i.created_at::date BETWEEN p_from AND p_to;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.day), '[]'::jsonb) INTO v_by_day
  FROM (
    SELECT i.created_at::date AS day,
           COUNT(*) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted') AS count,
           COALESCE(SUM(i.grand_total) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0) AS total,
           COALESCE(SUM(i.paid_cash) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0) AS cash,
           COALESCE(SUM(i.paid_card) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0) AS card,
           COALESCE(SUM(i.paid_credit) FILTER (WHERE i.kind = 'sale' AND i.status = 'posted'), 0) AS credit
    FROM public.sahl_invoices i
    WHERE i.created_at::date BETWEEN p_from AND p_to
      AND i.kind IN ('sale', 'quote')
    GROUP BY i.created_at::date
  ) t;

  SELECT COALESCE(
    jsonb_agg(t ORDER BY t.line_total DESC),
    '[]'::jsonb) INTO v_top
  FROM (
    SELECT ii.product_id,
           p.product_name,
           SUM(ii.qty_pieces)::integer AS pieces,
           SUM(ii.line_total) AS line_total
    FROM public.sahl_invoice_items ii
    JOIN public.products p ON p.id = ii.product_id
    JOIN public.sahl_invoices i ON i.id = ii.invoice_id
    WHERE i.kind = 'sale' AND i.status = 'posted'
      AND i.posted_at::date BETWEEN p_from AND p_to
    GROUP BY ii.product_id, p.product_name
    ORDER BY line_total DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', v_totals,
    'by_day', v_by_day,
    'top_items', v_top
  );
END;
$$;

-- 2. Installments due ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_get_due_installments(
  p_token text,
  p_days integer DEFAULT 30
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
  IF NOT public.check_capability(p_token, 'sahl.installments.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.installments.manage');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb) INTO v_result
  FROM (
    SELECT pt.id, pl.code AS plan_code, c.company_name AS customer_name,
           pt.part_number, pt.amount, pt.paid_amount,
           (pt.amount - pt.paid_amount) AS remaining,
           pt.due_date,
           (pt.due_date < CURRENT_DATE) AS overdue,
           (pt.due_date - CURRENT_DATE) AS days_until_due
    FROM public.sahl_installment_parts pt
    JOIN public.sahl_installment_plans pl ON pl.id = pt.plan_id
    JOIN public.customers c ON c.id = pl.customer_id
    WHERE pl.status = 'active'
      AND pt.paid_amount < pt.amount
      AND pt.due_date <= CURRENT_DATE + COALESCE(GREATEST(p_days, 0), 30)
    ORDER BY pt.due_date
    LIMIT 200
  ) t;

  RETURN v_result;
END;
$$;

-- 3. Grants ----------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_get_sales_report(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_due_installments(text, integer) TO authenticated;
