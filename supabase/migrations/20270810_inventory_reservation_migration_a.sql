-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION A
-- ============================================================================
-- وفق التصميم المعتمد: docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md
-- (القسم 15 — الخطوة 1، القسم 6.2، القسم 7)
--
-- 1. توسيع public.inventory_movements بـ 3 أعمدة تدقيق:
--      reason text, previous_quantity integer, new_quantity integer   (BR-AUD-01)
-- 2. الدالة الداخلية الموحدة public._to_pieces                        (BR-SU-01/02)
--    — تُنشأ هنا لأن governed_inventory_deduct أدناه تعتمد عليها (خطوة B تُنشئ الباقي).
-- 3. تحديث governed_inventory_deduct:
--      • تحويل القطع عبر _to_pieces من (unit_type, unit_quantity) + carton_quantity الحالية
--        بدلاً من piece_quantity المحفوظ (BR-SU-02 — معتمد 2026-08-01)
--      • كتابة reason/previous_quantity/new_quantity في سجل الحركات (BR-AUD-01)
-- 4. تحديث governed_inventory_restore:
--      • معامل اختياري p_movement_type (ORDER_CANCELLATION_RESTORE الافتراضي)
--        لتمييز استرجاع الإلغاء/المراجعة/التعديل (BR-AUD-01)
--      • كتابة reason/previous_quantity/new_quantity (BR-AUD-01)
--
-- لا يوجد ترحيل بيانات: خط الأساس 2026-08-01 = صفر طلبات إنتاج.
-- لا جداول جديدة، لا أعمدة على orders، لا RPC عامة جديدة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. توسيع inventory_movements — أعمدة تدقيق (BR-AUD-01)
-- ---------------------------------------------------------------------------

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS previous_quantity integer,
  ADD COLUMN IF NOT EXISTS new_quantity integer;

COMMENT ON COLUMN public.inventory_movements.reason IS
  'سبب الحركة — للتدقيق (BR-AUD-01)';
COMMENT ON COLUMN public.inventory_movements.previous_quantity IS
  'الكمية السابقة بالقطع — للتدقيق (BR-AUD-01)';
COMMENT ON COLUMN public.inventory_movements.new_quantity IS
  'الكمية الجديدة بالقطع — للتدقيق (BR-AUD-01)';

-- ---------------------------------------------------------------------------
-- 2. الدالة الموحدة لتحويل وحدات البيع إلى قطع (BR-SU-01/02)
--    piece  → unit_quantity
--    dozen  → unit_quantity * 12
--    carton → unit_quantity * carton_quantity (تُقرأ من أحدث قيمة للمنتج)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._to_pieces(
  p_unit_type text,
  p_unit_quantity integer,
  p_carton_quantity integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_unit_quantity IS NULL OR p_unit_quantity < 0 THEN
    RETURN 0;
  END IF;
  IF p_unit_type = 'dozen' THEN
    RETURN p_unit_quantity * 12;
  ELSIF p_unit_type = 'carton' THEN
    RETURN p_unit_quantity * COALESCE(p_carton_quantity, 0);
  ELSE
    RETURN p_unit_quantity; -- piece (والافتراضي)
  END IF;
END;
$$;

COMMENT ON FUNCTION public._to_pieces IS
  'تحويل وحدات البيع إلى قطع (كرتون/دزينة/قطعة) — مصدر واحد للحجز والخصم (BR-SU-01/02)';

-- ---------------------------------------------------------------------------
-- 3. governed_inventory_deduct — تحويل موحد + تدقيق قبل/بعد
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_inventory_deduct(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_prev_quantity integer;
  v_new_quantity integer;
  v_shortages jsonb := '[]'::jsonb;
  v_deducted_items jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', true);
  END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  -- Aggregate required pieces per product.
  -- order_items: التحويل عبر _to_pieces بأحدث carton_quantity (BR-SU-02).
  -- العروض اليومية/الوميضية: كما هي (مؤجَّلة خارج نطاق مرحلة الحجز — القسم 9).
  WITH combined AS (
    SELECT oi.product_id, SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)) AS total_qty
    FROM public.order_items oi
    LEFT JOIN public.products pr ON pr.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    UNION ALL
    SELECT di.product_id, SUM(di.quantity * odd.quantity)
    FROM public.order_daily_deals odd
    JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
    WHERE odd.order_id = p_order_id
    GROUP BY di.product_id
    UNION ALL
    SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)
    FROM public.order_flash_offers ofo
    JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
    WHERE ofo.order_id = p_order_id
    GROUP BY foi.product_id
  ),
  aggregated AS (
    SELECT product_id, SUM(total_qty) AS total_quantity
    FROM combined
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object('product_id', product_id, 'total_quantity', total_quantity)
  ) INTO v_requirements
  FROM aggregated;

  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    UPDATE public.orders
    SET inventory_deducted_at = now(),
        inventory_deducted_items = '[]'::jsonb,
        updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'deducted', true, 'item_count', 0);
  END IF;

  -- Phase 1: Lock and validate (لا تغيير في منطق السماح — القسم 5.3)
  IF NOT v_negative_selling THEN
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;

      IF FOUND AND v_available < (v_req.value->>'total_quantity')::integer THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_req.value->>'product_id',
          'requested_quantity', (v_req.value->>'total_quantity')::integer,
          'available_quantity', v_available
        );
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
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      PERFORM FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;
    END LOOP;
  END IF;

  -- Phase 2: Deduct + audit (previous/new/reason)
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    SELECT quantity INTO v_prev_quantity
    FROM public.inventory
    WHERE product_id = (v_req.value->>'product_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN v_prev_quantity := 0; END IF;
    v_new_quantity := v_prev_quantity - (v_req.value->>'total_quantity')::integer;

    UPDATE public.inventory
    SET quantity = v_new_quantity,
        updated_at = now()
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
    VALUES (
      (v_req.value->>'product_id')::uuid,
      p_order_id,
      -((v_req.value->>'total_quantity')::integer),
      'ORDER_DEDUCTION',
      'auto deduction at order status: ' || v_order.order_inventory_deduction_status,
      v_prev_quantity,
      v_new_quantity,
      v_order.created_by
    );

    v_deducted_items := v_deducted_items || jsonb_build_object(
      'product_id', v_req.value->>'product_id',
      'piece_quantity', (v_req.value->>'total_quantity')::integer
    );
  END LOOP;

  UPDATE public.orders
  SET inventory_deducted_at = now(),
      inventory_deducted_items = v_deducted_items,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'deducted', true,
    'item_count', jsonb_array_length(v_deducted_items)
  );
END;
$$;

COMMENT ON FUNCTION public.governed_inventory_deduct IS
  'خصم مخزون الطلب مرة واحدة فقط (exactly-once) — تحويل موحد _to_pieces + تدقيق قبل/بعد';

-- ---------------------------------------------------------------------------
-- 4. governed_inventory_restore — استرجاع ذري مع نوع الحركة + تدقيق
--    إضافة معاملين اختياريين (متوافق رجعياً مع كل الاستدعاءات الحالية):
--      p_movement_type  ← يميّز استرجاع الإلغاء / المراجعة / التعديل
--      p_reason         ← سبب الحركة
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_inventory_restore(uuid);

CREATE OR REPLACE FUNCTION public.governed_inventory_restore(
  p_order_id uuid,
  p_movement_type varchar(50) DEFAULT 'ORDER_CANCELLATION_RESTORE',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_prev_quantity integer;
  v_new_quantity integer;
  v_restored_count integer := 0;
  v_actor_id uuid;
  v_movement_type varchar(50);
  v_reason text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- Exactly-once guard
  IF v_order.inventory_deducted_at IS NULL OR v_order.inventory_deducted_items IS NULL THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_restore', true);
  END IF;

  v_movement_type := COALESCE(p_movement_type, 'ORDER_CANCELLATION_RESTORE');
  v_reason := COALESCE(p_reason, v_movement_type);
  v_actor_id := v_order.created_by;

  -- Phase 1: Lock all inventory rows (منع السباقات المتزامنة)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
  LOOP
    PERFORM FROM public.inventory
    WHERE product_id = (v_item->>'product_id')::uuid
    FOR UPDATE;
  END LOOP;

  -- Phase 2: Restore all (now safely locked) + audit
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.inventory_deducted_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'piece_quantity')::integer;

    SELECT quantity INTO v_prev_quantity
    FROM public.inventory
    WHERE product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN v_prev_quantity := 0; END IF;
    v_new_quantity := v_prev_quantity + v_quantity;

    UPDATE public.inventory
    SET quantity = v_new_quantity,
        updated_at = now()
    WHERE product_id = v_product_id;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
    VALUES (v_product_id, p_order_id, v_quantity, v_movement_type, v_reason, v_prev_quantity, v_new_quantity, v_actor_id);

    v_restored_count := v_restored_count + 1;
  END LOOP;

  -- Clear deducted marker (idempotency: next call returns nothing_to_restore)
  UPDATE public.orders
  SET inventory_deducted_at = NULL,
      inventory_deducted_items = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'restored', true,
    'item_count', v_restored_count
  );
END;
$$;

COMMENT ON FUNCTION public.governed_inventory_restore IS
  'استرداد كامل لتأثير المخزون للطلب (مرة واحدة فقط) — مع القفل والتسجيل ونوع الحركة';

-- ============================================================================
-- END OF MIGRATION A
-- ============================================================================
