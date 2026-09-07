-- ============================================================================
-- ADMIN OPTION MANAGEMENT — SAFE DELETE for Tier / Payment / Shipping options
--
-- Why:
--   The management screen (TiersManagerPage) previously had no delete path and
--   the tiers list relied on get_governed_tiers which hard-filters
--   `WHERE is_active = true`. These RPCs give the admin a first-class delete /
--   archive path that never breaks historical references:
--
--   • p_dry_run = true  → inspects references, returns recommended action
--   • p_dry_run = false → executes:
--        - referenced (orders / exceptions) → ARCHIVE: is_active=false,
--          is_visible=false (soft deactivation, preserves history/snapshots)
--        - unreferenced → permanent DELETE
--
--   Customer-facing queries (get_governed_discount_options / callers that
--   filter client-side with isActive && isVisible) are untouched.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. governed_delete_tier
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_tier(
  p_token uuid,
  p_id uuid,
  p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_orders integer;
  v_company_ex integer;
  v_product_ex integer;
  v_tier_ex integer;
  v_total integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_id) THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_orders FROM public.orders WHERE tier_id = p_id;
  SELECT COUNT(*) INTO v_company_ex FROM public.tier_company_exceptions WHERE tier_id = p_id;
  SELECT COUNT(*) INTO v_product_ex FROM public.tier_product_exceptions WHERE tier_id = p_id;
  SELECT COUNT(*) INTO v_tier_ex FROM public.tier_exceptions WHERE tier_id = p_id;
  v_total := v_orders + v_company_ex + v_product_ex + v_tier_ex;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'action', CASE WHEN v_total > 0 THEN 'archive' ELSE 'delete' END,
      'references', jsonb_build_object(
        'orders', v_orders,
        'company_exceptions', v_company_ex,
        'product_exceptions', v_product_ex,
        'tier_exceptions', v_tier_ex
      )
    );
  END IF;

  IF v_total > 0 THEN
    UPDATE public.tiers
    SET is_active = false, is_visible = false, updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'success', true, 'action', 'archive', 'id', p_id,
      'references', jsonb_build_object(
        'orders', v_orders,
        'company_exceptions', v_company_ex,
        'product_exceptions', v_product_ex,
        'tier_exceptions', v_tier_ex
      )
    );
  END IF;

  DELETE FROM public.tiers WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'action', 'delete', 'id', p_id);
END;
$$;

COMMENT ON FUNCTION public.governed_delete_tier IS
  'حذف/أرشفة شريحة سعرية بأمان. إذا كانت مرجعها (طلبات/استثناءات) موجودة تُؤرشف الشريحة (إيقاف + إخفاء)، وإلا تُحذف نهائياً.';

GRANT EXECUTE ON FUNCTION public.governed_delete_tier(uuid, uuid, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. governed_delete_payment_method_option
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_payment_method_option(
  p_token uuid,
  p_id uuid,
  p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_orders integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_method_options WHERE id = p_id) THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_orders FROM public.orders WHERE payment_method_option_id = p_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'action', CASE WHEN v_orders > 0 THEN 'archive' ELSE 'delete' END,
      'references', jsonb_build_object('orders', v_orders)
    );
  END IF;

  IF v_orders > 0 THEN
    UPDATE public.payment_method_options
    SET is_active = false, is_visible = false, updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'success', true, 'action', 'archive', 'id', p_id,
      'references', jsonb_build_object('orders', v_orders)
    );
  END IF;

  DELETE FROM public.payment_method_options WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'action', 'delete', 'id', p_id);
END;
$$;

COMMENT ON FUNCTION public.governed_delete_payment_method_option IS
  'حذف/أرشفة طريقة دفع بأمان. إذا كانت مرجعها (طلبات) موجودة تُؤرشف (إيقاف + إخفاء)، وإلا تُحذف نهائياً.';

GRANT EXECUTE ON FUNCTION public.governed_delete_payment_method_option(uuid, uuid, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. governed_delete_shipping_method_option
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_shipping_method_option(
  p_token uuid,
  p_id uuid,
  p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_orders integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shipping_method_options WHERE id = p_id) THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_orders FROM public.orders WHERE shipping_method_option_id = p_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'action', CASE WHEN v_orders > 0 THEN 'archive' ELSE 'delete' END,
      'references', jsonb_build_object('orders', v_orders)
    );
  END IF;

  IF v_orders > 0 THEN
    UPDATE public.shipping_method_options
    SET is_active = false, is_visible = false, updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'success', true, 'action', 'archive', 'id', p_id,
      'references', jsonb_build_object('orders', v_orders)
    );
  END IF;

  DELETE FROM public.shipping_method_options WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'action', 'delete', 'id', p_id);
END;
$$;

COMMENT ON FUNCTION public.governed_delete_shipping_method_option IS
  'حذف/أرشفة طريقة شحن بأمان. إذا كانت مرجعها (طلبات) موجودة تُؤرشف (إيقاف + إخفاء)، وإلا تُحذف نهائياً.';

GRANT EXECUTE ON FUNCTION public.governed_delete_shipping_method_option(uuid, uuid, boolean) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- END OF ADMIN OPTION MANAGEMENT MIGRATION
-- ============================================================================