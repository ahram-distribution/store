-- ============================================================================
-- TIER COMPANY DIVERSIFICATION RULES
-- Adds minimum_company_count and max_company_purchase_percent to tiers.
-- Client-side enforcement only (computeCartTotals). Server RPCs for config CRUD.
-- ============================================================================

-- 1. Add columns -----------------------------------------------------------

ALTER TABLE public.tiers
  ADD COLUMN IF NOT EXISTS minimum_company_count integer,
  ADD COLUMN IF NOT EXISTS max_company_purchase_percent numeric(5,2);

-- CHECK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tiers_min_company_count') THEN
    ALTER TABLE public.tiers ADD CONSTRAINT ck_tiers_min_company_count
      CHECK (minimum_company_count IS NULL OR minimum_company_count >= 1);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tiers_max_company_pct') THEN
    ALTER TABLE public.tiers ADD CONSTRAINT ck_tiers_max_company_pct
      CHECK (max_company_purchase_percent IS NULL OR (max_company_purchase_percent > 0 AND max_company_purchase_percent <= 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tiers_company_rule_pairing') THEN
    ALTER TABLE public.tiers ADD CONSTRAINT ck_tiers_company_rule_pairing
      CHECK (NOT (max_company_purchase_percent IS NOT NULL AND minimum_company_count IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.tiers.minimum_company_count IS 'Minimum distinct companies required. NULL = unlimited (no diversity requirement).';
COMMENT ON COLUMN public.tiers.max_company_purchase_percent IS 'Max percentage of qualifying value any single company may represent. NULL = no cap. Requires minimum_company_count to be set.';

-- 2. Extend get_governed_discount_options -----------------------------------

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
        'minimum_company_count', t.minimum_company_count,
        'max_company_purchase_percent', t.max_company_purchase_percent,
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

-- 3. Extend get_governed_tiers ---------------------------------------------

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
      'minimum_company_count', t.minimum_company_count,
      'max_company_purchase_percent', t.max_company_purchase_percent,
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

-- 4. Drop + recreate governed_create_tier with new params -------------------

DROP FUNCTION IF EXISTS public.governed_create_tier(
  uuid, varchar, text, numeric, numeric, varchar, text, integer, boolean
);

CREATE OR REPLACE FUNCTION public.governed_create_tier(
  p_token uuid,
  p_name varchar,
  p_description text DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_minimum_order_amount numeric DEFAULT 0,
  p_color varchar DEFAULT NULL,
  p_icon_url text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_is_visible boolean DEFAULT true,
  p_minimum_company_count integer DEFAULT NULL,
  p_max_company_purchase_percent numeric DEFAULT NULL
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

  -- Validate company diversification params
  IF p_minimum_company_count IS NOT NULL AND p_minimum_company_count < 1 THEN
    RETURN jsonb_build_object('error', 'INVALID_MINIMUM_COMPANY_COUNT');
  END IF;
  IF p_max_company_purchase_percent IS NOT NULL AND (p_max_company_purchase_percent <= 0 OR p_max_company_purchase_percent > 100) THEN
    RETURN jsonb_build_object('error', 'INVALID_MAX_COMPANY_PERCENT');
  END IF;
  IF p_max_company_purchase_percent IS NOT NULL AND p_minimum_company_count IS NULL THEN
    RETURN jsonb_build_object('error', 'MAX_COMPANY_PERCENT_REQUIRES_COMPANY_COUNT');
  END IF;

  IF p_sort_order IS NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_order FROM public.tiers;
    p_sort_order := v_max_order;
  END IF;

  INSERT INTO public.tiers (name, description, discount_percent, minimum_order_amount, color, icon_url, sort_order, is_visible, is_active, minimum_company_count, max_company_purchase_percent)
  VALUES (p_name, p_description, p_discount_percent, p_minimum_order_amount, p_color, p_icon_url, p_sort_order, p_is_visible, true, p_minimum_company_count, p_max_company_purchase_percent)
  RETURNING id INTO v_tier_id;

  RETURN jsonb_build_object('success', true, 'id', v_tier_id);
END;
$$;

-- 5. Drop + recreate governed_update_tier with clear flags ------------------

DROP FUNCTION IF EXISTS public.governed_update_tier(
  uuid, uuid, varchar, text, numeric, numeric, varchar, text, integer, boolean, boolean, timestamptz, timestamptz
);

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
  p_ends_at timestamptz DEFAULT NULL,
  p_minimum_company_count integer DEFAULT NULL,
  p_minimum_company_count_set boolean DEFAULT false,
  p_max_company_purchase_percent numeric DEFAULT NULL,
  p_max_company_purchase_percent_set boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_new_min_count integer;
  v_new_max_pct numeric;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'tiers.manage');

  IF NOT EXISTS (SELECT 1 FROM public.tiers WHERE id = p_id) THEN
    RETURN jsonb_build_object('error', 'TIER_NOT_FOUND');
  END IF;

  -- Resolve final company-rule values
  SELECT CASE WHEN p_minimum_company_count_set THEN p_minimum_company_count ELSE minimum_company_count END,
         CASE WHEN p_max_company_purchase_percent_set THEN p_max_company_purchase_percent ELSE max_company_purchase_percent END
  INTO v_new_min_count, v_new_max_pct
  FROM public.tiers WHERE id = p_id;

  -- Validate company diversification params
  IF v_new_min_count IS NOT NULL AND v_new_min_count < 1 THEN
    RETURN jsonb_build_object('error', 'INVALID_MINIMUM_COMPANY_COUNT');
  END IF;
  IF v_new_max_pct IS NOT NULL AND (v_new_max_pct <= 0 OR v_new_max_pct > 100) THEN
    RETURN jsonb_build_object('error', 'INVALID_MAX_COMPANY_PERCENT');
  END IF;
  IF v_new_max_pct IS NOT NULL AND v_new_min_count IS NULL THEN
    RETURN jsonb_build_object('error', 'MAX_COMPANY_PERCENT_REQUIRES_COMPANY_COUNT');
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
    minimum_company_count = v_new_min_count,
    max_company_purchase_percent = v_new_max_pct,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
