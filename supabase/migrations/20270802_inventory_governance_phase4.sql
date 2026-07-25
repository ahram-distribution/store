-- ============================================================================
-- INVENTORY GOVERNANCE — PHASE 4: Stock Review Resubmission & Updates
-- Update governed_submit_order to accept stock_review -> submitted.
-- Update governed_supreme_edit_order (has 7 args including p_order_type).
-- Update governed_replace_order_contents to accept stock_review status.
-- Update get_governed_products to include inventory governance fields.
-- ============================================================================

-- 1. Replace governed_submit_order — accept stock_review status
--    p_token is TEXT
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_submit_order(uuid, uuid);
DROP FUNCTION IF EXISTS public.governed_submit_order(text, uuid);

CREATE OR REPLACE FUNCTION public.governed_submit_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_is_revision boolean;
  v_creator_identity_type text;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  IF v_old_status NOT IN ('draft', 'returned_for_revision', 'stock_review') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft, returned_for_revision, or stock_review orders can be submitted');
  END IF;

  v_is_revision := EXISTS(
    SELECT 1 FROM public.order_modification_history
    WHERE order_id = p_id AND field_name = 'REVISION_SNAPSHOT'
  );

  IF v_session.identity_type = 'employee' THEN
    IF NOT v_is_revision THEN
      IF NOT public.check_capability(p_token, 'orders.create') THEN
        RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
      END IF;
      IF v_order.created_by IS DISTINCT FROM v_session.identity_id THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator can submit');
      END IF;
    ELSE
      SELECT identity_type INTO v_creator_identity_type
      FROM public.identities WHERE id = v_order.created_by;
    END IF;
  END IF;

  SELECT COALESCE(SUM(total_price), 0) INTO v_product_subtotal
  FROM public.order_items WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total
  FROM public.order_daily_deals WHERE order_id = p_id;

  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total
  FROM public.order_flash_offers WHERE order_id = p_id;

  UPDATE public.orders SET
    status = 'submitted',
    submitted_at = now(),
    subtotal = v_product_subtotal + v_deal_total + v_flash_offer_total,
    total_amount = v_product_subtotal + v_deal_total + v_flash_offer_total - COALESCE(discount_amount, 0),
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id, now());

  RETURN jsonb_build_object('success', true, 'status', 'submitted');
END;
$$;

-- 2. Replace governed_supreme_edit_order — handle Stock Review
--    Note: has 7 args including p_order_type varchar
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_supreme_edit_order(text, uuid, jsonb, text, numeric, text, varchar);

CREATE OR REPLACE FUNCTION public.governed_supreme_edit_order(
  p_token text,
  p_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_discount_amount decimal(12,2) DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_type varchar DEFAULT NULL
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
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_is_super := public.is_supreme_management(v_session.employee_id);
  IF NOT v_is_super THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN', 'detail', 'Only Supreme Management can edit orders');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

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
      p_order_id, (v_item->>'product_id')::uuid, v_item->>'unit_type',
      (v_item->>'unit_quantity')::int, COALESCE((v_item->>'piece_quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'total_price')::numeric, 0)
    );

    v_subtotal := v_subtotal + COALESCE((v_item->>'total_price')::numeric, 0);
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;

  v_subtotal := COALESCE(v_subtotal, 0);
  v_discount_amount := COALESCE(p_discount_amount, 0);
  v_total := GREATEST(v_subtotal - v_discount_amount, 0);

  UPDATE public.orders SET
    subtotal = v_subtotal, discount_amount = v_discount_amount, tax_amount = 0,
    total_amount = v_total, notes = COALESCE(p_notes, notes),
    order_type = COALESCE(p_order_type, order_type),
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items, modified_by, reason, modified_at
  ) VALUES (
    p_order_id, v_order.revision_number, 'supreme_edit',
    jsonb_build_object('subtotal', v_order.subtotal, 'discount_amount', v_order.discount_amount, 'total_amount', v_order.total_amount, 'notes', v_order.notes)::text,
    jsonb_build_object('subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total, 'notes', COALESCE(p_notes, v_order.notes))::text,
    v_old_items, v_new_items, v_session.identity_id, COALESCE(p_reason, 'Supreme Management edit'), now()
  );

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_order_id),
    'subtotal', v_subtotal, 'discount_amount', v_discount_amount, 'total_amount', v_total
  );
END;
$$;

-- 3. Replace governed_replace_order_contents — accept stock_review status
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.governed_replace_order_contents(uuid, uuid, jsonb, uuid, text, jsonb, jsonb);

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

  UPDATE public.orders SET tier_id = p_tier_id, notes = p_notes, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_id));
END;
$$;

-- 4. Replace get_governed_products — include inventory governance fields
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token uuid,
  p_active_only boolean DEFAULT true,
  p_visible_only boolean DEFAULT true,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_count_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id);
    RETURN v_result;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'description', p.description,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'recently_available_at', p.recently_available_at,
      'created_at', p.created_at,
      'negative_selling_allowed', p.negative_selling_allowed,
      'inventory_deduction_status', p.inventory_deduction_status,
      'oos_source', p.oos_source,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
    )
    ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  WHERE (NOT p_active_only OR p.is_active = true)
    AND (NOT p_visible_only OR p.is_visible = true)
    AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- END OF PHASE 4
-- ============================================================================
