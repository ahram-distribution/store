-- ============================================================================
-- PHASE A — PHYSICAL INVENTORY ENGINE (Delete-path restore safety)
-- ============================================================================
-- Frozen contract: inventory is restored IMMEDIATELY whenever an Approved order
-- leaves Approved for ANY reason, including DELETION. This migration hardens the
-- two live delete paths that bypassed the exactly-once restore:
--
--   1. governed_supreme_delete_cancelled_order used to UPSERT stock back
--      unconditionally. A cancelled order had ALREADY restored on leaving
--      Approved, so deleting it double-restored (inflated stock). It now calls
--      governed_inventory_restore whose exactly-once guard (inventory_deducted_at
--      / inventory_deducted_items) makes redundant calls no-ops.
--
--   2. governed_deletion_execute_orders deleted Approved orders without restoring
--      (stock leak) and never cleaned inventory_movements (FK failure). It now
--      restores every Approved/deducted order being deleted, then clears the
--      movements before removing the orders.
--
-- Both functions are CREATE OR REPLACE, safe to re-apply.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_supreme_delete_cancelled_order(p_token text, p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_is_super boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can delete cancelled orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_order.status != 'cancelled' THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE', 'detail', 'Only cancelled orders can be deleted');
  END IF;

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

  -- Phase A restore: exactly-once. A cancelled order already restored on leaving
  -- Approved, so this is normally a no-op (nothing_to_restore). It only restores
  -- if the order is still marked deducted, preventing both leaks and double
  -- restores.
  PERFORM public.governed_inventory_restore(
    p_order_id,
    'ORDER_DELETION_RESTORE',
    'تمت إعادة الكمية قبل حذف الطلب.'
  );

  IF v_order.payment_method = 'credit' THEN
    UPDATE public.customer_credit_accounts
    SET reserved_credit = GREATEST(reserved_credit - v_order.total_amount, 0),
        updated_at = now()
    WHERE customer_id = v_order.customer_id;
  END IF;

  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_order_id);

  DELETE FROM public.collections WHERE order_id = p_order_id;

  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_order_id);

  DELETE FROM public.preparation_records WHERE order_id = p_order_id;

  DELETE FROM public.delivery_tracking WHERE order_id = p_order_id;

  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_order_id);

  DELETE FROM public.returns WHERE order_id = p_order_id;

  DELETE FROM public.credit_invoice_cheques
  WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = p_order_id);

  DELETE FROM public.credit_invoices WHERE order_id = p_order_id;

  DELETE FROM public.auction_awards WHERE order_id = p_order_id;

  DELETE FROM public.order_daily_deals WHERE order_id = p_order_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.order_status_history WHERE order_id = p_order_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_order_id;

  DELETE FROM public.orders WHERE id = p_order_id;

  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count)
  VALUES (v_session.employee_id, 'order', ARRAY[p_order_id], 1);

  RETURN jsonb_build_object('success', true, 'action', 'deleted', 'order_id', p_order_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.governed_deletion_execute_orders(p_token uuid, p_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_related jsonb;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_order_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT jsonb_build_object(
        'order_items', (SELECT COUNT(*)::int FROM public.order_items oi WHERE oi.order_id = ANY(p_ids)),
        'order_status_history', (SELECT COUNT(*)::int FROM public.order_status_history osh WHERE osh.order_id = ANY(p_ids)),
        'order_modification_history', (SELECT COUNT(*)::int FROM public.order_modification_history omh WHERE omh.order_id = ANY(p_ids)),
        'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking dt WHERE dt.order_id = ANY(p_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.order_id = ANY(p_ids)),
        'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.order_id = ANY(p_ids)),
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices ci WHERE ci.order_id = ANY(p_ids)),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals odd WHERE odd.order_id = ANY(p_ids)),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers ofo WHERE ofo.order_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- Phase A restore: every Approved/deducted order being deleted restores its
    -- stock exactly once before removal (no leak, no double restore).
    PERFORM public.governed_inventory_restore(
      oid,
      'ORDER_DELETION_RESTORE',
      'تمت إعادة الكمية قبل حذف الطلب.'
    )
    FROM unnest(p_ids) AS oid
    JOIN public.orders o ON o.id = oid
    WHERE o.status = 'approved' AND o.inventory_deducted_at IS NOT NULL;

    -- Phase A: clear movements (written by deduct/restore) so the FK from
    -- inventory_movements.order_id does not block deleting the orders.
    DELETE FROM public.inventory_movements WHERE order_id = ANY(p_ids);

    -- Delete all related in FK order
    DELETE FROM public.order_flash_offers WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_daily_deals WHERE order_id = ANY(p_ids);
    DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(p_ids));
    DELETE FROM public.credit_invoices WHERE order_id = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(p_ids));
    DELETE FROM public.collections WHERE order_id = ANY(p_ids);
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(p_ids));
    DELETE FROM public.returns WHERE order_id = ANY(p_ids);
    DELETE FROM public.preparation_exceptions WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = ANY(p_ids));
    DELETE FROM public.preparation_records WHERE order_id = ANY(p_ids);
    DELETE FROM public.delivery_tracking WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_modification_history WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_status_history WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_items WHERE order_id = ANY(p_ids);

    v_deleted_count := 0;
    FOREACH v_order_id IN ARRAY p_ids LOOP
        DELETE FROM public.orders WHERE id = v_order_id;
        IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
    END LOOP;

    INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
    VALUES (v_session.employee_id, 'orders', p_ids, v_deleted_count, v_related)
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);
END;
$function$;
