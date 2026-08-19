-- ============================================================================
-- governed_executive_edit_purchase_order
--
-- Scoped edit capability for Executive (الإدارة العليا) users on orders in
-- "طلب شراء" (submitted) status ONLY.
--
-- Security guarantees:
--   1. Only Executive role (is_supreme_management) can invoke.
--   2. Order MUST be in 'submitted' status at invocation AND at save time
--      (concurrency revalidation — rejects stale edits).
--   3. Prices are NEVER accepted from the client — all unit_price and
--      total_price values are calculated server-side from the product catalog
--      via _calc_base_unit_price().
--   4. Order subtotal/total_amount are recalculated from authoritative prices.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_executive_edit_purchase_order(
  p_token   text,
  p_order_id uuid,
  p_items    jsonb DEFAULT '[]'::jsonb,
  p_notes    text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session  app.sessions;
  v_order    public.orders;
  v_old_items jsonb;
  v_new_items jsonb;
  v_item     jsonb;
  v_product  record;
  v_calc_price numeric;
  v_subtotal  decimal(12,2);
  v_total     decimal(12,2);
  v_actor_id  uuid;
BEGIN
  -- ── 1. Session validation ──
  SELECT * INTO v_session
    FROM app.sessions
   WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  -- ── 2. Role check: Executive only (الإدارة العليا OR الرئيس التنفيذي) ──
  IF NOT (
    public.is_supreme_management(v_session.employee_id)
    OR EXISTS(
      SELECT 1 FROM public.employee_roles er
      JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = v_session.employee_id
        AND r.name IN ('الرئيس التنفيذي', 'executive_director')
    )
  ) THEN
    RETURN jsonb_build_object(
      'error', 'FORBIDDEN',
      'detail', 'Only Executive users can edit purchase orders'
    );
  END IF;

  -- ── 3. Fetch order ──
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  v_actor_id := v_session.identity_id;

  -- ── 4. Status guard: must be 'submitted' (طلب شراء) ──
  IF v_order.status <> 'submitted' THEN
    RETURN jsonb_build_object(
      'error', 'INVALID_STATUS',
      'detail', 'Executive edit is only available for purchase orders (طلب شراء)',
      'current_status', v_order.status
    );
  END IF;

  -- ── 5. Snapshot old items for audit trail ──
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',     oi.product_id,
      'unit_type',      oi.unit_type,
      'unit_quantity',  oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price',     oi.unit_price,
      'total_price',    oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  -- ── 6. Replace all items with server-priced copies ──
  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_subtotal := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Fetch authoritative product pricing
    SELECT id, carton_price, carton_quantity
      INTO v_product
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'error', 'PRODUCT_NOT_FOUND',
        'detail', 'Product ' || (v_item->>'product_id')
      );
    END IF;

    -- Calculate price server-side (ignores any price in payload)
    v_calc_price := public._calc_base_unit_price(
      v_product.carton_price,
      v_product.carton_quantity,
      v_item->>'unit_type'
    );

    IF v_calc_price IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'INVALID_PRODUCT_PRICING',
        'detail', 'Cannot calculate price for product ' || (v_item->>'product_id')
      );
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, unit_type, unit_quantity, piece_quantity,
      unit_price, total_price
    ) VALUES (
      p_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'unit_type',
      GREATEST(COALESCE((v_item->>'unit_quantity')::int, 1), 1),
      COALESCE((v_item->>'piece_quantity')::int, 0),
      v_calc_price,
      ROUND(v_calc_price * GREATEST(COALESCE((v_item->>'unit_quantity')::int, 1), 1), 2)
    );

    v_subtotal := v_subtotal + ROUND(v_calc_price * GREATEST(COALESCE((v_item->>'unit_quantity')::int, 1), 1), 2);
  END LOOP;

  -- ── 7. Revalidate status (concurrency check) ──
  SELECT status INTO v_order.status
    FROM public.orders
   WHERE id = p_order_id;

  IF v_order.status <> 'submitted' THEN
    -- Rollback: restore old items
    DELETE FROM public.order_items WHERE order_id = p_order_id;

    -- Re-insert old items
    IF v_old_items IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_old_items)
      LOOP
        INSERT INTO public.order_items (
          order_id, product_id, unit_type, unit_quantity, piece_quantity,
          unit_price, total_price
        ) VALUES (
          p_order_id,
          (v_item->>'product_id')::uuid,
          v_item->>'unit_type',
          (v_item->>'unit_quantity')::int,
          (v_item->>'piece_quantity')::int,
          (v_item->>'unit_price')::numeric,
          (v_item->>'total_price')::numeric
        );
      END LOOP;
    END IF;

    RETURN jsonb_build_object(
      'error', 'STATUS_CHANGED',
      'detail', 'Order status changed during editing. The order is no longer a purchase order (طلب شراء).',
      'current_status', v_order.status
    );
  END IF;

  -- ── 8. Update order totals ──
  v_subtotal := COALESCE(v_subtotal, 0);
  v_total := GREATEST(v_subtotal - COALESCE(v_order.discount_amount, 0), 0);

  UPDATE public.orders SET
    subtotal     = v_subtotal,
    total_amount = v_total,
    notes        = COALESCE(p_notes, notes),
    updated_at   = now()
  WHERE id = p_order_id;

  -- ── 9. Snapshot new items for audit trail ──
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',     oi.product_id,
      'unit_type',      oi.unit_type,
      'unit_quantity',  oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price',     oi.unit_price,
      'total_price',    oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  -- ── 10. Audit trail ──
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'executive_purchase_edit',
    (v_old_items)::text,
    (v_new_items)::text,
    v_old_items, v_new_items, v_actor_id,
    'Executive edit on purchase order (طلب شراء)',
    now()
  );

  RETURN jsonb_build_object(
    'success',      true,
    'order_id',     p_order_id,
    'item_count',   (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal',     v_subtotal,
    'total_amount', v_total
  );
END;
$function$;

COMMENT ON FUNCTION public.governed_executive_edit_purchase_order(text, uuid, jsonb, text)
  IS 'Executive-only edit for submitted purchase orders. Prices are calculated server-side — client prices are ignored.';

GRANT EXECUTE ON FUNCTION public.governed_executive_edit_purchase_order(text, uuid, jsonb, text)
  TO PUBLIC, anon, authenticated, service_role;
