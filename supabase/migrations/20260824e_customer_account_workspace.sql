-- ============================================================================
-- SAHL — CUSTOMER ACCOUNT WORKSPACE (كشف حساب بالفترة + رصيد سابق)
-- Adds an OPTIONAL date-range to sahl_get_customer_account_statement so the
-- account workspace can print/filter a real كشف حساب exactly like the SAHL
-- desktop reference templates (account-statement-*):
--   * movements limited to [p_date_from .. p_date_to]
--   * balance_before = رصيد سابق (net effect of every movement family BEFORE
--     the period, derived from the SAME real records — no second ledger)
--   * running balances start from balance_before inside the period
-- Defaults (NULL,NULL) return the exact previous behavior: full history,
-- opening 0, ending at the canonical current balance.
-- No mutation paths are touched; the canonical balance function is untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sahl_get_customer_account_statement(
  p_token text,
  p_customer_id uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
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
  v_open    numeric(12,2) := 0;
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

  -- رصيد سابق: net effect of the SAME movement families recorded strictly
  -- BEFORE the period start (only when a period actually begins).
  IF p_date_from IS NOT NULL THEN
    SELECT
      COALESCE((SELECT SUM(o.total_amount) FROM public.orders o
        WHERE o.customer_id = p_customer_id AND public.is_order_in_statistics(o.status)
          AND o.created_at < p_date_from), 0)
      + COALESCE((SELECT SUM(v.paid_credit) FROM public.sahl_invoices v
        WHERE v.customer_id = p_customer_id AND v.kind = 'sale' AND v.status = 'posted'
          AND v.paid_credit > 0 AND v.created_at < p_date_from), 0)
      - COALESCE((SELECT SUM(rt.credit_note_amount) FROM public.returns rt
        WHERE rt.customer_id = p_customer_id AND rt.status = 'approved'
          AND rt.created_at < p_date_from), 0)
      - COALESCE((SELECT SUM(cl.amount) FROM public.collections cl
        WHERE cl.customer_id = p_customer_id
          AND (cl.status IS NULL OR cl.status IN ('approved','treasury_posted'))
          AND cl.created_at < p_date_from), 0)
      - COALESCE((SELECT SUM(ch.amount) FROM public.sahl_cheques ch
        WHERE ch.party_type = 'customer' AND ch.party_id = p_customer_id
          AND ch.direction = 'incoming'
          AND ch.status IN ('pending','deposited','cleared')
          AND ch.created_at < p_date_from
          AND NOT EXISTS (
            SELECT 1 FROM public.collections cl2
            WHERE cl2.id = ch.linked_collection_id
              AND (cl2.status IS NULL OR cl2.status IN ('approved','treasury_posted'))
          )), 0)
    INTO v_open;
    v_open := ROUND(COALESCE(v_open, 0), 2);
    v_run := v_open;
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
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
      UNION ALL
      SELECT 'invoice', v.id, v.code, 'فاتورة بيع آجل (سهل)',
             v.paid_credit, 1, v.status, v.created_at
      FROM public.sahl_invoices v
      WHERE v.customer_id = p_customer_id AND v.kind = 'sale' AND v.status = 'posted' AND v.paid_credit > 0
        AND (p_date_from IS NULL OR v.created_at >= p_date_from)
        AND (p_date_to IS NULL OR v.created_at <= p_date_to)
      UNION ALL
      SELECT 'return', rt.id, rt.code, 'مرتجع بيع',
             rt.credit_note_amount, -1, rt.status, rt.created_at
      FROM public.returns rt
      WHERE rt.customer_id = p_customer_id AND rt.status = 'approved'
        AND (p_date_from IS NULL OR rt.created_at >= p_date_from)
        AND (p_date_to IS NULL OR rt.created_at <= p_date_to)
      UNION ALL
      SELECT 'collection', cl.id, cl.code,
             'سند قبض — ' || CASE cl.method WHEN 'cash' THEN 'نقداً' WHEN 'bank_transfer' THEN 'تحويل بنكي' WHEN 'cheque' THEN 'شيك' WHEN 'deposit' THEN 'إيداع' ELSE cl.method END,
             cl.amount, -1, cl.status, cl.created_at
      FROM public.collections cl
      WHERE cl.customer_id = p_customer_id
        AND (cl.status IS NULL OR cl.status IN ('approved','treasury_posted'))
        AND (p_date_from IS NULL OR cl.created_at >= p_date_from)
        AND (p_date_to IS NULL OR cl.created_at <= p_date_to)
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
        AND (p_date_from IS NULL OR ch.created_at >= p_date_from)
        AND (p_date_to IS NULL OR ch.created_at <= p_date_to)
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
    'balance_before', v_open,
    'movements', v_moves
  );
END;
$$;

COMMENT ON FUNCTION public.sahl_get_customer_account_statement(text, uuid, timestamptz, timestamptz) IS
'سهل: كشف حساب العميل التتبعي — مصادر تكوين الرصيد والحركات الزمنية بالرصيد الجاري، مع فترة اختيارية ورصيد سابق مطتق من نفس السجلات (مطابق لقالب كشف الحساب في نظام سهل).';

GRANT EXECUTE ON FUNCTION public.sahl_get_customer_account_statement(text, uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
