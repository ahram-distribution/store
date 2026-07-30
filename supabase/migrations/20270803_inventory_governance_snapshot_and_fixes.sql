-- ============================================================================
-- INVENTORY GOVERNANCE — Snapshot RPC & shortage contract fix
-- 1. Add available_quantity to governed_inventory_deduct shortage entries
-- 2. governed_get_order_inventory_snapshot — read-only, management-only
-- ============================================================================

-- 1. Fix: Include available_quantity in each shortage entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_inventory_deduct(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_shortages jsonb := '[]'::jsonb;
  v_deducted_items jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  IF v_order.inventory_deducted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', true);
  END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  WITH combined AS (
    SELECT oi.product_id, SUM(oi.piece_quantity) AS total_qty
    FROM public.order_items oi WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    UNION ALL
    SELECT di.product_id, SUM(di.quantity * odd.quantity)
    FROM public.order_daily_deals odd
    JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
    WHERE odd.order_id = p_order_id
    GROUP BY di.product_id
    UNION ALL
    SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)
    FROM public.order_flash_offers ofo
    JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
    WHERE ofo.order_id = p_order_id
    GROUP BY foi.product_id
  ),
  aggregated AS (
    SELECT product_id, SUM(total_qty) AS total_quantity
    FROM combined
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object('product_id', product_id, 'total_quantity', total_quantity)
  ) INTO v_requirements
  FROM aggregated;

  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    UPDATE public.orders
    SET inventory_deducted_at = now(),
        inventory_deducted_items = '[]'::jsonb,
        updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'deducted', true, 'item_count', 0);
  END IF;

  IF NOT v_negative_selling THEN
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      SELECT quantity INTO v_available
      FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;

      IF FOUND AND v_available < (v_req.value->>'total_quantity')::integer THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_req.value->>'product_id',
          'requested_quantity', (v_req.value->>'total_quantity')::integer,
          'available_quantity', v_available
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(v_shortages) > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_STOCK',
        'shortages', v_shortages
      );
    END IF;
  ELSE
    FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
      PERFORM FROM public.inventory
      WHERE product_id = (v_req.value->>'product_id')::uuid
      FOR UPDATE;
    END LOOP;
  END IF;

  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    UPDATE public.inventory
    SET quantity = quantity - (v_req.value->>'total_quantity')::integer,
        updated_at = now()
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    v_deducted_items := v_deducted_items || jsonb_build_object(
      'product_id', v_req.value->>'product_id',
      'piece_quantity', (v_req.value->>'total_quantity')::integer
    );
  END LOOP;

  UPDATE public.orders
  SET inventory_deducted_at = now(),
      inventory_deducted_items = v_deducted_items,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'deducted', true,
    'item_count', jsonb_array_length(v_deducted_items)
  );
END;
$$;

COMMENT ON FUNCTION public.governed_inventory_deduct IS
  'خصم مخزون الطلب مرة واحدة فقط (exactly-once)';

-- ============================================================================
-- 2. governed_get_order_inventory_snapshot — read-only, management-only
-- Returns current inventory snapshot for all order products without locking
-- or mutating any data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_get_order_inventory_snapshot(
  p_token text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_order record;
  v_negative_selling boolean;
  v_requirements jsonb;
  v_req record;
  v_available integer;
  v_snapshot jsonb := '[]'::jsonb;
  v_is_sufficient boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'orders.manage');

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_negative_selling := COALESCE(v_order.order_negative_selling_allowed, false);

  -- Aggregate required quantities (same canonical logic as governed_inventory_deduct)
  WITH combined AS (
    SELECT oi.product_id, SUM(oi.piece_quantity) AS total_qty
    FROM public.order_items oi WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    UNION ALL
    SELECT di.product_id, SUM(di.quantity * odd.quantity)
    FROM public.order_daily_deals odd
    JOIN public.daily_deal_items di ON di.deal_id = odd.deal_id
    WHERE odd.order_id = p_order_id
    GROUP BY di.product_id
    UNION ALL
    SELECT foi.product_id, SUM(foi.quantity * ofo.quantity)
    FROM public.order_flash_offers ofo
    JOIN public.flash_offer_items foi ON foi.offer_id = ofo.offer_id
    WHERE ofo.order_id = p_order_id
    GROUP BY foi.product_id
  ),
  aggregated AS (
    SELECT product_id, SUM(total_qty) AS total_quantity
    FROM combined
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object('product_id', product_id, 'total_quantity', total_quantity)
  ) INTO v_requirements
  FROM aggregated;

  IF v_requirements IS NULL OR jsonb_array_length(v_requirements) = 0 THEN
    RETURN jsonb_build_object('snapshot', '[]'::jsonb);
  END IF;

  FOR v_req IN SELECT * FROM jsonb_array_elements(v_requirements) LOOP
    v_available := 0;

    SELECT quantity INTO v_available
    FROM public.inventory
    WHERE product_id = (v_req.value->>'product_id')::uuid;

    -- is_sufficient when: negative selling enabled, OR no inventory record, OR stock meets demand
    v_is_sufficient := v_negative_selling
                    OR NOT FOUND
                    OR v_available >= (v_req.value->>'total_quantity')::integer;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_req.value->>'product_id',
      'requested_quantity', (v_req.value->>'total_quantity')::integer,
      'available_quantity', v_available,
      'is_sufficient', v_is_sufficient
    );
  END LOOP;

  RETURN jsonb_build_object('snapshot', v_snapshot);
END;
$$;

COMMENT ON FUNCTION public.governed_get_order_inventory_snapshot IS
  'لقطة مخزون للاطلاع فقط — لا حجز ولا خصم';
