-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION C
-- ============================================================================
-- وفق التصميم المعتمد: docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md
-- (القسم 15 — الخطوة 3، القسم 8.1، القسم 8.2)
--
-- 1. RPC عامة جديدة باسم منفصل governed_check_product_availability_v2 (BR-VIS-01):
--    • قرار عقد RPC (القسم 8.1): لا overload على RPC عامة قائمة — `governed_check_product_availability`
--      القديمة (معاملان) تُبقى دون تغيير للمتوافقية الرجعية، والسلوك الجديد في اسم منفصل وواضح.
--    • إصلاح خلل التصميم (القسم 8.1/1): قراءة السياسة العالمية من
--      app.app_settings بدلاً من عمود products.negative_selling_allowed المهجور.
--    • معاملان اختياريان بافتراضات:
--        p_unit_type varchar(20) DEFAULT NULL  ← وحدة البيع المطلوبة
--        p_token      text DEFAULT NULL ← سياق الجلسة (غائب = غير محدود افتراضياً)
--    • الحجز يؤثر على الإرشاد (القسم 8.1/2): عند تعطيل البيع بالسالب
--      available = _reservation_capacity(P, NULL) >= قطع المطلوب.
--    • max_allowed_units = floor(السعة / قطع الوحدة الواحدة) (القسم 8.1/3)
--      — بدون كشف أي رقم مخزون/حجز خام (BR-VIS-01).
--    • عند السعة غير المحدودة: available=true مع error='NEGATIVE_SELLING_ALLOWED'
--      (نفس العقد المستهلك في واجهة التعديل OrderDetailPage).
--
-- 2. توسيع governed_get_order_inventory_snapshot (BR-VIS-02) — إدارة فقط:
--    حقول جديدة لكل منتج (غير كاسرة — تُحافظ على الحقول الحالية):
--      reserved_quantity   = _reserved_quantity_for_order(P, الطلب) — حجز هذا الطلب
--      allocated_quantity  = نصيب FCFS الفعلي لهذا الطلب (تخصيص جشع، مفتاح
--                            submitted_at/created_at/id، تقريب لأسفل لوحدات بيع كاملة)
--      capacity            = _reservation_capacity(P, الطلب) — سعة متاحة (NULL = غير محدودة)
--    is_sufficient يُحافظ على دلالته الحالية (حقل موجود — القسم 8.2).
--
-- لا ترحيل بيانات.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. governed_check_product_availability_v2 — إرشاد المندوب/المتجر (RPC عامة جديدة)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_check_product_availability_v2(
  p_product_id          uuid,
  p_requested_quantity  integer,
  p_unit_type           varchar(20) DEFAULT NULL,
  p_token               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_product record;
  v_unit_type varchar(20);
  v_unit_pieces integer;
  v_requested_pieces integer;
  v_capacity integer;
  v_available boolean;
  v_max_units integer;
BEGIN
  SELECT is_out_of_stock, carton_quantity INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF v_product.is_out_of_stock THEN
    RETURN jsonb_build_object('available', false, 'error', 'PRODUCT_OUT_OF_STOCK');
  END IF;

  v_unit_type := COALESCE(p_unit_type, 'piece');
  v_unit_pieces := public._to_pieces(v_unit_type, 1, COALESCE(v_product.carton_quantity, 0));
  IF v_unit_pieces IS NULL OR v_unit_pieces <= 0 THEN
    v_unit_pieces := 1; -- وقائي: كرتون بلا carton_quantity يُعامل كقطعة
  END IF;

  -- القسم 8.1: غياب سياق الجلسة → سعة غير محدودة افتراضياً.
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', 'NEGATIVE_SELLING_ALLOWED',
      'max_allowed_units', NULL,
      'unit_type', v_unit_type
    );
  END IF;

  -- سعة غير محدودة (البيع بالسالب مفعَّل عالمياً) → متاح دائماً.
  v_capacity := public._reservation_capacity(p_product_id, NULL);
  IF v_capacity IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', 'NEGATIVE_SELLING_ALLOWED',
      'max_allowed_units', NULL,
      'unit_type', v_unit_type
    );
  END IF;

  -- تحويل المطلوب إلى قطع بنفس الوحدة ثم المقارنة بالسعة (القسم 8.1/2).
  v_requested_pieces := public._to_pieces(
    v_unit_type,
    COALESCE(p_requested_quantity, 0),
    COALESCE(v_product.carton_quantity, 0)
  );
  v_available := v_capacity >= v_requested_pieces;

  -- الحد الأقصى بوحدات البيع المطلوبة — floor لأعداد صحيحة (BR-SU-01).
  v_max_units := v_capacity / v_unit_pieces;

  RETURN jsonb_build_object(
    'available', v_available,
    'error', CASE WHEN v_available THEN NULL ELSE 'INSUFFICIENT_STOCK' END,
    'max_allowed_units', v_max_units,
    'unit_type', v_unit_type
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_product_availability_v2(uuid, integer, varchar, text) IS
  'فحص توفر الكمية مع مراعاة الحجوزات والسعة (بدون كشف أرقام مخزون/حجز خام — BR-VIS-01)';

-- ---------------------------------------------------------------------------
-- 2. governed_get_order_inventory_snapshot — لقطة إدارية موسَّعة (BR-VIS-02)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_get_order_inventory_snapshot(
  p_token text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_has_inventory boolean;
  v_snapshot jsonb := '[]'::jsonb;
  v_is_sufficient boolean;
  v_reserved integer;
  v_capacity integer;
  v_allocated integer;
  v_stock integer;
  v_remaining integer;
  v_need integer;
  v_unit_pieces integer;
  v_alloc_this integer;
  v_queue record;
  v_product_id uuid;
  v_requested integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'orders.manage');

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  -- تجميع الكميات المطلوبة (نفس المنطق الأساسي المعتمد — القسم 6.2).
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
    RETURN jsonb_build_object('snapshot', '[]'::jsonb);
  END IF;

  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    v_product_id := (v_req.value->>'product_id')::uuid;
    v_requested  := (v_req.value->>'total_quantity')::integer;

    v_available := 0;
    v_has_inventory := false;
    SELECT quantity INTO v_available
    FROM public.inventory
    WHERE product_id = v_product_id;
    IF FOUND THEN
      v_has_inventory := true;
      IF v_available IS NULL THEN v_available := 0; END IF;
    ELSE
      v_available := 0; -- لا سطر مخزون → 0 (يمنع انتشار NULL في حساب التخصيص FCFS)
    END IF;

    -- is_sufficient: دلالة الحقل الحالي محفوظة (القسم 8.2 — «موجود»).
    v_is_sufficient := v_negative_selling
                    OR NOT v_has_inventory
                    OR v_available >= v_requested;

    v_reserved  := public._reserved_quantity_for_order(v_product_id, p_order_id);
    v_capacity  := public._reservation_capacity(v_product_id, p_order_id);

    -- نصيب FCFS الفعلي لهذا الطلب (تخصيص جشع — القسم 5.2).
    v_allocated := 0;
    IF v_order.status = 'submitted' AND v_order.inventory_deducted_at IS NULL THEN
      IF v_capacity IS NULL THEN
        -- سعة غير محدودة → كل طلب مؤهل يُخصَّص بكامل حاجته.
        v_allocated := v_reserved;
      ELSE
        v_stock    := v_available;
        v_remaining := v_stock;
        FOR v_queue IN
          SELECT o.id
          FROM public.orders o
          WHERE o.status = 'submitted'
            AND o.inventory_deducted_at IS NULL
          ORDER BY o.submitted_at ASC, o.created_at ASC, o.id ASC
        LOOP
          v_need := public._reserved_quantity_for_order(v_product_id, v_queue.id);
          IF v_need = 0 THEN CONTINUE; END IF;

          -- وحدة البيع لهذا الطلب (أول سطر للمنتج) — تقريب لأسفل لوحدات كاملة.
          SELECT public._to_pieces(oi.unit_type, 1, pr.carton_quantity)
          INTO v_unit_pieces
          FROM public.order_items oi
          LEFT JOIN public.products pr ON pr.id = oi.product_id
          WHERE oi.order_id = v_queue.id
            AND oi.product_id = v_product_id
          LIMIT 1;
          IF v_unit_pieces IS NULL OR v_unit_pieces <= 0 THEN
            v_unit_pieces := 1;
          END IF;

          v_alloc_this := LEAST(v_need, v_remaining);
          v_alloc_this := (v_alloc_this / v_unit_pieces) * v_unit_pieces;

          IF v_queue.id = p_order_id THEN
            v_allocated := v_alloc_this;
          END IF;
          v_remaining := v_remaining - v_alloc_this;
        END LOOP;
      END IF;
    END IF;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_product_id,
      'requested_quantity', v_requested,
      'available_quantity', v_available,
      'is_sufficient', v_is_sufficient,
      'reserved_quantity', v_reserved,
      'allocated_quantity', v_allocated,
      'capacity', v_capacity
    );
  END LOOP;

  RETURN jsonb_build_object('snapshot', v_snapshot);
END;
$$;

COMMENT ON FUNCTION public.governed_get_order_inventory_snapshot IS
  'لقطة مخزون للاطلاع فقط (إدارة) — حجز الطلب ونصيب FCFS والسعة المتاحة لكل منتج';

-- ============================================================================
-- END OF MIGRATION C
-- ============================================================================
