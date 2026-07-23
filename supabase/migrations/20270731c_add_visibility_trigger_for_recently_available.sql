-- Add recently_available_at to governed_update_product_visibility
-- When a product becomes visible (is_visible: false → true), it should
-- appear in the Recently Available collection.

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
  SET
    is_visible = COALESCE(p_is_visible, is_visible),
    recently_available_at = CASE WHEN p_is_visible = true THEN now() ELSE recently_available_at END,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_visibility IS 'تغيير حالة ظهور المنتج — يضبط recently_available_at عند التحول إلى مرئي';

NOTIFY pgrst, 'reload schema';
