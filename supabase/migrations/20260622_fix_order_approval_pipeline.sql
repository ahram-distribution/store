-- Fix order approval pipeline
-- governed_approve_order was only accepting 'submitted' status,
-- but the normal workflow includes 'submitted → reviewing → approved'.
-- This change allows both 'submitted' and 'reviewing' as valid pre-approval statuses.

DROP FUNCTION IF EXISTS public.governed_approve_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token uuid,
  p_id uuid
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
  v_daily_deal record;
  v_deal_item record;
  v_flash_offer record;
  v_fo_item record;
  v_inv record;
  v_new_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.identity_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status NOT IN ('submitted', 'reviewing') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- Deduct daily deal available_quantity and component product inventory
  FOR v_daily_deal IN
    SELECT odd.deal_id, odd.quantity
    FROM order_daily_deals odd
    WHERE odd.order_id = p_id
  LOOP
    UPDATE public.daily_deals
    SET available_quantity = GREATEST(available_quantity - v_daily_deal.quantity, 0),
        status = CASE
          WHEN available_quantity - v_daily_deal.quantity <= 0 THEN 'sold_out'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_daily_deal.deal_id;

    FOR v_deal_item IN
      SELECT di.product_id, di.quantity
      FROM daily_deal_items di
      WHERE di.deal_id = v_daily_deal.deal_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_deal_item.quantity * v_daily_deal.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_deal_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Deduct flash offer available_quantity and component product inventory
  FOR v_flash_offer IN
    SELECT ofo.offer_id, ofo.quantity
    FROM order_flash_offers ofo
    WHERE ofo.order_id = p_id
  LOOP
    UPDATE public.flash_offers
    SET available_quantity = GREATEST(available_quantity - v_flash_offer.quantity, 0),
        status = CASE
          WHEN available_quantity - v_flash_offer.quantity <= 0 THEN 'sold_out'::flash_offer_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_flash_offer.offer_id;

    FOR v_fo_item IN
      SELECT foi.product_id, foi.quantity
      FROM flash_offer_items foi
      WHERE foi.offer_id = v_flash_offer.offer_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_fo_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_fo_item.quantity * v_flash_offer.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_fo_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Deduct normal order item inventory
  FOR v_deal_item IN
    SELECT oi.product_id, oi.piece_quantity
    FROM order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
    IF FOUND THEN
      v_new_qty := GREATEST(v_inv.quantity - v_deal_item.piece_quantity, 0);
      UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
      WHERE product_id = v_deal_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.orders SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS 'اعتماد طلب مع خصم المخزون (منتجات + عروض يومية + عروض ساعة)';
