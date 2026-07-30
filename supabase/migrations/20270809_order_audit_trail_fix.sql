-- ============================================================================
-- ORDER AUDIT TRAIL FIX — 20270809
-- ============================================================================
-- 1. governed_approve_order: accept p_reason, persist to order_status_history
-- 2. governed_replace_order_contents: capture old/new items into order_modification_history
-- 3. get_unified_order: include osh.reason in status_history response
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. governed_approve_order — add p_reason parameter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token text,
  p_id uuid,
  p_reason text DEFAULT NULL
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
  v_order record;
  v_deduct_result jsonb;
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

  IF v_order.order_inventory_deduction_status = 'approved' THEN
    v_deduct_result := public.governed_inventory_deduct(p_id);
    IF (v_deduct_result->>'error') IS NOT NULL THEN
      RETURN v_deduct_result;
    END IF;
  END IF;

  UPDATE public.orders
  SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status IN ('submitted', 'reviewing');

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, p_reason, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. governed_replace_order_contents — audit old/new items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_replace_order_contents(
  p_token uuid,
  p_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_tier_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_daily_deals jsonb DEFAULT '[]'::jsonb,
  p_flash_offers jsonb DEFAULT '[]'::jsonb
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
  v_calculated_unit_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_deal jsonb;
  v_deal_record record;
  v_offer jsonb;
  v_offer_record record;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_order.status NOT IN ('draft', 'returned_for_revision', 'stock_review') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft, returned_for_revision, or stock_review orders can be edited');
  END IF;

  IF v_session.identity_type = 'employee' THEN
    IF v_order.status = 'stock_review' THEN
      IF NOT public.check_capability(p_token, 'orders.create') AND NOT public.check_capability(p_token, 'orders.manage') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create or orders.manage');
      END IF;
    ELSE
      IF NOT public.check_capability(p_token, 'orders.create') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
      END IF;
    END IF;
  ELSE
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  IF p_tier_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_tier_id AND is_active = true) THEN
      RETURN jsonb_build_object('error', 'TIER_NOT_FOUND_OR_INACTIVE');
    END IF;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_id;

  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_item->>'product_id')::uuid);
    END IF;
    v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type');
    IF v_calculated_unit_price IS NULL THEN
      RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || (v_item->>'product_id')::uuid);
    END IF;
    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2);
    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price)
    VALUES (p_id, (v_item->>'product_id')::uuid, v_item->>'unit_type', (v_item->>'unit_quantity')::int,
      COALESCE((v_item->>'piece_quantity')::int, 0), v_calculated_unit_price, v_calculated_total_price);
  END LOOP;

  FOR v_deal IN SELECT * FROM jsonb_array_elements(p_daily_deals)
  LOOP
    SELECT id, fixed_price INTO v_deal_record FROM public.daily_deals WHERE id = (v_deal->>'deal_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'DAILY_DEAL_NOT_FOUND: ' || (v_deal->>'deal_id')::uuid);
    END IF;
    INSERT INTO public.order_daily_deals (order_id, deal_id, quantity, unit_price, total_price)
    VALUES (p_id, v_deal_record.id, 1, v_deal_record.fixed_price, v_deal_record.fixed_price);
  END LOOP;

  FOR v_offer IN SELECT * FROM jsonb_array_elements(p_flash_offers)
  LOOP
    SELECT id, fixed_price INTO v_offer_record FROM public.flash_offers WHERE id = (v_offer->>'offer_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'FLASH_OFFER_NOT_FOUND: ' || (v_offer->>'offer_id')::uuid);
    END IF;
    INSERT INTO public.order_flash_offers (order_id, offer_id, quantity, unit_price, total_price)
    VALUES (p_id, v_offer_record.id, 1, v_offer_record.fixed_price, v_offer_record.fixed_price);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_id;

  UPDATE public.orders SET tier_id = p_tier_id, notes = p_notes, updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_id, v_order.revision_number, 'content_replacement',
    jsonb_build_object('item_count', COALESCE(jsonb_array_length(v_old_items), 0))::text,
    jsonb_build_object('item_count', COALESCE(jsonb_array_length(v_new_items), 0))::text,
    COALESCE(v_old_items, '[]'::jsonb), COALESCE(v_new_items, '[]'::jsonb),
    v_session.identity_id, 'Content replacement', now()
  );

  RETURN jsonb_build_object('success', true, 'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_unified_order — include osh.reason in status_history
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_customer_id uuid;
  v_identity_type text;
  v_result jsonb;
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;
  v_customer_id := v_session.customer_id;
  v_identity_type := v_session.identity_type;

  -- Visibility check: employee can see any order, customer only their own
  IF v_identity_type = 'customer' THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_id AND customer_id = v_customer_id) THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT jsonb_build_object(
      'order', row_to_json(o.*)::jsonb || jsonb_strip_nulls(jsonb_build_object(
        'customer_owner_name', COALESCE(c_owner.full_name, ''),
        'customer_owner_role', COALESCE(c_owner.job_title, ''),
        'customer_owner_id', c.owner_id,
        'order_creator_name', COALESCE(oc_emp.full_name, oc_cust.company_name, oc_cust.name, ''),
        'order_creator_role', COALESCE(oc_emp.job_title::text, oc_cust.identity_type, ''),
        'order_creator_id', o.created_by,
        'order_creator_type', oc_i.identity_type,
        'current_owner_name', COALESCE(owner_e.full_name, ''),
        'reference_number', o.reference_number
      )),
      'customer', row_to_json(c.*)::jsonb || jsonb_strip_nulls(jsonb_build_object(
        'display_address', CASE
          WHEN c.address_line1 IS NOT NULL AND c.city IS NOT NULL
            THEN c.address_line1 || ' - ' || c.city
          WHEN c.address_line1 IS NOT NULL THEN c.address_line1
          WHEN c.city IS NOT NULL THEN c.city
          ELSE NULL
        END
      )),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', COALESCE(p.name_ar, p.name_en, ''),
          'legacy_code', p.legacy_code,
          'image_url', p.image_url,
          'company_id', p.company_id,
          'company_name', comp.company_name,
          'unit_type', oi.unit_type,
          'unit_quantity', oi.unit_quantity,
          'piece_quantity', oi.piece_quantity,
          'unit_price', oi.unit_price,
          'total_price', oi.total_price
        ) ORDER BY oi.id)
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        LEFT JOIN public.companies comp ON comp.id = p.company_id
        WHERE oi.order_id = o.id
      ), '[]'::jsonb),
      'status_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'from_status', osh.from_status,
          'to_status', osh.to_status,
          'changed_by', osh.changed_by,
          'changed_by_name', e_changed.full_name,
          'reason', osh.reason,
          'changed_at', osh.changed_at
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
        LEFT JOIN public.employees e_changed ON e_changed.identity_id = osh.changed_by
        WHERE osh.order_id = o.id
      ), '[]'::jsonb),
      'modification_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', omh.id,
          'revision_number', omh.revision_number,
          'field_name', omh.field_name,
          'old_value', omh.old_value,
          'new_value', omh.new_value,
          'old_order_items', omh.old_order_items,
          'new_order_items', omh.new_order_items,
          'old_daily_deals', omh.old_daily_deals,
          'new_daily_deals', omh.new_daily_deals,
          'old_flash_offers', omh.old_flash_offers,
          'new_flash_offers', omh.new_flash_offers,
          'modified_by', omh.modified_by,
          'modified_by_name', e_modified.full_name,
          'reason', omh.reason,
          'modified_at', omh.modified_at
        ) ORDER BY omh.modified_at DESC)
        FROM public.order_modification_history omh
        LEFT JOIN public.employees e_modified ON e_modified.identity_id = omh.modified_by
        WHERE omh.order_id = o.id
      ), '[]'::jsonb),
      'current_delivery', (
        SELECT jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'delivery_mode', o.delivery_mode,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id AND dt.is_active = true
        LIMIT 1
      ),
      'delivery_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'is_active', dt.is_active,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id
      ), '[]'::jsonb),
      'preparation', (
        SELECT jsonb_build_object(
          'id', pr.id,
          'status', pr.status,
          'started_by', pr.started_by,
          'started_at', pr.started_at,
          'completed_by', pr.completed_by,
          'completed_at', pr.completed_at,
          'reviewed_by', pr.reviewed_by,
          'reviewed_at', pr.reviewed_at,
          'cancelled_by', pr.cancelled_by,
          'cancelled_at', pr.cancelled_at,
          'notes', pr.notes
        )
        FROM public.preparation_records pr
        WHERE pr.order_id = o.id
        ORDER BY pr.created_at DESC
        LIMIT 1
      ),
      'returns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'status', r.status,
          'credit_note_amount', r.credit_note_amount,
          'notes', r.notes,
          'created_at', r.created_at
        ) ORDER BY r.created_at)
        FROM public.returns r
        WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'collections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', col.id,
          'code', col.code,
          'method', col.method,
          'amount', col.amount,
          'status', col.status,
          'reference_number', col.reference_number,
          'collected_at', col.collected_at,
          'order_id', col.order_id
        ) ORDER BY col.created_at)
        FROM public.collections col
        WHERE col.order_id = o.id
           OR (col.customer_id = v_customer_id AND col.order_id IS NULL)
      ), '[]'::jsonb)
    )
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees c_owner ON c_owner.id = c.owner_id
    LEFT JOIN public.employees owner_e ON owner_e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.id = p_id
  INTO v_result;

  RETURN v_result;
END;
$$;
