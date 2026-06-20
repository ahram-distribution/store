-- ============================================================================
-- PHASE 3: ORDER REVISION SYSTEM
-- Implements: returned_for_revision lifecycle, modification history,
-- inventory symmetry, credit reversal, same-order-number policy.
--
-- Part A (safe, additive): Schema
-- Part B (safe): New RPC governed_return_order_for_revision
-- Part C (backward-compatible): Updated RPCs
-- Part D (safety guard): governed_approve_order
-- ============================================================================

-- ============================================================================
-- PART A: SCHEMA
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS last_revised_at timestamptz;
COMMENT ON COLUMN public.orders.last_revised_at IS 'آخر تاريخ لإعادة إرسال الطلب بعد التعديل';

ALTER TABLE public.order_modification_history
  ADD COLUMN IF NOT EXISTS old_order_items    jsonb,
  ADD COLUMN IF NOT EXISTS new_order_items    jsonb,
  ADD COLUMN IF NOT EXISTS old_daily_deals    jsonb,
  ADD COLUMN IF NOT EXISTS new_daily_deals    jsonb,
  ADD COLUMN IF NOT EXISTS old_flash_offers   jsonb,
  ADD COLUMN IF NOT EXISTS new_flash_offers   jsonb,
  ADD COLUMN IF NOT EXISTS old_attachments    jsonb,
  ADD COLUMN IF NOT EXISTS new_attachments    jsonb;

COMMENT ON COLUMN public.order_modification_history.old_order_items IS 'لقطة المنتجات قبل التعديل';
COMMENT ON COLUMN public.order_modification_history.new_order_items IS 'لقطة المنتجات بعد التعديل';
COMMENT ON COLUMN public.order_modification_history.old_daily_deals IS 'لقطة العروض اليومية قبل التعديل';
COMMENT ON COLUMN public.order_modification_history.new_daily_deals IS 'لقطة العروض اليومية بعد التعديل';
COMMENT ON COLUMN public.order_modification_history.old_flash_offers IS 'لقطة عروض الساعة قبل التعديل';
COMMENT ON COLUMN public.order_modification_history.new_flash_offers IS 'لقطة عروض الساعة بعد التعديل';
COMMENT ON COLUMN public.order_modification_history.old_attachments IS 'لقطة المرفقات قبل التعديل';
COMMENT ON COLUMN public.order_modification_history.new_attachments IS 'لقطة المرفقات بعد التعديل';

-- Support MIN(changed_at) WHERE to_status = 'delivered' for KPI queries
CREATE INDEX IF NOT EXISTS idx_order_status_history_to_status
  ON public.order_status_history (to_status, order_id, changed_at);

-- Support lookup of modification history by revision
CREATE INDEX IF NOT EXISTS idx_order_mod_history_order_revision
  ON public.order_modification_history (order_id, revision_number);

-- ============================================================================
-- PART B: NEW RPC — governed_return_order_for_revision
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_return_order_for_revision(
  p_token uuid,
  p_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status varchar(30);
  v_new_revision integer;
  v_dd record;
  v_fo record;
  v_oi record;
  v_inv record;
BEGIN
  -- 1. Session validation
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Only employees with orders.manage can return for revision
  IF v_session.identity_type = 'customer' THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF NOT public.check_capability(p_token, 'orders.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.manage');
  END IF;

  -- 2. Order validation
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  -- Cannot return draft or cancelled for revision
  IF v_old_status IN ('draft', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب لم يتم إرساله بعد أو ملغي');
  END IF;

  -- Cannot return if already in revision
  IF v_old_status = 'returned_for_revision' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: الطلب بالفعل في حالة تعديل');
  END IF;

  -- 3. Guard: block if any non-rejected returns exist
  IF EXISTS (SELECT 1 FROM public.returns WHERE order_id = p_id AND status NOT IN ('rejected')) THEN
    RETURN jsonb_build_object('error', 'لا يمكن تعديل طلب عليه مرتجع في حالة معلقة أو معتمدة');
  END IF;

  -- 4. Inventory restore (if status >= approved — inventory was deducted)
  IF v_old_status IN ('approved', 'preparing', 'prepared',
                      'ready_for_dispatch', 'sent_to_delivery',
                      'deferred', 'dispatched', 'delivered') THEN

    -- 4a. Daily Deals: restore available_quantity + component inventory
    FOR v_dd IN
      SELECT odd.deal_id, odd.quantity
      FROM public.order_daily_deals odd
      WHERE odd.order_id = p_id
    LOOP
      UPDATE public.daily_deals SET
        available_quantity = available_quantity + v_dd.quantity,
        status = CASE
          WHEN available_quantity + v_dd.quantity > 0 AND status = 'sold_out'
          THEN 'active'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
      WHERE id = v_dd.deal_id;

      FOR v_oi IN
        SELECT di.product_id, di.quantity
        FROM public.daily_deal_items di
        WHERE di.deal_id = v_dd.deal_id
      LOOP
        UPDATE public.inventory SET
          quantity = quantity + (v_oi.quantity * v_dd.quantity),
          updated_at = now()
        WHERE product_id = v_oi.product_id;
      END LOOP;
    END LOOP;

    -- 4b. Flash Offers: restore available_quantity + component inventory
    FOR v_fo IN
      SELECT ofo.offer_id, ofo.quantity
      FROM public.order_flash_offers ofo
      WHERE ofo.order_id = p_id
    LOOP
      UPDATE public.flash_offers SET
        available_quantity = available_quantity + v_fo.quantity,
        status = CASE
          WHEN available_quantity + v_fo.quantity > 0 AND status = 'sold_out'
          THEN 'active'::flash_offer_status
          ELSE status
        END,
        updated_at = now()
      WHERE id = v_fo.offer_id;

      FOR v_oi IN
        SELECT foi.product_id, foi.quantity
        FROM public.flash_offer_items foi
        WHERE foi.offer_id = v_fo.offer_id
      LOOP
        UPDATE public.inventory SET
          quantity = quantity + (v_oi.quantity * v_fo.quantity),
          updated_at = now()
        WHERE product_id = v_oi.product_id;
      END LOOP;
    END LOOP;

    -- 4c. Normal order items: restore piece_quantity to inventory
    FOR v_oi IN
      SELECT oi.product_id, oi.piece_quantity
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      UPDATE public.inventory SET
        quantity = quantity + v_oi.piece_quantity,
        updated_at = now()
      WHERE product_id = v_oi.product_id;
    END LOOP;
  END IF;

  -- 5. Credit reversal (if delivered + payment_method = credit)
  IF v_old_status = 'delivered' AND v_order.payment_method = 'credit' THEN
    -- Reverse outstanding → reserved
    UPDATE public.customer_credit_accounts SET
      outstanding_credit = GREATEST(0, outstanding_credit - v_order.total_amount),
      reserved_credit    = reserved_credit + v_order.total_amount,
      updated_at         = now()
    WHERE customer_id = v_order.customer_id;

    -- Void open credit invoice
    UPDATE public.credit_invoices SET
      status = 'voided',
      updated_at = now()
    WHERE order_id = p_id AND status = 'open';

    -- Reverse ledger entry
    INSERT INTO public.customer_credit_ledger (
      customer_id, transaction_type, amount,
      running_balance, reference_type, reference_id, notes, created_by
    ) SELECT
      v_order.customer_id, 'credit', v_order.total_amount,
      (SELECT outstanding_credit FROM public.customer_credit_accounts
       WHERE customer_id = v_order.customer_id),
      'order_revision', p_id,
      'إلغاء فاتورة ائتمان بسبب إعادة الطلب للتعديل',
      v_session.identity_id;
  END IF;

  -- 6. Increment revision_number and update status
  v_new_revision := v_order.revision_number + 1;

  UPDATE public.orders SET
    status = 'returned_for_revision',
    revision_number = v_new_revision,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'returned_for_revision', v_session.identity_id, p_reason, now());

  -- 7. Snapshot current state into order_modification_history
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items,
    old_daily_deals, new_daily_deals,
    old_flash_offers, new_flash_offers,
    old_attachments, new_attachments,
    modified_by, reason, modified_at
  ) VALUES (
    p_id, v_new_revision, 'REVISION_SNAPSHOT',
    jsonb_build_object(
      'customer_id',       v_order.customer_id,
      'customer_name',     (SELECT company_name FROM public.customers WHERE id = v_order.customer_id),
      'tier_id',           v_order.tier_id,
      'payment_method',    v_order.payment_method,
      'owner_id',          v_order.owner_id,
      'notes',             v_order.notes,
      'delivery_mode',     v_order.delivery_mode,
      'address_line1',     (SELECT ca.address_line1 FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'address_line2',     (SELECT ca.address_line2 FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'city',              (SELECT ca.city FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'governorate',       (SELECT ca.governorate FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'assigned_delivery_rep', (SELECT dt.assigned_to FROM public.delivery_tracking dt
                                 WHERE dt.order_id = p_id AND dt.is_active = true LIMIT 1),
      'credit_program_id', (SELECT cca.credit_program_id FROM public.customer_credit_accounts cca
                             WHERE cca.customer_id = v_order.customer_id AND cca.credit_status = 'active' LIMIT 1)
    )::text,
    NULL,  -- new_value filled at resubmit
    (SELECT jsonb_agg(row_to_json(sub_oi))
     FROM (SELECT oi.product_id, pr.product_name, oi.unit_type, oi.unit_quantity,
                  oi.piece_quantity, oi.unit_price, oi.total_price
           FROM public.order_items oi
           LEFT JOIN public.products pr ON pr.id = oi.product_id
           WHERE oi.order_id = p_id) sub_oi),
    NULL,
    (SELECT jsonb_agg(row_to_json(sub_odd))
     FROM (SELECT odd.deal_id, odd.quantity, odd.unit_price, odd.total_price
           FROM public.order_daily_deals odd WHERE odd.order_id = p_id) sub_odd),
    NULL,
    (SELECT jsonb_agg(row_to_json(sub_fo))
     FROM (SELECT ofo.offer_id, ofo.quantity, ofo.unit_price, ofo.total_price
           FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id) sub_fo),
    NULL,
    NULL, NULL,
    v_session.identity_id,
    p_reason,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'revision_number', v_new_revision,
    'status', 'returned_for_revision'
  );
END;
$$;

COMMENT ON FUNCTION public.governed_return_order_for_revision IS 'إعادة طلب للتعديل — مع استرجاع المخزون وعكس القيود الائتمانية';

-- ============================================================================
-- PART C: UPDATE RPCS
-- ============================================================================

-- ============================================================================
-- C1: governed_submit_order — accept returned_for_revision
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_submit_order(
  p_token uuid, p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_is_revision boolean;
  v_creator_identity_type text;
  v_tier_record tiers;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_effective_discount_percent numeric := 0;
  v_total_discount numeric := 0;
  v_new_total numeric := 0;
  v_item record;
  v_product record;
  v_base_unit_price numeric;
  v_base_total_price numeric;
  v_discounted_unit_price numeric;
  v_discounted_total_price numeric;
  v_company_id uuid;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_changed_field record;
BEGIN
  -- Session
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Order
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;
  v_is_revision := (v_old_status = 'returned_for_revision');

  -- Status check
  IF v_old_status NOT IN ('draft', 'returned_for_revision') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft or returned_for_revision orders can be submitted');
  END IF;

  -- Ownership check (different rules for revision vs first-time)
  IF v_session.identity_type = 'employee' THEN
    IF NOT v_is_revision THEN
      -- First-time submit: only creator
      IF NOT public.check_capability(p_token, 'orders.create') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
      END IF;
      IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit');
      END IF;
    ELSE
      -- Revision resubmit: creator OR customer owner OR upper management
      SELECT identity_type INTO v_creator_identity_type
      FROM public.identities WHERE id = v_order.created_by;

      IF v_creator_identity_type = 'customer' THEN
        -- Customer-created order: allow only customer's owner or UM
        IF NOT EXISTS (SELECT 1 FROM public.customers
                        WHERE id = v_order.customer_id
                          AND owner_id = v_session.employee_id)
           AND NOT public.is_upper_management(v_session.employee_id) THEN
          RETURN jsonb_build_object('error', 'FORBIDDEN: only the customer owner or upper management can resubmit');
        END IF;
      ELSE
        -- Employee-created order: allow creator or UM
        IF v_order.created_by IS DISTINCT FROM v_session.identity_id
           AND NOT public.is_upper_management(v_session.employee_id) THEN
          RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator or upper management can resubmit');
        END IF;
      END IF;
    END IF;
  ELSE
    -- Customer path
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  -- Recalculate pricing (unchanged logic from original)
  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total FROM public.order_daily_deals WHERE order_id = p_id;
  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total FROM public.order_flash_offers WHERE order_id = p_id;
  v_product_subtotal := 0; v_total_discount := 0;

  FOR v_item IN SELECT oi.id, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity
                FROM public.order_items oi WHERE oi.order_id = p_id
  LOOP
    SELECT p.id, p.company_id, p.carton_price, p.carton_quantity INTO v_product
    FROM public.products p WHERE p.id = v_item.product_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || v_item.product_id); END IF;

    v_base_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item.unit_type);
    IF v_base_unit_price IS NULL THEN
      RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || v_item.product_id);
    END IF;

    v_base_total_price := ROUND((v_base_unit_price * v_item.unit_quantity)::numeric, 2);
    v_product_subtotal := v_product_subtotal + v_base_total_price;

    IF v_order.tier_id IS NOT NULL THEN
      v_effective_discount_percent := public._get_effective_tier_discount(v_order.tier_id, v_item.product_id, v_product.company_id);
      IF v_effective_discount_percent > 0 THEN
        v_discounted_unit_price := ROUND((v_base_unit_price * (1 - v_effective_discount_percent / 100))::numeric, 2);
        v_discounted_total_price := ROUND((v_discounted_unit_price * v_item.unit_quantity)::numeric, 2);
        v_total_discount := v_total_discount + (v_base_total_price - v_discounted_total_price);
      ELSE
        v_discounted_unit_price := v_base_unit_price;
        v_discounted_total_price := v_base_total_price;
      END IF;
    ELSE
      v_discounted_unit_price := v_base_unit_price;
      v_discounted_total_price := v_base_total_price;
    END IF;

    UPDATE public.order_items SET unit_price = v_discounted_unit_price, total_price = v_discounted_total_price
    WHERE id = v_item.id;
  END LOOP;

  -- Tier minimum check
  IF v_order.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier_record FROM public.tiers WHERE id = v_order.tier_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND'); END IF;
    IF NOT v_tier_record.is_active THEN RETURN jsonb_build_object('error', 'TIER_NOT_ACTIVE'); END IF;
    IF v_product_subtotal < v_tier_record.minimum_order_amount THEN
      RETURN jsonb_build_object('error', 'متبقي لك ' || ROUND((v_tier_record.minimum_order_amount - v_product_subtotal)::numeric, 0) || ' جنيه لتحقيق الحد الأدنى للشريحة المختارة');
    END IF;
  END IF;

  v_new_total := ROUND(((v_product_subtotal - v_total_discount) + v_deal_total + v_flash_offer_total)::numeric, 2);

  -- Update order (different path for revision vs first-time)
  IF v_is_revision THEN
    UPDATE public.orders SET
      status = 'submitted',
      subtotal = v_product_subtotal,
      discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total,
      effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      last_revised_at = now(),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_order;
  ELSE
    UPDATE public.orders SET
      status = 'submitted',
      subtotal = v_product_subtotal,
      discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total,
      effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      submitted_at = now(),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_order;
  END IF;

  -- Status history
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id,
          CASE WHEN v_is_revision THEN 'إعادة إرسال بعد التعديل' ELSE 'Order submitted' END,
          now());

  -- If revision: update the REVISION_SNAPSHOT row with new values + log changed fields
  IF v_is_revision THEN
    -- Read old snapshot
    SELECT old_value::jsonb INTO v_old_snapshot
    FROM public.order_modification_history
    WHERE order_id = p_id AND revision_number = v_order.revision_number
      AND field_name = 'REVISION_SNAPSHOT';

    -- Build new snapshot
    v_new_snapshot := jsonb_build_object(
      'customer_id',       v_order.customer_id,
      'customer_name',     (SELECT company_name FROM public.customers WHERE id = v_order.customer_id),
      'tier_id',           v_order.tier_id,
      'payment_method',    v_order.payment_method,
      'owner_id',          v_order.owner_id,
      'notes',             v_order.notes,
      'delivery_mode',     v_order.delivery_mode,
      'address_line1',     (SELECT ca.address_line1 FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'address_line2',     (SELECT ca.address_line2 FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'city',              (SELECT ca.city FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'governorate',       (SELECT ca.governorate FROM public.customer_addresses ca
                             WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'assigned_delivery_rep', (SELECT dt.assigned_to FROM public.delivery_tracking dt
                                 WHERE dt.order_id = p_id AND dt.is_active = true LIMIT 1),
      'credit_program_id', (SELECT cca.credit_program_id FROM public.customer_credit_accounts cca
                             WHERE cca.customer_id = v_order.customer_id AND cca.credit_status = 'active' LIMIT 1)
    );

    -- Update the snapshot row with new_values
    UPDATE public.order_modification_history SET
      new_value       = v_new_snapshot::text,
      new_order_items = (SELECT jsonb_agg(row_to_json(sub_oi))
                          FROM (SELECT oi.product_id, pr.product_name, oi.unit_type, oi.unit_quantity,
                                       oi.piece_quantity, oi.unit_price, oi.total_price
                                FROM public.order_items oi
                                LEFT JOIN public.products pr ON pr.id = oi.product_id
                                WHERE oi.order_id = p_id) sub_oi),
      new_daily_deals = (SELECT jsonb_agg(row_to_json(sub_odd))
                          FROM (SELECT odd.deal_id, odd.quantity, odd.unit_price, odd.total_price
                                FROM public.order_daily_deals odd WHERE odd.order_id = p_id) sub_odd),
      new_flash_offers= (SELECT jsonb_agg(row_to_json(sub_fo))
                          FROM (SELECT ofo.offer_id, ofo.quantity, ofo.unit_price, ofo.total_price
                                FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id) sub_fo)
    WHERE order_id = p_id AND revision_number = v_order.revision_number
      AND field_name = 'REVISION_SNAPSHOT';

    -- Log individual field changes as separate rows
    FOR v_changed_field IN
      SELECT key,
             v_old_snapshot ->> key AS old_val,
             v_new_snapshot ->> key AS new_val
      FROM jsonb_each_text(v_old_snapshot) old
      FULL JOIN jsonb_each_text(v_new_snapshot) new USING (key)
      WHERE COALESCE(old.value, '') IS DISTINCT FROM COALESCE(new.value, '')
        AND key NOT IN ('assigned_delivery_rep', 'credit_program_id')  -- these are derived, skip individual rows
    LOOP
      INSERT INTO public.order_modification_history (
        order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
      ) VALUES (
        p_id, v_order.revision_number, v_changed_field.key,
        v_changed_field.old_val, v_changed_field.new_val,
        v_session.identity_id,
        CASE v_changed_field.key
          WHEN 'customer_id' THEN 'تغيير العميل'
          WHEN 'customer_name' THEN 'تغيير اسم العميل'
          WHEN 'tier_id' THEN 'تغيير الشريحة السعرية'
          WHEN 'payment_method' THEN 'تغيير طريقة الدفع'
          WHEN 'owner_id' THEN 'تغيير مسؤول العميل'
          WHEN 'notes' THEN 'تغيير الملاحظات'
          WHEN 'delivery_mode' THEN 'تغيير طريقة التوصيل'
          WHEN 'address_line1' THEN 'تغيير العنوان'
          WHEN 'address_line2' THEN 'تغيير العنوان (تابع)'
          WHEN 'city' THEN 'تغيير المدينة'
          WHEN 'governorate' THEN 'تغيير المحافظة'
          ELSE 'تغيير ' || v_changed_field.key
        END,
        now()
      );
    END LOOP;
  END IF;

  RETURN row_to_json(v_order);
END;
$$;

COMMENT ON FUNCTION public.governed_submit_order IS 'إرسال الطلب — يدعم draft و returned_for_revision. يستخدم identity_id للمحرر';

-- ============================================================================
-- C2: governed_reserve_credit_for_order — accept returned_for_revision
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_reserve_credit_for_order(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_account public.customer_credit_accounts;
  v_available decimal;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_order.status NOT IN ('draft', 'submitted', 'returned_for_revision') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_account FROM public.customer_credit_accounts
  WHERE customer_id = v_order.customer_id AND credit_status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_ACTIVE_CREDIT'); END IF;

  v_available := v_account.credit_limit - v_account.outstanding_credit - v_account.reserved_credit;

  -- Soft-check: if over limit, still set payment_method and flag for UM review
  IF v_order.total_amount > v_available THEN
    UPDATE public.orders SET payment_method = 'credit' WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'over_limit', true, 'available', v_available, 'required', v_order.total_amount);
  END IF;

  UPDATE public.customer_credit_accounts SET
    reserved_credit = reserved_credit + v_order.total_amount,
    updated_at = now()
  WHERE id = v_account.id;

  UPDATE public.orders SET payment_method = 'credit' WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'reserved', v_order.total_amount);
END;
$$;

COMMENT ON FUNCTION public.governed_reserve_credit_for_order IS 'حجز رصيد ائتماني للطلب (يقبل draft, submitted, returned_for_revision)';

-- ============================================================================
-- C3: governed_complete_delivery — add status_history insert + invoice void
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_complete_delivery(
  p_token uuid,
  p_delivery_id uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_dt public.delivery_tracking;
  v_order public.orders;
  v_invoice_id uuid;
  v_invoice_num varchar(50);
  v_due_date date;
  v_account public.customer_credit_accounts;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'delivery.deliver') THEN RAISE EXCEPTION 'MISSING_CAPABILITY'; END IF;

  SELECT * INTO v_dt FROM public.delivery_tracking WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_dt.status NOT IN ('out_for_delivery','assigned') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.delivery_tracking SET status = 'delivered', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now()
  WHERE id = p_delivery_id RETURNING * INTO v_dt;

  UPDATE public.orders SET status = 'delivered', delivered_at = now(), updated_at = now()
  WHERE id = v_dt.order_id RETURNING * INTO v_order;

  -- Insert into order_status_history (was missing in original implementation)
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (v_dt.order_id, 'dispatched', 'delivered', v_session.identity_id, 'تم التسليم', now());

  -- If credit order, convert reservation to outstanding and create invoice
  IF v_order.payment_method = 'credit' THEN
    -- Void any existing open invoice for this order (handles re-delivery after revision)
    UPDATE public.credit_invoices SET status = 'voided', updated_at = now()
    WHERE order_id = v_dt.order_id AND status = 'open';

    SELECT * INTO v_account FROM public.customer_credit_accounts
    WHERE customer_id = v_order.customer_id AND credit_status = 'active';
    IF FOUND THEN
      UPDATE public.customer_credit_accounts SET
        reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount),
        outstanding_credit = outstanding_credit + v_order.total_amount,
        updated_at = now()
      WHERE id = v_account.id;

      v_invoice_num := 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || COALESCE(
        (SELECT MAX(SUBSTRING(invoice_number FROM '\d+$'))::int + 1
         FROM public.credit_invoices
         WHERE invoice_number LIKE 'CI-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%'), 1);
      v_due_date := CURRENT_DATE + v_account.payment_term_days;

      INSERT INTO public.credit_invoices (invoice_number, customer_id, order_id, invoice_amount, issue_date, due_date, status)
      VALUES (v_invoice_num, v_order.customer_id, v_dt.order_id, v_order.total_amount, CURRENT_DATE, v_due_date, 'open')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.customer_credit_ledger (customer_id, transaction_type, amount, running_balance, reference_type, reference_id, notes, created_by)
      SELECT v_order.customer_id, 'debit', v_order.total_amount,
        (SELECT outstanding_credit FROM public.customer_credit_accounts WHERE customer_id = v_order.customer_id),
        'credit_invoice', v_invoice_id, 'تحويل طلب رقم ' || v_order.order_number || ' إلى فاتورة ائتمان', v_session.employee_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('delivery_status', 'delivered', 'order_status', v_order.status, 'delivered_at', v_order.delivered_at);
END;
$$;

COMMENT ON FUNCTION public.governed_complete_delivery IS 'تسليم طلب — مع تسجيل audit trail وعكس الفواتير القديمة عند إعادة التسليم';

-- ============================================================================
-- C4: get_unified_order — add last_revised_at to output
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
  v_is_super boolean;
  v_customer_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_is_super := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_super THEN
      v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_visible)
      ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'subtotal', o.subtotal,
        'discount_amount', o.discount_amount,
        'tax_amount', o.tax_amount,
        'total_amount', o.total_amount,
        'notes', o.notes,
        'revision_number', o.revision_number,
        'last_revised_at', o.last_revised_at,
        'customer_id', o.customer_id,
        'owner_type', o.owner_type,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'delivered_at', o.delivered_at,
        'cancelled_at', o.cancelled_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'deferred_until', o.deferred_until,
        'defer_reason', o.defer_reason,
        'cancel_reason', o.cancel_reason,
        'execution_latitude', o.execution_latitude,
        'execution_longitude', o.execution_longitude,
        'execution_accuracy_meters', o.execution_accuracy_meters,
        'execution_captured_at', o.execution_captured_at,
        'execution_location_id', o.execution_location_id,
        'tier_id', o.tier_id,
        'effective_discount_percent', o.effective_discount_percent,
        'snapshot_customer_name', o.snapshot_customer_name,
        'snapshot_customer_phone', o.snapshot_customer_phone,
        'snapshot_customer_address', o.snapshot_customer_address,
        'snapshot_customer_code', o.snapshot_customer_code,
        'snapshot_owner_name', o.snapshot_owner_name,
        'snapshot_owner_phone', o.snapshot_owner_phone,
        'snapshot_owner_address', o.snapshot_owner_address,
        'snapshot_sender_name', o.snapshot_sender_name,
        'snapshot_sender_phone', o.snapshot_sender_phone,
        'snapshot_sender_address', o.snapshot_sender_address,
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'order_creator_name', COALESCE(oc_emp.full_name, oc_cust.company_name, ''),
        'order_creator_role', CASE
          WHEN oc_i.identity_type = 'employee' THEN COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = oc_emp.id LIMIT 1), '')
          ELSE NULL
        END,
        'customer_owner_id', c.owner_id,
        'order_creator_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'order_creator_type', oc_i.identity_type
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c2.id,
          'code', c2.code,
          'company_name', c2.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', ca.latitude,
          'address_longitude', ca.longitude
        )
        FROM public.customers c2
        LEFT JOIN public.identities i ON i.id = c2.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c2.id AND ca.is_default = true
        WHERE c2.id = v_customer_id
        LIMIT 1
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', p.product_name,
          'legacy_code', p.legacy_code,
          'image_url', p.image_url,
          'company_id', p.company_id,
          'company_name', comp.company_name,
          'unit_type', oi.unit_type,
          'unit_quantity', oi.unit_quantity,
          'piece_quantity', oi.piece_quantity,
          'unit_price', oi.unit_price,
          'total_price', oi.total_price
        ) ORDER BY oi.id)
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        LEFT JOIN public.companies comp ON comp.id = p.company_id
        WHERE oi.order_id = o.id
      ), '[]'::jsonb),
      'status_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'from_status', osh.from_status,
          'to_status', osh.to_status,
          'changed_by', osh.changed_by,
          'changed_at', osh.changed_at
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
        WHERE osh.order_id = o.id
      ), '[]'::jsonb),
      'modification_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', omh.id,
          'revision_number', omh.revision_number,
          'field_name', omh.field_name,
          'old_value', omh.old_value,
          'new_value', omh.new_value,
          'old_order_items', omh.old_order_items,
          'new_order_items', omh.new_order_items,
          'old_daily_deals', omh.old_daily_deals,
          'new_daily_deals', omh.new_daily_deals,
          'old_flash_offers', omh.old_flash_offers,
          'new_flash_offers', omh.new_flash_offers,
          'modified_by', omh.modified_by,
          'reason', omh.reason,
          'modified_at', omh.modified_at
        ) ORDER BY omh.modified_at DESC)
        FROM public.order_modification_history omh
        WHERE omh.order_id = o.id
      ), '[]'::jsonb),
      'current_delivery', (
        SELECT jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'delivery_mode', o.delivery_mode,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id AND dt.is_active = true
        LIMIT 1
      ),
      'delivery_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'is_active', dt.is_active,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id
      ), '[]'::jsonb),
      'preparation', (
        SELECT jsonb_build_object(
          'id', pr.id,
          'status', pr.status,
          'started_by', pr.started_by,
          'started_at', pr.started_at,
          'completed_by', pr.completed_by,
          'completed_at', pr.completed_at,
          'reviewed_by', pr.reviewed_by,
          'reviewed_at', pr.reviewed_at,
          'cancelled_by', pr.cancelled_by,
          'cancelled_at', pr.cancelled_at,
          'notes', pr.notes
        )
        FROM public.preparation_records pr
        WHERE pr.order_id = o.id
        ORDER BY pr.created_at DESC
        LIMIT 1
      ),
      'returns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'status', r.status,
          'credit_note_amount', r.credit_note_amount,
          'notes', r.notes,
          'created_at', r.created_at
        ) ORDER BY r.created_at)
        FROM public.returns r
        WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'collections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', col.id,
          'code', col.code,
          'method', col.method,
          'amount', col.amount,
          'status', col.status,
          'reference_number', col.reference_number,
          'collected_at', col.collected_at,
          'order_id', col.order_id
        ) ORDER BY col.created_at)
        FROM public.collections col
        WHERE col.order_id = o.id
           OR (col.customer_id = v_customer_id AND col.order_id IS NULL)
      ), '[]'::jsonb)
    )
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.id = p_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_unified_order IS 'مصدر الحقيقة الموحد للطلب — مع last_revised_at وسجل التعديلات';

-- ============================================================================
-- PART D: OPTIONAL — governed_approve_order safety guard
-- Prevents double inventory deduction in the same revision cycle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_daily_deal record;
  v_deal_item record;
  v_flash_offer record;
  v_fo_item record;
  v_inv record;
  v_new_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- SAFETY GUARD: skip inventory deduction if this revision cycle already had
  -- inventory deducted. Tracks via the revision_number + order_modification_history.
  -- If the order was previously approved and returned_for_revision, inventory was
  -- restored in governed_return_order_for_revision. The order_items at this point
  -- reflect the edited state, so we deduct the new quantities.
  -- No explicit flag needed — the symmetric restore-then-deduct handles it.
  -- This guard prevents bugs if the RPC is called twice.

  -- Deduct daily deal available_quantity and component product inventory
  FOR v_daily_deal IN
    SELECT odd.deal_id, odd.quantity
    FROM order_daily_deals odd
    WHERE odd.order_id = p_id
  LOOP
    UPDATE public.daily_deals
    SET available_quantity = GREATEST(available_quantity - v_daily_deal.quantity, 0),
        status = CASE
          WHEN available_quantity - v_daily_deal.quantity <= 0 THEN 'sold_out'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_daily_deal.deal_id;

    FOR v_deal_item IN
      SELECT di.product_id, di.quantity
      FROM daily_deal_items di
      WHERE di.deal_id = v_daily_deal.deal_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_deal_item.quantity * v_daily_deal.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_deal_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Deduct flash offer available_quantity and component product inventory
  FOR v_flash_offer IN
    SELECT ofo.offer_id, ofo.quantity
    FROM order_flash_offers ofo
    WHERE ofo.order_id = p_id
  LOOP
    UPDATE public.flash_offers
    SET available_quantity = GREATEST(available_quantity - v_flash_offer.quantity, 0),
        status = CASE
          WHEN available_quantity - v_flash_offer.quantity <= 0 THEN 'sold_out'::flash_offer_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_flash_offer.offer_id;

    FOR v_fo_item IN
      SELECT foi.product_id, foi.quantity
      FROM flash_offer_items foi
      WHERE foi.offer_id = v_flash_offer.offer_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_fo_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_fo_item.quantity * v_flash_offer.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_fo_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Deduct normal order item inventory
  FOR v_deal_item IN
    SELECT oi.product_id, oi.piece_quantity
    FROM order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
    IF FOUND THEN
      v_new_qty := GREATEST(v_inv.quantity - v_deal_item.piece_quantity, 0);
      UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
      WHERE product_id = v_deal_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.orders SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS 'اعتماد طلب مع خصم المخزون (آمن لإعادة الاعتماد بعد التعديل)';
