-- ============================================================================
-- STAGE 2.1 — PHASE B: DYNAMIC RESERVATION ENGINE (Order Details self-exclusion)
-- ============================================================================
-- محرك الحجز الديناميكي (Phase B):
--   • الحجز إجابة حيّة على السؤال الوحيد «ماذا سيحدث للكمية التي اخترتها؟» —
--     لا يُخزَّن، لا يستمر، لا يُحجب السلة/الطلب، لا يخصم ولا يسترجع المخزون.
--   • governed_check_product_availability_v2 (Rev 5 — 20270812) يحسب كل شيء من
--     الحالة الحيّة (orders/inventory/إعدادات السياسة) ولا يقرأ أبداً صفوف
--     RESERVATION_* المخزَّنة (سجل تدقيق فقط). محرك واحد، القاعدة 1.
--
-- التغيير هنا:
--   • إضافة معامل اختياري p_exclude_order_id — صفحة «تفاصيل الطلب» تستثني الطلب
--     المعروض من «الطلبات السابقة»، وإلا عدّ الطلبُ المقدَّمُ حجزه الخاص كحجز
--     سابق → YELLOW خاطئ بدلاً من GREEN. توقيع متوافق مع الخلف (4 وسائط فقط
--     للمتصلين الحاليين).
--   • توحيد نوع p_unit_type إلى varchar (غير محدود) بعدما وُجد التوقيع الحي
--     بغير محدود فيما الملفات السابقة تستخدم varchar(20): DROP ثم CREATE،
--     مع إعادة منح EXECUTE بنفس ACL الافتراضي (PUBLIC/anon/authenticated/
--     service_role). (بحث Postgres عن الدالة بتجاهل typmod، لذا يطابق DROP
--     واحدٌ كلا الحالتين.)
-- لا جداول جديدة، لا أعمدة جديدة، لا ترحيل بيانات، لا تغيير لأي محرك آخر.
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_check_product_availability_v2(uuid, integer, varchar, text);

CREATE OR REPLACE FUNCTION public.governed_check_product_availability_v2(
  p_product_id          uuid,
  p_requested_quantity  integer,
  p_unit_type           varchar DEFAULT NULL,
  p_token               text DEFAULT NULL,
  p_exclude_order_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_product record;
  v_unit_type varchar;
  v_unit_pieces integer;
  v_requested_pieces integer;
  v_negative_selling boolean;
  v_physical_stock integer;
  v_available boolean;
  v_max_units integer;
  v_prior_reservations boolean;
  v_capacity integer;
  v_expected_executable integer;
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

  v_requested_pieces := public._to_pieces(
    v_unit_type,
    COALESCE(p_requested_quantity, 0),
    COALESCE(v_product.carton_quantity, 0)
  );

  -- هل توجد طلبات سابقة (submitted وغير محسومة) تحمل حجزاً لهذا الصنف؟
  -- (BR-RS-03) — تستثني الطلب المعروض إن مُرِّر p_exclude_order_id (تفاصيل الطلب).
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.status = 'submitted'
      AND o.inventory_deducted_at IS NULL
      AND o.id IS DISTINCT FROM p_exclude_order_id
      AND public._reserved_quantity_for_order(p_product_id, o.id) > 0
  ) INTO v_prior_reservations;

  -- غياب سياق الجلسة → سعة غير محدودة افتراضياً (القرار المعتمد — القسم 8.1).
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', NULL,
      'max_allowed_units', NULL,
      'max_allowed_pieces', NULL,
      'carton_quantity', COALESCE(v_product.carton_quantity, 0),
      'unit_type', v_unit_type,
      'prior_reservations_exist', v_prior_reservations,
      'expected_executable_pieces', v_requested_pieces
    );
  END IF;

  -- سياسة البيع بالسالب (المصدر الوحيد — 20270803): مفعَّل افتراضياً → لا حد رصيد.
  SELECT (value->>'value')::boolean
  INTO v_negative_selling
  FROM app.app_settings
  WHERE key = 'inventory_negative_selling_allowed';

  IF v_negative_selling IS NULL THEN
    v_negative_selling := true;
  END IF;

  IF v_negative_selling THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', NULL,
      'max_allowed_units', NULL,
      'max_allowed_pieces', NULL,
      'carton_quantity', COALESCE(v_product.carton_quantity, 0),
      'unit_type', v_unit_type,
      'prior_reservations_exist', v_prior_reservations,
      'expected_executable_pieces', v_requested_pieces
    );
  END IF;

  -- حد صارم (البيع بالسالب معطَّل): الحجب الوحيد هو تجاوز المخزون الفيزيائي.
  SELECT quantity INTO v_physical_stock
  FROM public.inventory
  WHERE product_id = p_product_id;

  IF NOT FOUND THEN
    v_physical_stock := 0;
  END IF;

  v_available := v_physical_stock >= v_requested_pieces;
  v_max_units := v_physical_stock / v_unit_pieces;

  -- الكمية المتوقعة للتنفيذ (القاعدة 1 — نفس محرك الحساب):
  -- حصة طلب في نهاية طابور FCFS = min(المطلوب, السعة) حيث السعة
  -- = المخزون الفيزيائي ناقص حجوزات الطلبات السابقة (الطلب الجديد لا يُستثنى؛
  -- تفاصيل الطلب تستثني الطلب المعروض عبر p_exclude_order_id).
  v_capacity := public._reservation_capacity(p_product_id, p_exclude_order_id);
  IF v_capacity IS NULL THEN
    v_expected_executable := v_requested_pieces;
  ELSE
    v_expected_executable := LEAST(v_requested_pieces, v_capacity);
  END IF;

  RETURN jsonb_build_object(
    'available', v_available,
    'error', CASE WHEN v_available THEN NULL ELSE 'INSUFFICIENT_STOCK' END,
    'max_allowed_units', v_max_units,
    'max_allowed_pieces', v_physical_stock,
    'carton_quantity', COALESCE(v_product.carton_quantity, 0),
    'unit_type', v_unit_type,
    'prior_reservations_exist', v_prior_reservations,
    'expected_executable_pieces', v_expected_executable
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_product_availability_v2 IS
  'إرشاد السلة/تفاصيل الطلب: حجب فقط عند تجاوز المخزون الفيزيائي (لا حجوزات) + حقلان لبطاقة حالة الأعمال (prior_reservations_exist, expected_executable_pieces) من نفس محرك الحساب (القاعدة 1). p_exclude_order_id = استثناء الطلب المعروض من الطلبات السابقة (تفاصيل الطلب). بدون كشف أرقام مخزون/حجز خام (BR-VIS-01)';

GRANT EXECUTE ON FUNCTION public.governed_check_product_availability_v2(uuid, integer, varchar, text, uuid) TO PUBLIC, anon, authenticated, service_role;
