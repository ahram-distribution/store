-- ============================================================================
-- 20271105 — Supreme Edit: Tier/Payment/Shipping change or removal + Customer change
-- ----------------------------------------------------------------------------
-- Extends the "تحرير الطلب" (supreme management inline edit) screen with:
--   1. Changing or removing the price tier (الشريحة السعرية).
--   2. Changing or removing the payment method (طريقة الدفع) and shipping
--      method (طريقة الشحن).
--   3. Reassigning the order to another customer (اسم العميل).
--
-- A NEW function governed_supreme_edit_order_v2 is introduced instead of an
-- overload on the existing governed_supreme_edit_order to avoid PostgREST
-- ambiguity. It keeps all existing behavior (inventory sync, reservation
-- events, audit) and adds:
--   - p_tier_id                : set the active tier (validated).
--   - p_clear_tier             : remove the tier (السعر الأساسي) — wins over p_tier_id.
--   - p_payment_method_option_id : set the payment method option (validated).
--   - p_clear_payment          : remove the payment method (wins over the option id).
--   - p_shipping_method_option_id : set the shipping method option (validated).
--   - p_clear_shipping         : remove the shipping method (wins over the option id).
--   - p_customer_id            : reassign the order to another active customer and
--                                refill the frozen customer snapshot fields.
--   - Discount: after ANY edit, the discount D from each option is recomputed as
--     tier % + payment % + shipping % (additive, applied ONCE) against the NEW
--     item subtotal and applied to the order:
--       discount_amount     = subtotal * (tier% + payment% + shipping%) / 100
--       effective_discount_percent = tier% + payment% + shipping% (or NULL if 0)
--     Percentages come from the resulting order state (selected option if changed,
--     otherwise the frozen snapshot). p_discount_amount is kept for signature
--     compatibility but no longer used.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order_v2(
  p_token text,
  p_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_discount_amount decimal(12,2) DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_type varchar DEFAULT NULL,
  p_tier_id uuid DEFAULT NULL,
  p_clear_tier boolean DEFAULT false,
  p_customer_id uuid DEFAULT NULL,
  p_payment_method_option_id uuid DEFAULT NULL,
  p_clear_payment boolean DEFAULT false,
  p_shipping_method_option_id uuid DEFAULT NULL,
  p_clear_shipping boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item jsonb;
  v_product record;
  v_subtotal decimal(12,2);
  v_discount_amount decimal(12,2);
  v_total decimal(12,2);
  v_is_super boolean;
  v_order_status text;
  v_was_deducted boolean;
  v_old_res_map jsonb := '{}'::jsonb;
  v_restore_map jsonb := '{}'::jsonb;
  v_req_row record;
  v_restore_item jsonb;
  v_requested integer;
  v_capacity integer;
  v_available integer;
  v_prev integer;
  v_new integer;
  v_key text;
  v_actor_id uuid;
  v_restore_result jsonb;
  v_deduct_result jsonb;
  v_notices jsonb := '[]'::jsonb;
  v_new_tier_id uuid;
  v_tier_changed boolean := false;
  v_new_tier_name text;
  v_tier_discount numeric := 0;
  v_tier_minimum numeric := 0;
  v_payment_discount numeric := 0;
  v_shipping_discount numeric := 0;
  v_effective numeric := 0;
  v_discount_changed boolean := false;
  v_new_payment_id uuid;
  v_payment_changed boolean := false;
  v_new_payment_name text;
  v_new_shipping_id uuid;
  v_shipping_changed boolean := false;
  v_new_shipping_name text;
  v_customer_changed boolean := false;
  v_cust_code text;
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_actor_id := v_session.identity_id;
  v_order_status := v_order.status;
  v_was_deducted := v_order.inventory_deducted_at IS NOT NULL;

  -- Tier change detection (set active tier / remove tier).
  IF p_clear_tier THEN
    v_new_tier_id := NULL;
    v_tier_changed := true;
    v_tier_discount := 0;
  ELSIF p_tier_id IS NOT NULL AND p_tier_id IS DISTINCT FROM v_order.tier_id THEN
    SELECT name, discount_percent, minimum_order_amount
      INTO v_new_tier_name, v_tier_discount, v_tier_minimum
    FROM public.tiers WHERE id = p_tier_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND_OR_INACTIVE'); END IF;
    v_new_tier_id := p_tier_id;
    v_tier_changed := true;
  END IF;

  -- Customer change detection + frozen snapshot refill (same source query as order creation).
  IF p_customer_id IS NOT NULL AND p_customer_id IS DISTINCT FROM v_order.customer_id THEN
    SELECT c.code, c.company_name,
      COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
      COALESCE(
        (SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
        (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1),
        ''
      )
      INTO v_cust_code, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND_OR_INACTIVE'); END IF;
    v_customer_changed := true;
  END IF;

  -- Payment method change detection (set active option / remove).
  IF p_clear_payment THEN
    v_new_payment_id := NULL;
    v_payment_changed := true;
    v_payment_discount := 0;
  ELSIF p_payment_method_option_id IS NOT NULL AND p_payment_method_option_id IS DISTINCT FROM v_order.payment_method_option_id THEN
    SELECT name, discount_percent INTO v_new_payment_name, v_payment_discount
    FROM public.payment_method_options WHERE id = p_payment_method_option_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PAYMENT_METHOD_NOT_FOUND_OR_INACTIVE'); END IF;
    v_new_payment_id := p_payment_method_option_id;
    v_payment_changed := true;
  END IF;

  -- Shipping method change detection (set active option / remove).
  IF p_clear_shipping THEN
    v_new_shipping_id := NULL;
    v_shipping_changed := true;
    v_shipping_discount := 0;
  ELSIF p_shipping_method_option_id IS NOT NULL AND p_shipping_method_option_id IS DISTINCT FROM v_order.shipping_method_option_id THEN
    SELECT name, discount_percent INTO v_new_shipping_name, v_shipping_discount
    FROM public.shipping_method_options WHERE id = p_shipping_method_option_id AND is_active = true;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SHIPPING_METHOD_NOT_FOUND_OR_INACTIVE'); END IF;
    v_new_shipping_id := p_shipping_method_option_id;
    v_shipping_changed := true;
  END IF;

  -- خريطة الحجز القديم لكل منتج (النموذج المشتق — قبل أي تغيير).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_old_res_map := v_old_res_map || jsonb_build_object(
        v_req_row.product_id::text,
        public._reserved_quantity_for_order(v_req_row.product_id, p_order_id)
      );
    END LOOP;
  END IF;

  -- خريطة المبالغ المستردة من الخصم السابق (للتحقق المسبق من الرصيد بعد الاسترجاع).
  IF v_was_deducted THEN
    FOR v_restore_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
    LOOP
      v_restore_map := v_restore_map || jsonb_build_object(
        v_restore_item->>'product_id',
        COALESCE((v_restore_item->>'piece_quantity')::integer, 0)
      );
    END LOOP;
  END IF;

  -- تحقق مسبق من الرصيد لطلب محسوم ستُعاد خصمه بعد الاسترجاع (يماثل فحص الخصم الفعلي).
  IF v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_req_row.product_id;

      IF NOT FOUND THEN v_available := 0; END IF;

      v_available := v_available
        + COALESCE((v_restore_map->>v_req_row.product_id::text)::integer, 0);

      IF v_available < v_req_row.total_requested THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'shortages', jsonb_build_array(jsonb_build_object(
            'product_id', v_req_row.product_id,
            'requested_quantity', v_req_row.total_requested,
            'available_quantity', v_available
          ))
        );
      END IF;
    END LOOP;
  END IF;

  -- طلب في submitted مع تجاوز سعة الحجز عند زيادة المحتوى: إشعار فقط (لا رفض — BR-RS-03/05).
  IF v_order_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT vi.product_id, SUM(vi.req)::integer AS total_requested FROM (
        SELECT (vi->>'product_id')::uuid AS product_id,
               public._to_pieces(
                 vi->>'unit_type',
                 GREATEST(COALESCE((vi->>'unit_quantity')::integer, 1), 1),
                 pr.carton_quantity
               ) AS req
        FROM jsonb_array_elements(p_items) vi
        LEFT JOIN public.products pr ON pr.id = (vi->>'product_id')::uuid
      ) vi
      WHERE vi.product_id IS NOT NULL
      GROUP BY vi.product_id
    LOOP
      v_capacity := public._reservation_capacity(v_req_row.product_id, p_order_id);
      IF v_capacity IS NOT NULL AND v_req_row.total_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_req_row.total_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.',
          COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0),
          v_req_row.total_requested,
          v_actor_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_req_row.total_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- استرجاع الخصم القديم قبل استبدال المحتوى (BR-RS-08 — القسم 8.3).
  IF v_was_deducted THEN
    v_restore_result := public.governed_inventory_restore(
      p_order_id, 'ORDER_EDIT_RESTORE', COALESCE(p_reason, 'Supreme Management edit')
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND', 'detail', 'Product ' || (v_item->>'product_id'));
    END IF;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_order_id, (v_item->>'product_id')::uuid, v_item->>'unit_type',
      (v_item->>'unit_quantity')::int, COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- أحداث RESERVATION_UPDATE لطلب في submitted (لم يُعَد خصمه في نفس العملية).
  IF v_order_status = 'submitted'
     AND NOT (v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status) THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_new := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_prev := COALESCE((v_old_res_map->>v_req_row.product_id::text)::integer, 0);
      IF v_prev <> v_new THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_new - v_prev, 'RESERVATION_UPDATE',
          'تم تعديل كمية الحجز بعد تعديل الفاتورة.',
          v_prev, v_new, v_actor_id
        );
      END IF;
    END LOOP;

    -- منتجات أُزيلت من الطلب: حجزها القديم يتلاشى (previous → 0).
    FOR v_key IN SELECT jsonb_object_keys(v_old_res_map)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = p_order_id AND product_id = v_key::uuid
      ) THEN
        v_prev := (v_old_res_map->>v_key)::integer;
        IF v_prev > 0 THEN
          INSERT INTO public.inventory_movements
            (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
          VALUES (
            v_key::uuid, p_order_id, -v_prev, 'RESERVATION_UPDATE',
            'تم تحرير حجز الصنف المحذوف من الفاتورة.',
            v_prev, 0, v_actor_id
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- إعادة خصم المحتوى الجديد إن كان الطلب وصل/تجاوز نقطة الخصم (BR-RS-08).
  IF v_was_deducted AND v_order.order_inventory_deduction_status = v_order_status THEN
    v_deduct_result := public.governed_inventory_deduct(p_order_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  v_subtotal := COALESCE(v_subtotal, 0);

  -- Discount always recomputed after the edit and applied to the NEW subtotal
  -- (product requirement: recompute the discount percentages and apply them).
  -- Percentages come from the resulting order state: selected option when it was
  -- changed in this edit, otherwise the frozen snapshot percentage. Additive sum
  -- (tier + payment + shipping), Method B — applied ONCE on the subtotal.
  v_discount_changed := v_tier_changed OR v_payment_changed OR v_shipping_changed;
  v_tier_discount := CASE WHEN v_tier_changed THEN COALESCE(v_tier_discount, 0) ELSE COALESCE(v_order.snapshot_tier_discount, 0) END;
  v_payment_discount := CASE WHEN v_payment_changed THEN COALESCE(v_payment_discount, 0) ELSE COALESCE(v_order.snapshot_payment_discount, 0) END;
  v_shipping_discount := CASE WHEN v_shipping_changed THEN COALESCE(v_shipping_discount, 0) ELSE COALESCE(v_order.snapshot_shipping_discount, 0) END;
  v_effective := v_tier_discount + v_payment_discount + v_shipping_discount;
  v_discount_amount := ROUND((v_subtotal * v_effective / 100)::numeric, 2);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  -- Non-blocking notice when the new tier's minimum order amount is not reached.
  IF v_tier_changed AND v_new_tier_id IS NOT NULL AND v_subtotal < v_tier_minimum THEN
    v_notices := v_notices || jsonb_build_object(
      'type', 'TIER_MINIMUM_NOTICE',
      'minimum_order_amount', v_tier_minimum,
      'subtotal', v_subtotal,
      'remaining', ROUND((v_tier_minimum - v_subtotal)::numeric, 0)
    );
  END IF;

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
    tier_id = CASE WHEN v_tier_changed THEN v_new_tier_id ELSE tier_id END,
    snapshot_tier_name = CASE WHEN v_tier_changed THEN v_new_tier_name ELSE snapshot_tier_name END,
    snapshot_tier_discount = CASE WHEN v_tier_changed THEN v_tier_discount ELSE snapshot_tier_discount END,
    payment_method_option_id = CASE WHEN v_payment_changed THEN v_new_payment_id ELSE payment_method_option_id END,
    snapshot_payment_name = CASE WHEN v_payment_changed THEN v_new_payment_name ELSE snapshot_payment_name END,
    snapshot_payment_discount = CASE WHEN v_payment_changed THEN v_payment_discount ELSE snapshot_payment_discount END,
    shipping_method_option_id = CASE WHEN v_shipping_changed THEN v_new_shipping_id ELSE shipping_method_option_id END,
    snapshot_shipping_name = CASE WHEN v_shipping_changed THEN v_new_shipping_name ELSE snapshot_shipping_name END,
    snapshot_shipping_discount = CASE WHEN v_shipping_changed THEN v_shipping_discount ELSE snapshot_shipping_discount END,
    effective_discount_percent = CASE WHEN v_effective > 0 THEN v_effective ELSE NULL END,
    customer_id = CASE WHEN v_customer_changed THEN p_customer_id ELSE customer_id END,
    snapshot_customer_code = CASE WHEN v_customer_changed THEN v_cust_code ELSE snapshot_customer_code END,
    snapshot_customer_name = CASE WHEN v_customer_changed THEN v_cust_name ELSE snapshot_customer_name END,
    snapshot_customer_phone = CASE WHEN v_customer_changed THEN v_cust_phone ELSE snapshot_customer_phone END,
    snapshot_customer_address = CASE WHEN v_customer_changed THEN v_cust_address ELSE snapshot_customer_address END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'supreme_edit',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount, 'notes', v_order.notes)::text,
    jsonb_build_object('subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total, 'notes', COALESCE(p_notes, v_order.notes))::text,
    v_old_items, v_new_items, v_session.identity_id, COALESCE(p_reason, 'Supreme Management edit'), now()
  );

  IF v_tier_changed THEN
    INSERT INTO public.order_modification_history (
      order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
    ) VALUES (
      p_order_id, v_order.revision_number, 'tier_change',
      jsonb_build_object(
        'tier_id', v_order.tier_id, 'tier_name', v_order.snapshot_tier_name, 'tier_discount', v_order.snapshot_tier_discount,
        'effective_discount_percent', v_order.effective_discount_percent,
        'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount
      )::text,
      jsonb_build_object(
        'tier_id', v_new_tier_id, 'tier_name', v_new_tier_name, 'tier_discount', v_tier_discount,
        'effective_discount_percent', CASE WHEN v_effective > 0 THEN v_effective ELSE NULL END,
        'discount_amount', v_discount_amount, 'total_amount', v_total
      )::text,
      v_session.identity_id, COALESCE(p_reason, 'تعديل الشريحة السعرية من الإدارة العليا'), now()
    );
  END IF;

  IF v_customer_changed THEN
    INSERT INTO public.order_modification_history (
      order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
    ) VALUES (
      p_order_id, v_order.revision_number, 'customer_change',
      jsonb_build_object(
        'customer_id', v_order.customer_id, 'customer_code', v_order.snapshot_customer_code,
        'customer_name', v_order.snapshot_customer_name
      )::text,
      jsonb_build_object(
        'customer_id', p_customer_id, 'customer_code', v_cust_code,
        'customer_name', v_cust_name
      )::text,
      v_session.identity_id, COALESCE(p_reason, 'تغيير عميل الطلب من الإدارة العليا'), now()
    );
  END IF;

  IF v_payment_changed THEN
    INSERT INTO public.order_modification_history (
      order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
    ) VALUES (
      p_order_id, v_order.revision_number, 'payment_change',
      jsonb_build_object(
        'payment_method_option_id', v_order.payment_method_option_id, 'name', v_order.snapshot_payment_name,
        'discount_percent', v_order.snapshot_payment_discount
      )::text,
      jsonb_build_object(
        'payment_method_option_id', v_new_payment_id, 'name', v_new_payment_name,
        'discount_percent', v_payment_discount
      )::text,
      v_session.identity_id, COALESCE(p_reason, 'تعديل طريقة الدفع من الإدارة العليا'), now()
    );
  END IF;

  IF v_shipping_changed THEN
    INSERT INTO public.order_modification_history (
      order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
    ) VALUES (
      p_order_id, v_order.revision_number, 'shipping_change',
      jsonb_build_object(
        'shipping_method_option_id', v_order.shipping_method_option_id, 'name', v_order.snapshot_shipping_name,
        'discount_percent', v_order.snapshot_shipping_discount
      )::text,
      jsonb_build_object(
        'shipping_method_option_id', v_new_shipping_id, 'name', v_new_shipping_name,
        'discount_percent', v_shipping_discount
      )::text,
      v_session.identity_id, COALESCE(p_reason, 'تعديل طريقة الشحن من الإدارة العليا'), now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total,
    'reservations_notice', v_notices,
    'tier_id', CASE WHEN v_tier_changed THEN v_new_tier_id ELSE v_order.tier_id END,
    'tier_changed', v_tier_changed,
    'payment_method_option_id', CASE WHEN v_payment_changed THEN v_new_payment_id ELSE v_order.payment_method_option_id END,
    'payment_changed', v_payment_changed,
    'shipping_method_option_id', CASE WHEN v_shipping_changed THEN v_new_shipping_id ELSE v_order.shipping_method_option_id END,
    'shipping_changed', v_shipping_changed,
    'effective_discount_percent', CASE WHEN v_effective > 0 THEN v_effective ELSE NULL END,
    'customer_id', CASE WHEN v_customer_changed THEN p_customer_id ELSE v_order.customer_id END,
    'customer_changed', v_customer_changed
  );
END;
$$;

COMMENT ON FUNCTION public.governed_supreme_edit_order_v2 IS
  'تعديل أعلى إدارة (v2): أصناف + شريحة/دفع/شحن (تغيير أو إزالة) + عميل. بعد أي تعديل يُعاد حساب نسب الخصم (شريحة + دفع + شحن مجمعة) وتُطبَّق على إجمالي الطلب الجديد.';

GRANT EXECUTE ON FUNCTION public.governed_supreme_edit_order_v2(
  text, uuid, jsonb, text, numeric, text, character varying, uuid, boolean, uuid, uuid, boolean, uuid, boolean
) TO PUBLIC, anon, authenticated, service_role;