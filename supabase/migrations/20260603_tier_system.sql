-- ============================================================================
-- TIER SYSTEM IMPLEMENTATION
-- Seeds Bronze/Silver/Gold tiers. Creates company/product exception tables
-- with discount priority logic. Governed RPCs for tier management.
-- ============================================================================

-- 1. Seed default tiers (idempotent) ----------------------------------------

DO $$
DECLARE
  v_bronze_id uuid;
  v_silver_id uuid;
  v_gold_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'برونزي') THEN
    INSERT INTO public.tiers (name, description, sort_order, is_active, is_visible, discount_percent, minimum_order_amount, color, icon_url)
    VALUES ('برونزي', 'الشريحة البرونزية - خصم 2.97%', 1, true, true, 2.97, 5000, '#CD7F32', NULL)
    RETURNING id INTO v_bronze_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'فضي') THEN
    INSERT INTO public.tiers (name, description, sort_order, is_active, is_visible, discount_percent, minimum_order_amount, color, icon_url)
    VALUES ('فضي', 'الشريحة الفضية - خصم 3.94%', 2, true, true, 3.94, 15000, '#C0C0C0', NULL)
    RETURNING id INTO v_silver_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'ذهبي') THEN
    INSERT INTO public.tiers (name, description, sort_order, is_active, is_visible, discount_percent, minimum_order_amount, color, icon_url)
    VALUES ('ذهبي', 'الشريحة الذهبية - خصم 4.90%', 3, true, true, 4.90, 30000, '#FFD700', NULL)
    RETURNING id INTO v_gold_id;
  END IF;
END;
$$;

-- 2. tier_company_exceptions table ------------------------------------------

CREATE TABLE IF NOT EXISTS tier_company_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id uuid NOT NULL,
    company_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tier_company_exceptions ADD CONSTRAINT fk_tce_tier
    FOREIGN KEY (tier_id) REFERENCES tiers (id) ON DELETE CASCADE;
ALTER TABLE tier_company_exceptions ADD CONSTRAINT fk_tce_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE;

ALTER TABLE tier_company_exceptions ADD CONSTRAINT ck_tce_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

ALTER TABLE tier_company_exceptions ADD CONSTRAINT uq_tce_tier_company
    UNIQUE (tier_id, company_id);

CREATE INDEX IF NOT EXISTS idx_tce_tier_id ON tier_company_exceptions (tier_id);
CREATE INDEX IF NOT EXISTS idx_tce_company_id ON tier_company_exceptions (company_id);

COMMENT ON TABLE tier_company_exceptions IS 'Per-company discount overrides for tiers. Takes priority over tier default discount.';
COMMENT ON COLUMN tier_company_exceptions.discount_percent IS 'Override discount percent for this company+tier combination. Range: 0-100';

-- 3. tier_product_exceptions table ------------------------------------------

CREATE TABLE IF NOT EXISTS tier_product_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id uuid,
    product_id uuid NOT NULL,
    discount_percent numeric(5,2) NOT NULL,
    applies_to_all_tiers boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tier_product_exceptions ADD CONSTRAINT fk_tpe_tier
    FOREIGN KEY (tier_id) REFERENCES tiers (id) ON DELETE CASCADE;
ALTER TABLE tier_product_exceptions ADD CONSTRAINT fk_tpe_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE;

ALTER TABLE tier_product_exceptions ADD CONSTRAINT ck_tpe_discount_percent
    CHECK (discount_percent >= 0 AND discount_percent <= 100);

CREATE INDEX IF NOT EXISTS idx_tpe_tier_id ON tier_product_exceptions (tier_id);
CREATE INDEX IF NOT EXISTS idx_tpe_product_id ON tier_product_exceptions (product_id);
CREATE INDEX IF NOT EXISTS idx_tpe_all_tiers ON tier_product_exceptions (product_id) WHERE applies_to_all_tiers = true;

COMMENT ON TABLE tier_product_exceptions IS 'Per-product discount overrides for tiers. appliestoalltiers=true means the same discount applies regardless of tier.';
COMMENT ON COLUMN tier_product_exceptions.tier_id IS 'NULL when appliestoalltiers=true, otherwise the specific tier this exception applies to';
COMMENT ON COLUMN tier_product_exceptions.applies_to_all_tiers IS 'When true, this discount applies across all tiers regardless of which tier is selected';

-- 4. Seed company exceptions (FOJ + Palette) --------------------------------

DO $$
DECLARE
  v_bronze_id uuid;
  v_silver_id uuid;
  v_gold_id uuid;
  v_foj_id uuid := '3e83aebe-f1d6-4f40-bf17-2355813f7972';
  v_palette_id uuid := '90d8078c-1ecf-4d63-a582-74f3856cc4e0';
BEGIN
  SELECT id INTO v_bronze_id FROM public.tiers WHERE name = 'برونزي';
  SELECT id INTO v_silver_id FROM public.tiers WHERE name = 'فضي';
  SELECT id INTO v_gold_id FROM public.tiers WHERE name = 'ذهبي';

  -- FOJ company exceptions
  IF v_bronze_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_bronze_id AND company_id = v_foj_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_bronze_id, v_foj_id, 2.48);
  END IF;
  IF v_silver_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_silver_id AND company_id = v_foj_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_silver_id, v_foj_id, 2.97);
  END IF;
  IF v_gold_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_gold_id AND company_id = v_foj_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_gold_id, v_foj_id, 3.45);
  END IF;

  -- Palette company exceptions
  IF v_bronze_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_bronze_id AND company_id = v_palette_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_bronze_id, v_palette_id, 2.62);
  END IF;
  IF v_silver_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_silver_id AND company_id = v_palette_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_silver_id, v_palette_id, 2.86);
  END IF;
  IF v_gold_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tier_company_exceptions WHERE tier_id = v_gold_id AND company_id = v_palette_id) THEN
    INSERT INTO tier_company_exceptions (tier_id, company_id, discount_percent) VALUES (v_gold_id, v_palette_id, 3.83);
  END IF;
END;
$$;

-- 5. Seed product exception (سباركل شامبو - 2.97% all tiers) ----------------

DO $$
DECLARE
  v_product_id uuid := '573f1f01-4579-494b-9ce2-c3e0481cfbcd';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tier_product_exceptions WHERE product_id = v_product_id AND applies_to_all_tiers = true) THEN
    INSERT INTO tier_product_exceptions (product_id, discount_percent, applies_to_all_tiers, tier_id)
    VALUES (v_product_id, 2.97, true, NULL);
  END IF;
END;
$$;

-- 6. tiers.manage capability -------------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'tiers.manage', 'إدارة الشرائح السعرية', 'Create, edit, activate, and cancel tier configurations', 'tiers'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'tiers.manage');

-- ============================================================================
-- GOVERNED RPCs
-- ============================================================================

-- 7. get_governed_tiers ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_tiers(p_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  IF p_token IS NOT NULL THEN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'description', t.description,
      'sort_order', t.sort_order,
      'is_active', t.is_active,
      'is_visible', t.is_visible,
      'discount_percent', t.discount_percent,
      'minimum_order_amount', t.minimum_order_amount,
      'icon_url', t.icon_url,
      'color', t.color,
      'starts_at', t.starts_at,
      'ends_at', t.ends_at,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'company_exceptions', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', ce.id,
            'company_id', ce.company_id,
            'company_name', c.company_name,
            'discount_percent', ce.discount_percent
          )
        ) FROM tier_company_exceptions ce
        JOIN companies c ON c.id = ce.company_id
        WHERE ce.tier_id = t.id), '[]'::jsonb
      ),
      'product_exceptions', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', pe.id,
            'product_id', pe.product_id,
            'product_name', p.product_name,
            'discount_percent', pe.discount_percent,
            'applies_to_all_tiers', pe.applies_to_all_tiers
          )
        ) FROM tier_product_exceptions pe
        JOIN products p ON p.id = pe.product_id
        WHERE pe.tier_id = t.id OR (pe.tier_id IS NULL AND pe.applies_to_all_tiers = true)), '[]'::jsonb
      )
    ) ORDER BY t.sort_order ASC
  ) INTO v_result FROM tiers t WHERE t.is_active = true;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_tiers IS 'جلب جميع الشرائح السعرية النشطة مع استثناءات الشركات والمنتجات (متاح للجميع)';

-- 8. governed_create_tier ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_create_tier(
  p_token uuid,
  p_name varchar,
  p_description text DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_minimum_order_amount numeric DEFAULT 0,
  p_color varchar DEFAULT NULL,
  p_icon_url text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_is_visible boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_tier_id uuid;
  v_max_order integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'tiers.manage');

  IF p_sort_order IS NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_order FROM public.tiers;
    p_sort_order := v_max_order;
  END IF;

  INSERT INTO public.tiers (name, description, discount_percent, minimum_order_amount, color, icon_url, sort_order, is_visible, is_active)
  VALUES (p_name, p_description, p_discount_percent, p_minimum_order_amount, p_color, p_icon_url, p_sort_order, p_is_visible, true)
  RETURNING id INTO v_tier_id;

  RETURN jsonb_build_object('success', true, 'id', v_tier_id);
END;
$$;

COMMENT ON FUNCTION public.governed_create_tier IS 'إنشاء شريحة سعرية جديدة';

-- 9. governed_update_tier ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_tier(
  p_token uuid,
  p_id uuid,
  p_name varchar DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL,
  p_minimum_order_amount numeric DEFAULT NULL,
  p_color varchar DEFAULT NULL,
  p_icon_url text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_is_visible boolean DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'tiers.manage');

  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_id) THEN
    RETURN jsonb_build_object('error', 'TIER_NOT_FOUND');
  END IF;

  UPDATE public.tiers SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    discount_percent = COALESCE(p_discount_percent, discount_percent),
    minimum_order_amount = COALESCE(p_minimum_order_amount, minimum_order_amount),
    color = COALESCE(p_color, color),
    icon_url = COALESCE(p_icon_url, icon_url),
    sort_order = COALESCE(p_sort_order, sort_order),
    is_visible = COALESCE(p_is_visible, is_visible),
    is_active = COALESCE(p_is_active, is_active),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_tier IS 'تحديث بيانات شريحة سعرية';

-- 10. governed_set_tier_company_exception ------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_tier_company_exception(
  p_token uuid,
  p_tier_id uuid,
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

  PERFORM check_capability(p_token, 'tiers.manage');

  INSERT INTO public.tier_company_exceptions (tier_id, company_id, discount_percent)
  VALUES (p_tier_id, p_company_id, p_discount_percent)
  ON CONFLICT (tier_id, company_id)
  DO UPDATE SET discount_percent = p_discount_percent, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_set_tier_company_exception IS 'تعيين أو تحديث استثناء شركة لشريحة محددة';

-- 11. governed_remove_tier_company_exception ---------------------------------

CREATE OR REPLACE FUNCTION public.governed_remove_tier_company_exception(
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

  PERFORM check_capability(p_token, 'tiers.manage');

  DELETE FROM public.tier_company_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_remove_tier_company_exception IS 'إزالة استثناء شركة لشريحة';

-- 12. governed_set_tier_product_exception ------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_tier_product_exception(
  p_token uuid,
  p_product_id uuid,
  p_discount_percent numeric,
  p_tier_id uuid DEFAULT NULL,
  p_applies_to_all_tiers boolean DEFAULT false
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

  PERFORM check_capability(p_token, 'tiers.manage');

  INSERT INTO public.tier_product_exceptions (tier_id, product_id, discount_percent, applies_to_all_tiers)
  VALUES (p_tier_id, p_product_id, p_discount_percent, p_applies_to_all_tiers)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_set_tier_product_exception IS 'تعيين استثناء منتج لشريحة محددة';

-- 13. governed_remove_tier_product_exception ---------------------------------

CREATE OR REPLACE FUNCTION public.governed_remove_tier_product_exception(
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

  PERFORM check_capability(p_token, 'tiers.manage');

  DELETE FROM public.tier_product_exceptions WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_remove_tier_product_exception IS 'إزالة استثناء منتج لشريحة';

-- ============================================================================
-- END OF TIER SYSTEM IMPLEMENTATION
-- ============================================================================
