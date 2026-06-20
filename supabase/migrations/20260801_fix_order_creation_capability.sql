-- Fix 1: governed_return_order_for_revision — snapshot queries use fixed_price (column is fixed_price not unit_price)
--        (these columns don't exist: order_daily_deals.unit_price, order_flash_offers.unit_price)
CREATE OR REPLACE FUNCTION public.governed_return_order_for_revision(p_token uuid, p_id uuid, p_reason text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_daily_deals jsonb DEFAULT NULL::jsonb, p_flash_offers jsonb DEFAULT NULL::jsonb, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_execution_location_id uuid DEFAULT NULL::uuid, p_execution_latitude numeric DEFAULT NULL::numeric, p_execution_longitude numeric DEFAULT NULL::numeric, p_execution_accuracy_meters numeric DEFAULT NULL::numeric, p_execution_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_old_items jsonb;
  v_old_daily_deals jsonb;
  v_old_flash_offers jsonb;
  v_new_revision_number int;
  v_old_items_data jsonb;
  v_old_daily_deals_data jsonb;
  v_old_flash_offers_data jsonb;
  v_item jsonb;
  v_product record;
  v_calculated_unit_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_deal jsonb;
  v_deal_record record;
  v_offer jsonb;
  v_offer_record record;
  v_exec_location_id uuid;
  v_cust_code text;
  v_cust_name text;
  v_cust_phone text;
  v_cust_address text;
  v_owner_name text;
  v_owner_phone text;
  v_owner_address text;
  v_sender_name text;
  v_sender_phone text;
  v_sender_address text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.manage') AND NOT public.check_capability(p_token, 'orders.approve') THEN
      RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.manage or orders.approve');
    END IF;
  ELSE
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_order.status NOT IN ('submitted', 'approved', 'delivered', 'partially_delivered') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only submitted, approved, or delivered orders can be returned for revision');
  END IF;

  v_old_status := v_order.status;

  -- Snapshot old data (before we delete/replace)
  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_items_data
  FROM (SELECT product_id, unit_type, unit_quantity, piece_quantity, unit_price, total_price
        FROM public.order_items WHERE order_id = p_id) sub;

  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_daily_deals_data
  FROM (SELECT deal_id, quantity, fixed_price AS unit_price, total_price
        FROM public.order_daily_deals WHERE order_id = p_id) sub;

  SELECT jsonb_agg(row_to_json(sub)) INTO v_old_flash_offers_data
  FROM (SELECT offer_id, quantity, fixed_price AS unit_price, total_price
        FROM public.order_flash_offers WHERE order_id = p_id) sub;

  -- Retire current prices (reset deals / offers)
  UPDATE public.daily_deals dd
  SET status = 'active'
  FROM public.order_daily_deals odd
  WHERE odd.order_id = p_id AND odd.deal_id = dd.id;

  DELETE FROM public.order_daily_deals WHERE order_id = p_id;

  UPDATE public.flash_offers fo
  SET status = 'active'
  FROM public.order_flash_offers ofo
  WHERE ofo.order_id = p_id AND ofo.offer_id = fo.id;

  DELETE FROM public.order_flash_offers WHERE order_id = p_id;

  -- Location
  v_exec_location_id := p_execution_location_id;
  IF v_exec_location_id IS NULL AND p_execution_latitude IS NOT NULL AND p_execution_longitude IS NOT NULL THEN
    v_exec_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, captured_at)
    VALUES (v_exec_location_id, p_execution_latitude, p_execution_longitude, p_execution_accuracy_meters, COALESCE(p_execution_captured_at, now()));
  END IF;

  -- Customer / Owner / Sender snapshots
  SELECT
    c.code, c.company_name,
    COALESCE((SELECT phone FROM customer_contacts WHERE customer_id = c.id AND is_primary = true LIMIT 1), ''),
    COALESCE((SELECT formatted_address FROM unified_locations ul WHERE ul.id = c.location_id),
             (SELECT address_line1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND ca.is_default = true LIMIT 1), '')
  INTO v_cust_code, v_cust_name, v_cust_phone, v_cust_address
  FROM customers c WHERE c.id = v_order.customer_id;

  SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
  INTO v_owner_name, v_owner_phone, v_owner_address
  FROM customers c
  LEFT JOIN employees e ON e.id = c.owner_id
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE c.id = v_order.customer_id;

  SELECT COALESCE(e.full_name, ''), COALESCE(i.phone, ''), COALESCE(e.address, '')
  INTO v_sender_name, v_sender_phone, v_sender_address
  FROM employees e
  LEFT JOIN identities i ON i.id = e.identity_id
  WHERE e.identity_id = v_session.identity_id;

  -- New revision number
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_new_revision_number
  FROM public.order_modification_history WHERE order_id = p_id;

  -- Push revision snapshot
  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    old_order_items, new_order_items,
    old_daily_deals, new_daily_deals,
    old_flash_offers, new_flash_offers,
    modified_by, reason, modified_at
  ) VALUES (
    p_id, v_new_revision_number, 'REVISION_SNAPSHOT',
    -- old_value/new_value are snapshots of order metadata fields
    row_to_json(v_order)::text,
    NULL,
    -- Items
    v_old_items_data,
    (SELECT jsonb_agg(row_to_json(sub_oi))
     FROM (SELECT oi.product_id, pr.product_name, oi.unit_type, oi.unit_quantity,
                  oi.piece_quantity, oi.unit_price, oi.total_price
           FROM public.order_items oi
           LEFT JOIN public.products pr ON pr.id = oi.product_id
           WHERE oi.order_id = p_id) sub_oi),
    -- Daily deals
    v_old_daily_deals_data,
    (SELECT jsonb_agg(row_to_json(sub_odd))
     FROM (SELECT odd.deal_id, odd.quantity, odd.fixed_price AS unit_price, odd.total_price
           FROM public.order_daily_deals odd WHERE odd.order_id = p_id) sub_odd),
    -- Flash offers
    v_old_flash_offers_data,
    (SELECT jsonb_agg(row_to_json(sub_fo))
     FROM (SELECT ofo.offer_id, ofo.quantity, ofo.fixed_price AS unit_price, ofo.total_price
           FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id) sub_fo),
    v_session.identity_id,
    p_reason,
    now()
  );

  -- Replace items if provided
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    DELETE FROM public.order_items WHERE order_id = p_id;

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
  END IF;

  -- Replace daily deals if provided
  IF p_daily_deals IS NOT NULL AND jsonb_array_length(p_daily_deals) > 0 THEN
    FOR v_deal IN SELECT * FROM jsonb_array_elements(p_daily_deals)
    LOOP
      SELECT id, fixed_price INTO v_deal_record FROM public.daily_deals WHERE id = (v_deal->>'deal_id')::uuid;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'DAILY_DEAL_NOT_FOUND: ' || (v_deal->>'deal_id')::uuid);
      END IF;
      INSERT INTO public.order_daily_deals (order_id, deal_id, quantity, unit_price, total_price)
      VALUES (p_id, v_deal_record.id, 1, v_deal_record.fixed_price, v_deal_record.fixed_price);
    END LOOP;
  END IF;

  -- Replace flash offers if provided
  IF p_flash_offers IS NOT NULL AND jsonb_array_length(p_flash_offers) > 0 THEN
    FOR v_offer IN SELECT * FROM jsonb_array_elements(p_flash_offers)
    LOOP
      SELECT id, fixed_price INTO v_offer_record FROM public.flash_offers WHERE id = (v_offer->>'offer_id')::uuid;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'FLASH_OFFER_NOT_FOUND: ' || (v_offer->>'offer_id')::uuid);
      END IF;
      INSERT INTO public.order_flash_offers (order_id, offer_id, quantity, unit_price, total_price)
      VALUES (p_id, v_offer_record.id, 1, v_offer_record.fixed_price, v_offer_record.fixed_price);
    END LOOP;
  END IF;

  -- Update order status to draft + revision
  UPDATE public.orders SET
    status = 'draft',
    revision_number = v_new_revision_number,
    last_revised_at = now(),
    tier_id = COALESCE(p_tier_id, tier_id),
    notes = COALESCE(p_notes, notes),
    execution_location_id = COALESCE(v_exec_location_id, execution_location_id),
    execution_latitude = COALESCE(p_execution_latitude, execution_latitude),
    execution_longitude = COALESCE(p_execution_longitude, execution_longitude),
    execution_accuracy_meters = COALESCE(p_execution_accuracy_meters, execution_accuracy_meters),
    execution_captured_at = COALESCE(p_execution_captured_at, execution_captured_at),
    snapshot_customer_code = v_cust_code,
    snapshot_customer_name = v_cust_name,
    snapshot_customer_phone = v_cust_phone,
    snapshot_customer_address = v_cust_address,
    snapshot_owner_name = v_owner_name,
    snapshot_owner_phone = v_owner_phone,
    snapshot_owner_address = v_owner_address,
    snapshot_sender_name = v_sender_name,
    snapshot_sender_phone = v_sender_phone,
    snapshot_sender_address = v_sender_address,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'draft', v_session.identity_id, p_reason);

  RETURN jsonb_build_object('success', true, 'revision_number', v_new_revision_number);
END;
$function$;


-- Fix 2: governed_submit_order — snapshot queries use fixed_price (same schema mismatch)
CREATE OR REPLACE FUNCTION public.governed_submit_order(p_token uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_order public.orders;
  v_old_status text;
  v_is_revision boolean;
  v_creator_identity_type text;
  v_tier_record tiers;
  v_product_subtotal numeric := 0;
  v_deal_total numeric := 0;
  v_flash_offer_total numeric := 0;
  v_effective_discount_percent numeric := 0;
  v_total_discount numeric := 0;
  v_new_total numeric := 0;
  v_item record;
  v_product record;
  v_base_unit_price numeric;
  v_base_total_price numeric;
  v_discounted_unit_price numeric;
  v_discounted_total_price numeric;
  v_company_id uuid;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_changed_field record;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  v_old_status := v_order.status;

  IF v_old_status NOT IN ('draft', 'returned_for_revision') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft or returned_for_revision orders can be submitted');
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
      IF v_creator_identity_type = 'customer' THEN
        IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_order.customer_id AND owner_id = v_session.employee_id)
           AND NOT public.is_upper_management(v_session.employee_id) THEN
          RETURN jsonb_build_object('error', 'FORBIDDEN: only the customer owner or upper management can resubmit');
        END IF;
      ELSE
        IF v_order.created_by IS DISTINCT FROM v_session.identity_id
           AND NOT public.is_upper_management(v_session.employee_id) THEN
          RETURN jsonb_build_object('error', 'FORBIDDEN: only the order creator or upper management can resubmit');
        END IF;
      END IF;
    END IF;
  ELSE
    IF v_session.customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT COALESCE(SUM(total_price), 0) INTO v_deal_total FROM public.order_daily_deals WHERE order_id = p_id;
  SELECT COALESCE(SUM(total_price), 0) INTO v_flash_offer_total FROM public.order_flash_offers WHERE order_id = p_id;
  v_product_subtotal := 0; v_total_discount := 0;

  FOR v_item IN SELECT oi.id, oi.product_id, oi.unit_type, oi.unit_quantity, oi.piece_quantity
                FROM public.order_items oi WHERE oi.order_id = p_id
  LOOP
    SELECT p.id, p.company_id, p.carton_price, p.carton_quantity INTO v_product
    FROM public.products p WHERE p.id = v_item.product_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || v_item.product_id); END IF;

    v_base_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item.unit_type);
    IF v_base_unit_price IS NULL THEN
      RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || v_item.product_id);
    END IF;

    v_base_total_price := ROUND((v_base_unit_price * v_item.unit_quantity)::numeric, 2);
    v_product_subtotal := v_product_subtotal + v_base_total_price;

    IF v_order.tier_id IS NOT NULL THEN
      v_effective_discount_percent := public._get_effective_tier_discount(v_order.tier_id, v_item.product_id, v_product.company_id);
      IF v_effective_discount_percent > 0 THEN
        v_discounted_unit_price := ROUND((v_base_unit_price * (1 - v_effective_discount_percent / 100))::numeric, 2);
        v_discounted_total_price := ROUND((v_discounted_unit_price * v_item.unit_quantity)::numeric, 2);
        v_total_discount := v_total_discount + (v_base_total_price - v_discounted_total_price);
      ELSE
        v_discounted_unit_price := v_base_unit_price;
        v_discounted_total_price := v_base_total_price;
      END IF;
    ELSE
      v_discounted_unit_price := v_base_unit_price;
      v_discounted_total_price := v_base_total_price;
    END IF;

    UPDATE public.order_items SET unit_price = v_discounted_unit_price, total_price = v_discounted_total_price
    WHERE id = v_item.id;
  END LOOP;

  IF v_order.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier_record FROM public.tiers WHERE id = v_order.tier_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TIER_NOT_FOUND'); END IF;
    IF NOT v_tier_record.is_active THEN RETURN jsonb_build_object('error', 'TIER_NOT_ACTIVE'); END IF;
    IF v_product_subtotal < v_tier_record.minimum_order_amount THEN
      RETURN jsonb_build_object('error', '????? ?? ' || ROUND((v_tier_record.minimum_order_amount - v_product_subtotal)::numeric, 0) || ' ???? ?????? ???? ?????? ??????? ????????');
    END IF;
  END IF;

  v_new_total := ROUND(((v_product_subtotal - v_total_discount) + v_deal_total + v_flash_offer_total)::numeric, 2);

  IF v_is_revision THEN
    UPDATE public.orders SET
      status = 'submitted',
      subtotal = v_product_subtotal,
      discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total,
      effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      last_revised_at = now(),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_order;
  ELSE
    UPDATE public.orders SET
      status = 'submitted',
      subtotal = v_product_subtotal,
      discount_amount = ROUND(v_total_discount::numeric, 2),
      total_amount = v_new_total,
      effective_discount_percent = CASE WHEN v_order.tier_id IS NOT NULL THEN v_effective_discount_percent ELSE NULL END,
      submitted_at = now(),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_order;
  END IF;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_id, v_old_status, 'submitted', v_session.identity_id,
          CASE WHEN v_is_revision THEN '????? ????? ??? ???????' ELSE 'Order submitted' END, now());

  IF v_is_revision THEN
    SELECT old_value::jsonb INTO v_old_snapshot
    FROM public.order_modification_history
    WHERE order_id = p_id AND revision_number = v_order.revision_number
      AND field_name = 'REVISION_SNAPSHOT';

    v_new_snapshot := jsonb_build_object(
      'customer_id',       v_order.customer_id,
      'customer_name',     (SELECT company_name FROM public.customers WHERE id = v_order.customer_id),
      'tier_id',           v_order.tier_id,
      'payment_method',    v_order.payment_method,
      'owner_id',          v_order.owner_id,
      'notes',             v_order.notes,
      'delivery_mode',     v_order.delivery_mode,
      'address_line1',     (SELECT ca.address_line1 FROM public.customer_addresses ca WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'address_line2',     (SELECT ca.address_line2 FROM public.customer_addresses ca WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'city',              (SELECT ca.city FROM public.customer_addresses ca WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'governorate',       (SELECT ca.governorate FROM public.customer_addresses ca WHERE ca.customer_id = v_order.customer_id AND ca.is_default = true LIMIT 1),
      'assigned_delivery_rep', (SELECT dt.assigned_to FROM public.delivery_tracking dt WHERE dt.order_id = p_id AND dt.is_active = true LIMIT 1),
      'credit_program_id', (SELECT cca.credit_program_id FROM public.customer_credit_accounts cca WHERE cca.customer_id = v_order.customer_id AND cca.credit_status = 'active' LIMIT 1)
    );

    UPDATE public.order_modification_history SET
      new_value       = v_new_snapshot::text,
      new_order_items = (SELECT jsonb_agg(row_to_json(sub_oi))
                          FROM (SELECT oi.product_id, pr.product_name, oi.unit_type, oi.unit_quantity,
                                       oi.piece_quantity, oi.unit_price, oi.total_price
                                FROM public.order_items oi
                                LEFT JOIN public.products pr ON pr.id = oi.product_id
                                WHERE oi.order_id = p_id) sub_oi),
      new_daily_deals = (SELECT jsonb_agg(row_to_json(sub_odd))
                          FROM (SELECT odd.deal_id, odd.quantity, odd.fixed_price AS unit_price, odd.total_price
                                FROM public.order_daily_deals odd WHERE odd.order_id = p_id) sub_odd),
      new_flash_offers= (SELECT jsonb_agg(row_to_json(sub_fo))
                          FROM (SELECT ofo.offer_id, ofo.quantity, ofo.fixed_price AS unit_price, ofo.total_price
                                FROM public.order_flash_offers ofo WHERE ofo.order_id = p_id) sub_fo)
    WHERE order_id = p_id AND revision_number = v_order.revision_number
      AND field_name = 'REVISION_SNAPSHOT';

    FOR v_changed_field IN
      SELECT key, v_old_snapshot ->> key AS old_val, v_new_snapshot ->> key AS new_val
      FROM jsonb_each_text(v_old_snapshot) old
      FULL JOIN jsonb_each_text(v_new_snapshot) new USING (key)
      WHERE COALESCE(old.value, '') IS DISTINCT FROM COALESCE(new.value, '')
        AND key NOT IN ('assigned_delivery_rep', 'credit_program_id')
    LOOP
      INSERT INTO public.order_modification_history (order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at)
      VALUES (p_id, v_order.revision_number, v_changed_field.key,
              v_changed_field.old_val, v_changed_field.new_val,
              v_session.identity_id,
              CASE v_changed_field.key
                WHEN 'customer_id' THEN '????? ??????'
                WHEN 'customer_name' THEN '????? ??? ??????'
                WHEN 'tier_id' THEN '????? ??????? ???????'
                WHEN 'payment_method' THEN '????? ????? ?????'
                WHEN 'owner_id' THEN '????? ????? ??????'
                WHEN 'notes' THEN '????? ?????????'
                WHEN 'delivery_mode' THEN '????? ????? ???????'
                WHEN 'address_line1' THEN '????? ???????'
                WHEN 'address_line2' THEN '????? ??????? (????)'
                WHEN 'city' THEN '????? ???????'
                WHEN 'governorate' THEN '????? ????????'
                ELSE '????? ' || v_changed_field.key
              END, now());
    END LOOP;
  END IF;

  RETURN row_to_json(v_order);
END;
$function$;


-- Fix 3: governed_replace_order_contents — accept returned_for_revision (legacy status) in addition to draft
CREATE OR REPLACE FUNCTION public.governed_replace_order_contents(p_token uuid, p_id uuid, p_items jsonb DEFAULT '[]'::jsonb, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_daily_deals jsonb DEFAULT '[]'::jsonb, p_flash_offers jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  IF v_order.status NOT IN ('draft', 'returned_for_revision') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATE: only draft or returned_for_revision orders can be edited');
  END IF;

  IF v_session.identity_type = 'employee' THEN
    IF NOT public.check_capability(p_token, 'orders.create') THEN
      RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: orders.create');
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
$function$;


-- Fix 4: Add orders.create capability to sales roles that are missing it
INSERT INTO role_capabilities (role_id, capability_id)
SELECT r.id, c.id
FROM roles r, capabilities c
WHERE c.code = 'orders.create'
  AND r.id IN (
    'f6352adc-8284-405f-ba03-5f660dc745ae',
    '598b1537-d179-4faa-98c0-a25d6a1b711c'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_capabilities rc
    WHERE rc.role_id = r.id AND rc.capability_id = c.id
  );
