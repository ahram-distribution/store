-- ============================================================================
-- Enhance governed_update_product with image_url and is_visible support
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
  SET
    is_visible = COALESCE(p_is_visible, is_visible),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_product_visibility IS 'تغيير حالة ظهور المنتج';

-- ============================================================================
-- Enhance governed_update_product with image_url
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
-- Enhance governed_update_company with logo_url and is_visible
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

-- ============================================================================
-- RPC to manage product inventory
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
