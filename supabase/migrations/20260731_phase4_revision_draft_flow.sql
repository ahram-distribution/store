-- ============================================================================
-- PHASE 4: REVISION DRAFT FLOW — Full Cart Restore Experience
-- ============================================================================
-- Changes:
--   1. governed_return_order_for_revision → sets status = 'draft' (not 'returned_for_revision')
--   2. NEW governed_replace_order_contents — atomically replace all items/deals/offers
--   3. governed_submit_order — detect revision via REVISION_SNAPSHOT existence
-- ============================================================================

-- ============================================================================
-- 1. governed_return_order_for_revision — set status to draft
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

  -- 6. Increment revision_number and set status to DRAFT (full edit experience)
  v_new_revision := v_order.revision_number + 1;

  UPDATE public.orders SET
    status = 'draft',
    revision_number = v_new_revision,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'draft', v_session.identity_id, p_reason, now());

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
    'status', 'draft'
  );
END;
$$;

COMMENT ON FUNCTION public.governed_return_order_for_revision IS 'إعادة طلب للتعديل → Draft (مع استرجاع المخزون وعكس القيود الائتمانية)';

-- ============================================================================
-- 2. NEW RPC: governed_replace_order_contents
-- Atomically replace all order items, daily deals, and flash offers.
-- Called by the edit page before governed_submit_order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_replace_order_contents(
  p_token uuid,
  p_id uuid,
  p_items jsonb DEFAULT '[]',
  p_tier_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_daily_deals jsonb DEFAULT '[]',
  p_flash_offers jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_deal jsonb;
  v_deal_record record;
  v_offer jsonb;
  v_offer_record record;
BEGIN
  -- Session
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Order
  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Must be draft
  IF v_order.status != 'draft' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft orders can be edited');
  END IF;

  -- Permission: employee must have orders.create
  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN
      RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
    END IF;
  ELSE
    -- Customer: only their own orders
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  -- Validate tier
  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RETURN jsonb_build_object('error', 'TIER_NOT_FOUND_OR_INACTIVE');
    END IF;
  END IF;

  -- Delete existing items, deals, offers
  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;

  -- Insert new order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_item->>'product_id')::uuid);
    END IF;

    v_calculated_unit_price := public._calc_base_unit_price(
      v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type'
    );

    IF v_calculated_unit_price IS NULL THEN
      RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || (v_item->>'product_id')::uuid);
    END IF;

    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2);

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'unit_quantity')::int,
      COALESCE((v_item->>'piece_quantity')::int, 0),
      v_calculated_unit_price,
      v_calculated_total_price
    );
  END LOOP;

  -- Insert new daily deals
  FOR v_deal IN SELECT * FROM jsonb_array_elements(p_daily_deals)
  LOOP
    SELECT id, fixed_price INTO v_deal_record
    FROM public.daily_deals WHERE id = (v_deal->>'deal_id')::uuid;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'DAILY_DEAL_NOT_FOUND: ' || (v_deal->>'deal_id')::uuid);
    END IF;

    INSERT INTO public.order_daily_deals (order_id, deal_id, quantity, unit_price, total_price)
    VALUES (p_id, v_deal_record.id, 1, v_deal_record.fixed_price, v_deal_record.fixed_price);
  END LOOP;

  -- Insert new flash offers
  FOR v_offer IN SELECT * FROM jsonb_array_elements(p_flash_offers)
  LOOP
    SELECT id, fixed_price INTO v_offer_record
    FROM public.flash_offers WHERE id = (v_offer->>'offer_id')::uuid;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'FLASH_OFFER_NOT_FOUND: ' || (v_offer->>'offer_id')::uuid);
    END IF;

    INSERT INTO public.order_flash_offers (order_id, offer_id, quantity, unit_price, total_price)
    VALUES (p_id, v_offer_record.id, 1, v_offer_record.fixed_price, v_offer_record.fixed_price);
  END LOOP;

  -- Update order fields
  UPDATE public.orders SET
    tier_id = p_tier_id,
    notes = p_notes,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_id));
END;
$$;

COMMENT ON FUNCTION public.governed_replace_order_contents IS 'استبدال جميع محتويات الطلب (المنتجات والعروض) — يستخدم قبل إعادة إرسال الطلب المعدل';

-- ============================================================================
-- 3. governed_submit_order — detect revision via REVISION_SNAPSHOT
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

  -- Status check
  IF v_old_status NOT IN ('draft', 'returned_for_revision') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft or returned_for_revision orders can be submitted');
  END IF;

  -- Detect revision by checking if a REVISION_SNAPSHOT exists
  v_is_revision := EXISTS(
    SELECT 1 FROM public.order_modification_history
    WHERE order_id = p_id AND field_name = 'REVISION_SNAPSHOT'
  );

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

  -- Recalculate pricing
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

  -- Update order
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
        AND key NOT IN ('assigned_delivery_rep', 'credit_program_id')
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

COMMENT ON FUNCTION public.governed_submit_order IS 'إرسال الطلب — يدعم draft و returned_for_revision. يكشف التعديلات عبر REVISION_SNAPSHOT.';
