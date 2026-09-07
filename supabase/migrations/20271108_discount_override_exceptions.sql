-- ============================================================================
-- DISCOUNT OVERRIDE EXCEPTIONS — Payment & Shipping method groups
-- ============================================================================
-- Extends the tier-exception architecture (tier_company_exceptions /
-- tier_product_exceptions) with the equivalent per-company and per-product
-- override tables for Group 2 (Payment Method options) and Group 3
-- (Shipping Method options).
--
-- Rules:
--   * All four tables follow the exact tier model: option × company / option ×
--     product, discount_percent 0..100.
--   * Precedence (per group, independently):
--       product override > company override > option global discount
--   * Empty / absent row = "use the global/default discount". An explicit
--     0.00 row is a REAL override that ZEROES the group for that company/product.
--   * Only future pricing is affected — historical order snapshots are frozen
--     and are never recalculated.
-- ============================================================================

-- 1. company_payment_method_exceptions ----------------------------------------

CREATE TABLE IF NOT EXISTS public.company_payment_method_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_method_option_id uuid NOT NULL,
    company_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_payment_method_exceptions ADD CONSTRAINT fk_cpme_option
    FOREIGN KEY (payment_method_option_id) REFERENCES public.payment_method_options (id) ON DELETE CASCADE;
ALTER TABLE public.company_payment_method_exceptions ADD CONSTRAINT fk_cpme_company
    FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE CASCADE;
ALTER TABLE public.company_payment_method_exceptions ADD CONSTRAINT ck_cpme_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE public.company_payment_method_exceptions ADD CONSTRAINT uq_cpme_option_company
    UNIQUE (payment_method_option_id, company_id);

CREATE INDEX IF NOT EXISTS idx_cpme_option_id ON public.company_payment_method_exceptions (payment_method_option_id);
CREATE INDEX IF NOT EXISTS idx_cpme_company_id ON public.company_payment_method_exceptions (company_id);

COMMENT ON TABLE public.company_payment_method_exceptions IS 'Per-company discount overrides for payment method options. Takes priority over the option global discount.';
COMMENT ON COLUMN public.company_payment_method_exceptions.discount_percent IS 'Override discount percent for this company+payment_method_option combination. Range: 0-100';

-- 2. company_shipping_method_exceptions ---------------------------------------

CREATE TABLE IF NOT EXISTS public.company_shipping_method_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipping_method_option_id uuid NOT NULL,
    company_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_shipping_method_exceptions ADD CONSTRAINT fk_csme_option
    FOREIGN KEY (shipping_method_option_id) REFERENCES public.shipping_method_options (id) ON DELETE CASCADE;
ALTER TABLE public.company_shipping_method_exceptions ADD CONSTRAINT fk_csme_company
    FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE CASCADE;
ALTER TABLE public.company_shipping_method_exceptions ADD CONSTRAINT ck_csme_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE public.company_shipping_method_exceptions ADD CONSTRAINT uq_csme_option_company
    UNIQUE (shipping_method_option_id, company_id);

CREATE INDEX IF NOT EXISTS idx_csme_option_id ON public.company_shipping_method_exceptions (shipping_method_option_id);
CREATE INDEX IF NOT EXISTS idx_csme_company_id ON public.company_shipping_method_exceptions (company_id);

COMMENT ON TABLE public.company_shipping_method_exceptions IS 'Per-company discount overrides for shipping method options. Takes priority over the option global discount.';
COMMENT ON COLUMN public.company_shipping_method_exceptions.discount_percent IS 'Override discount percent for this company+shipping_method_option combination. Range: 0-100';

-- 3. product_payment_method_exceptions ----------------------------------------

CREATE TABLE IF NOT EXISTS public.product_payment_method_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_method_option_id uuid NOT NULL,
    product_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_payment_method_exceptions ADD CONSTRAINT fk_ppme_option
    FOREIGN KEY (payment_method_option_id) REFERENCES public.payment_method_options (id) ON DELETE CASCADE;
ALTER TABLE public.product_payment_method_exceptions ADD CONSTRAINT fk_ppme_product
    FOREIGN KEY (product_id) REFERENCES public.products (id) ON DELETE CASCADE;
ALTER TABLE public.product_payment_method_exceptions ADD CONSTRAINT ck_ppme_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE public.product_payment_method_exceptions ADD CONSTRAINT uq_ppme_option_product
    UNIQUE (payment_method_option_id, product_id);

CREATE INDEX IF NOT EXISTS idx_ppme_option_id ON public.product_payment_method_exceptions (payment_method_option_id);
CREATE INDEX IF NOT EXISTS idx_ppme_product_id ON public.product_payment_method_exceptions (product_id);

COMMENT ON TABLE public.product_payment_method_exceptions IS 'Per-product discount overrides for payment method options. Takes priority over company and option global.';
COMMENT ON COLUMN public.product_payment_method_exceptions.discount_percent IS 'Override discount percent for this product+payment_method_option combination. Range: 0-100';

-- 4. product_shipping_method_exceptions ---------------------------------------

CREATE TABLE IF NOT EXISTS public.product_shipping_method_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipping_method_option_id uuid NOT NULL,
    product_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_shipping_method_exceptions ADD CONSTRAINT fk_psme_option
    FOREIGN KEY (shipping_method_option_id) REFERENCES public.shipping_method_options (id) ON DELETE CASCADE;
ALTER TABLE public.product_shipping_method_exceptions ADD CONSTRAINT fk_psme_product
    FOREIGN KEY (product_id) REFERENCES public.products (id) ON DELETE CASCADE;
ALTER TABLE public.product_shipping_method_exceptions ADD CONSTRAINT ck_psme_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
ALTER TABLE public.product_shipping_method_exceptions ADD CONSTRAINT uq_psme_option_product
    UNIQUE (shipping_method_option_id, product_id);

CREATE INDEX IF NOT EXISTS idx_psme_option_id ON public.product_shipping_method_exceptions (shipping_method_option_id);
CREATE INDEX IF NOT EXISTS idx_psme_product_id ON public.product_shipping_method_exceptions (product_id);

COMMENT ON TABLE public.product_shipping_method_exceptions IS 'Per-product discount overrides for shipping method options. Takes priority over company and option global.';
COMMENT ON COLUMN public.product_shipping_method_exceptions.discount_percent IS 'Override discount percent for this product+shipping_method_option combination. Range: 0-100';

-- ============================================================================
-- 5. READ API — get_governed_discount_options (additive superset)
--    Now every tier / payment method / shipping method carries its own
--    company_exceptions + product_exceptions arrays (same contract as
--    get_governed_tiers), so customer-facing pricing and admin editing both
--    resolve overrides from a single source.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_discount_options(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  RETURN jsonb_build_object(
    'tiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'description', t.description,
        'discount_percent', t.discount_percent,
        'minimum_order_amount', t.minimum_order_amount,
        'sort_order', t.sort_order,
        'is_visible', t.is_visible,
        'is_active', t.is_active,
        'color', t.color,
        'icon_url', t.icon_url,
        'starts_at', t.starts_at,
        'ends_at', t.ends_at,
        'updated_at', t.updated_at,
        'company_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ce.id,
            'company_id', ce.company_id,
            'company_name', c.company_name,
            'discount_percent', ce.discount_percent
          ))
          FROM public.tier_company_exceptions ce
          JOIN public.companies c ON c.id = ce.company_id
          WHERE ce.tier_id = t.id), '[]'::jsonb),
        'product_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id,
            'product_id', pe.product_id,
            'product_name', p.product_name,
            'discount_percent', pe.discount_percent,
            'applies_to_all_tiers', pe.applies_to_all_tiers
          ))
          FROM public.tier_product_exceptions pe
          JOIN public.products p ON p.id = pe.product_id
          WHERE pe.tier_id = t.id OR (pe.tier_id IS NULL AND pe.applies_to_all_tiers = true)), '[]'::jsonb)
      ) ORDER BY t.sort_order ASC)
      FROM public.tiers t), '[]'::jsonb),
    'payment_methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'discount_percent', p.discount_percent,
        'sort_order', p.sort_order,
        'is_visible', p.is_visible,
        'is_active', p.is_active,
        'updated_at', p.updated_at,
        'company_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ce.id,
            'company_id', ce.company_id,
            'company_name', c.company_name,
            'discount_percent', ce.discount_percent
          ))
          FROM public.company_payment_method_exceptions ce
          JOIN public.companies c ON c.id = ce.company_id
          WHERE ce.payment_method_option_id = p.id), '[]'::jsonb),
        'product_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id,
            'product_id', pe.product_id,
            'product_name', pr.product_name,
            'discount_percent', pe.discount_percent
          ))
          FROM public.product_payment_method_exceptions pe
          JOIN public.products pr ON pr.id = pe.product_id
          WHERE pe.payment_method_option_id = p.id), '[]'::jsonb)
      ) ORDER BY p.sort_order ASC)
      FROM public.payment_method_options p), '[]'::jsonb),
    'shipping_methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'discount_percent', s.discount_percent,
        'sort_order', s.sort_order,
        'is_visible', s.is_visible,
        'is_active', s.is_active,
        'updated_at', s.updated_at,
        'company_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ce.id,
            'company_id', ce.company_id,
            'company_name', c.company_name,
            'discount_percent', ce.discount_percent
          ))
          FROM public.company_shipping_method_exceptions ce
          JOIN public.companies c ON c.id = ce.company_id
          WHERE ce.shipping_method_option_id = s.id), '[]'::jsonb),
        'product_exceptions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id,
            'product_id', pe.product_id,
            'product_name', pr.product_name,
            'discount_percent', pe.discount_percent
          ))
          FROM public.product_shipping_method_exceptions pe
          JOIN public.products pr ON pr.id = pe.product_id
          WHERE pe.shipping_method_option_id = s.id), '[]'::jsonb)
      ) ORDER BY s.sort_order ASC)
      FROM public.shipping_method_options s), '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- 6. WRITE API — Payment Method company exceptions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_set_payment_method_company_exception(
  p_token uuid,
  p_payment_method_option_id uuid,
  p_company_id uuid,
  p_discount_percent numeric
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.company_payment_method_exceptions (payment_method_option_id, company_id, discount_percent)
  VALUES (p_payment_method_option_id, p_company_id, p_discount_percent)
  ON CONFLICT (payment_method_option_id, company_id)
  DO UPDATE SET discount_percent = EXCLUDED.discount_percent, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_remove_payment_method_company_exception(
  p_token uuid,
  p_exception_id uuid
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  DELETE FROM public.company_payment_method_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 7. WRITE API — Shipping Method company exceptions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_set_shipping_method_company_exception(
  p_token uuid,
  p_shipping_method_option_id uuid,
  p_company_id uuid,
  p_discount_percent numeric
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.company_shipping_method_exceptions (shipping_method_option_id, company_id, discount_percent)
  VALUES (p_shipping_method_option_id, p_company_id, p_discount_percent)
  ON CONFLICT (shipping_method_option_id, company_id)
  DO UPDATE SET discount_percent = EXCLUDED.discount_percent, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_remove_shipping_method_company_exception(
  p_token uuid,
  p_exception_id uuid
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  DELETE FROM public.company_shipping_method_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 8. WRITE API — Payment Method product exceptions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_set_payment_method_product_exception(
  p_token uuid,
  p_payment_method_option_id uuid,
  p_product_id uuid,
  p_discount_percent numeric
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.product_payment_method_exceptions (payment_method_option_id, product_id, discount_percent)
  VALUES (p_payment_method_option_id, p_product_id, p_discount_percent)
  ON CONFLICT (payment_method_option_id, product_id)
  DO UPDATE SET discount_percent = EXCLUDED.discount_percent, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_remove_payment_method_product_exception(
  p_token uuid,
  p_exception_id uuid
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  DELETE FROM public.product_payment_method_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 9. WRITE API — Shipping Method product exceptions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_set_shipping_method_product_exception(
  p_token uuid,
  p_shipping_method_option_id uuid,
  p_product_id uuid,
  p_discount_percent numeric
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  INSERT INTO public.product_shipping_method_exceptions (shipping_method_option_id, product_id, discount_percent)
  VALUES (p_shipping_method_option_id, p_product_id, p_discount_percent)
  ON CONFLICT (shipping_method_option_id, product_id)
  DO UPDATE SET discount_percent = EXCLUDED.discount_percent, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.governed_remove_shipping_method_product_exception(
  p_token uuid,
  p_exception_id uuid
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
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;
  IF NOT public.check_capability(p_token, 'tiers.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: tiers.manage');
  END IF;

  DELETE FROM public.product_shipping_method_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 10. Grants ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.get_governed_discount_options(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_set_payment_method_company_exception(uuid, uuid, uuid, numeric) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_remove_payment_method_company_exception(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_set_shipping_method_company_exception(uuid, uuid, uuid, numeric) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_remove_shipping_method_company_exception(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_set_payment_method_product_exception(uuid, uuid, uuid, numeric) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_remove_payment_method_product_exception(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_set_shipping_method_product_exception(uuid, uuid, uuid, numeric) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_remove_shipping_method_product_exception(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- END OF DISCOUNT OVERRIDE EXCEPTIONS MIGRATION
-- ============================================================================