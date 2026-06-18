-- 20260728_fix_governed_dispatch_delivery_tracking.sql
-- Fix: governed_dispatch_order now accepts p_assigned_to and creates delivery_tracking
-- Root cause: WarehousePage.tsx passes p_assigned_to (delivery employee ID) to the RPC,
-- but the original function signature didn't accept it, so the assignment was silently dropped.
-- The order was set to 'dispatched' but no delivery_tracking record was created,
-- making the order invisible to the delivery team in DeliveryPage/DeliveryDetailPage.

-- Must DROP first: CREATE OR REPLACE cannot change parameter list,
-- and the existing 2-param overload would cause ambiguity error 42725.
DROP FUNCTION IF EXISTS public.governed_dispatch_order(p_token uuid, p_id uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.governed_dispatch_order(
  p_token uuid,
  p_id uuid,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_dt public.delivery_tracking;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.dispatch');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('approved', 'ready_for_dispatch', 'sent_to_delivery') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE');
  END IF;

  UPDATE public.orders SET status = 'dispatched', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'dispatched', v_session.identity_id, now());

  -- NEW: Create delivery_tracking record if p_assigned_to is provided
  -- This fixes the bug where WarehousePage passed p_assigned_to but the function ignored it
  IF p_assigned_to IS NOT NULL THEN
    INSERT INTO public.delivery_tracking (order_id, status, assigned_to, assigned_by, assigned_at)
    VALUES (p_id, 'assigned', p_assigned_to, v_employee_id, now())
    RETURNING * INTO v_dt;
  END IF;

  RETURN jsonb_build_object('success', true, 'delivery_id', v_dt.id);
END;
$$;

COMMENT ON FUNCTION public.governed_dispatch_order IS 'شحن طلب — مع تعيين مندوب توصيل وإنشاء سجل تتبع';
