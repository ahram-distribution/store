-- Fix enum cast bugs in governed_create/activate/cancel for daily_deals and flash_offers

-- 1. governed_create_daily_deal: cast CASE expression to daily_deal_status
CREATE OR REPLACE FUNCTION public.governed_create_daily_deal(
  p_token uuid,
  p_title varchar,
  p_fixed_price numeric,
  p_quantity integer,
  p_image_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_items jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_deal_id uuid;
  v_item jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'deals.manage');

  IF p_fixed_price < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PRICE'); END IF;
  IF p_quantity <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_QUANTITY'); END IF;

  INSERT INTO public.daily_deals (
    title, image_url, description, fixed_price,
    available_quantity, original_quantity,
    starts_at, ends_at, status, created_by
  ) VALUES (
    p_title, p_image_url, p_description, p_fixed_price,
    p_quantity, p_quantity,
    p_starts_at, p_ends_at,
    CASE
      WHEN p_starts_at IS NOT NULL AND p_starts_at > now() THEN 'scheduled'::daily_deal_status
      ELSE 'active'::daily_deal_status
    END,
    v_session.employee_id
  )
  RETURNING id INTO v_deal_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.daily_deal_items (deal_id, product_id, quantity)
    VALUES (
      v_deal_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::int
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_deal_id);
END;
$function$;

-- 2. governed_activate_daily_deal: cast to daily_deal_status
CREATE OR REPLACE FUNCTION public.governed_activate_daily_deal(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
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
  IF v_current_status NOT IN ('draft', 'scheduled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.daily_deals SET status = 'active'::daily_deal_status, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 3. governed_cancel_daily_deal: cast to daily_deal_status
CREATE OR REPLACE FUNCTION public.governed_cancel_daily_deal(
  p_token uuid,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
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

  UPDATE public.daily_deals SET status = 'cancelled'::daily_deal_status, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 4. governed_create_flash_offer: cast CASE expression to flash_offer_status
CREATE OR REPLACE FUNCTION public.governed_create_flash_offer(
  p_token uuid,
  p_title varchar,
  p_fixed_price numeric,
  p_quantity integer,
  p_image_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_items jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_offer_id uuid;
  v_item jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'flash_offers.manage');

  IF p_fixed_price < 0 THEN RETURN jsonb_build_object('error', 'INVALID_PRICE'); END IF;
  IF p_quantity <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_QUANTITY'); END IF;

  INSERT INTO public.flash_offers (
    title, image_url, description, fixed_price,
    available_quantity, original_quantity,
    starts_at, ends_at, status, created_by
  ) VALUES (
    p_title, p_image_url, p_description, p_fixed_price,
    p_quantity, p_quantity,
    p_starts_at, p_ends_at,
    CASE
      WHEN p_starts_at IS NOT NULL AND p_starts_at > now() THEN 'scheduled'::flash_offer_status
      ELSE 'active'::flash_offer_status
    END,
    v_session.employee_id
  )
  RETURNING id INTO v_offer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.flash_offer_items (offer_id, product_id, quantity)
    VALUES (
      v_offer_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::int
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'id', v_offer_id);
END;
$function$;

-- 5. governed_activate_flash_offer: cast to flash_offer_status
CREATE OR REPLACE FUNCTION public.governed_activate_flash_offer(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status flash_offer_status;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'flash_offers.manage');

  SELECT status INTO v_current_status FROM public.flash_offers WHERE id = p_id;
  IF v_current_status IS NULL THEN RETURN jsonb_build_object('error', 'OFFER_NOT_FOUND'); END IF;
  IF v_current_status NOT IN ('draft', 'scheduled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.flash_offers SET status = 'active'::flash_offer_status, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 6. governed_cancel_flash_offer: cast to flash_offer_status
CREATE OR REPLACE FUNCTION public.governed_cancel_flash_offer(
  p_token uuid,
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_current_status flash_offer_status;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'flash_offers.manage');

  SELECT status INTO v_current_status FROM public.flash_offers WHERE id = p_id;
  IF v_current_status IS NULL THEN RETURN jsonb_build_object('error', 'OFFER_NOT_FOUND'); END IF;
  IF v_current_status IN ('expired', 'cancelled') THEN RETURN jsonb_build_object('error', 'OFFER_LOCKED'); END IF;

  UPDATE public.flash_offers SET status = 'cancelled'::flash_offer_status, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
