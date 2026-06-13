-- ============================================================================
-- Add p_original_quantity parameter to governed_update_flash_offer
-- Allows Upper Management to update the original_quantity field via the RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_update_flash_offer(
  p_token uuid,
  p_id uuid,
  p_title varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
  p_original_quantity integer DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

  UPDATE public.flash_offers SET
    title = COALESCE(p_title, title),
    image_url = COALESCE(p_image_url, image_url),
    description = COALESCE(p_description, description),
    fixed_price = COALESCE(p_fixed_price, fixed_price),
    original_quantity = COALESCE(p_original_quantity, original_quantity),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_flash_offer IS 'تحديث عرض ساعة (مع إمكانية تعديل الكمية الأصلية)';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
