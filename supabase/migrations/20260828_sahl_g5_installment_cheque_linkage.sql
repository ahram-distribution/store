-- =====================================================================
-- SAHL G5 — Installments ↔ Cheques linkage + drawer-aware treasury legs
-- =====================================================================
-- 1. sahl_receive_installment gains optional p_treasury_id plus cheque
--    linkage params. method='cheque' now behaves like real سهل:
--      • NO immediate treasury movement (cash not received yet)
--      • collection document stays 'pending'
--      • a linked incoming cheque is registered automatically (bank,
--        number from p_reference_number, due date) and shows up in الشيكات
--      • clearing that cheque posts the treasury inflow (existing logic)
--      • bouncing/cancelling it reverses the FIFO allocation, restores
--        the plan totals and the customer outstanding
-- 2. sahl_cheque_action gains optional p_treasury_id for the clearing leg.
-- Old call sites remain valid via parameter defaults.
-- =====================================================================

-- 1. Linkage columns ---------------------------------------------------------------------

ALTER TABLE public.sahl_cheques ADD COLUMN IF NOT EXISTS linked_collection_id uuid REFERENCES public.collections (id);
ALTER TABLE public.sahl_cheques ADD COLUMN IF NOT EXISTS linked_plan_id uuid REFERENCES public.sahl_installment_plans (id);

COMMENT ON COLUMN public.sahl_cheques.linked_plan_id IS 'Set when this cheque was auto-registered by an installment receipt (تحصيل قسط بشيك). Bounce/cancel reverses the allocation.';

-- 2. sahl_receive_installment ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sahl_receive_installment(
  p_token text,
  p_plan_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_treasury_id uuid DEFAULT NULL,
  p_cheque_bank_name text DEFAULT NULL,
  p_cheque_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session         app.sessions;
  v_plan            public.sahl_installment_plans;
  v_col             public.collections%ROWTYPE;
  v_remaining       numeric(12,2);
  v_left            numeric(12,2);
  v_applied_part    numeric(12,2);
  r                 record;
  v_allocations     jsonb := '[]'::jsonb;
  v_outstanding     numeric(12,2);
  v_applied_credit  numeric(12,2);
  v_new_outstanding numeric(12,2);
  v_col_seq         integer;
  v_is_cheque       boolean;
  v_treasury_id     uuid;
  v_chq_id          uuid;
  v_chq_code        varchar(30);
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

  -- Treasury movement only when cash is actually received NOW.
  -- Cheque receipts settle against the treasury when the cheque clears.
  IF NOT v_is_cheque THEN
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
  END IF;

  -- Customer credit settlement (LEAST rule — mirrors sahl_post_receipt).
  SELECT COALESCE(outstanding_credit, 0) INTO v_outstanding
  FROM public.customer_credit_accounts
  WHERE customer_id = v_plan.customer_id
  FOR UPDATE;

  IF FOUND THEN
    v_applied_credit := LEAST(v_col.amount, GREATEST(v_outstanding, 0));
    v_new_outstanding := v_outstanding - v_applied_credit;
    UPDATE public.customer_credit_accounts
    SET outstanding_credit = v_new_outstanding, updated_at = now()
    WHERE customer_id = v_plan.customer_id;
  ELSE
    v_applied_credit := 0;
    v_new_outstanding := NULL;
  END IF;

  INSERT INTO public.customer_credit_ledger (
    customer_id, transaction_type, amount, running_balance,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_plan.customer_id, 'debit', v_col.amount, COALESCE(v_new_outstanding, 0),
    'collection', v_col.id,
    'قبض ' || v_col.code || ' — قسط ' || v_plan.code
      || CASE WHEN v_applied_credit < v_col.amount THEN ' — المبلغ يتجاوز الرصيد المطبق على الحساب الائتماني' ELSE '' END,
    v_session.employee_id
  );

  IF NOT v_is_cheque THEN
    UPDATE public.collections SET
      status = 'treasury_posted',
      approved_by = v_session.employee_id,
      approved_at = now(),
      updated_at = now()
    WHERE id = v_col.id;
  END IF;

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

  -- Linked incoming cheque (appears in الشيكات; clearing posts the treasury).
  IF v_is_cheque THEN
    INSERT INTO public.sahl_cheques (
      code, direction, party_type, party_id, amount, applied_amount,
      bank_name, cheque_number, due_date, notes, created_by,
      linked_collection_id, linked_plan_id
    ) VALUES (
      public.generate_cheque_number(), 'incoming', 'customer', v_plan.customer_id,
      p_amount, 0,
      btrim(p_cheque_bank_name), btrim(p_reference_number), p_cheque_due_date,
      'شيك تحصيل قسط ' || v_plan.code || ' (' || v_col.code || ')',
      v_session.employee_id,
      v_col.id, v_plan.id
    )
    RETURNING id, code INTO v_chq_id, v_chq_code;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'plan_code', v_plan.code,
    'collection_code', v_col.code,
    'amount', p_amount,
    'allocations', v_allocations,
    'remaining_after', v_remaining - p_amount,
    'plan_completed', (v_plan.paid_total + p_amount >= v_plan.total_amount),
    'outstanding_after', COALESCE(v_new_outstanding, 0)
  ) || CASE WHEN v_is_cheque
        THEN jsonb_build_object('cheque_code', v_chq_code,
                                'note', 'لم تُقيَّد بالخزينة — بانتظار تحصيل الشيك')
        ELSE '{}'::jsonb END;
END;
$$;

-- 3. sahl_cheque_action (+ drawer leg, + linked-plan reversal) --------------------------------

CREATE OR REPLACE FUNCTION public.sahl_cheque_action(
  p_token text,
  p_cheque_id uuid,
  p_action text,
  p_treasury_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_session  app.sessions;
  v_chq      public.sahl_cheques;
  v_new_out  numeric(12,2);
  v_treasury_id uuid;
  v_left     numeric(12,2);
  v_take     numeric(12,2);
  v_plan_code varchar(40);
  r          record;
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
      CASE WHEN v_chq.direction = 'incoming' THEN 'تحصيل شيك وارد ' ELSE 'صرف شيك صادر ' END
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

    -- Linked installment cheque: reverse the whole chain (allocation,
    -- plan totals, customer outstanding) then close the cheque.
    IF v_chq.linked_plan_id IS NOT NULL THEN
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

      SELECT COALESCE(outstanding_credit, 0) + v_chq.amount INTO v_new_out
      FROM public.customer_credit_accounts WHERE customer_id = v_chq.party_id FOR UPDATE;

      UPDATE public.customer_credit_accounts
      SET outstanding_credit = v_new_out, updated_at = now()
      WHERE customer_id = v_chq.party_id;

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

      IF v_chq.linked_collection_id IS NOT NULL THEN
        UPDATE public.collections SET
          notes = COALESCE(notes, '') || CASE WHEN p_action = 'bounce' THEN ' — شيك القسط مرتد' ELSE ' — شيك القسط ملغي' END,
          updated_at = now()
        WHERE id = v_chq.linked_collection_id;
      END IF;

      UPDATE public.sahl_cheques SET
        status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
        closed_at = now(), updated_at = now()
      WHERE id = p_cheque_id;

      RETURN jsonb_build_object('success', true,
                                'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                'restored_amount', v_chq.amount,
                                'plan_reversed', true);

    ELSE
      -- Generic path: restore whatever was deducted at registration.
      IF v_chq.applied_amount > 0 THEN
        IF v_chq.direction = 'incoming' THEN
          SELECT COALESCE(outstanding_credit, 0) + v_chq.applied_amount INTO v_new_out
          FROM public.customer_credit_accounts WHERE customer_id = v_chq.party_id FOR UPDATE;

          UPDATE public.customer_credit_accounts
          SET outstanding_credit = v_new_out, updated_at = now()
          WHERE customer_id = v_chq.party_id;

          INSERT INTO public.customer_credit_ledger (
            customer_id, transaction_type, amount, running_balance,
            reference_type, reference_id, notes, created_by
          ) VALUES (
            v_chq.party_id, 'credit', v_chq.applied_amount, COALESCE(v_new_out, 0),
            'cheque', v_chq.id,
            CASE WHEN p_action = 'bounce' THEN 'ارتداد شيك وارد ' ELSE 'إلغاء شيك وارد ' END
              || v_chq.code || ' — إعادة الرصيد المخصوم',
            v_session.employee_id
          );
        ELSE
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
            CASE WHEN p_action = 'bounce' THEN 'ارتداد شيك صادر ' ELSE 'إلغاء شيك صادر ' END
              || v_chq.code || ' — إعادة الرصيد المخصوم',
            v_session.employee_id
          );
        END IF;
      END IF;

      UPDATE public.sahl_cheques SET
        status = CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
        closed_at = now(), updated_at = now()
      WHERE id = p_cheque_id;

      RETURN jsonb_build_object('success', true,
                                'status', CASE WHEN p_action = 'bounce' THEN 'bounced' ELSE 'cancelled' END,
                                'restored_amount', v_chq.applied_amount);
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;
END;
$$;

-- 4. Grants (new signatures) -----------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.sahl_receive_installment(text, uuid, numeric, text, text, text, uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sahl_cheque_action(text, uuid, text, uuid) TO authenticated;
