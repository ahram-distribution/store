-- ============================================================================
-- Fix: governed_supreme_delete_cancelled_order — ON CONFLICT duplicate row error
-- Root Cause:
--   The inventory restoration query selects order_items rows individually.
--   When a cancelled order has multiple order_items with the same product_id
--   (mixed-unit orders: e.g. 1 carton + 5 pieces of same product), the
--   INSERT ... ON CONFLICT DO UPDATE receives two rows for the same product_id
--   and fails:
--     "ON CONFLICT DO UPDATE command cannot affect row a second time"
--
-- Fix:
--   Aggregate duplicate product_ids using SUM(piece_quantity) + GROUP BY
--   before the INSERT. Each product_id appears exactly once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_supreme_delete_cancelled_order(
  p_token text,
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_is_super boolean;
BEGIN
  -- Validate session
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Only Supreme Management (الإدارة العليا)
  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can delete cancelled orders');
  END IF;

  -- Load order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Only allow deletion of cancelled orders
  IF v_order.status != 'cancelled' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be deleted');
  END IF;

  -- Record audit trail before deletion
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, modified_by, reason, modified_at
  )
  VALUES (
    p_order_id,
    v_order.revision_number,
    'supreme_delete',
    jsonb_build_object(
      'status', v_order.status,
      'total_amount', v_order.total_amount,
      'order_number', v_order.order_number
    )::text,
    jsonb_build_object('deleted', true)::text,
    (SELECT jsonb_agg(row_to_json(oi.*)) FROM public.order_items oi WHERE oi.order_id = p_order_id),
    v_session.identity_id,
    COALESCE(p_reason, 'Deleted by Supreme Management'),
    now()
  );

  -- Restore inventory — FIX: aggregate duplicate product_ids with SUM
  INSERT INTO public.inventory (product_id, quantity)
  SELECT oi.product_id, SUM(oi.piece_quantity)
  FROM public.order_items oi WHERE oi.order_id = p_order_id
  GROUP BY oi.product_id
  ON CONFLICT (product_id) DO UPDATE
  SET quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = now();

  -- Release credit reservation
  IF v_order.payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts
    SET reserved_credit = GREATEST(reserved_credit - v_order.total_amount, 0),
        updated_at = now()
    WHERE customer_id = v_order.customer_id;
  END IF;

  -- Delete treasury_transactions referencing collections
  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_order_id);

  -- Delete collections
  DELETE FROM public.collections WHERE order_id = p_order_id;

  -- Delete preparation_exceptions
  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_order_id);

  -- Delete preparation_records
  DELETE FROM public.preparation_records WHERE order_id = p_order_id;

  -- Delete delivery_tracking
  DELETE FROM public.delivery_tracking WHERE order_id = p_order_id;

  -- Delete return_items
  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_order_id);

  -- Delete returns
  DELETE FROM public.returns WHERE order_id = p_order_id;

  -- Delete credit_invoice_cheques
  DELETE FROM public.credit_invoice_cheques
  WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = p_order_id);

  -- Delete credit_invoices
  DELETE FROM public.credit_invoices WHERE order_id = p_order_id;

  -- Delete auction_awards
  DELETE FROM public.auction_awards WHERE order_id = p_order_id;

  -- Delete order_daily_deals, order_flash_offers
  DELETE FROM public.order_daily_deals WHERE order_id = p_order_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_order_id;

  -- Delete order_items, order_status_history, order_modification_history
  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.order_status_history WHERE order_id = p_order_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_order_id;

  -- Delete the order
  DELETE FROM public.orders WHERE id = p_order_id;

  -- Audit log
  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count)
  VALUES (v_session.employee_id, 'order', ARRAY[p_order_id], 1);

  RETURN jsonb_build_object('success', true, 'action', 'deleted', 'order_id', p_order_id);
END;
$$;

COMMENT ON FUNCTION public.governed_supreme_delete_cancelled_order IS
  'Supreme Management (الإدارة العليا): Permanently delete a cancelled order with full cleanup. FIX: aggregates duplicate product_ids on inventory restore.';

GRANT EXECUTE ON FUNCTION public.governed_supreme_delete_cancelled_order TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
