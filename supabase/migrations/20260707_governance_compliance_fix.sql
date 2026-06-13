-- ============================================================================
-- Governance Compliance Fix
-- Adds governed RPCs for auctions and enhances existing RPCs with missing
-- fields (image_url, is_visible, logo_url, original_quantity, inventory).
-- All RPCs use SECURITY DEFINER with session validation + capability check.
-- ============================================================================

-- ============================================================================
-- 1. governed_create_auction
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_create_auction(
  p_token uuid,
  p_code varchar,
  p_title varchar,
  p_description text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_starting_price decimal DEFAULT 0,
  p_bid_increment decimal DEFAULT 1,
  p_deposit_amount decimal DEFAULT NULL,
  p_start_time timestamptz DEFAULT now(),
  p_end_time timestamptz DEFAULT (now() + interval '7 days')
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_auction_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'auctions.manage');

  INSERT INTO public.auctions (code, title, description, image_url, starting_price, current_price, bid_increment, deposit_amount, start_time, end_time, created_by)
  VALUES (p_code, p_title, p_description, p_image_url, p_starting_price, p_starting_price, p_bid_increment, p_deposit_amount, p_start_time, p_end_time, v_session.employee_id)
  RETURNING id INTO v_auction_id;

  RETURN jsonb_build_object('success', true, 'id', v_auction_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_auction IS 'إنشاء مزاد جديد';

-- ============================================================================
-- 2. governed_update_auction
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_auction(
  p_token uuid,
  p_id uuid,
  p_title varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_starting_price decimal DEFAULT NULL,
  p_bid_increment decimal DEFAULT NULL,
  p_deposit_amount decimal DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'auctions.manage');

  UPDATE public.auctions SET
    title = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    image_url = COALESCE(p_image_url, image_url),
    starting_price = COALESCE(p_starting_price, starting_price),
    bid_increment = COALESCE(p_bid_increment, bid_increment),
    deposit_amount = COALESCE(p_deposit_amount, deposit_amount),
    start_time = COALESCE(p_start_time, start_time),
    end_time = COALESCE(p_end_time, end_time),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_auction IS 'تعديل بيانات مزاد';

-- ============================================================================
-- 3. Enhance governed_update_daily_deal with p_original_quantity
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_daily_deal(
  p_token uuid,
  p_id uuid,
  p_title varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_original_quantity integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_current_status daily_deal_status;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'deals.manage');

  SELECT status INTO v_current_status FROM public.daily_deals WHERE id = p_id;
  IF v_current_status IS NULL THEN RETURN jsonb_build_object('error', 'DEAL_NOT_FOUND'); END IF;
  IF v_current_status IN ('expired', 'cancelled') THEN RETURN jsonb_build_object('error', 'DEAL_LOCKED'); END IF;

  UPDATE public.daily_deals SET
    title = COALESCE(p_title, title),
    image_url = COALESCE(p_image_url, image_url),
    description = COALESCE(p_description, description),
    fixed_price = COALESCE(p_fixed_price, fixed_price),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    original_quantity = COALESCE(p_original_quantity, original_quantity),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_daily_deal IS 'تحديث عرض يومي (مع الكمية الأصلية)';

-- ============================================================================
-- 4. Enhance governed_update_product with p_image_url
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_product(
  p_token uuid,
  p_id uuid,
  p_product_name varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET
    product_name = COALESCE(p_product_name, product_name),
    description = COALESCE(p_description, description),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    image_url = COALESCE(p_image_url, image_url),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product IS 'تعديل بيانات منتج (مع الصورة)';

-- ============================================================================
-- 5. governed_update_product_visibility
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_product_visibility(
  p_token uuid,
  p_id uuid,
  p_is_visible boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  UPDATE public.products
  SET is_visible = COALESCE(p_is_visible, is_visible), updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_visibility IS 'تغيير حالة ظهور المنتج';

-- ============================================================================
-- 6. governed_update_product_inventory
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_product_inventory(
  p_token uuid,
  p_id uuid,
  p_quantity integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_inv_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'products.manage');

  SELECT id INTO v_inv_id FROM public.inventory WHERE product_id = p_id;
  IF v_inv_id IS NULL THEN
    INSERT INTO public.inventory (product_id, quantity) VALUES (p_id, COALESCE(p_quantity, 0))
    ON CONFLICT (product_id) DO UPDATE SET quantity = COALESCE(p_quantity, EXCLUDED.quantity), updated_at = now();
  ELSE
    UPDATE public.inventory SET quantity = COALESCE(p_quantity, quantity), updated_at = now() WHERE product_id = p_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_inventory IS 'تحديث مخزون المنتج';

-- ============================================================================
-- 7. Enhance governed_update_company with p_logo_url and p_is_visible
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_company(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,
  p_legacy_code varchar DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'companies.manage');

  UPDATE public.companies
  SET
    company_name = COALESCE(p_company_name, company_name),
    legacy_code = COALESCE(p_legacy_code, legacy_code),
    logo_url = COALESCE(p_logo_url, logo_url),
    is_visible = COALESCE(p_is_visible, is_visible),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_company IS 'تعديل بيانات شركة (مع الشعار والظهور)';
