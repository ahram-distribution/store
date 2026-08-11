-- ============================================================================
-- FIX: DELETE COMPLETED DELIVERY ORDERS — delivery_actions FK dependency
-- ============================================================================
-- Reported failure (ORD-2026-000146):
--
--   Failed to delete order:
--   update or delete on table "delivery_tracking" violates foreign key
--   constraint "delivery_actions_delivery_tracking_id_fkey"
--   on table "delivery_actions"
--
-- Root cause:
--   delivery_actions.delivery_tracking_id REFERENCES delivery_tracking(id)
--   (created in 20260809_delivery_operations.sql). The order-deletion RPCs
--   deleted delivery_tracking BEFORE deleting the order's delivery_actions, so
--   any order with recorded delivery steps (a completed delivery) failed the FK.
--
-- Surgical fix (no redesign):
--   Each order-deletion path deletes the order's own delivery_actions rows
--   BEFORE the order's delivery_tracking rows:
--
--     delivery_actions
--     -> delivery_tracking
--     -> existing order deletion flow (collections, returns, preparation,
--        credit invoices, inventory movements, items, order, ...)
--
--   delivery_actions is the ONLY table with an FK into delivery_tracking(id)
--   (verified across the repo), so removing it first fully unblocks the
--   delivery_tracking delete. Every delete below is scoped by the order being
--   deleted (order_id / the order's tracking ids) — no other order's delivery
--   records are touched.
--
--   Scope: all three order-deletion entry points share this exact dependency:
--     1. governed_delete_order                    (legacy single path)
--     2. governed_supreme_delete_cancelled_order  (single path, Order Detail)
--     3. governed_deletion_execute_orders         (bulk deletion center)
--   Each function is one plpgsql transaction: any failure rolls back the whole
--   deletion. Orders with no delivery records are unaffected.
--
--   No FK constraints are disabled or changed; the journey model, assignment,
--   tracking, collection, and delivery workflow are untouched.
--
-- SAFETY: code only; same policy as the delivery/journey migrations — it is
-- NOT applied to the live Supabase project automatically.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) governed_delete_order — legacy single-order delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_order(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
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

  -- Restore inventory first if the order belongs to the Execution State Group.
  -- governed_inventory_restore is exactly-once, so this is a safe no-op for
  -- orders that were already restored or never deducted.
  PERFORM public.governed_inventory_restore(
    p_id,
    'ORDER_DELETION_RESTORE',
    'تمت إعادة الكمية قبل حذف الطلب.'
  );

  -- Remove every dependent record (children before parents), then the order.
  -- Note: no snapshot is archived. The business decision requires permanent
  -- deletion (not an archive), so order_deletion_inventory_audit rows for this
  -- order are purged too — no record may reference a deleted order.
  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_id);
  DELETE FROM public.collections WHERE order_id = p_id;

  DELETE FROM public.credit_invoice_cheques
  WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = p_id);
  DELETE FROM public.credit_invoices WHERE order_id = p_id;

  DELETE FROM public.credit_collection_requests
  WHERE invoice_id IN (SELECT id FROM public.credit_collection_invoices WHERE order_id = p_id);
  DELETE FROM public.credit_collection_invoices WHERE order_id = p_id;

  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_id);
  DELETE FROM public.returns WHERE order_id = p_id;

  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_id);
  DELETE FROM public.preparation_records WHERE order_id = p_id;

  -- Delivery children: delivery_actions must go before delivery_tracking
  -- (delivery_actions_delivery_tracking_id_fkey). Scoped to this order's
  -- tracking rows only.
  DELETE FROM public.delivery_actions
  WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = p_id);
  DELETE FROM public.delivery_tracking WHERE order_id = p_id;

  DELETE FROM public.auction_awards WHERE order_id = p_id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;
  DELETE FROM public.inventory_movements WHERE order_id = p_id;
  DELETE FROM public.order_deletion_inventory_audit WHERE order_id = p_id;
  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_status_history WHERE order_id = p_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_id;
  DELETE FROM public.orders WHERE id = p_id;
  RETURN true;
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_delete_order(uuid, uuid) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- 2) governed_supreme_delete_cancelled_order — single path (Order Detail)
-- ---------------------------------------------------------------------------
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

  v_is_super := public.is_supreme_management(v_session.employee_id)
    OR EXISTS (
      SELECT 1 FROM public.employee_roles er
      JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('الرئيس التنفيذي', 'executive_director')
    );
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

  -- Restore inventory first if the order belongs to the Execution State Group.
  -- A cancelled order already restored on leaving the group, so this is
  -- normally an exactly-once no-op; it still restores if marked deducted.
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

  -- Remove every dependent record (children before parents), then the order.
  DELETE FROM public.treasury_transactions
  WHERE reference_type = 'collection'
    AND reference_id IN (SELECT id FROM public.collections WHERE order_id = p_order_id);

  DELETE FROM public.collections WHERE order_id = p_order_id;

  DELETE FROM public.preparation_exceptions
  WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = p_order_id);

  DELETE FROM public.preparation_records WHERE order_id = p_order_id;

  -- Delivery children: delivery_actions must go before delivery_tracking
  -- (delivery_actions_delivery_tracking_id_fkey). Scoped to this order's
  -- tracking rows only.
  DELETE FROM public.delivery_actions
  WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = p_order_id);

  DELETE FROM public.delivery_tracking WHERE order_id = p_order_id;

  DELETE FROM public.return_items
  WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = p_order_id);

  DELETE FROM public.returns WHERE order_id = p_order_id;

  DELETE FROM public.credit_invoice_cheques
  WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = p_order_id);

  DELETE FROM public.credit_invoices WHERE order_id = p_order_id;

  DELETE FROM public.credit_collection_requests
  WHERE invoice_id IN (SELECT id FROM public.credit_collection_invoices WHERE order_id = p_order_id);

  DELETE FROM public.credit_collection_invoices WHERE order_id = p_order_id;

  DELETE FROM public.auction_awards WHERE order_id = p_order_id;

  DELETE FROM public.order_daily_deals WHERE order_id = p_order_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_order_id;

  -- Critical: movements written by deduct/restore must be removed too, or the
  -- FK inventory_movements_order_id_fkey blocks deleting the order.
  DELETE FROM public.inventory_movements WHERE order_id = p_order_id;

  -- No archive is kept: purge any prior snapshot so no record references the
  -- deleted order.
  DELETE FROM public.order_deletion_inventory_audit WHERE order_id = p_order_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.order_status_history WHERE order_id = p_order_id;
  DELETE FROM public.order_modification_history WHERE order_id = p_order_id;

  DELETE FROM public.orders WHERE id = p_order_id;

  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count)
  VALUES (v_session.employee_id, 'order', ARRAY[p_order_id], 1);

  RETURN jsonb_build_object('success', true, 'action', 'deleted', 'order_id', p_order_id);
END;
$function$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_supreme_delete_cancelled_order(text, uuid, text) TO authenticated';
  END IF;
END
$grant$;

-- ---------------------------------------------------------------------------
-- 3) governed_deletion_execute_orders — bulk deletion center path
-- ---------------------------------------------------------------------------
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
        'delivery_actions', (SELECT COUNT(*)::int FROM public.delivery_actions da WHERE da.order_id = ANY(p_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records pr WHERE pr.order_id = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns r WHERE r.order_id = ANY(p_ids)),
        'collections', (SELECT COUNT(*)::int FROM public.collections cl WHERE cl.order_id = ANY(p_ids)),
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices ci WHERE ci.order_id = ANY(p_ids)),
        'credit_collection_invoices', (SELECT COUNT(*)::int FROM public.credit_collection_invoices cci WHERE cci.order_id = ANY(p_ids)),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals odd WHERE odd.order_id = ANY(p_ids)),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers ofo WHERE ofo.order_id = ANY(p_ids)),
        'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards aa WHERE aa.order_id = ANY(p_ids)),
        'inventory_movements', (SELECT COUNT(*)::int FROM public.inventory_movements im WHERE im.order_id = ANY(p_ids))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- Restore inventory first: EVERY order in the Execution State Group that is
    -- still marked deducted gets its stock back exactly once before removal.
    PERFORM public.governed_inventory_restore(
      oid,
      'ORDER_DELETION_RESTORE',
      'تمت إعادة الكمية قبل حذف الطلب.'
    )
    FROM unnest(p_ids) AS oid
    JOIN public.orders o ON o.id = oid
    WHERE o.status = ANY(public.execution_status_group())
      AND o.inventory_deducted_at IS NOT NULL;

    -- Clear movements (written by deduct/restore) so the FK from
    -- inventory_movements.order_id does not block deleting the orders.
    DELETE FROM public.inventory_movements WHERE order_id = ANY(p_ids);

    -- No archive is kept: purge any prior snapshot so no record references the
    -- deleted orders.
    DELETE FROM public.order_deletion_inventory_audit WHERE order_id = ANY(p_ids);

    -- Delete all related in FK order. Delivery children: delivery_actions must
    -- go before delivery_tracking (delivery_actions_delivery_tracking_id_fkey),
    -- scoped to the selected orders' tracking rows only.
    DELETE FROM public.delivery_actions
    WHERE delivery_tracking_id IN (SELECT id FROM public.delivery_tracking WHERE order_id = ANY(p_ids));
    DELETE FROM public.order_flash_offers WHERE order_id = ANY(p_ids);
    DELETE FROM public.order_daily_deals WHERE order_id = ANY(p_ids);
    DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(p_ids));
    DELETE FROM public.credit_invoices WHERE order_id = ANY(p_ids);
    DELETE FROM public.credit_collection_requests WHERE invoice_id IN (SELECT id FROM public.credit_collection_invoices WHERE order_id = ANY(p_ids));
    DELETE FROM public.credit_collection_invoices WHERE order_id = ANY(p_ids);
    DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(p_ids));
    DELETE FROM public.collections WHERE order_id = ANY(p_ids);
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(p_ids));
    DELETE FROM public.returns WHERE order_id = ANY(p_ids);
    DELETE FROM public.preparation_exceptions WHERE preparation_id IN (SELECT id FROM public.preparation_records WHERE order_id = ANY(p_ids));
    DELETE FROM public.preparation_records WHERE order_id = ANY(p_ids);
    DELETE FROM public.delivery_tracking WHERE order_id = ANY(p_ids);
    DELETE FROM public.auction_awards WHERE order_id = ANY(p_ids);
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

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.governed_deletion_execute_orders(uuid, uuid[], boolean) TO authenticated';
  END IF;
END
$grant$;

COMMIT;
