-- ============================================================================
-- Purge All Old Role Name References
--
-- Business Decision (Approved):
-- 'الإدارة العليا' is the ONLY highest-authority role in the entire ERP.
-- No other role (SUPER_ADMIN, ADMIN, CHAIRMAN, سوبر أدمن, etc.) has equal
-- or higher authority.
--
-- This migration rewrites every authorization function that still contains
-- hardcoded old role name checks like:
--   r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN', ...)
-- or:
--   r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', ...)
--
-- Each function is replaced with a version that uses the centralized
-- is_upper_management() check (which already tests only 'الإدارة العليا')
-- or is_supreme_management().
-- ============================================================================

-- ============================================================================
-- 1. is_supreme_management — ROOT CAUSE OF THE BLOCKING BUG
--    Was checking old role names NOT including 'الإدارة العليا'
--    Now checks ONLY 'الإدارة العليا'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_supreme_management(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = p_employee_id
      AND r.name = 'الإدارة العليا'
  );
$$;

COMMENT ON FUNCTION public.is_supreme_management IS
  'Check if employee has role الإدارة العليا';

-- ============================================================================
-- 2. governed_supreme_edit_order — Fixed error message and comment
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(
  p_token text,
  p_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_discount_amount decimal(12,2) DEFAULT NULL,
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
  v_old_items jsonb;
  v_new_items jsonb;
  v_item jsonb;
  v_product record;
  v_subtotal decimal(12,2);
  v_discount_amount decimal(12,2);
  v_total decimal(12,2);
  v_is_super boolean;
BEGIN
  -- Validate session
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Only Supreme Management (الإدارة العليا)
  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  -- Load order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Capture old items for audit trail
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id,
      'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price,
      'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- Replace all items atomically
  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND', 'detail', 'Product ' || (v_item->>'product_id'));
    END IF;

    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (
      p_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      (v_item->>'unit_quantity')::int,
      COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  -- Build new items json for audit
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id,
      'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price,
      'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- Calculate totals
  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  -- Update order header (preserve existing status)
  UPDATE public.orders SET
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax_amount = 0,
    total_amount = v_total,
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_order_id;

  -- Audit trail
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items,
    modified_by, reason, modified_at
  )
  VALUES (
    p_order_id,
    v_order.revision_number,
    'supreme_edit',
    jsonb_build_object(
      'subtotal', v_order.subtotal,
      'discount_amount', v_order.discount_amount,
      'total_amount', v_order.total_amount,
      'notes', v_order.notes
    )::text,
    jsonb_build_object(
      'subtotal', v_subtotal,
      'discount_amount', v_discount_amount,
      'total_amount', v_total,
      'notes', COALESCE(p_notes, v_order.notes)
    )::text,
    v_old_items,
    v_new_items,
    v_session.identity_id,
    COALESCE(p_reason, 'Supreme Management edit'),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal,
    'discount_amount', v_discount_amount,
    'total_amount', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.governed_supreme_edit_order IS
  'Supreme Management (الإدارة العليا): Edit ANY order (any status). Replaces all items, records audit trail with full diffs.';

-- ============================================================================
-- 3. governed_supreme_delete_cancelled_order — Fixed error message and comment
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

  -- Restore inventory
  INSERT INTO public.inventory (product_id, quantity)
  SELECT oi.product_id, oi.piece_quantity
  FROM public.order_items oi WHERE oi.order_id = p_order_id
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
  'Supreme Management (الإدارة العليا): Permanently delete a cancelled order with full cleanup.';

-- ============================================================================
-- 4. Data Deletion Center — Remove old role names from capability assignment
-- ============================================================================

-- Remove old role-capability assignments for non-الإدارة العليا roles
DELETE FROM public.role_capabilities
WHERE capability_id = (SELECT id FROM public.capabilities WHERE code = 'data.deletion_center')
  AND role_id IN (
    SELECT id FROM public.roles
    WHERE name IN ('سوبر أدمن', 'رئيس مجلس الإدارة')
  );

-- Re-insert the capability assignment for ONLY الإدارة العليا (idempotent)
INSERT INTO public.role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM public.roles r, public.capabilities c
WHERE c.code = 'data.deletion_center'
  AND r.name = 'الإدارة العليا'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_capabilities rc
    WHERE rc.role_id = r.id AND rc.capability_id = c.id
  );

-- ============================================================================
-- Done
-- ============================================================================
