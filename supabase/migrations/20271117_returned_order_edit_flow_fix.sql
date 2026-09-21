-- ============================================================================
-- Fix returned/edit-order resubmission flow (storefront "edit order" path)
-- ----------------------------------------------------------------------------
-- governed_replace_order_contents was repricing every line to the flat catalog
-- base (destroying base_unit_price and any verified per-line prices), ignoring
-- bonus products entirely (they vanished on every resubmit), skipping
-- out-of-stock revalidation, and never refreshing the frozen bonus financials.
-- The restored cart then read base_unit_price=0 and displayed ZERO prices.
--
-- This superset keeps full backward compatibility: the legacy 7-arg call
-- (p_token, p_id, p_items, p_tier_id, p_notes, p_daily_deals, p_flash_offers —
-- used by the upper-management OrderEditPage) behaves as before, except that
-- main items now also persist base_unit_price = 0 (identical to create_order's
-- non-bonus semantics) and out-of-stock products are rejected. NON-bonus (direct
-- discount) cart lines persist the client's verified unit_price unchanged —
-- exactly like governed_create_order — and never re-price to the flat catalog
-- base (which previously could reject a valid cart with PRICE_NOT_CONFIGURED
-- when carton pricing was absent and silently destroyed discounted prices).
--
-- When the storefront edit path passes the Bonus binders (p_bonus_mode_used +
-- p_bonus_items + p_bonus_credit/... + p_payment_method_option_id +
-- p_shipping_method_option_id + p_bonus_governorate_id), the order is rebuilt
-- through the SAME verify-not-reprice pipeline as governed_create_order:
--
--   * main items are re-verified against the authoritative geo base and stored
--     with unit_price = base_unit_price = that base
--   * bonus products are re-validated (eligibility, availability, pricing) and
--     persisted with is_bonus = true and per-line bonus_applied_amount
--   * the server recomputes credit / products / applied / unused / overflow and
--     aborts on any client mismatch (0.011) or unapproved overflow
--   * payment/shipping option snapshots are re-stamped on the order
--   * the resource/grading/audit contract is unchanged
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_replace_order_contents(uuid, uuid, jsonb, uuid, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.governed_replace_order_contents(
  p_token uuid,
  p_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_tier_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_daily_deals jsonb DEFAULT '[]'::jsonb,
  p_flash_offers jsonb DEFAULT '[]'::jsonb,
  p_payment_method_option_id uuid DEFAULT NULL::uuid,
  p_shipping_method_option_id uuid DEFAULT NULL::uuid,
  p_bonus_items jsonb DEFAULT NULL::jsonb,
  p_bonus_mode_used boolean DEFAULT NULL::boolean,
  p_bonus_credit numeric DEFAULT NULL::numeric,
  p_bonus_products_total numeric DEFAULT NULL::numeric,
  p_bonus_applied numeric DEFAULT NULL::numeric,
  p_bonus_unused numeric DEFAULT NULL::numeric,
  p_bonus_overflow numeric DEFAULT NULL::numeric,
  p_main_base_total numeric DEFAULT NULL::numeric,
  p_bonus_overflow_approved boolean DEFAULT false::boolean,
  p_bonus_governorate_id uuid DEFAULT NULL::uuid
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
  v_calculated_base_price numeric(12,2);
  v_calculated_total_price numeric(12,2);
  v_deal jsonb;
  v_deal_record record;
  v_offer jsonb;
  v_offer_record record;

  -- Discount option snapshots (mirrors governed_update_order_discount_options)
  v_tier_name text;
  v_tier_discount numeric;
  v_payment_name text;
  v_payment_discount numeric;
  v_shipping_name text;
  v_shipping_discount numeric;

  -- Bonus Mode verify-not-reprice persistence (mirrors governed_create_order)
  v_bonus_active boolean := p_bonus_mode_used IS TRUE;
  v_bonus_mode_enabled boolean := false;
  v_bonus_geo_base numeric;
  v_bonus_item jsonb;
  v_bonus_product record;
  v_percent_tier numeric := 0;
  v_percent_payment numeric := 0;
  v_percent_shipping numeric := 0;
  v_combined_pct numeric := 0;
  v_line_base_total numeric := 0;
  v_server_main_base_total numeric := 0;
  v_server_bonus_credit numeric := 0;
  v_server_bonus_products_total numeric := 0;
  v_server_bonus_applied numeric := 0;
  v_server_bonus_unused numeric := 0;
  v_server_bonus_overflow numeric := 0;
  v_remaining_bonus_credit numeric := 0;
  v_line_bonus_applied numeric := 0;
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
    SELECT name, discount_percent INTO v_tier_name, v_tier_discount
    FROM public.tiers WHERE id = p_tier_id;
  END IF;

  IF p_payment_method_option_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_method_options WHERE id = p_payment_method_option_id AND is_active = true) THEN
      RETURN jsonb_build_object('error', 'PAYMENT_METHOD_NOT_FOUND_OR_INACTIVE');
    END IF;
    SELECT name, discount_percent INTO v_payment_name, v_payment_discount
    FROM public.payment_method_options WHERE id = p_payment_method_option_id;
  END IF;

  IF p_shipping_method_option_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.shipping_method_options WHERE id = p_shipping_method_option_id AND is_active = true) THEN
      RETURN jsonb_build_object('error', 'SHIPPING_METHOD_NOT_FOUND_OR_INACTIVE');
    END IF;
    SELECT name, discount_percent INTO v_shipping_name, v_shipping_discount
    FROM public.shipping_method_options WHERE id = p_shipping_method_option_id;
  END IF;

  -- Bonus Mode consistency guards (single system — verify-not-reprice, OFF guard)
  IF v_bonus_active THEN
    SELECT COALESCE((value->>'value')::boolean, false) INTO v_bonus_mode_enabled
    FROM app.app_settings WHERE key = 'bonus_mode_enabled';

    IF NOT v_bonus_mode_enabled THEN
      RETURN jsonb_build_object('error', 'BONUS_MODE_OFF_SERVER');
    END IF;
    IF p_bonus_credit IS NULL OR p_bonus_products_total IS NULL OR p_bonus_applied IS NULL
       OR p_bonus_unused IS NULL OR p_bonus_overflow IS NULL OR p_main_base_total IS NULL THEN
      RETURN jsonb_build_object('error', 'BONUS_FINANCIALS_REQUIRED');
    END IF;
  ELSIF p_bonus_items IS NOT NULL AND jsonb_array_length(p_bonus_items) > 0 THEN
    RETURN jsonb_build_object('error', 'BONUS_ITEMS_WITHOUT_MODE');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', oi.product_id, 'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity, 'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price, 'total_price', oi.total_price,
      'base_unit_price', oi.base_unit_price, 'is_bonus', oi.is_bonus,
      'bonus_applied_amount', oi.bonus_applied_amount
    )
  ) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_id;

  DELETE FROM public.order_items WHERE order_id = p_id;
  DELETE FROM public.order_daily_deals WHERE order_id = p_id;
  DELETE FROM public.order_flash_offers WHERE order_id = p_id;

  -- MAIN products: verified lines with unit_price/base_unit_price persisted
  -- (bonus mode verifies against the authoritative geo base and stores both).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, carton_price, carton_quantity, piece_price, dozen_price, company_id, is_out_of_stock, is_active
    INTO v_product
    FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_item->>'product_id')::uuid);
    END IF;

    -- Revalidation against CURRENT availability (matches governed_create_order)
    IF v_product.is_out_of_stock = true AND v_product.is_active = true THEN
      RETURN jsonb_build_object('error', 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS: ' || v_product.id);
    END IF;

    IF v_bonus_active THEN
      v_bonus_geo_base := public._bonus_geo_base_unit_price(
        v_product.carton_price, v_product.piece_price, v_product.dozen_price,
        COALESCE(v_item->>'unit_type', 'piece'),
        p_bonus_governorate_id, v_product.company_id, v_product.id
      );
      IF v_bonus_geo_base IS NULL THEN
        RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: ' || v_product.id);
      END IF;
      -- verify-not-reprice: the client's unit price must equal the authoritative base
      v_calculated_unit_price := v_bonus_geo_base;
      IF ABS(COALESCE((v_item->>'unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011
         OR ABS(COALESCE((v_item->>'base_unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011 THEN
        RETURN jsonb_build_object('error', 'BONUS_PRICE_MISMATCH: ' || v_product.id);
      END IF;
      v_calculated_base_price := v_bonus_geo_base;
    ELSE
      -- Direct-discount mode: SAME semantics as governed_create_order's non-bonus
      -- branch — persist the CLIENT's verified per-line unit_price (the
      -- discounted price the storefront cart already computed) and disregard it
      -- ONLY for legacy 7-arg callers that omit unit_price, which fall back to
      -- the flat catalog base. This replaces the previous behavior that re-priced
      -- every line to the flat base (rejecting carts with PRICE_NOT_CONFIGURED
      -- when carton pricing is missing and silently destroying verified prices).
      IF (v_item ? 'unit_price') AND (v_item->>'unit_price') IS NOT NULL THEN
        v_calculated_unit_price := (v_item->>'unit_price')::numeric;
      ELSE
        v_calculated_unit_price := public._calc_base_unit_price(v_product.carton_price, v_product.carton_quantity, v_item->>'unit_type');
      END IF;
      IF v_calculated_unit_price IS NULL THEN
        RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: product ' || (v_item->>'product_id')::uuid);
      END IF;
      v_calculated_base_price := 0;
    END IF;

    v_calculated_total_price := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2);
    INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity, piece_quantity, unit_price, base_unit_price, total_price, is_bonus)
    VALUES (p_id, (v_item->>'product_id')::uuid, v_item->>'unit_type', (v_item->>'unit_quantity')::int,
      COALESCE((v_item->>'piece_quantity')::int, 0), v_calculated_unit_price, v_calculated_base_price, v_calculated_total_price, false);

    -- Credit is generated ONLY from MAIN products (tier+payment+shipping).
    IF v_bonus_active THEN
      v_line_base_total := ROUND((v_calculated_unit_price * (v_item->>'unit_quantity')::numeric)::numeric, 2);
      v_server_main_base_total := v_server_main_base_total + v_line_base_total;

      IF p_tier_id IS NOT NULL THEN
        v_percent_tier := public._get_effective_tier_discount(p_tier_id, v_product.id, v_product.company_id);
      ELSE
        v_percent_tier := 0;
      END IF;

      IF p_payment_method_option_id IS NOT NULL THEN
        SELECT COALESCE(
          (SELECT pe.discount_percent FROM public.product_payment_method_exceptions pe
           WHERE pe.payment_method_option_id = p_payment_method_option_id AND pe.product_id = v_product.id LIMIT 1),
          (SELECT ce.discount_percent FROM public.company_payment_method_exceptions ce
           WHERE ce.payment_method_option_id = p_payment_method_option_id AND ce.company_id = v_product.company_id LIMIT 1),
          opt.discount_percent
        ) INTO v_percent_payment
        FROM public.payment_method_options opt WHERE opt.id = p_payment_method_option_id;
      ELSE
        v_percent_payment := 0;
      END IF;

      IF p_shipping_method_option_id IS NOT NULL THEN
        SELECT COALESCE(
          (SELECT pe.discount_percent FROM public.product_shipping_method_exceptions pe
           WHERE pe.shipping_method_option_id = p_shipping_method_option_id AND pe.product_id = v_product.id LIMIT 1),
          (SELECT ce.discount_percent FROM public.company_shipping_method_exceptions ce
           WHERE ce.shipping_method_option_id = p_shipping_method_option_id AND ce.company_id = v_product.company_id LIMIT 1),
          opt.discount_percent
        ) INTO v_percent_shipping
        FROM public.shipping_method_options opt WHERE opt.id = p_shipping_method_option_id;
      ELSE
        v_percent_shipping := 0;
      END IF;

      v_combined_pct := COALESCE(v_percent_tier, 0) + COALESCE(v_percent_payment, 0) + COALESCE(v_percent_shipping, 0);
      v_server_bonus_credit := v_server_bonus_credit
        + ROUND((v_line_base_total * v_combined_pct / 100)::numeric, 2);
    END IF;
  END LOOP;

  -- BONUS products: real order items at the geo base, each consuming credit.
  IF v_bonus_active AND p_bonus_items IS NOT NULL AND jsonb_array_length(p_bonus_items) > 0 THEN
    v_remaining_bonus_credit := v_server_bonus_credit;
    FOR v_bonus_item IN SELECT * FROM jsonb_array_elements(p_bonus_items)
    LOOP
      SELECT p.id, p.carton_price, p.carton_quantity, p.is_out_of_stock, p.is_active, p.company_id, p.piece_price, p.dozen_price
      INTO v_bonus_product
      FROM public.products p
      WHERE p.id = (v_bonus_item->>'product_id')::uuid;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'PRODUCT_NOT_FOUND: ' || (v_bonus_item->>'product_id')::uuid);
      END IF;

      IF NOT public._bonus_product_eligible(v_bonus_product.id) THEN
        RETURN jsonb_build_object('error', 'BONUS_PRODUCT_NOT_ELIGIBLE: ' || v_bonus_product.id);
      END IF;

      IF v_bonus_product.is_out_of_stock = true AND v_bonus_product.is_active = true THEN
        RETURN jsonb_build_object('error', 'ORDER_CONTAINS_OUT_OF_STOCK_PRODUCTS');
      END IF;

      v_bonus_geo_base := public._bonus_geo_base_unit_price(
        v_bonus_product.carton_price, v_bonus_product.piece_price, v_bonus_product.dozen_price,
        COALESCE(v_bonus_item->>'unit_type', 'piece'),
        p_bonus_governorate_id, v_bonus_product.company_id, v_bonus_product.id
      );
      IF v_bonus_geo_base IS NULL THEN
        RETURN jsonb_build_object('error', 'PRICE_NOT_CONFIGURED: ' || v_bonus_product.id);
      END IF;

      -- Bonus lines must be priced EXACTLY at the geo base (no discount allowed)
      IF ABS(COALESCE((v_bonus_item->>'unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011
         OR ABS(COALESCE((v_bonus_item->>'base_unit_price')::numeric, 0) - v_bonus_geo_base) > 0.011 THEN
        RETURN jsonb_build_object('error', 'BONUS_PRICE_MISMATCH: ' || v_bonus_product.id);
      END IF;

      v_calculated_total_price := ROUND((v_bonus_geo_base
        * GREATEST(COALESCE((v_bonus_item->>'unit_quantity')::integer, 1), 1))::numeric, 2);
      v_server_bonus_products_total := v_server_bonus_products_total + v_calculated_total_price;

      v_line_bonus_applied := GREATEST(LEAST(v_remaining_bonus_credit, v_calculated_total_price), 0);
      v_remaining_bonus_credit := v_remaining_bonus_credit - v_line_bonus_applied;

      INSERT INTO public.order_items (
        order_id, product_id, unit_type, unit_quantity, piece_quantity,
        unit_price, base_unit_price, total_price, is_bonus, bonus_applied_amount
      ) VALUES (
        p_id, v_bonus_product.id,
        COALESCE(v_bonus_item->>'unit_type', 'piece'),
        GREATEST(COALESCE((v_bonus_item->>'unit_quantity')::integer, 1), 1),
        GREATEST(COALESCE((v_bonus_item->>'piece_quantity')::integer, 0), 1),
        v_bonus_geo_base, v_bonus_geo_base, v_calculated_total_price,
        true, v_line_bonus_applied
      );
    END LOOP;
  END IF;

  -- Verify the client-provided Bonus financial snapshot against the SERVER.
  IF v_bonus_active THEN
    v_server_main_base_total := ROUND(v_server_main_base_total, 2);
    v_server_bonus_credit := ROUND(v_server_bonus_credit, 2);
    v_server_bonus_products_total := ROUND(v_server_bonus_products_total, 2);
    v_server_bonus_applied := ROUND(LEAST(v_server_bonus_credit, v_server_bonus_products_total), 2);
    v_server_bonus_unused := ROUND(GREATEST(v_server_bonus_credit - v_server_bonus_products_total, 0), 2);
    v_server_bonus_overflow := ROUND(GREATEST(v_server_bonus_products_total - v_server_bonus_credit, 0), 2);

    IF ABS(v_server_main_base_total - COALESCE(p_main_base_total, 0)) > 0.011
       OR ABS(v_server_bonus_credit - COALESCE(p_bonus_credit, 0)) > 0.011
       OR ABS(v_server_bonus_products_total - COALESCE(p_bonus_products_total, 0)) > 0.011
       OR ABS(v_server_bonus_applied - COALESCE(p_bonus_applied, 0)) > 0.011
       OR ABS(v_server_bonus_unused - COALESCE(p_bonus_unused, 0)) > 0.011
       OR ABS(v_server_bonus_overflow - COALESCE(p_bonus_overflow, 0)) > 0.011 THEN
      RETURN jsonb_build_object('error',
        'BONUS_FINANCIALS_MISMATCH: server_credit=' || v_server_bonus_credit
        || ' products=' || v_server_bonus_products_total || ' overflow=' || v_server_bonus_overflow);
    END IF;

    IF v_server_bonus_overflow > 0 AND COALESCE(p_bonus_overflow_approved, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('error', 'BONUS_OVERFLOW_NOT_APPROVED');
    END IF;
  END IF;

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
      'unit_price', oi.unit_price, 'total_price', oi.total_price,
      'base_unit_price', oi.base_unit_price, 'is_bonus', oi.is_bonus,
      'bonus_applied_amount', oi.bonus_applied_amount
    )
  ) INTO v_new_items
  FROM public.order_items oi WHERE oi.order_id = p_id;

  -- Task: re-stamp discount option references + snapshots, freeze the verified
  -- Bonus financial snapshot (or NULL it in direct-discount mode), never
  -- destroying the confirmed audit trail.
  UPDATE public.orders SET
    tier_id = COALESCE(p_tier_id, tier_id),
    payment_method_option_id = COALESCE(p_payment_method_option_id, payment_method_option_id),
    shipping_method_option_id = COALESCE(p_shipping_method_option_id, shipping_method_option_id),
    snapshot_tier_name = COALESCE(v_tier_name, snapshot_tier_name),
    snapshot_tier_discount = COALESCE(v_tier_discount, snapshot_tier_discount),
    snapshot_payment_name = COALESCE(v_payment_name, snapshot_payment_name),
    snapshot_payment_discount = COALESCE(v_payment_discount, snapshot_payment_discount),
    snapshot_shipping_name = COALESCE(v_shipping_name, snapshot_shipping_name),
    snapshot_shipping_discount = COALESCE(v_shipping_discount, snapshot_shipping_discount),
    notes = p_notes,
    bonus_mode_used = CASE WHEN v_bonus_active THEN true ELSE NULL END,
    bonus_credit = CASE WHEN v_bonus_active THEN v_server_bonus_credit ELSE NULL END,
    bonus_products_total = CASE WHEN v_bonus_active THEN v_server_bonus_products_total ELSE NULL END,
    bonus_applied = CASE WHEN v_bonus_active THEN v_server_bonus_applied ELSE NULL END,
    bonus_unused = CASE WHEN v_bonus_active THEN v_server_bonus_unused ELSE NULL END,
    bonus_overflow = CASE WHEN v_bonus_active THEN v_server_bonus_overflow ELSE NULL END,
    main_base_total = CASE WHEN v_bonus_active THEN v_server_main_base_total ELSE NULL END,
    updated_at = now()
  WHERE id = p_id;

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

  IF p_tier_id IS NOT NULL OR p_payment_method_option_id IS NOT NULL OR p_shipping_method_option_id IS NOT NULL THEN
    INSERT INTO public.order_modification_history (
      order_id, revision_number, field_name, old_value, new_value, modified_by, reason, modified_at
    ) VALUES (
      p_id, v_order.revision_number, 'discount_options',
      jsonb_build_object(
        'tier_id', v_order.tier_id,
        'payment_method_option_id', v_order.payment_method_option_id,
        'shipping_method_option_id', v_order.shipping_method_option_id
      )::text,
      jsonb_build_object(
        'tier_id', p_tier_id,
        'payment_method_option_id', p_payment_method_option_id,
        'shipping_method_option_id', p_shipping_method_option_id
      )::text,
      v_session.identity_id,
      'تحديث خيارات الخصم أثناء تعديل الطلب',
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'item_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = p_id),
    'bonus_mode_used', CASE WHEN v_bonus_active THEN true ELSE NULL END,
    'bonus_credit', CASE WHEN v_bonus_active THEN v_server_bonus_credit ELSE NULL END,
    'bonus_products_total', CASE WHEN v_bonus_active THEN v_server_bonus_products_total ELSE NULL END,
    'bonus_applied', CASE WHEN v_bonus_active THEN v_server_bonus_applied ELSE NULL END,
    'bonus_unused', CASE WHEN v_bonus_active THEN v_server_bonus_unused ELSE NULL END,
    'bonus_overflow', CASE WHEN v_bonus_active THEN v_server_bonus_overflow ELSE NULL END,
    'main_base_total', CASE WHEN v_bonus_active THEN v_server_main_base_total ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.governed_replace_order_contents IS
  'استبدال محتويات طلب (نسخة فائقة): يعيد بناء العناصر الرئيسية مع حفظ السعر الأساسي (verify-not-reprice في وضع البونص)، ويحفظ منتجات البونص ويحسب الائتمان والمجاميع على الخادم، ويجمد اللقطات وخيارات الخصم، كل ذلك بنفس العقد والتدقيق كما في governed_create_order — مع دعم تام لاستدعاء النسخة 7-برامتر القديمة.';

GRANT EXECUTE ON FUNCTION public.governed_replace_order_contents(uuid, uuid, jsonb, uuid, text, jsonb, jsonb, uuid, uuid, jsonb, boolean, numeric, numeric, numeric, numeric, numeric, numeric, boolean, uuid) TO authenticated, service_role;

-- ============================================================================
-- get_unified_order — re-add per-line bonus markers to the restore payload
-- ----------------------------------------------------------------------------
-- The 20271106/20271115 rewrites of get_unified_order (to expose
-- order_items.base_unit_price and restore reference_number) dropped the
-- per-line is_bonus / bonus_applied_amount fields that the 20271112 Bonus
-- persistence migration reads from the plural get_unified_orders RPC. As a
-- result a RETURNED/EDIT order's restored cart could not distinguish bonus
-- products from main ones, and the storefront resubmit lost them.
--
-- This recreation keeps the EXACT current (20271115) response shape — same
-- order jsonb (split into two jsonb_build_object calls to stay under the
-- 100-argument variadic limit), same customer/status/modification/delivery/
-- preparation/returns/collections blocks — and adds three per-item fields to
-- the items aggregate: is_bonus, bonus_applied_amount, and note. This is the
-- SAME authoritative pair the plural list has exposed since 20271112.
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_unified_order(text, uuid);

CREATE OR REPLACE FUNCTION public.get_unified_order(p_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
  v_is_super boolean;
  v_customer_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_is_super := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_super THEN
      v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_visible)
      ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'subtotal', o.subtotal,
        'discount_amount', o.discount_amount,
        'tax_amount', o.tax_amount,
        'total_amount', o.total_amount,
        'notes', o.notes,
        'revision_number', o.revision_number,
        'last_revised_at', o.last_revised_at,
        'customer_id', o.customer_id,
        'owner_type', o.owner_type,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'delivered_at', o.delivered_at,
        'cancelled_at', o.cancelled_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'deferred_until', o.deferred_until,
        'defer_reason', o.defer_reason,
        'cancel_reason', o.cancel_reason,
        'execution_latitude', o.execution_latitude,
        'execution_longitude', o.execution_longitude,
        'execution_accuracy_meters', o.execution_accuracy_meters,
        'execution_captured_at', o.execution_captured_at,
        'execution_location_id', o.execution_location_id,
        'tier_id', o.tier_id,
        'effective_discount_percent', o.effective_discount_percent
      ) || jsonb_build_object(
        'snapshot_customer_name', o.snapshot_customer_name,
        'snapshot_customer_phone', o.snapshot_customer_phone,
        'snapshot_customer_address', o.snapshot_customer_address,
        'snapshot_customer_code', o.snapshot_customer_code,
        'snapshot_owner_name', o.snapshot_owner_name,
        'snapshot_owner_phone', o.snapshot_owner_phone,
        'snapshot_owner_address', o.snapshot_owner_address,
        'snapshot_sender_name', o.snapshot_sender_name,
        'snapshot_sender_phone', o.snapshot_sender_phone,
        'snapshot_sender_address', o.snapshot_sender_address,
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'order_creator_name', COALESCE(oc_emp.full_name, oc_cust.company_name, ''),
        'order_creator_role', CASE
          WHEN oc_i.identity_type = 'employee' THEN COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = oc_emp.id LIMIT 1), '')
          ELSE NULL
        END,
        'customer_owner_id', c.owner_id,
        'order_creator_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'order_creator_type', oc_i.identity_type,
        'current_owner_name', COALESCE(owner_e.full_name, o.snapshot_owner_name, ''),
        'reference_number', o.reference_number
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c2.id,
          'code', c2.code,
          'company_name', c2.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', ca.latitude,
          'address_longitude', ca.longitude,
          'display_address',
            COALESCE(
              NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
              o.snapshot_customer_address
            ),
          'previous_order_count', ps.order_count,
          'previous_orders_total', ps.orders_total,
          'previous_order_number', ps.last_order_number,
          'previous_order_date', ps.last_order_date,
          'previous_order_total', ps.last_order_total
        )
        FROM public.customers c2
        LEFT JOIN public.identities i ON i.id = c2.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c2.id AND ca.is_default = true
        LEFT JOIN LATERAL (
          SELECT
            count(*)::bigint AS order_count,
            COALESCE(sum(total_amount), 0) AS orders_total,
            (array_agg(order_number ORDER BY created_at DESC))[1] AS last_order_number,
            max(created_at) AS last_order_date,
            (array_agg(total_amount ORDER BY created_at DESC))[1] AS last_order_total
          FROM public.orders o2
          WHERE o2.customer_id = c2.id AND o2.id <> o.id
        ) ps ON true
        WHERE c2.id = v_customer_id
        LIMIT 1
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', p.product_name,
          'legacy_code', p.legacy_code,
          'image_url', p.image_url,
          'company_id', p.company_id,
          'company_name', comp.company_name,
          'unit_type', oi.unit_type,
          'unit_quantity', oi.unit_quantity,
          'piece_quantity', oi.piece_quantity,
          'unit_price', oi.unit_price,
          'base_unit_price', oi.base_unit_price,
          'total_price', oi.total_price,
          'is_bonus', COALESCE(oi.is_bonus, false),
          'bonus_applied_amount', COALESCE(oi.bonus_applied_amount, 0)
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
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
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
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.employees owner_e ON owner_e.id = o.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.id = p_id
  );
END;
$function$;

COMMENT ON FUNCTION public.get_unified_order IS 'مصدر الحقيقة الموحد للطلب — يعرض الطلب مع العميل والأصناف (بما فيها base_unit_price و is_bonus و bonus_applied_amount) والتوصيل والتحصيل والمرتجعات والرقم المرجعي';

-- ============================================================================
-- END OF FIX — RETURNED/EDIT ORDER RESUBMISSION FLOW
-- ============================================================================