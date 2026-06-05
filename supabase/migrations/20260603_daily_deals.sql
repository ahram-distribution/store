-- ============================================================================
-- DAILY DEALS MODULE
-- Implements Daily Deal as a dedicated commercial package module.
-- Status: daily_deal_status ENUM (draft, scheduled, active, sold_out, expired, cancelled)
-- ============================================================================

-- 1. daily_deal_status ENUM ---------------------------------------------------

DO $$ BEGIN
    CREATE TYPE daily_deal_status AS ENUM (
        'draft', 'scheduled', 'active', 'sold_out', 'expired', 'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. daily_deals table --------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_deals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(255) NOT NULL,
    image_url text,
    description text,
    fixed_price decimal(12,2) NOT NULL,
    available_quantity integer NOT NULL DEFAULT 0,
    original_quantity integer NOT NULL DEFAULT 0,
    starts_at timestamptz,
    ends_at timestamptz,
    status daily_deal_status NOT NULL DEFAULT 'draft',
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE daily_deals ADD CONSTRAINT fk_daily_deals_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

-- check constraints
ALTER TABLE daily_deals ADD CONSTRAINT ck_daily_deals_fixed_price
    CHECK (fixed_price >= 0);
ALTER TABLE daily_deals ADD CONSTRAINT ck_daily_deals_available_quantity
    CHECK (available_quantity >= 0);
ALTER TABLE daily_deals ADD CONSTRAINT ck_daily_deals_original_quantity
    CHECK (original_quantity >= 0);
ALTER TABLE daily_deals ADD CONSTRAINT ck_daily_deals_dates
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at);

-- indexes
CREATE INDEX IF NOT EXISTS idx_daily_deals_status ON daily_deals (status);
CREATE INDEX IF NOT EXISTS idx_daily_deals_created_by ON daily_deals (created_by);
CREATE INDEX IF NOT EXISTS idx_daily_deals_ends_at ON daily_deals (ends_at);

COMMENT ON TABLE daily_deals IS 'Daily Deal commercial packages. Fixed-price bundles of products.';
COMMENT ON COLUMN daily_deals.fixed_price IS 'Fixed price for the entire deal (not per-unit)';
COMMENT ON COLUMN daily_deals.available_quantity IS 'Remaining quantity available for purchase';
COMMENT ON COLUMN daily_deals.original_quantity IS 'Initial quantity when created';

-- 3. daily_deal_items table ---------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_deal_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE daily_deal_items ADD CONSTRAINT fk_daily_deal_items_deal
    FOREIGN KEY (deal_id) REFERENCES daily_deals (id) ON DELETE CASCADE;
ALTER TABLE daily_deal_items ADD CONSTRAINT fk_daily_deal_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);

-- check constraints
ALTER TABLE daily_deal_items ADD CONSTRAINT ck_daily_deal_items_quantity
    CHECK (quantity > 0);

-- indexes
CREATE INDEX IF NOT EXISTS idx_daily_deal_items_deal_id ON daily_deal_items (deal_id);
CREATE INDEX IF NOT EXISTS idx_daily_deal_items_product_id ON daily_deal_items (product_id);

COMMENT ON TABLE daily_deal_items IS 'Products included in a daily deal with their quantities.';

-- 4. order_daily_deals table --------------------------------------------------

CREATE TABLE IF NOT EXISTS order_daily_deals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    deal_id uuid NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    fixed_price decimal(12,2) NOT NULL,
    total_price decimal(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- foreign keys
ALTER TABLE order_daily_deals ADD CONSTRAINT fk_order_daily_deals_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
ALTER TABLE order_daily_deals ADD CONSTRAINT fk_order_daily_deals_deal
    FOREIGN KEY (deal_id) REFERENCES daily_deals (id);

-- check constraints
ALTER TABLE order_daily_deals ADD CONSTRAINT ck_order_daily_deals_quantity
    CHECK (quantity > 0);
ALTER TABLE order_daily_deals ADD CONSTRAINT ck_order_daily_deals_prices
    CHECK (fixed_price >= 0 AND total_price >= 0);

-- unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_daily_deals ON order_daily_deals (order_id, deal_id);

-- indexes
CREATE INDEX IF NOT EXISTS idx_order_daily_deals_order_id ON order_daily_deals (order_id);
CREATE INDEX IF NOT EXISTS idx_order_daily_deals_deal_id ON order_daily_deals (deal_id);

COMMENT ON TABLE order_daily_deals IS 'Links daily deals to orders. Snapshots fixed_price at order time.';
COMMENT ON COLUMN order_daily_deals.fixed_price IS 'Fixed price per deal at time of order';
COMMENT ON COLUMN order_daily_deals.total_price IS 'quantity × fixed_price';

-- 5. deals.manage capability --------------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'deals.manage', 'إدارة العروض اليومية', 'Create, edit, activate, and cancel daily deals', 'deals'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'deals.manage');

-- Assign deals.manage to Sales Manager and above (EXECUTIVE_MANAGER and higher)
-- (role_capability assignments would be done via the admin UI or seed data)

-- ============================================================================
-- GOVERNED RPCs
-- ============================================================================

-- 6. get_governed_daily_deals --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_daily_deals(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'title', d.title,
      'image_url', d.image_url,
      'description', d.description,
      'fixed_price', d.fixed_price,
      'available_quantity', d.available_quantity,
      'original_quantity', d.original_quantity,
      'starts_at', d.starts_at,
      'ends_at', d.ends_at,
      'status', d.status,
      'created_by', d.created_by,
      'created_at', d.created_at,
      'updated_at', d.updated_at,
      'items', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', di.id,
            'product_id', di.product_id,
            'product_name', p.product_name,
            'quantity', di.quantity
          )
        ) FROM daily_deal_items di
        JOIN products p ON p.id = di.product_id
        WHERE di.deal_id = d.id), '[]'::jsonb
      )
    ) ORDER BY d.created_at DESC
  ) INTO v_result FROM daily_deals d;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_daily_deals IS 'جلب جميع العروض اليومية مع عناصرها';

-- 7. get_governed_active_daily_deals -------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_active_daily_deals(p_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Public function: accepts optional token for session validation
  -- Returns active (or recently expired/sold_out for visibility) deals

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'title', d.title,
      'image_url', d.image_url,
      'description', d.description,
      'fixed_price', d.fixed_price,
      'available_quantity', d.available_quantity,
      'original_quantity', d.original_quantity,
      'starts_at', d.starts_at,
      'ends_at', d.ends_at,
      'status', d.status,
      'is_purchasable',
        CASE
          WHEN d.status = 'active' AND d.available_quantity > 0
            AND (d.starts_at IS NULL OR d.starts_at <= now())
            AND (d.ends_at IS NULL OR d.ends_at > now())
          THEN true
          ELSE false
        END,
      'items', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', di.id,
            'product_id', di.product_id,
            'product_name', p.product_name,
            'quantity', di.quantity
          )
        ) FROM daily_deal_items di
        JOIN products p ON p.id = di.product_id
        WHERE di.deal_id = d.id), '[]'::jsonb
      )
    ) ORDER BY d.created_at DESC
  ) INTO v_result FROM daily_deals d
  WHERE d.status IN ('active', 'sold_out', 'expired')
    AND (d.ends_at IS NULL OR d.ends_at > now() - interval '30 days');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_active_daily_deals IS 'جلب العروض اليومية النشطة للواجهة العامة';

-- 8. governed_create_daily_deal ------------------------------------------------

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
AS $$
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
      WHEN p_starts_at IS NOT NULL AND p_starts_at > now() THEN 'scheduled'
      ELSE 'active'
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
$$;

COMMENT ON FUNCTION public.governed_create_daily_deal IS 'إنشاء عرض يومي جديد مع عناصره';

-- 9. governed_update_daily_deal ------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_daily_deal(
  p_token uuid,
  p_id uuid,
  p_title varchar DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
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
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_daily_deal IS 'تحديث عرض يومي';

-- 10. governed_activate_daily_deal ---------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_daily_deal(
  p_token uuid,
  p_id uuid
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
  IF v_current_status NOT IN ('draft', 'scheduled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.daily_deals SET status = 'active', updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_daily_deal IS 'تفعيل عرض يومي';

-- 11. governed_cancel_daily_deal -----------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_cancel_daily_deal(
  p_token uuid,
  p_id uuid,
  p_reason text DEFAULT NULL
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
  IF v_current_status IN ('expired', 'cancelled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.daily_deals SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_cancel_daily_deal IS 'إلغاء عرض يومي';

-- 12. Update governed_approve_order to deduct daily deal inventory -------------

DROP FUNCTION IF EXISTS public.governed_approve_order(uuid, uuid);
CREATE OR REPLACE FUNCTION public.governed_approve_order(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_old_status varchar(30);
  v_daily_deal record;
  v_deal_item record;
  v_inv record;
  v_new_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.approve');

  -- Save old status BEFORE update
  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status != 'submitted' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- Deduct daily deal available_quantity and deduct component product inventory
  FOR v_daily_deal IN
    SELECT odd.deal_id, odd.quantity
    FROM order_daily_deals odd
    WHERE odd.order_id = p_id
  LOOP
    -- Deduct deal available_quantity
    UPDATE public.daily_deals
    SET available_quantity = GREATEST(available_quantity - v_daily_deal.quantity, 0),
        status = CASE
          WHEN available_quantity - v_daily_deal.quantity <= 0 THEN 'sold_out'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_daily_deal.deal_id;

    -- Deduct component product inventory
    FOR v_deal_item IN
      SELECT di.product_id, di.quantity
      FROM daily_deal_items di
      WHERE di.deal_id = v_daily_deal.deal_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_deal_item.quantity * v_daily_deal.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_deal_item.product_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Deduct normal order item inventory
  FOR v_deal_item IN
    SELECT oi.product_id, oi.piece_quantity
    FROM order_items oi
    WHERE oi.order_id = p_id
  LOOP
    SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_deal_item.product_id;
    IF FOUND THEN
      v_new_qty := GREATEST(v_inv.quantity - v_deal_item.piece_quantity, 0);
      UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
      WHERE product_id = v_deal_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.orders SET status = 'approved', approved_at = now(), updated_at = now()
  WHERE id = p_id AND status = 'submitted';

  -- Use saved v_old_status for correct audit trail
  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS 'اعتماد طلب مع خصم المخزون (منتجات + عروض يومية)';

-- 13. governed_add_order_daily_deals -----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_add_order_daily_deals(
  p_token uuid,
  p_order_id uuid,
  p_deals jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_deal jsonb;
  v_deal_record daily_deals;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  FOR v_deal IN SELECT * FROM jsonb_array_elements(p_deals)
  LOOP
    SELECT * INTO v_deal_record FROM public.daily_deals WHERE id = (v_deal->>'deal_id')::uuid;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'DEAL_NOT_FOUND'); END IF;

    IF v_deal_record.status != 'active' THEN RETURN jsonb_build_object('error', 'DEAL_NOT_ACTIVE'); END IF;
    IF v_deal_record.available_quantity < (v_deal->>'quantity')::int THEN
      RETURN jsonb_build_object('error', 'DEAL_INSUFFICIENT_QUANTITY');
    END IF;

    INSERT INTO public.order_daily_deals (order_id, deal_id, quantity, fixed_price, total_price)
    VALUES (
      p_order_id,
      (v_deal->>'deal_id')::uuid,
      (v_deal->>'quantity')::int,
      v_deal_record.fixed_price,
      v_deal_record.fixed_price * (v_deal->>'quantity')::int
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_add_order_daily_deals IS 'إضافة عروض يومية إلى طلب موجود';

-- 14. get_governed_order_daily_deals -----------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_order_daily_deals(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', odd.id,
      'order_id', odd.order_id,
      'deal_id', odd.deal_id,
      'title', d.title,
      'quantity', odd.quantity,
      'fixed_price', odd.fixed_price,
      'total_price', odd.total_price,
      'image_url', d.image_url
    )
  ) INTO v_result
  FROM order_daily_deals odd
  JOIN daily_deals d ON d.id = odd.deal_id
  WHERE odd.order_id = p_order_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_order_daily_deals IS 'جلب العروض اليومية لطلب معين';

-- 15. Seed test deal (idempotent) --------------------------------------------

DO $$
DECLARE
  v_deal_id uuid;
  v_employee_id uuid;
  v_product record;
  v_shampoo_id uuid;
  v_dye_id uuid;
BEGIN
  -- Only create if no active deals exist
  IF NOT EXISTS (SELECT 1 FROM public.daily_deals WHERE status = 'active') THEN
    -- Find an admin/manager employee to be the creator
    SELECT e.id INTO v_employee_id FROM public.employees e
    JOIN public.employee_roles er ON er.employee_id = e.id
    JOIN public.roles r ON r.id = er.role_id
    WHERE r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN')
    LIMIT 1;

    IF v_employee_id IS NULL THEN
      SELECT id INTO v_employee_id FROM public.employees ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_employee_id IS NOT NULL THEN
      INSERT INTO public.daily_deals (
        title, image_url, description,
        fixed_price, available_quantity, original_quantity,
        starts_at, ends_at, status, created_by
      ) VALUES (
        'صفقة اليوم التجريبية',
        'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=600',
        '100 كرتونة شامبو متنوع سباركل
50 كرتونة صبغة باليت',
        200000, 20, 20,
        now(), now() + interval '30 days',
        'active', v_employee_id
      )
      RETURNING id INTO v_deal_id;

      -- Find products containing "شامبو" or "سباركل" in their name
      FOR v_product IN
        SELECT id FROM public.products
        WHERE product_name ILIKE '%شامبو%' OR product_name ILIKE '%سباركل%'
        LIMIT 1
      LOOP
        INSERT INTO public.daily_deal_items (deal_id, product_id, quantity)
        VALUES (v_deal_id, v_product.id, 100);
      END LOOP;

      -- Find products containing "صبغة" or "باليت" in their name
      FOR v_product IN
        SELECT id FROM public.products
        WHERE product_name ILIKE '%صبغة%' OR product_name ILIKE '%باليت%'
        LIMIT 1
      LOOP
        INSERT INTO public.daily_deal_items (deal_id, product_id, quantity)
        VALUES (v_deal_id, v_product.id, 50);
      END LOOP;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- END OF DAILY DEALS MODULE
-- ============================================================================
