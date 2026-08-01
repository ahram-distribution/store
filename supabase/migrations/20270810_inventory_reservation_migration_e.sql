-- ============================================================================
-- INVENTORY RESERVATION & ALLOCATION — MIGRATION E
-- ============================================================================
-- وفق التصميم المعتمد: docs/01-ARCHITECTURE/BUSINESS_SPECIFICATION_RESERVATION_ALLOCATION.md
-- (BR-AUD-01 — القسم 7 «سجل أحداث الطلب») + docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md
-- (القسم 15 — خطوة التحقق: «التحقق من سجل inventory_movements لكل خطوة»).
--
-- 1. RPC عامة جديدة للاطلاع فقط (إدارة) باسم واضح:
--      governed_get_order_event_log(p_token text, p_order_id uuid) RETURNS jsonb
--    — تُعرِض سجل أحداث الحجز/المخزون للطلب من public.inventory_movements
--      (BR-AUD-01): كل عملية حجز/تخصيص/تعديل/خصم/استرجاع/تحرير مع
--      (product_name, movement_type, reason, quantity_change, previous_quantity,
--       new_quantity, created_at, created_by_name).
--    — تفويض صارم: جلسة سليمة + صلاحية orders.manage فقط (نفس عقد اللقطة
--      الإدارية governed_get_order_inventory_snapshot — BR-VIS-02).
--    — لا كشف لأرقام مخزون/حجز خام خارج هذا السجل الإداري (BR-VIS-01 محفوظ
--      لقنوات المندوب/المتجر).
--
-- لا جداول جديدة، لا أعمدة جديدة، لا ترحيل بيانات، لا تغيير لأي دالة قائمة.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_get_order_event_log(
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
  v_events jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'orders.manage');

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(ev ORDER BY (ev->>'created_at') DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'id',               im.id,
      'product_id',       im.product_id,
      'product_name',     pr.product_name,
      'movement_type',    im.movement_type,
      'reason',           im.reason,
      'quantity_change',  im.quantity_change,
      'previous_quantity', im.previous_quantity,
      'new_quantity',     im.new_quantity,
      'created_at',       im.created_at,
      'created_by',       im.created_by,
      'created_by_name',  e.full_name
    ) AS ev
    FROM public.inventory_movements im
    LEFT JOIN public.products pr  ON pr.id = im.product_id
    LEFT JOIN public.employees e  ON e.identity_id = im.created_by
    WHERE im.order_id = p_order_id
  ) t;

  RETURN jsonb_build_object('events', v_events);
END;
$$;

COMMENT ON FUNCTION public.governed_get_order_event_log IS
  'سجل أحداث الطلب (BR-AUD-01) — كل حركات الحجز/التخصيص/الخصم/الاسترجاع من inventory_movements (إدارة فقط)';

-- ============================================================================
-- END OF MIGRATION E
-- ============================================================================
