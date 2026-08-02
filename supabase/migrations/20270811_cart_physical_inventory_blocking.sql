-- ============================================================================
-- STAGE 1 — CART PRODUCT SELECTION: Physical Inventory Blocking Only
-- ============================================================================
-- وفق نموذج الأعمال المعتمد (BUSINESS_MODEL_UNDERSTANDING_FOR_REVIEW.md — Rev 3):
--   • قاعدة السلة الوحيدة: «حجب فقط عندما تتجاوز الكمية المطلوبة المخزون الفيزيائي».
--   • الحجز (memory) لا يلعب أي دور في السلة — لا حجب، لا تقليل، لا رفض قبل الاعتماد.
--
-- التغيير الوحيد هنا: governed_check_product_availability_v2
--   — الحساب يعتمد المخزون الفيزيائي (physical inventory) فقط، بدلاً من
--     _reservation_capacity (رصيد ناقص حجوزات الطلبات الأخرى).
--   — عند البيع بالسالب (سياسة عالمية مفعَّلة) → سعة غير محدودة: لا حجب أبداً.
--   — عند البيع بالسالب معطَّل → الحد الأقصى = المخزون الفيزيائي بالكامل.
--   — لا تُغيَّر _reservation_capacity: تبقى لمحرك التخصيص عند الاعتماد (Stage 5)
--     وللقطة الإدارية (governed_get_order_inventory_snapshot).
--
-- لا جداول جديدة، لا أعمدة جديدة، لا ترحيل بيانات، لا تغيير لأي دالة أخرى.
-- ============================================================================

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
  v_negative_selling boolean;
  v_physical_stock integer;
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

  -- غياب سياق الجلسة → سعة غير محدودة افتراضياً (القرار المعتمد — القسم 8.1).
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'error', NULL,
      'max_allowed_units', NULL,
      'max_allowed_pieces', NULL,
      'carton_quantity', COALESCE(v_product.carton_quantity, 0),
      'unit_type', v_unit_type
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
      'unit_type', v_unit_type
    );
  END IF;

  -- حد صارم (البيع بالسالب معطَّل): الحجب الوحيد هو تجاوز المخزون الفيزيائي.
  -- الحجوزات (reservation memory) لا تُطرح هنا — لا تؤثر على السلة إطلاقاً.
  SELECT quantity INTO v_physical_stock
  FROM public.inventory
  WHERE product_id = p_product_id;

  IF NOT FOUND THEN
    v_physical_stock := 0;
  END IF;

  v_requested_pieces := public._to_pieces(
    v_unit_type,
    COALESCE(p_requested_quantity, 0),
    COALESCE(v_product.carton_quantity, 0)
  );
  v_available := v_physical_stock >= v_requested_pieces;
  v_max_units := v_physical_stock / v_unit_pieces;

  RETURN jsonb_build_object(
    'available', v_available,
    'error', CASE WHEN v_available THEN NULL ELSE 'INSUFFICIENT_STOCK' END,
    'max_allowed_units', v_max_units,
    'max_allowed_pieces', v_physical_stock,
    'carton_quantity', COALESCE(v_product.carton_quantity, 0),
    'unit_type', v_unit_type
  );
END;
$$;

COMMENT ON FUNCTION public.governed_check_product_availability_v2 IS
  'إرشاد السلة: حجب فقط عند تجاوز المخزون الفيزيائي (لا حجوزات). عند البيع بالسالب = لا حد. بدون كشف أرقام مخزون/حجز خام (BR-VIS-01)';
