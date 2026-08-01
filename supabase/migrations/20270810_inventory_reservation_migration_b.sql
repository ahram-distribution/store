-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION B
-- ============================================================================
-- وفق التصميم المعتمد: docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md
-- (القسم 15 — الخطوة 2، القسم 3.1، القسم 5، القسم 6)
--
-- الدوال الداخلية الثلاث (مصدر واحد للحساب — غير معروضة عبر PostgREST):
--   1. public._to_pieces                                        (BR-SU-01/02)
--      — يُعاد تعريفها هنا (إعادة تعريف آمنة CREATE OR REPLACE) لتكون
--        Migration B مكتفية ذاتياً وفق القسم 15 خطوة 2.
--   2. public._reserved_quantity_for_order(p_product_id, p_order_id)
--      — الحجز المشتق لطلب واحد على منتج (القسم 3.1):
--        = مجموع _to_pieces على أسطر order_items فقط عندما يكون الطلب
--          في حالة 'submitted' ولم يُخصم بعد (inventory_deducted_at IS NULL)
--        = 0 لأي حالة أخرى أو بعد الخصم. العروض مؤجَّلة (القسم 9).
--   3. public._reservation_capacity(p_product_id, p_exclude_order_id)
--      — سعة الحجز المتاحة (القسم 5.1):
--        • عند تفعيل البيع بالسالب عالمياً (app.app_settings
--          inventory_negative_selling_allowed = true) → غير محدودة (NULL).
--        • عند التعطيل → inventory.quantity(P) − Σ حجوزات الطلبات
--          المؤهلة الأخرى غير المستثناة، مع تقييد أدنى بـ 0
--          (باقي FCFS لطالب جديد في نهاية الطابور — القسم 5.2).
--        • منتج بلا سطر مخزون → 0 (لا رصيد → لا سعة).
--        • p_product_id NULL → NULL (لا منتج → لا سعة).
--
-- مفتاح FCFS: (submitted_at ASC, created_at ASC, id ASC) — يُطبَّق حيثما
-- تُحسب المخصصات الفعلية (Migration C في اللقطة الإدارية).
-- لا ترحيل بيانات (خط الأساس 2026-08-01 = صفر طلبات).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. الدالة الموحدة لتحويل وحدات البيع إلى قطع (BR-SU-01/02)
--    إعادة تعريف مطابقة لـ Migration A — idempotent ومكتفية ذاتياً.
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
-- 2. الحجز المشتق لطلب واحد على منتج (القسم 3.1)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._reserved_quantity_for_order(
  p_product_id uuid,
  p_order_id   uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_reserved integer;
BEGIN
  IF p_product_id IS NULL OR p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT status, inventory_deducted_at INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- القاعدة المعتمدة (القسم 4): الحجز فقط في حالة submitted وغير المحسوم.
  -- أي حالة أخرى أو بعد الخصم → 0. (approved: الخصم ينهي الحجز؛ العروض مؤجَّلة.)
  IF v_order.status <> 'submitted' OR v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, pr.carton_quantity)), 0)
  INTO v_reserved
  FROM public.order_items oi
  LEFT JOIN public.products pr ON pr.id = oi.product_id
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p_product_id;

  RETURN v_reserved;
END;
$$;

COMMENT ON FUNCTION public._reserved_quantity_for_order IS
  'حجز طلب على منتج (قطع) — مشتق من أسطر order_items بتحويل _to_pieces، يسري فقط في حالة submitted وغير المحسوم (BR-RS-01..05)';

-- ---------------------------------------------------------------------------
-- 3. سعة الحجز المتاحة لمنتج (القسم 5.1) — NULL = سعة غير محدودة
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._reservation_capacity(
  p_product_id      uuid,
  p_exclude_order_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_negative_selling boolean;
  v_stock integer;
  v_reserved_others integer;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- السياسة العالمية (المصدر الوحيد — القسم 8.1): افتراضياً مفعَّل.
  -- نفس النمط المعتمد في get_inventory_policies/الترigger (20270803):
  -- غياب الإعداد أو قيمته NULL → بيع سالب مفعَّل (سعة غير محدودة).
  SELECT (value->>'value')::boolean
  INTO v_negative_selling
  FROM app.app_settings
  WHERE key = 'inventory_negative_selling_allowed';

  IF v_negative_selling IS NULL THEN
    v_negative_selling := true;
  END IF;

  IF v_negative_selling THEN
    RETURN NULL; -- سعة غير محدودة — لا فحص رصيد
  END IF;

  SELECT quantity INTO v_stock
  FROM public.inventory
  WHERE product_id = p_product_id;

  IF NOT FOUND THEN
    RETURN 0; -- لا رصيد → لا سعة
  END IF;

  -- مجموع حجوزات الطلبات المؤهلة الأخرى (submitted وغير المحسومة)
  -- باستثناء الطلب المستثنى إن حُدد (IS DISTINCT FROM يتجاهل NULL).
  SELECT COALESCE(SUM(public._reserved_quantity_for_order(p_product_id, o.id)), 0)
  INTO v_reserved_others
  FROM public.orders o
  WHERE o.status = 'submitted'
    AND o.inventory_deducted_at IS NULL
    AND o.id IS DISTINCT FROM p_exclude_order_id;

  -- تقييد أدنى بـ 0: لطالب جديد في نهاية طابور FCFS لا يمكن أن تتجاوز
  -- الحصة المتاحة ما تبقّى من الرصيد (القسم 5.2).
  RETURN GREATEST(0, v_stock - v_reserved_others);
END;
$$;

COMMENT ON FUNCTION public._reservation_capacity IS
  'سعة الحجز المتاحة لمنتج (قطع) — NULL تعني غير محدودة (بيع سالب مفعَّل)، وإلا رصيد المخزون ناقص حجوزات الطلبات المؤهلة الأخرى (BR-AL-01, BR-RS-03)';

-- ---------------------------------------------------------------------------
-- 4. عدم إتاحة الدوال الداخلية عبر PostgREST (القسم 15 — «غير معروضة»)
--    هي أدوات حساب داخلية فقط، وتُمنع من أي دور منخفض الصلاحية.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._to_pieces(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reserved_quantity_for_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reservation_capacity(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- END OF MIGRATION B
-- ============================================================================
