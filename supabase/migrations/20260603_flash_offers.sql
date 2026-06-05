-- ============================================================================
-- FLASH OFFERS MODULE
-- Implements Flash Offer (عرض الساعة) as a countdown-driven commercial package.
-- Status: flash_offer_status ENUM (draft, scheduled, active, sold_out, expired, cancelled)
-- ============================================================================

-- 1. flash_offer_status ENUM -------------------------------------------------

DO $$ BEGIN
    CREATE TYPE flash_offer_status AS ENUM (
        'draft', 'scheduled', 'active', 'sold_out', 'expired', 'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. flash_offers table ------------------------------------------------------

CREATE TABLE IF NOT EXISTS flash_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(255) NOT NULL,
    image_url text,
    description text,
    fixed_price decimal(12,2) NOT NULL,
    available_quantity integer NOT NULL DEFAULT 0,
    original_quantity integer NOT NULL DEFAULT 0,
    starts_at timestamptz,
    ends_at timestamptz,
    status flash_offer_status NOT NULL DEFAULT 'draft',
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE flash_offers ADD CONSTRAINT fk_flash_offers_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);

ALTER TABLE flash_offers ADD CONSTRAINT ck_flash_offers_fixed_price
    CHECK (fixed_price >= 0);
ALTER TABLE flash_offers ADD CONSTRAINT ck_flash_offers_available_quantity
    CHECK (available_quantity >= 0);
ALTER TABLE flash_offers ADD CONSTRAINT ck_flash_offers_original_quantity
    CHECK (original_quantity >= 0);
ALTER TABLE flash_offers ADD CONSTRAINT ck_flash_offers_dates
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at);

CREATE INDEX IF NOT EXISTS idx_flash_offers_status ON flash_offers (status);
CREATE INDEX IF NOT EXISTS idx_flash_offers_created_by ON flash_offers (created_by);
CREATE INDEX IF NOT EXISTS idx_flash_offers_ends_at ON flash_offers (ends_at);

COMMENT ON TABLE flash_offers IS 'Flash Offer (عرض الساعة) countdown-driven commercial packages.';
COMMENT ON COLUMN flash_offers.fixed_price IS 'Fixed price for the entire offer (not per-unit)';
COMMENT ON COLUMN flash_offers.available_quantity IS 'Remaining quantity available for purchase';
COMMENT ON COLUMN flash_offers.original_quantity IS 'Initial quantity when created';

-- 3. flash_offer_items table -------------------------------------------------

CREATE TABLE IF NOT EXISTS flash_offer_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE flash_offer_items ADD CONSTRAINT fk_flash_offer_items_offer
    FOREIGN KEY (offer_id) REFERENCES flash_offers (id) ON DELETE CASCADE;
ALTER TABLE flash_offer_items ADD CONSTRAINT fk_flash_offer_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);

ALTER TABLE flash_offer_items ADD CONSTRAINT ck_flash_offer_items_quantity
    CHECK (quantity > 0);

CREATE INDEX IF NOT EXISTS idx_flash_offer_items_offer_id ON flash_offer_items (offer_id);
CREATE INDEX IF NOT EXISTS idx_flash_offer_items_product_id ON flash_offer_items (product_id);

COMMENT ON TABLE flash_offer_items IS 'Products included in a flash offer with their quantities.';

-- 4. order_flash_offers table ------------------------------------------------

CREATE TABLE IF NOT EXISTS order_flash_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    fixed_price decimal(12,2) NOT NULL,
    total_price decimal(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_flash_offers ADD CONSTRAINT fk_order_flash_offers_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;
ALTER TABLE order_flash_offers ADD CONSTRAINT fk_order_flash_offers_offer
    FOREIGN KEY (offer_id) REFERENCES flash_offers (id);

ALTER TABLE order_flash_offers ADD CONSTRAINT ck_order_flash_offers_quantity
    CHECK (quantity > 0);
ALTER TABLE order_flash_offers ADD CONSTRAINT ck_order_flash_offers_prices
    CHECK (fixed_price >= 0 AND total_price >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_flash_offers ON order_flash_offers (order_id, offer_id);

CREATE INDEX IF NOT EXISTS idx_order_flash_offers_order_id ON order_flash_offers (order_id);
CREATE INDEX IF NOT EXISTS idx_order_flash_offers_offer_id ON order_flash_offers (offer_id);

COMMENT ON TABLE order_flash_offers IS 'Links flash offers to orders. Snapshots fixed_price at order time.';

-- 5. flash_offers.manage capability ------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'flash_offers.manage', 'إدارة عروض الساعة', 'Create, edit, activate, and cancel flash offers', 'flash_offers'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'flash_offers.manage');

-- ============================================================================
-- GOVERNED RPCs
-- ============================================================================

-- 6. get_governed_flash_offers -----------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_flash_offers(p_token uuid)
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
        ) FROM flash_offer_items di
        JOIN products p ON p.id = di.product_id
        WHERE di.offer_id = d.id), '[]'::jsonb
      )
    ) ORDER BY d.created_at DESC
  ) INTO v_result FROM flash_offers d;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_flash_offers IS 'جلب جميع عروض الساعة مع عناصرها';

-- 7. get_governed_active_flash_offers ----------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_active_flash_offers(p_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
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
        ) FROM flash_offer_items di
        JOIN products p ON p.id = di.product_id
        WHERE di.offer_id = d.id), '[]'::jsonb
      )
    ) ORDER BY d.ends_at ASC NULLS LAST
  ) INTO v_result FROM flash_offers d
  WHERE d.status IN ('active', 'sold_out', 'expired')
    AND (d.ends_at IS NULL OR d.ends_at > now() - interval '30 days');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_active_flash_offers IS 'جلب عروض الساعة النشطة للواجهة العامة (مرتبة حسب الأقرب انتهاء)';

-- 8. governed_create_flash_offer ---------------------------------------------

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
AS $$
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
      WHEN p_starts_at IS NOT NULL AND p_starts_at > now() THEN 'scheduled'
      ELSE 'active'
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
$$;

COMMENT ON FUNCTION public.governed_create_flash_offer IS 'إنشاء عرض ساعة جديد مع عناصره';

-- 9. governed_update_flash_offer ---------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_update_flash_offer(
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
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_update_flash_offer IS 'تحديث عرض ساعة';

-- 10. governed_activate_flash_offer ------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_activate_flash_offer(
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
  v_current_status flash_offer_status;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'flash_offers.manage');

  SELECT status INTO v_current_status FROM public.flash_offers WHERE id = p_id;
  IF v_current_status IS NULL THEN RETURN jsonb_build_object('error', 'OFFER_NOT_FOUND'); END IF;
  IF v_current_status NOT IN ('draft', 'scheduled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.flash_offers SET status = 'active', updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_activate_flash_offer IS 'تفعيل عرض ساعة';

-- 11. governed_cancel_flash_offer --------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_cancel_flash_offer(
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
  v_current_status flash_offer_status;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'flash_offers.manage');

  SELECT status INTO v_current_status FROM public.flash_offers WHERE id = p_id;
  IF v_current_status IS NULL THEN RETURN jsonb_build_object('error', 'OFFER_NOT_FOUND'); END IF;
  IF v_current_status IN ('expired', 'cancelled') THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.flash_offers SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_cancel_flash_offer IS 'إلغاء عرض ساعة';

-- 12. Update governed_approve_order to deduct flash offer inventory ----------

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
  v_flash_offer record;
  v_fo_item record;
  v_inv record;
  v_new_qty integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;

  PERFORM check_capability(p_token, 'orders.approve');

  SELECT status INTO v_old_status FROM public.orders WHERE id = p_id;
  IF v_old_status IS NULL THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;
  IF v_old_status != 'submitted' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  -- Deduct daily deal available_quantity and component product inventory
  FOR v_daily_deal IN
    SELECT odd.deal_id, odd.quantity
    FROM order_daily_deals odd
    WHERE odd.order_id = p_id
  LOOP
    UPDATE public.daily_deals
    SET available_quantity = GREATEST(available_quantity - v_daily_deal.quantity, 0),
        status = CASE
          WHEN available_quantity - v_daily_deal.quantity <= 0 THEN 'sold_out'::daily_deal_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_daily_deal.deal_id;

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

  -- Deduct flash offer available_quantity and component product inventory
  FOR v_flash_offer IN
    SELECT ofo.offer_id, ofo.quantity
    FROM order_flash_offers ofo
    WHERE ofo.order_id = p_id
  LOOP
    UPDATE public.flash_offers
    SET available_quantity = GREATEST(available_quantity - v_flash_offer.quantity, 0),
        status = CASE
          WHEN available_quantity - v_flash_offer.quantity <= 0 THEN 'sold_out'::flash_offer_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_flash_offer.offer_id;

    FOR v_fo_item IN
      SELECT foi.product_id, foi.quantity
      FROM flash_offer_items foi
      WHERE foi.offer_id = v_flash_offer.offer_id
    LOOP
      SELECT * INTO v_inv FROM public.inventory WHERE product_id = v_fo_item.product_id;
      IF FOUND THEN
        v_new_qty := GREATEST(v_inv.quantity - (v_fo_item.quantity * v_flash_offer.quantity), 0);
        UPDATE public.inventory SET quantity = v_new_qty, updated_at = now()
        WHERE product_id = v_fo_item.product_id;
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

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, changed_at)
  VALUES (p_id, v_old_status, 'approved', v_employee_id, now());

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_order IS 'اعتماد طلب مع خصم المخزون (منتجات + عروض يومية + عروض ساعة)';

-- 13. governed_add_order_flash_offers ----------------------------------------

CREATE OR REPLACE FUNCTION public.governed_add_order_flash_offers(
  p_token uuid,
  p_order_id uuid,
  p_offers jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_offer jsonb;
  v_offer_record flash_offers;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  FOR v_offer IN SELECT * FROM jsonb_array_elements(p_offers)
  LOOP
    SELECT * INTO v_offer_record FROM public.flash_offers WHERE id = (v_offer->>'offer_id')::uuid;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'OFFER_NOT_FOUND'); END IF;

    IF v_offer_record.status != 'active' THEN RETURN jsonb_build_object('error', 'OFFER_NOT_ACTIVE'); END IF;
    IF v_offer_record.available_quantity < (v_offer->>'quantity')::int THEN
      RETURN jsonb_build_object('error', 'OFFER_INSUFFICIENT_QUANTITY');
    END IF;

    INSERT INTO public.order_flash_offers (order_id, offer_id, quantity, fixed_price, total_price)
    VALUES (
      p_order_id,
      (v_offer->>'offer_id')::uuid,
      (v_offer->>'quantity')::int,
      v_offer_record.fixed_price,
      v_offer_record.fixed_price * (v_offer->>'quantity')::int
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_add_order_flash_offers IS 'إضافة عروض ساعة إلى طلب موجود';

-- 14. get_governed_order_flash_offers ----------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_order_flash_offers(
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
      'id', ofo.id,
      'order_id', ofo.order_id,
      'offer_id', ofo.offer_id,
      'title', d.title,
      'quantity', ofo.quantity,
      'fixed_price', ofo.fixed_price,
      'total_price', ofo.total_price,
      'image_url', d.image_url
    )
  ) INTO v_result
  FROM order_flash_offers ofo
  JOIN flash_offers d ON d.id = ofo.offer_id
  WHERE ofo.order_id = p_order_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_order_flash_offers IS 'جلب عروض الساعة لطلب معين';

-- 15. Seed test offers (idempotent) -------------------------------------------

DO $$
DECLARE
  v_offer_id uuid;
  v_employee_id uuid;
  v_product record;
  v_shampoo_id uuid;
  v_dye_id uuid;
  v_nivea_id uuid;
  v_dove_id uuid;
  v_loreal_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.flash_offers WHERE status = 'active') THEN
    SELECT e.id INTO v_employee_id FROM public.employees e
    JOIN public.employee_roles er ON er.employee_id = e.id
    JOIN public.roles r ON r.id = er.role_id
    WHERE r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN')
    LIMIT 1;

    IF v_employee_id IS NULL THEN
      SELECT id INTO v_employee_id FROM public.employees ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_employee_id IS NOT NULL THEN
      -- Find product IDs
      SELECT id INTO v_shampoo_id FROM public.products WHERE product_name ILIKE '%شامبو%' OR product_name ILIKE '%سباركل%' LIMIT 1;
      SELECT id INTO v_dye_id FROM public.products WHERE product_name ILIKE '%صبغة%' OR product_name ILIKE '%باليت%' LIMIT 1;
      SELECT id INTO v_nivea_id FROM public.products WHERE product_name ILIKE '%نيفيا%' LIMIT 1;
      SELECT id INTO v_dove_id FROM public.products WHERE product_name ILIKE '%دوف%' LIMIT 1;
      SELECT id INTO v_loreal_id FROM public.products WHERE product_name ILIKE '%لوريال%' LIMIT 1;

      -- Offer 1: عرض الساعة الذهبي (expires 1 hour from now)
      INSERT INTO public.flash_offers (
        title, image_url, description,
        fixed_price, available_quantity, original_quantity,
        starts_at, ends_at, status, created_by
      ) VALUES (
        'عرض الساعة الذهبي',
        'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=600',
        '100 كرتونة شامبو سباركل
50 كرتونة صبغة باليت',
        180000, 12, 12,
        now(), now() + interval '1 hour',
        'active', v_employee_id
      )
      RETURNING id INTO v_offer_id;

      IF v_shampoo_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_shampoo_id, 100);
      END IF;
      IF v_dye_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_dye_id, 50);
      END IF;

      -- Offer 2: عرض الانتعاش المميز (expires 2 hours from now)
      INSERT INTO public.flash_offers (
        title, image_url, description,
        fixed_price, available_quantity, original_quantity,
        starts_at, ends_at, status, created_by
      ) VALUES (
        'عرض الانتعاش المميز',
        'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=600',
        '70 كرتونة نيفيا
50 كرتونة دوف',
        160000, 15, 15,
        now(), now() + interval '2 hours',
        'active', v_employee_id
      )
      RETURNING id INTO v_offer_id;

      IF v_nivea_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_nivea_id, 70);
      END IF;
      IF v_dove_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_dove_id, 50);
      END IF;

      -- Offer 3: عرض الألوان الاحترافي (expires 3 hours from now)
      INSERT INTO public.flash_offers (
        title, image_url, description,
        fixed_price, available_quantity, original_quantity,
        starts_at, ends_at, status, created_by
      ) VALUES (
        'عرض الألوان الاحترافي',
        'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=600',
        '50 كرتونة صبغة باليت
30 كرتونة لوريال',
        140000, 20, 20,
        now(), now() + interval '3 hours',
        'active', v_employee_id
      )
      RETURNING id INTO v_offer_id;

      IF v_dye_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_dye_id, 50);
      END IF;
      IF v_loreal_id IS NOT NULL THEN
        INSERT INTO public.flash_offer_items (offer_id, product_id, quantity) VALUES (v_offer_id, v_loreal_id, 30);
      END IF;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- END OF FLASH OFFERS MODULE
-- ============================================================================
