-- ============================================================================
-- PHASE B — EXECUTION GROUP ENTRY FINALIZATION
-- ============================================================================
-- العقد المعتمد (قرارات 2026-08-02):
--   1. قبل دخول أي حالة تنفيذ: فحص المخزون الفيزيائي الحالي أولاً.
--   2. لا حاجة لتعديل → تغيير الحالة بشكل طبيعي.
--   3. يوجد صنف يجب تخفيضه → لا تغيير للحالة فوراً، عرض حوار تأكيد:
--      متابعة = تخفيض الكميات ثم تغيير الحالة ثم خصم المخزون،
--      إلغاء = لا شيء يتغير.
--   4. مخزون الصنف صفر → حوار يوضح أن الصنف سيُحذف: متابعة = حذف + متابعة
--      تغيير الحالة، إلغاء = لا تغيير.
--   5. حساب التعديل من المخزون الفيزيائي الحالي فقط (لا حجوزات/سجل حركات/حسابات سابقة).
--   6. التعديل يحدث مرة واحدة فقط عند أول دخول لمجموعة حالات التنفيذ.
--   7. لا تعديل ولا خصم إضافي أثناء الحركة داخل المجموعة.
--   8. مغادرة المجموعة تسترجع المخزون مرة واحدة بالضبط (دون تغيير الكميات المعدلة).
--   9. عودة الطلب لاحقاً للمجموعة → حساب جديد من المخزون الفيزيائي الحالي.
--  10. الكميات المعدلة تُحتفظ بها بعد مغادرة المجموعة (لا استرجاع للمطلوب الأصلي).
--  11. كل تعديل تلقائي يُسجَّل في سجل أحداث الطلب + سجل أحداث المخزون والحجز.

-- ملاحظة التمثيل (قرار «الكمية القابلة للتنفيذ»):
--   order_items تدعم أسطراً متعددة لنفس المنتج (لا قيد unique على order_id+product_id).
--   لذلك لا نحتاج بنية جديدة: نُخزِّن الكمية القابلة للتنفيذ كسطور وحدات بيع كاملة
--   (كرتونة/دستة/قطعة) مجموعها قطعاً = الكمية القابلة للتنفيذ بالضبط.
--   التفكيك حتمي من الأكبر إلى الأصغر: كرتونة (إن كانت معرفة) → دستة (12) → قطعة،
--   دون فقد أي قطعة قابلة للبيع (تحقق دائم: مجموع القطع == p_pieces).

-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) التفكيك الحتمي للقطع إلى وحدات بيع كاملة (يحفظ كل قطعة)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._decompose_to_units(
  p_pieces         integer,
  p_carton_quantity integer,
  p_price_per_piece numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_units      jsonb := '[]'::jsonb;
  v_rem        integer := GREATEST(COALESCE(p_pieces, 0), 0);
  v_carton_qty integer := GREATEST(COALESCE(p_carton_quantity, 0), 0);
  v_count      integer;
  v_unit_price numeric;
BEGIN
  IF v_rem = 0 THEN
    RETURN v_units;
  END IF;

  -- كرتونة (الأكبر) — فقط إن كانت الوحدة معرفة للمنتج
  IF v_carton_qty > 0 THEN
    v_count := v_rem / v_carton_qty;
    IF v_count > 0 THEN
      v_unit_price := ROUND(COALESCE(p_price_per_piece, 0) * v_carton_qty, 2);
      v_units := v_units || jsonb_build_object(
        'unit_type', 'carton',
        'unit_quantity', v_count,
        'unit_price', v_unit_price,
        'total_price', ROUND(v_unit_price * v_count, 2)
      );
      v_rem := v_rem % v_carton_qty;
    END IF;
  END IF;

  -- دستة (12 قطعة)
  v_count := v_rem / 12;
  IF v_count > 0 THEN
    v_unit_price := ROUND(COALESCE(p_price_per_piece, 0) * 12, 2);
    v_units := v_units || jsonb_build_object(
      'unit_type', 'dozen',
      'unit_quantity', v_count,
      'unit_price', v_unit_price,
      'total_price', ROUND(v_unit_price * v_count, 2)
    );
    v_rem := v_rem % 12;
  END IF;

  -- قطع (الأصغر) — الباقي لا يُفقد أبداً
  IF v_rem > 0 THEN
    v_unit_price := ROUND(COALESCE(p_price_per_piece, 0), 2);
    v_units := v_units || jsonb_build_object(
      'unit_type', 'piece',
      'unit_quantity', v_rem,
      'unit_price', v_unit_price,
      'total_price', ROUND(v_unit_price * v_rem, 2)
    );
  END IF;

  RETURN v_units;
END;
$$;

COMMENT ON FUNCTION public._decompose_to_units IS
  'تفكيك كمية بالقطع إلى وحدات بيع كاملة (كرتونة→دستة→قطعة) مع حفظ كل قطعة (مجموع القطع == المدخل دائماً)';

-- ---------------------------------------------------------------------------
-- 2) خطة تعديل دخول مجموعة التنفيذ (قراءة فقط؛ p_lock = قفل صفوف المخزون)
--    المصدر الوحيد: المخزون الفيزيائي الحالي (القرار 5). العروض اليومية/
--    الوميضية تُحتسب كالتزامات على نفس المخزون (القرار 4 الخاص).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._plan_execution_entry_adjustments(
  p_order_id uuid,
  p_lock     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_adjustments jsonb := '[]'::jsonb;
  v_row record;
  v_requested   integer;
  v_other_claims integer;
  v_available   integer;
  v_exec        integer;
  v_carton_qty  integer;
  v_price_per_piece numeric;
  v_req_units   jsonb;
  v_units       jsonb;
  v_total_price numeric;
BEGIN
  FOR v_row IN
    SELECT oi.product_id,
           p.product_name,
           p.carton_quantity,
           p.carton_price
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id, p.product_name, p.carton_quantity, p.carton_price
  LOOP
    -- القطع المطلوبة حالياً (أسطر الطلب الحالية — بعد أي تعديل سابق)
    SELECT COALESCE(SUM(public._to_pieces(oi.unit_type, oi.unit_quantity, COALESCE(v_row.carton_quantity, 0))), 0)
    INTO v_requested
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = v_row.product_id;

    -- التزامات أخرى على نفس المخزون (عروض يومية + عروض وميضية)
    SELECT COALESCE((
        SELECT SUM(di.quantity * odd.quantity)
        FROM public.order_daily_deals odd
        JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
        WHERE odd.order_id = p_order_id AND di.product_id = v_row.product_id
      ), 0) + COALESCE((
        SELECT SUM(foi.quantity * ofo.quantity)
        FROM public.order_flash_offers ofo
        JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
        WHERE ofo.order_id = p_order_id AND foi.product_id = v_row.product_id
      ), 0)
    INTO v_other_claims;

    -- المخزون الفيزيائي الحالي (المصدر الوحيد)
    IF p_lock THEN
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_row.product_id
      FOR UPDATE;
    ELSE
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = v_row.product_id;
    END IF;
    IF NOT FOUND THEN
      v_available := 0;
    END IF;

    v_available := GREATEST(0, v_available - v_other_claims);
    v_exec := LEAST(v_requested, v_available);

    IF v_exec = v_requested THEN
      CONTINUE; -- لا تعديل مطلوب لهذا الصنف
    END IF;

    -- سعر القطعة المشتق من أسطر الطلب الحالية (يحافظ على سعر القطعة المتفق عليه)
    SELECT COALESCE(SUM(oi.total_price), 0)
    INTO v_total_price
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = v_row.product_id;

    IF v_requested > 0 THEN
      v_price_per_piece := ROUND(v_total_price / v_requested, 2);
    ELSE
      v_price_per_piece := 0;
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'unit_type', oi.unit_type,
        'unit_quantity', oi.unit_quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price
      ) ORDER BY oi.id)
    INTO v_req_units
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = v_row.product_id;

    v_carton_qty := COALESCE(v_row.carton_quantity, 0);
    v_units := public._decompose_to_units(v_exec, v_carton_qty, v_price_per_piece);

    v_adjustments := v_adjustments || jsonb_build_object(
      'product_id',          v_row.product_id,
      'product_name',        COALESCE(v_row.product_name, ''),
      'requested_pieces',    v_requested,
      'other_claims_pieces', v_other_claims,
      'available_pieces',    v_available,
      'executable_pieces',   v_exec,
      'action',              CASE WHEN v_exec = 0 THEN 'remove' ELSE 'reduce' END,
      'carton_quantity',     v_carton_qty,
      'requested_units',     COALESCE(v_req_units, '[]'::jsonb),
      'executable_units',    v_units
    );
  END LOOP;

  RETURN v_adjustments;
END;
$$;

COMMENT ON FUNCTION public._plan_execution_entry_adjustments IS
  'خطة تعديل دخول مجموعة التنفيذ (تخفيض/حذف) من المخزون الفيزيائي الحالي فقط — لا حجوزات ولا سجل حركات ولا حسابات سابقة (القرار 5)';

-- ---------------------------------------------------------------------------
-- 3) تطبيق خطة التعديل: إعادة كتابة الأسطر + إعادة الحسابات + التدقيق
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_execution_entry_adjustments(
  p_order_id   uuid,
  p_adjustments jsonb,
  p_actor_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order       public.orders;
  v_adj         jsonb;
  v_unit        jsonb;
  v_old_items   jsonb;
  v_new_items   jsonb;
  v_new_subtotal numeric;
  v_new_total   numeric;
  v_piece_qty   integer;
  v_carton_qty  integer;
  v_reason_parts text;
  v_phys_at_moment integer;
  v_product_name text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id,
      'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price,
      'total_price', oi.total_price
    ) ORDER BY oi.id)
  INTO v_old_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_reason_parts := 'تعديل تلقائي للكمية عند دخول مرحلة التنفيذ حسب المخزون الفيزيائي الحالي.';

  FOR v_adj IN SELECT * FROM jsonb_array_elements(p_adjustments)
  LOOP
    v_product_name := COALESCE(v_adj->>'product_name', '');

    -- حذف أسطر المنتج القديمة واستبدالها بوحدات قابلة للتنفيذ (أو حذف كلي عند الصفر)
    DELETE FROM public.order_items
    WHERE order_id = p_order_id AND product_id = (v_adj->>'product_id')::uuid;

    FOR v_unit IN SELECT * FROM jsonb_array_elements(v_adj->'executable_units')
    LOOP
      IF v_unit->>'unit_type' = 'carton' THEN
        SELECT COALESCE(carton_quantity, 0) INTO v_carton_qty
        FROM public.products WHERE id = (v_adj->>'product_id')::uuid;
        v_piece_qty := (v_unit->>'unit_quantity')::int * v_carton_qty;
      ELSIF v_unit->>'unit_type' = 'dozen' THEN
        v_piece_qty := (v_unit->>'unit_quantity')::int * 12;
      ELSE
        v_piece_qty := (v_unit->>'unit_quantity')::int;
      END IF;

      INSERT INTO public.order_items
        (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
      VALUES (
        p_order_id,
        (v_adj->>'product_id')::uuid,
        v_unit->>'unit_type',
        (v_unit->>'unit_quantity')::int,
        v_piece_qty,
        (v_unit->>'unit_price')::numeric,
        (v_unit->>'total_price')::numeric
      );
    END LOOP;

    -- سجل أحداث المخزون والحجز (القرار 11 — Inventory & Reservation Event History)
    v_phys_at_moment := (v_adj->>'available_pieces')::int + (v_adj->>'other_claims_pieces')::int;

    INSERT INTO public.inventory_movements
      (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
    VALUES (
      (v_adj->>'product_id')::uuid,
      p_order_id,
      ((v_adj->>'executable_pieces')::int - (v_adj->>'requested_pieces')::int),
      'ORDER_EXECUTION_ENTRY_ADJUST',
      'تعديل تلقائي عند دخول مرحلة التنفيذ — صنف: ' || v_product_name
        || '، الكمية المطلوبة: ' || (v_adj->>'requested_pieces') || ' قطعة'
        || '، الكمية القابلة للتنفيذ: ' || (v_adj->>'executable_pieces') || ' قطعة'
        || '، المخزون الفيزيائي لحظة التنفيذ: ' || v_phys_at_moment || ' قطعة.',
      (v_adj->>'requested_pieces')::int,
      (v_adj->>'executable_pieces')::int,
      p_actor_id
    );

    v_reason_parts := v_reason_parts || ' ' || v_product_name
      || ' (المطلوب ' || (v_adj->>'requested_pieces')
      || '، القابل للتنفيذ ' || (v_adj->>'executable_pieces') || ').';
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id,
      'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price,
      'total_price', oi.total_price
    ) ORDER BY oi.id)
  INTO v_new_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  -- إعادة حساب المجاميع (حافظ على الخصم/الضريبة)
  SELECT COALESCE(SUM(total_price), 0)
  INTO v_new_subtotal
  FROM public.order_items
  WHERE order_id = p_order_id;

  v_new_total := GREATEST(
    v_new_subtotal - COALESCE(v_order.discount_amount, 0) + COALESCE(v_order.tax_amount, 0),
    0
  );

  UPDATE public.orders
  SET subtotal = v_new_subtotal,
      total_amount = v_new_total,
      updated_at = now()
  WHERE id = p_order_id;

  -- سجل أحداث الطلب (القرار 11 — Order Event History / timeline)
  INSERT INTO public.order_modification_history
    (order_id, revision_number, field_name, old_value, new_value,
     old_order_items, new_order_items, modified_by, reason, modified_at)
  VALUES (
    p_order_id,
    v_order.revision_number,
    'execution_entry_adjustment',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount)::text,
    jsonb_build_object('subtotal', v_new_subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_new_total)::text,
    v_old_items, v_new_items, p_actor_id, v_reason_parts, now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'adjusted_product_count', jsonb_array_length(p_adjustments),
    'subtotal', v_new_subtotal,
    'total_amount', v_new_total
  );
END;
$$;

COMMENT ON FUNCTION public._apply_execution_entry_adjustments IS
  'تطبيق خطة تعديل دخول مرحلة التنفيذ: إعادة كتابة أسطر order_items + إعادة المجاميع + تدقيق (order_modification_history + inventory_movements)';

-- ============================================================================
-- 4) المعاينة (قراءة فقط) — قبل تغيير الحالة
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_preview_execution_entry(
  p_token    text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order   record;
  v_has_approve boolean;
  v_has_manage boolean;
  v_plan    jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  -- من يملك صلاحية التصديق أو الإدارة يملك صلاحية المعاينة
  SELECT check_capability(p_token, 'orders.approve') INTO v_has_approve;
  SELECT check_capability(p_token, 'orders.manage') INTO v_has_manage;
  IF NOT (v_has_approve OR v_has_manage) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  -- داخل مجموعة التنفيذ أو محسوم مسبقاً → لا تعديل جديد
  IF v_order.status = ANY(public.execution_status_group()) OR v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'entering', false,
      'exempt', false,
      'adjustments', '[]'::jsonb
    );
  END IF;

  -- البيع بالسالب (تجاوز إداري صريح) → دخول كما هو بدون تعديل/حوار (القرار المعتمد)
  IF COALESCE(v_order.order_negative_selling_allowed, true) THEN
    RETURN jsonb_build_object(
      'entering', true,
      'exempt', true,
      'adjustments', '[]'::jsonb
    );
  END IF;

  v_plan := public._plan_execution_entry_adjustments(p_order_id, false);

  RETURN jsonb_build_object(
    'entering', true,
    'exempt', false,
    'adjustments', v_plan
  );
END;
$$;

COMMENT ON FUNCTION public.governed_preview_execution_entry IS
  'معاينة تعديل دخول مرحلة التنفيذ (قراءة فقط) — تخطط تخفيض/حذف الأصناف حسب المخزون الفيزيائي الحالي. لا تغيّر أي شيء.';

-- ============================================================================
-- 5) governed_approve_order — بوابة تعديل الدخول + معامل تأكيد اختياري
-- ============================================================================
DROP FUNCTION IF EXISTS public.governed_approve_order(text, uuid, text);

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token               text,
  p_id                  uuid,
  p_reason              text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_order record;
  v_deduct_result jsonb;
  v_req_row record;
  v_reserved integer;
  v_adjust_plan jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_status := v_order.status;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  -- Execution Group Entry Finalization (القرارات 1..6):
  -- الاعتماد يدخل مجموعة التنفيذ دائماً → فحص المخزون الفيزيائي أولاً.
  -- البيع بالسالب (تجاوز إداري) → دخول كما هو بدون تعديل.
  IF NOT COALESCE(v_order.order_negative_selling_allowed, true) THEN
    v_adjust_plan := public._plan_execution_entry_adjustments(p_id, true);
    IF jsonb_array_length(v_adjust_plan) > 0 THEN
      IF p_confirm_adjustments THEN
        PERFORM public._apply_execution_entry_adjustments(p_id, v_adjust_plan, v_employee_id);
      ELSE
        RETURN jsonb_build_object(
          'error', 'ADJUSTMENT_REQUIRED',
          'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يلزم تأكيد التعديل قبل دخول مرحلة التنفيذ.',
          'adjustments', v_adjust_plan
        );
      END IF;
    END IF;
  END IF;

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items إطلاقًا عند الاعتماد
  -- (تُخصم الكمية كما قدمها المستخدم بالضبط). تحرير الحجز عند الخروج من submitted.
  IF v_old_status = 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم اعتماد الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_employee_id
        );
      END IF;
    END LOOP;
  END IF;

  -- Entering the Execution State Group → deduct exactly once.
  v_deduct_result := public.governed_inventory_deduct(p_id);
  IF (v_deduct_result->>'error') IS NOT NULL THEN
    RETURN v_deduct_result;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- 6) governed_change_order_status — بوابة تعديل الدخول + معامل تأكيد اختياري
-- ============================================================================
DROP FUNCTION IF EXISTS public.governed_change_order_status(text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.governed_change_order_status(
  p_token               text,
  p_order_id            uuid,
  p_new_status          text,
  p_reason              text DEFAULT NULL::text,
  p_reference_number    text DEFAULT NULL::text,
  p_confirm_adjustments boolean DEFAULT false
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status text;
  v_customer_id uuid;
  v_total_amount decimal(12,2);
  v_payment_method varchar(20);
  v_from_idx int;
  v_to_idx int;
  v_required_capability text;
  v_has_capability boolean;
  v_is_exceptional boolean;
  v_order record;
  v_deduct_result jsonb;
  v_restore_result jsonb;
  v_req_row record;
  v_requested integer;
  v_capacity integer;
  v_reserved integer;
  v_notices jsonb := '[]'::jsonb;
  v_adjust_plan jsonb;
  v_neg boolean;
  v_deducted_at timestamptz;
  statuses text[] := ARRAY[
    'draft','submitted','reviewing','returned_for_revision',
    'approved','preparing','prepared','ready_for_dispatch',
    'sent_to_delivery','dispatched','deferred','cancelled',
    'delivered','stock_review'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_SESSION');
  END IF;

  IF NOT (p_new_status = ANY(statuses)) THEN
    RETURN json_build_object('success', false, 'error', chr(1581)||chr(1575)||chr(1604)||chr(1577)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1589)||chr(1575)||chr(1604)||chr(1581)||chr(1577));
  END IF;

  SELECT status::text, customer_id, total_amount, payment_method
  INTO v_current_status, v_customer_id, v_total_amount, v_payment_method
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1594)||chr(1610)||chr(1585)||' '||chr(1605)||chr(1608)||chr(1580)||chr(1608)||chr(1583));
  END IF;

  IF v_current_status = p_new_status THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1591)||chr(1604)||chr(1576)||' '||chr(1576)||chr(1606)||chr(1601)||chr(1587)||' '||chr(1575)||chr(1604)||chr(1581)||chr(1575)||chr(1604)||chr(1577));
  END IF;

  v_from_idx := array_position(statuses, v_current_status);
  v_to_idx := array_position(statuses, p_new_status);

  SELECT check_capability(p_token, 'orders.manage') INTO v_has_capability;
  IF v_has_capability THEN
    v_required_capability := 'orders.manage';
  ELSE
    IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
      v_required_capability := 'orders.review';
    ELSIF v_current_status = 'approved' AND p_new_status = 'preparing' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF v_current_status = 'preparing' AND p_new_status = 'prepared' THEN
      v_required_capability := 'warehouse.complete_preparation';
    ELSIF (v_current_status = 'prepared' OR v_current_status = 'ready_for_dispatch') AND p_new_status = 'sent_to_delivery' THEN
      v_required_capability := 'transportation.send_to_delivery';
    ELSE
      v_required_capability := 'orders.manage';
    END IF;
  END IF;

  SELECT check_capability(p_token, v_required_capability) INTO v_has_capability;
  IF NOT v_has_capability THEN
    RETURN json_build_object('success', false, 'error', chr(1604)||chr(1610)||chr(1587)||' '||chr(1604)||chr(1583)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1589)||chr(1604)||chr(1575)||chr(1581)||chr(1610)||chr(1577)||' '||chr(1604)||chr(1607)||chr(1584)||chr(1575)||' '||chr(1575)||chr(1604)||chr(1573)||chr(1580)||chr(1585)||chr(1575)||chr(1569));
  END IF;

  v_is_exceptional := false;
  IF v_current_status = 'cancelled' OR p_new_status = 'cancelled' THEN
    v_is_exceptional := true;
  ELSIF v_current_status = 'deferred' OR p_new_status = 'deferred' THEN
    v_is_exceptional := true;
  ELSIF v_to_idx < v_from_idx THEN
    v_is_exceptional := true;
  ELSIF v_to_idx > v_from_idx + 1 THEN
    v_is_exceptional := true;
  END IF;

  IF v_is_exceptional AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1580)||chr(1575)||chr(1569)||' '||chr(1573)||chr(1583)||chr(1582)||chr(1575)||chr(1604)||' '||chr(1587)||chr(1576)||chr(1576)||' '||chr(1604)||chr(1604)||chr(1578)||chr(1594)||chr(1610)||chr(1585)||' '||chr(1575)||chr(1604)||chr(1575)||chr(1587)||chr(1578)||chr(1579)||chr(1606)||chr(1575)||chr(1574)||chr(1610));
  END IF;

  IF v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN
    IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
      RETURN json_build_object('success', false, 'error', chr(1575)||chr(1604)||chr(1585)||chr(1602)||chr(1605)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1580)||chr(1593)||chr(1609)||' '||chr(1575)||chr(1580)||chr(1576)||chr(1575)||chr(1583)||chr(1610)||' '||chr(1593)||chr(1606)||chr(1583)||' '||chr(1575)||chr(1604)||chr(1578)||chr(1581)||chr(1608)||chr(1610)||chr(1604)||' '||chr(1573)||chr(1604)||chr(1609)||' '||chr(1580)||chr(1575)||chr(1585)||chr(1610)||' '||chr(1575)||chr(1604)||chr(1605)||chr(1585)||chr(1575)||chr(1580)||chr(1593)||chr(1577));
    END IF;
  END IF;

  -- Execution Group Entry Finalization (القرارات 1..6):
  -- يُنفَّذ قبل تحرير الحجز حتى تعكس الكميات المُحرَّرة/المُبقاة الكمية القابلة للتنفيذ.
  IF p_new_status = ANY(public.execution_status_group())
     AND v_current_status <> ALL(public.execution_status_group()) THEN
    SELECT order_negative_selling_allowed, inventory_deducted_at
    INTO v_neg, v_deducted_at
    FROM public.orders WHERE id = p_order_id;

    IF v_deducted_at IS NULL AND NOT COALESCE(v_neg, true) THEN
      v_adjust_plan := public._plan_execution_entry_adjustments(p_order_id, true);
      IF jsonb_array_length(v_adjust_plan) > 0 THEN
        IF p_confirm_adjustments THEN
          PERFORM public._apply_execution_entry_adjustments(p_order_id, v_adjust_plan, v_session.identity_id);
        ELSE
          RETURN json_build_object(
            'success', false,
            'error', 'ADJUSTMENT_REQUIRED',
            'details', 'الكمية المطلوبة تتجاوز المخزون الفيزيائي المتاح. يلزم تأكيد التعديل قبل دخول مرحلة التنفيذ.',
            'adjustments', v_adjust_plan
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Dynamic Reservation محرك حساب فقط — لا يُعدَّل order_items عند الاعتماد إطلاقًا.

  -- تحرير الحجز عند الخروج من submitted (قبل أي خصم/تغيير حالة).
  IF v_current_status = 'submitted' AND p_new_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_reserved := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      IF v_reserved > 0 THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, -v_reserved, 'RESERVATION_RELEASE',
          'تم تغيير حالة الفاتورة وتم تحرير حجز الكمية.',
          v_reserved, 0, v_session.identity_id
        );
      END IF;
    END LOOP;
  END IF;

  -- الدخول إلى submitted: تخصيص + إشعار عند تجاوز السعة المحدودة (لا رفض).
  IF p_new_status = 'submitted' AND v_current_status <> 'submitted' THEN
    FOR v_req_row IN
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    LOOP
      v_requested := public._requested_quantity_for_order(v_req_row.product_id, p_order_id);
      v_reserved  := public._reserved_quantity_for_order(v_req_row.product_id, p_order_id);
      v_capacity  := public._reservation_capacity(v_req_row.product_id, p_order_id);

      IF v_reserved > 0 AND v_capacity IS NOT NULL THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_reserved, 'RESERVATION_ALLOCATE',
          'تم حجز الكمية لهذا الصنف.',
          0, v_reserved, v_session.identity_id
        );
      END IF;

      IF v_capacity IS NOT NULL AND v_requested > v_capacity THEN
        INSERT INTO public.inventory_movements
          (product_id, order_id, quantity_change, movement_type, reason, previous_quantity, new_quantity, created_by)
        VALUES (
          v_req_row.product_id, p_order_id, v_requested, 'RESERVATION_NOTICE',
          'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك.',
          0, v_requested, v_session.identity_id
        );
        v_notices := v_notices || jsonb_build_object(
          'product_id', v_req_row.product_id,
          'requested_quantity', v_requested,
          'available_capacity', v_capacity
        );
      END IF;
    END LOOP;
  END IF;

  -- Inventory management (Execution State Group)
  IF p_new_status != v_current_status THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Case 1: Entering the Execution State Group → deduct exactly once.
    IF p_new_status = ANY(public.execution_status_group())
       AND v_current_status <> ALL(public.execution_status_group())
       AND v_order.inventory_deducted_at IS NULL THEN
      v_deduct_result := public.governed_inventory_deduct(p_order_id);
      IF (v_deduct_result->>'error') IS NOT NULL THEN
        RETURN v_deduct_result::json;
      END IF;
    END IF;

    -- Case 2: Leaving the Execution State Group via cancellation → restore.
    IF p_new_status = 'cancelled' THEN
      v_restore_result := public.governed_inventory_restore(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    reference_number = CASE
      WHEN v_current_status = 'submitted' AND p_new_status = 'reviewing' THEN trim(p_reference_number)
      ELSE reference_number
    END,
    delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_order_id, v_current_status, p_new_status, v_session.identity_id, p_reason, now());

  IF p_new_status = 'cancelled' AND v_payment_method = 'credit' THEN
    UPDATE customer_credit_accounts SET
      reserved_credit = GREATEST(0, reserved_credit - v_total_amount),
      updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from_status', v_current_status,
    'to_status', p_new_status,
    'reservations_notice', v_notices
  );
END;
$function$;

-- ============================================================================
-- 7) المنح
-- ============================================================================
REVOKE ALL ON FUNCTION public._decompose_to_units(integer, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._plan_execution_entry_adjustments(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_execution_entry_adjustments(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.governed_preview_execution_entry(text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_approve_order(text, uuid, text, boolean) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_change_order_status(text, uuid, text, text, text, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
