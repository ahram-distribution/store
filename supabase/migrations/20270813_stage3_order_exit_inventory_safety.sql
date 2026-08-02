-- Stage 3 follow-up: keep approved-order inventory and deletion history consistent.

CREATE OR REPLACE FUNCTION public.restore_inventory_before_approved_order_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF OLD.status = 'approved'
     AND NEW.status IN ('draft', 'submitted', 'reviewing', 'returned_for_revision', 'stock_review', 'cancelled')
     AND OLD.inventory_deducted_at IS NOT NULL THEN
    PERFORM public.governed_inventory_restore(
      OLD.id,
      'ORDER_APPROVED_EXIT_RESTORE',
      'تمت إعادة الكمية لأن الطلب غادر حالة الاعتماد.'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restore_inventory_before_approved_order_exit ON public.orders;
CREATE TRIGGER trg_restore_inventory_before_approved_order_exit
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.restore_inventory_before_approved_order_exit();

DROP TRIGGER IF EXISTS trg_restore_inventory_before_order_deletion ON public.orders;
DROP FUNCTION IF EXISTS public.restore_inventory_before_order_deletion();

CREATE TABLE IF NOT EXISTS public.order_deletion_inventory_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  order_id uuid NOT NULL,
  order_snapshot jsonb NOT NULL,
  inventory_movements jsonb NOT NULL
);

ALTER TABLE public.order_deletion_inventory_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.governed_delete_order(p_token uuid, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, app, extensions, pg_catalog
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF NOT public.check_capability(p_token, 'orders.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: orders.delete'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_session.identity_type <> 'employee' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_visible := public.get_visible_employee_ids(p_token);
  IF NOT (v_order.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: order not in visibility scope'; END IF;

  IF v_order.payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts
    SET reserved_credit = GREATEST(0, reserved_credit - v_order.total_amount), updated_at = now()
    WHERE customer_id = v_order.customer_id;
  END IF;

  PERFORM public.governed_inventory_restore(
    p_id,
    'ORDER_DELETION_RESTORE',
    'تمت إعادة الكمية قبل حذف الطلب.'
  );

  -- Preserve the complete inventory ledger with its order snapshot before removing
  -- the live order. The audit stays private and no live movement can be orphaned.
  INSERT INTO public.order_deletion_inventory_audit (
    order_id,
    order_snapshot,
    inventory_movements
  )
  VALUES (
    v_order.id,
    to_jsonb(v_order),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(im))
       FROM public.inventory_movements im
       WHERE im.order_id = p_id),
      '[]'::jsonb
    )
  );

  -- Delete only the live dependent rows, after their complete inventory audit
  -- has been retained above. This preserves the foreign key and avoids orphans.
  DELETE FROM public.inventory_movements WHERE order_id = p_id;
  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_status_history WHERE order_id = p_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_id;
  DELETE FROM public.orders WHERE id = p_id;
  RETURN true;
END;
$$;
