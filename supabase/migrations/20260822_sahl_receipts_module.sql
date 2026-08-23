-- ============================================================================
-- SAHL MODULE — القبض (Receipts) — Stage 1
-- Maps the SAHL receipt cycle onto Ahram's canonical structures:
--
--   SAHL receipt document       → collections (via governed_create_collection)
--   SAHL cash register movement → treasury_transactions (inflow / 'collection')
--   SAHL customer account debt  → customer_credit_accounts.outstanding_credit
--   SAHL financial movement     → customer_credit_ledger (INSERT-only audit)
--   SAHL account statement      → sahl_get_customer_ledger + collections history
--
-- Gap filled: governed_approve_collection only flips status to 'approved'.
-- Nothing posted money IN to the treasury, nothing reduced the customer's
-- outstanding balance, nothing wrote a ledger entry. sahl_post_receipt
-- completes that cycle atomically (pending/approved → treasury_posted).
--
-- Business-rule note (SAHL vs AHRAM):
--   SAHL allows overpayment producing a negative customer balance.
--   AHRAM enforces CHECK (outstanding_credit >= 0). Therefore only
--   LEAST(amount, outstanding) is applied to the credit account; any excess
--   is still recorded on the receipt, treasury and ledger with an explicit
--   note. Changing this rule requires an explicit decision.
-- ============================================================================

-- 1. Capabilities (Ahram permission model) -----------------------------------

INSERT INTO public.capabilities (code, name) VALUES
  ('sahl.access',        'الدخول إلى مساحة سهل'),
  ('sahl.receipts.read', 'عرض سندات القبض — سهل'),
  ('sahl.receipts.post', 'ترحيل سندات القبض إلى الخزينة — سهل')
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
  WHERE c.code IN ('sahl.access', 'sahl.receipts.read', 'sahl.receipts.post')
    AND NOT EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      WHERE rc.role_id = v_role_id AND rc.capability_id = c.id
    );
END;
$$;

-- 2. sahl_post_receipt ---------------------------------------------------------
-- Posts a collection (receipt) to the treasury and settles it against the
-- customer's credit account. Works from 'pending' (implies approval) or
-- 'approved'. Idempotent-safe: already-posted receipts are rejected.

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
  v_session         app.sessions;
  v_col             public.collections;
  v_outstanding     numeric(12,2);
  v_applied         numeric(12,2);
  v_new_outstanding numeric(12,2);
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

  -- Customer outstanding settlement (canonical: customer_credit_accounts).
  -- Table CHECK keeps outstanding >= 0, so only LEAST(amount, outstanding)
  -- is applied; any excess stays visible in the ledger notes.
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

  -- Financial movement on the customer account (INSERT-only audit table).
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

  UPDATE public.collections SET
    status       = 'treasury_posted',
    collected_at = COALESCE(collected_at, now()),
    approved_by  = COALESCE(approved_by, v_session.employee_id),
    approved_at  = COALESCE(approved_at, now()),
    updated_at   = now()
  WHERE id = v_col.id;

  RETURN jsonb_build_object(
    'success', true,
    'collection_id', v_col.id,
    'code', v_col.code,
    'amount', v_col.amount,
    'applied_to_credit_account', COALESCE(v_applied, 0),
    'outstanding_after', COALESCE(v_new_outstanding, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.sahl_post_receipt IS 'سهل: ترحيل سند قبض إلى الخزينة وتسويته على حساب العميل (دورة القبض الكاملة)';

-- 3. sahl_get_customer_ledger ---------------------------------------------------
-- كشف حساب العميل — آخر حركات مالية على دفتر العميل (سهل).

CREATE OR REPLACE FUNCTION public.sahl_get_customer_ledger(
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
  v_result  jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'sahl.receipts.read') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: sahl.receipts.read');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT l.id, l.transaction_type, l.amount, l.running_balance,
           l.reference_type, l.reference_id, l.notes, l.created_at
    FROM public.customer_credit_ledger l
    WHERE l.customer_id = p_customer_id
    ORDER BY l.created_at DESC
    LIMIT 100
  ) t;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.sahl_get_customer_ledger IS 'سهل: كشف حساب العميل — حركات الدفتر الائتماني';

-- 4. Grants & schema reload -----------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_post_receipt(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_get_customer_ledger(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END — SAHL القبض Module (Stage 1)
-- ============================================================================
