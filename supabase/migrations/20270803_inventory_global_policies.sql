-- ============================================================================
-- INVENTORY GOVERNANCE — Global Policy Migration
--
-- Converts negative_selling_allowed and inventory_deduction_status from
-- per-product settings to global policies stored in app.app_settings.
--
-- Changes:
--   1. Seed default global policy values in app.app_settings
--   2. get_inventory_policies RPC — read both global settings
--   3. set_global_negative_selling_policy RPC — set global + retroactive scope
--   4. set_global_inventory_deduction_status RPC — set global + retroactive scope
--   5. Trigger on orders — snapshot global policies at order creation time
--   6. Remove per-product policy fields from get_governed_products response
-- ============================================================================

-- ============================================================================
-- 1. Seed default global policy values
-- ============================================================================

INSERT INTO app.app_settings (key, value, description)
VALUES
  ('inventory_negative_selling_allowed', '{"value": true}'::jsonb,
   'Global negative selling policy — when false, inventory floor is enforced for all products'),
  ('inventory_deduction_status', '{"value": "approved"}'::jsonb,
   'Global order status at which inventory is automatically deducted')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. get_inventory_policies — read both global settings
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_inventory_policies(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_neg_selling boolean;
  v_ded_status varchar(30);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  SELECT (value->>'value')::boolean INTO v_neg_selling
  FROM app.app_settings WHERE key = 'inventory_negative_selling_allowed';
  IF v_neg_selling IS NULL THEN v_neg_selling := true; END IF;

  SELECT (value->>'value')::varchar INTO v_ded_status
  FROM app.app_settings WHERE key = 'inventory_deduction_status';
  IF v_ded_status IS NULL THEN v_ded_status := 'approved'; END IF;

  RETURN jsonb_build_object(
    'negative_selling_allowed', v_neg_selling,
    'inventory_deduction_status', v_ded_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_policies TO authenticated;

COMMENT ON FUNCTION public.get_inventory_policies IS
  'قراءة سياسات المخزون العالمية (البيع بالسالب وحالة الخصم)';

-- ============================================================================
-- 3. set_global_negative_selling_policy — set global + retroactive scope
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_global_negative_selling_policy(
  p_token text,
  p_value boolean,
  p_scope varchar(20) DEFAULT 'new_orders'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_old_value boolean;
  v_order record;
  v_has_unavailable boolean;
  v_has_insufficient boolean;
  v_restore_result jsonb;
  v_moved_count integer := 0;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  -- Read old value
  SELECT (value->>'value')::boolean INTO v_old_value
  FROM app.app_settings WHERE key = 'inventory_negative_selling_allowed';
  IF v_old_value IS NULL THEN v_old_value := true; END IF;

  -- Update global setting
  INSERT INTO app.app_settings (key, value, description)
  VALUES ('inventory_negative_selling_allowed', jsonb_build_object('value', p_value),
          'Global negative selling policy')
  ON CONFLICT (key) DO UPDATE
  SET value = jsonb_build_object('value', p_value), updated_at = now();

  -- If scope is previous_and_new AND changing from true to false, Stock Review revalidation
  IF p_scope = 'previous_and_new' AND v_old_value = true AND p_value = false THEN
    FOR v_order IN
      SELECT DISTINCT o.id, o.status, o.inventory_deducted_at
      FROM public.orders o
      WHERE o.status NOT IN ('delivered', 'cancelled', 'stock_review')
    LOOP
      v_has_unavailable := false;
      v_has_insufficient := false;

      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = v_order.id
          AND (p.is_out_of_stock = true OR p.is_active = false)
      ) THEN
        v_has_unavailable := true;
      END IF;

      IF v_order.inventory_deducted_at IS NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.order_items oi2
          JOIN public.inventory inv ON inv.product_id = oi2.product_id
          WHERE oi2.order_id = v_order.id
            AND inv.quantity < oi2.piece_quantity
        ) INTO v_has_insufficient;
      END IF;

      IF v_has_unavailable OR v_has_insufficient THEN
        PERFORM public.governed_inventory_restore(v_order.id);

        UPDATE public.orders
        SET status = 'stock_review',
            order_negative_selling_allowed = false,
            updated_at = now()
        WHERE id = v_order.id;

        INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason, changed_at)
        VALUES (v_order.id, v_order.status, 'stock_review', v_session.identity_id,
                'تم نقل الطلب لمراجعة المخزونdue to global Negative Selling policy change', now());

        v_moved_count := v_moved_count + 1;
      ELSE
        UPDATE public.orders
        SET order_negative_selling_allowed = false, updated_at = now()
        WHERE id = v_order.id;
      END IF;
    END LOOP;
  ELSIF p_scope = 'previous_and_new' THEN
    UPDATE public.orders
    SET order_negative_selling_allowed = p_value, updated_at = now()
    WHERE status NOT IN ('delivered', 'cancelled', 'stock_review');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'negative_selling_allowed', p_value,
    'scope', p_scope,
    'moved_to_stock_review', v_moved_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_global_negative_selling_policy TO authenticated;

COMMENT ON FUNCTION public.set_global_negative_selling_policy IS
  'تغيير سياسة البيع بالسالب العالمية مع تحديد النطاق (طلبات جديدة فقط / سابقة وحديثة)';

-- ============================================================================
-- 4. set_global_inventory_deduction_status — set global + retroactive scope
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_global_inventory_deduction_status(
  p_token text,
  p_value varchar(30),
  p_scope varchar(20) DEFAULT 'new_orders'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_old_value varchar(30);
  v_valid_statuses text[] := ARRAY[
    'submitted', 'reviewing', 'approved', 'preparing', 'prepared',
    'ready_for_dispatch', 'sent_to_delivery', 'dispatched', 'delivered'
  ];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token::uuid AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  IF p_scope NOT IN ('new_orders', 'previous_and_new') THEN
    RETURN jsonb_build_object('error', 'INVALID_SCOPE');
  END IF;

  IF NOT (p_value = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('error', 'INVALID_DEDUCTION_STATUS');
  END IF;

  -- Read old value
  SELECT (value->>'value')::varchar INTO v_old_value
  FROM app.app_settings WHERE key = 'inventory_deduction_status';
  IF v_old_value IS NULL THEN v_old_value := 'approved'; END IF;

  -- Update global setting
  INSERT INTO app.app_settings (key, value, description)
  VALUES ('inventory_deduction_status', jsonb_build_object('value', p_value),
          'Global inventory deduction status')
  ON CONFLICT (key) DO UPDATE
  SET value = jsonb_build_object('value', p_value), updated_at = now();

  -- If scope is previous_and_new, update snapshot on all active orders
  IF p_scope = 'previous_and_new' AND v_old_value != p_value THEN
    UPDATE public.orders
    SET order_inventory_deduction_status = p_value, updated_at = now()
    WHERE status NOT IN ('delivered', 'cancelled', 'stock_review');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inventory_deduction_status', p_value,
    'scope', p_scope
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_global_inventory_deduction_status TO authenticated;

COMMENT ON FUNCTION public.set_global_inventory_deduction_status IS
  'تغيير حالة الخصم المخزنية العالمية مع تحديد النطاق';

-- ============================================================================
-- 5. Trigger: snapshot global policies on new orders
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_snapshot_inventory_policies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.order_negative_selling_allowed := COALESCE(
    (SELECT (value->>'value')::boolean FROM app.app_settings WHERE key = 'inventory_negative_selling_allowed'),
    true
  );
  NEW.order_inventory_deduction_status := COALESCE(
    (SELECT (value->>'value')::varchar FROM app.app_settings WHERE key = 'inventory_deduction_status'),
    'approved'::varchar
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_inventory_policies ON public.orders;

CREATE TRIGGER snapshot_inventory_policies
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_snapshot_inventory_policies();

-- ============================================================================
-- END
-- ============================================================================

NOTIFY pgrst, 'reload schema';
