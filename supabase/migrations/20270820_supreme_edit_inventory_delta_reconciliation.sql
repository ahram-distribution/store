-- ============================================================================
-- 20270820 — supreme edit: transactional delta inventory reconciliation
-- ----------------------------------------------------------------------------
-- Replaces the restore-everything + re-deduct-everything approach inside
-- governed_supreme_edit_order with a transactional DELTA reconciliation:
--
--   old_committed = orders.inventory_deducted_items (exactly-once marker,
--                  authoritative piece-quantity map of what the order commits)
--   new_required  = combined requirement of the NEW saved content, computed
--                  with the exact same formula as governed_inventory_deduct
--                  (order items via _to_pieces + daily deals + flash offers)
--   delta = new_required - old_committed  per product:
--       delta > 0  -> deduct only the delta   (ORDER_DEDUCTION movement)
--       delta < 0  -> restore only the delta  (ORDER_EDIT_RESTORE movement)
--       delta = 0  -> NO movement at all
--
-- Fixes:
-- 1. PARTIAL-COMMIT BUG (root cause of the NULL-marker defect): the old code
--    restored the deduction, replaced the items, then re-deducted; if the
--    re-deduction failed (INSUFFICIENT_STOCK), it RETURNed the error while
--    the restore + item replacement had ALREADY committed -> order left in
--    the execution zone with inventory_deducted_at = NULL and inventory out
--    of sync. The new code validates every positive delta against the
--    physical inventory BEFORE any mutation (with FOR UPDATE row locks and
--    an order-row lock), so a failure touches nothing.
-- 2. MOVEMENT CHURN: the old code emitted N restores + N deductions on every
--    save (even a no-change save). The new code emits one movement per
--    changed product and zero movements when nothing changed.
-- 3. RACE: the old pre-check read inventory without row locks (TOCTOU).
-- 4. NEGATIVE-SELLING semantics now match governed_inventory_deduct (no
--    availability rejection for order_negative_selling_allowed orders);
--    the old pre-check wrongly rejected them.
--
-- Scope guard: ONLY governed_supreme_edit_order is replaced (same signature,
-- same RPC surface, same response shape plus an extra 'inventory_deltas'
-- array). No schema change, no status/group/trigger/reference/permission/
-- revision/capsule/storefront/sync behavior is touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(p_token text, p_order_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_discount_amount numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_order_type character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_old_committed jsonb := '{}'::jsonb;
  v_new_required jsonb := '{}'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_deltas jsonb := '[]'::jsonb;
  v_negative_selling boolean;
  v_req_row record;
  v_restore_item jsonb;
  v_requested integer;
  v_capacity integer;
  v_available integer;
  v_prev integer;
  v_new integer;
  v_delta integer;
  v_key text;
  v_actor_id uuid;
  v_notices jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  -- قفل صف الطلب: يمنع تعديلين متزامنين على نفس الطلب من التسوية على نفس
  -- الأساس (إلزامي لكي تظل التسوية الجبرية صحيحة وذات مرة واحدة).
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_actor_id := v_session.identity_id;
  v_order_status := v_order.status;
  v_was_deducted := v_order.inventory_deducted_at IS NOT NULL;
  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

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

  -- ========================================================================
  -- التسوية الجبرية (DELTA) للطلب الملتزم بالمخزون — قبل أي تعديل على
  -- المحتوى: بناء الأساسين + التحقق المسبق من الزيادات.
  -- ========================================================================
  IF v_was_deducted THEN
    -- الأساس القديم: ما التزم به الطلب فعليًا (علامة الخصم — مرجع موثوق).
    FOR v_restore_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.inventory_deducted_items, '[]'::jsonb))
    LOOP
      v_old_committed := v_old_committed || jsonb_build_object(
        v_restore_item->>'product_id',
        COALESCE((v_restore_item->>'piece_quantity')::integer, 0)
      );
    END LOOP;

    -- المتطلبات الجديدة المجمعة (نفس حساب governed_inventory_deduct تمامًا:
    -- الأصناف عبر _to_pieces + العروض اليومية + عروض الفلاش — مجمعة لكل صنف).
    FOR v_req_row IN
      SELECT c.product_id, SUM(c.total_requested)::integer AS total_requested FROM (
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
        UNION ALL
        SELECT di.product_id, SUM(di.quantity * odd.quantity)::integer AS total_requested
        FROM public.order_daily_deals odd
        JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
        WHERE odd.order_id = p_order_id
        GROUP BY di.product_id
        UNION ALL
        SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)::integer AS total_requested
        FROM public.order_flash_offers ofo
        JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
        WHERE ofo.order_id = p_order_id
        GROUP BY foi.product_id
      ) c
      WHERE c.product_id IS NOT NULL
      GROUP BY c.product_id
    LOOP
      v_new_required := v_new_required || jsonb_build_object(
        v_req_row.product_id::text, v_req_row.total_requested
      );
    END LOOP;

    -- التحقق المسبق من الزيادات فقط (delta > 0) مقابل المخزون الفيزيائي
    -- المتاح — بأقفال FOR UPDATE قبل أي تعديل (لا TOCTOU، ولا حالة جزئية).
    IF NOT v_negative_selling THEN
      FOR v_key IN SELECT jsonb_object_keys(v_new_required)
      LOOP
        v_delta := COALESCE((v_new_required->>v_key)::integer, 0)
                - COALESCE((v_old_committed->>v_key)::integer, 0);
        IF v_delta > 0 THEN
          SELECT quantity INTO v_available
          FROM public.inventory
          WHERE product_id = v_key::uuid
          FOR UPDATE;

          IF NOT FOUND THEN v_available := 0; END IF;

          IF v_available < v_delta THEN
            v_shortages := v_shortages || jsonb_build_object(
              'product_id', v_key,
              'requested_quantity', v_delta,
              'available_quantity', v_available
            );
          END IF;
        END IF;
      END LOOP;

      IF jsonb_array_length(v_shortages) > 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_STOCK',
          'shortages', v_shortages
        );
      END IF;
    ELSE
      -- البيع السالب: قفل صفوف الزيادات فقط دون فحص رصيد (نفس سلوك الخصم).
      FOR v_key IN SELECT jsonb_object_keys(v_new_required)
      LOOP
        v_delta := COALESCE((v_new_required->>v_key)::integer, 0)
                - COALESCE((v_old_committed->>v_key)::integer, 0);
        IF v_delta > 0 THEN
          PERFORM 1 FROM public.inventory
          WHERE product_id = v_key::uuid
          FOR UPDATE;
        END IF;
      END LOOP;
    END IF;
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
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
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
     AND NOT (v_was_deducted AND v_order_status = ANY(public.execution_status_group())) THEN
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

  -- ========================================================================
  -- تطبيق التسوية الجبرية: حركة واحدة لكل صنف تغيّر (خصم الزيادة / استرجاع
  -- النقصان)، وصفر حركات عند عدم التغيير. ثم تحديث علامة الخصم إلى المحتوى
  -- الجديد (مرجع التسوية التالية — تكرار الحفظ لا يولّد أي حركة).
  -- ========================================================================
  IF v_was_deducted THEN
    FOR v_key IN
      SELECT k FROM (
        SELECT jsonb_object_keys(v_old_committed) AS k
        UNION
        SELECT jsonb_object_keys(v_new_required)
      ) s
    LOOP
      v_delta := COALESCE((v_new_required->>v_key)::integer, 0)
              - COALESCE((v_old_committed->>v_key)::integer, 0);
      IF v_delta <> 0 THEN
        SELECT quantity INTO v_prev
        FROM public.inventory
        WHERE product_id = v_key::uuid
        FOR UPDATE;

        IF NOT FOUND THEN v_prev := 0; END IF;
        v_new := v_prev - v_delta;

        UPDATE public.inventory
        SET quantity = v_new,
            updated_at = now()
        WHERE product_id = v_key::uuid;

        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_key::uuid, p_order_id, -v_delta,
          CASE WHEN v_delta > 0 THEN 'ORDER_DEDUCTION' ELSE 'ORDER_EDIT_RESTORE' END,
          CASE WHEN v_delta > 0
               THEN 'تم خصم الكمية من المخزون تلقائيًا.'
               ELSE 'تم تعديل الفاتورة وتم استرجاع الكمية إلى المخزون.' END,
          v_prev, v_new, v_actor_id
        );

        v_deltas := v_deltas || jsonb_build_object(
          'product_id', v_key, 'quantity_change', -v_delta
        );
      END IF;
    END LOOP;

    UPDATE public.orders
    SET inventory_deducted_at = now(),
        inventory_deducted_items = (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', k, 'piece_quantity', v::integer)), '[]'::jsonb)
          FROM jsonb_each_text(v_new_required) AS t(k, v)
        ),
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
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

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total,
    'inventory_deltas', v_deltas,
    'reservations_notice', v_notices
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.governed_supreme_edit_order(text, uuid, jsonb, text, numeric, text, character varying) TO PUBLIC, anon, authenticated, service_role;