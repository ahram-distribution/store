-- ============================================================================
-- AUCTION MODULE V2 — LIVE B2B AUCTION ROOM
-- Mobile-first, realtime, governed RPCs
-- ============================================================================

-- 0. Drop old objects if they exist -----------------------------------------

DROP TYPE IF EXISTS public.auction_status CASCADE;
DROP TYPE IF EXISTS public.auction_participant_status CASCADE;

-- 1. ENUMs -------------------------------------------------------------------

CREATE TYPE public.auction_status AS ENUM (
    'pending', 'live', 'ended', 'awarded', 'cancelled'
);

CREATE TYPE public.auction_participant_status AS ENUM (
    'pending', 'approved', 'rejected', 'blocked'
);

-- 2. auctions table ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auctions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(30) NOT NULL,
    title varchar(255) NOT NULL,
    description text,
    image_url text,
    starting_price decimal(12,2) NOT NULL,
    current_price decimal(12,2) NOT NULL,
    bid_increment decimal(12,2) NOT NULL,
    deposit_amount decimal(12,2),
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status public.auction_status NOT NULL DEFAULT 'pending',
    winner_id uuid,
    winner_amount decimal(12,2),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auctions ADD CONSTRAINT fk_auctions_created_by
    FOREIGN KEY (created_by) REFERENCES employees (id);
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_price
    CHECK (starting_price >= 0 AND current_price >= 0 AND bid_increment > 0);
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_deposit
    CHECK (deposit_amount IS NULL OR deposit_amount >= 0);
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_time
    CHECK (start_time < end_time);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_code ON auctions (code);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions (status);
CREATE INDEX IF NOT EXISTS idx_auctions_start_time ON auctions (start_time);
CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON auctions (end_time);

COMMENT ON TABLE auctions IS 'Live B2B auction room. Mobile-first realtime bidding.';

-- 3. auction_items table (package contents) ----------------------------------

CREATE TABLE IF NOT EXISTS public.auction_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auction_items ADD CONSTRAINT fk_auction_items_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;
ALTER TABLE auction_items ADD CONSTRAINT fk_auction_items_product
    FOREIGN KEY (product_id) REFERENCES products (id);
ALTER TABLE auction_items ADD CONSTRAINT ck_auction_items_quantity
    CHECK (quantity > 0);

CREATE INDEX IF NOT EXISTS idx_auction_items_auction_id ON auction_items (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_items_product_id ON auction_items (product_id);

COMMENT ON TABLE auction_items IS 'Products included in an auction package with quantities.';

-- 4. auction_participants table ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.auction_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_type varchar(20) NOT NULL,
    participant_id uuid NOT NULL,
    status public.auction_participant_status NOT NULL DEFAULT 'pending',
    deposit_paid boolean NOT NULL DEFAULT false,
    approved_by uuid,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auction_participants ADD CONSTRAINT fk_auction_participants_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;
ALTER TABLE auction_participants ADD CONSTRAINT fk_auction_participants_approved_by
    FOREIGN KEY (approved_by) REFERENCES employees (id);
ALTER TABLE auction_participants ADD CONSTRAINT ck_auction_participants_type
    CHECK (participant_type IN ('employee', 'customer'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_participants ON auction_participants (auction_id, participant_type, participant_id);
CREATE INDEX IF NOT EXISTS idx_auction_participants_auction_id ON auction_participants (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_participants_status ON auction_participants (status);

COMMENT ON TABLE auction_participants IS 'Registered participants for each auction with deposit/approval status.';

-- 5. auction_bids table ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auction_bids (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    is_winning boolean NOT NULL DEFAULT false,
    placed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auction_bids ADD CONSTRAINT fk_auction_bids_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;
ALTER TABLE auction_bids ADD CONSTRAINT fk_auction_bids_participant
    FOREIGN KEY (participant_id) REFERENCES auction_participants (id);
ALTER TABLE auction_bids ADD CONSTRAINT ck_auction_bids_amount
    CHECK (amount >= 0);

CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_id ON auction_bids (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_placed_at ON auction_bids (auction_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_bids_winning ON auction_bids (auction_id) WHERE is_winning = true;

COMMENT ON TABLE auction_bids IS 'Bid records. is_winning updated in realtime.';

-- 6. auction_awards table ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auction_awards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    amount decimal(12,2) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    order_id uuid,
    confirmation_deadline timestamptz,
    awarded_by uuid NOT NULL,
    awarded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_participant
    FOREIGN KEY (participant_id) REFERENCES auction_participants (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_order
    FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE auction_awards ADD CONSTRAINT fk_auction_awards_awarded_by
    FOREIGN KEY (awarded_by) REFERENCES employees (id);
ALTER TABLE auction_awards ADD CONSTRAINT ck_auction_awards_status
    CHECK (status IN ('pending', 'awarded', 'converted', 'forfeited'));
ALTER TABLE auction_awards ADD CONSTRAINT ck_auction_awards_amount
    CHECK (amount >= 0);

CREATE INDEX IF NOT EXISTS idx_auction_awards_auction_id ON auction_awards (auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_awards_status ON auction_awards (status);

COMMENT ON TABLE auction_awards IS 'Winner awards. 1hr confirmation window.';

-- 7. auction_activity table --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auction_activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id uuid NOT NULL,
    activity_type varchar(50) NOT NULL,
    actor_name varchar(255),
    message text NOT NULL,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auction_activity ADD CONSTRAINT fk_auction_activity_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_auction_activity_auction_id ON auction_activity (auction_id, created_at DESC);

COMMENT ON TABLE auction_activity IS 'Realtime activity feed for auction room.';

-- 8. Realtime publication ----------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_activity;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_participants;

-- 9. auctions.manage capability ----------------------------------------------

INSERT INTO public.capabilities (code, name, description, "group")
SELECT 'auctions.manage', 'إدارة المزادات', 'Create, activate, cancel auctions', 'auctions'
WHERE NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'auctions.manage');

-- ============================================================================
-- GOVERNED RPCs
-- ============================================================================

-- 10. Helper: get participant status for a session ---------------------------

CREATE OR REPLACE FUNCTION public._get_auction_participant_status(
  p_auction_id uuid,
  p_session app.sessions
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_participant public.auction_participants;
  v_company_name varchar(255);
BEGIN
  IF p_session.customer_id IS NOT NULL THEN
    SELECT ap.* INTO v_participant FROM public.auction_participants ap
    WHERE ap.auction_id = p_auction_id AND ap.participant_type = 'customer' AND ap.participant_id = p_session.customer_id;
    SELECT company_name INTO v_company_name FROM public.customers WHERE id = p_session.customer_id;
  ELSIF p_session.employee_id IS NOT NULL THEN
    SELECT ap.* INTO v_participant FROM public.auction_participants ap
    WHERE ap.auction_id = p_auction_id AND ap.participant_type = 'employee' AND ap.participant_id = p_session.employee_id;
    SELECT full_name INTO v_company_name FROM public.employees WHERE id = p_session.employee_id;
  ELSE
    RETURN jsonb_build_object('status', 'visitor');
  END IF;

  IF v_participant.id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'registered',
      'can_request', true,
      'company_name', v_company_name
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_participant.status,
    'participant_id', v_participant.id,
    'deposit_paid', v_participant.deposit_paid,
    'company_name', v_company_name
  );
END;
$$;

-- 11. get_governed_auctions --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_auctions(p_token uuid DEFAULT NULL)
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
      'id', a.id,
      'code', a.code,
      'title', a.title,
      'description', a.description,
      'image_url', a.image_url,
      'starting_price', a.starting_price,
      'current_price', a.current_price,
      'bid_increment', a.bid_increment,
      'deposit_amount', a.deposit_amount,
      'start_time', a.start_time,
      'end_time', a.end_time,
      'status', a.status,
      'winner_id', a.winner_id,
      'winner_amount', a.winner_amount,
      'participant_count', (SELECT COUNT(*) FROM public.auction_participants ap WHERE ap.auction_id = a.id AND ap.status = 'approved'),
      'bid_count', (SELECT COUNT(*) FROM public.auction_bids ab WHERE ab.auction_id = a.id),
      'items', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', ai.id,
            'product_id', ai.product_id,
            'product_name', p.product_name,
            'quantity', ai.quantity
          )
        ) FROM public.auction_items ai
        JOIN products p ON p.id = ai.product_id
        WHERE ai.auction_id = a.id), '[]'::jsonb
      ),
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'participant_status',
      CASE WHEN v_session.token IS NOT NULL THEN
        public._get_auction_participant_status(a.id, v_session)
      ELSE
        jsonb_build_object('status', 'visitor')
      END
    ) ORDER BY
      CASE a.status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      a.end_time ASC
  ) INTO v_result FROM public.auctions a;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_auctions IS 'جلب جميع المزادات مع حالة المشاركة للمستخدم الحالي';

-- 12. get_governed_auction_detail --------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_auction_detail(
  p_auction_id uuid,
  p_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_auction public.auctions;
  v_result jsonb;
  v_top_bid public.auction_bids;
  v_leader_name varchar(255);
BEGIN
  IF p_token IS NOT NULL THEN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  -- Get current leader
  SELECT * INTO v_top_bid FROM public.auction_bids
  WHERE auction_id = p_auction_id AND is_winning = true LIMIT 1;

  IF v_top_bid.id IS NOT NULL THEN
    SELECT COALESCE(c.company_name, e.full_name) INTO v_leader_name
    FROM public.auction_participants ap
    LEFT JOIN customers c ON c.id = ap.participant_id AND ap.participant_type = 'customer'
    LEFT JOIN employees e ON e.id = ap.participant_id AND ap.participant_type = 'employee'
    WHERE ap.id = v_top_bid.participant_id;
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'code', a.code,
    'title', a.title,
    'description', a.description,
    'image_url', a.image_url,
    'starting_price', a.starting_price,
    'current_price', a.current_price,
    'bid_increment', a.bid_increment,
    'deposit_amount', a.deposit_amount,
    'start_time', a.start_time,
    'end_time', a.end_time,
    'status', a.status,
    'winner_id', a.winner_id,
    'winner_amount', a.winner_amount,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'participant_count', (SELECT COUNT(*) FROM public.auction_participants ap WHERE ap.auction_id = a.id AND ap.status = 'approved'),
    'bid_count', (SELECT COUNT(*) FROM public.auction_bids ab WHERE ab.auction_id = a.id),
    'current_leader_name', v_leader_name,
    'current_leader_bid', v_top_bid.amount,
    'items', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', ai.id,
          'product_id', ai.product_id,
          'product_name', p.product_name,
          'quantity', ai.quantity
        )
      ) FROM public.auction_items ai
      JOIN products p ON p.id = ai.product_id
      WHERE ai.auction_id = a.id), '[]'::jsonb
    ),
    'participant_status',
    CASE WHEN v_session.token IS NOT NULL THEN
      public._get_auction_participant_status(a.id, v_session)
    ELSE
      jsonb_build_object('status', 'visitor')
    END,
    'bids', COALESCE(
      (SELECT jsonb_agg(sub) FROM (
        SELECT jsonb_build_object(
          'id', ab.id,
          'participant_id', ab.participant_id,
          'participant_name', COALESCE(c.company_name, e.full_name),
          'amount', ab.amount,
          'is_winning', ab.is_winning,
          'placed_at', ab.placed_at
        ) AS val FROM public.auction_bids ab
        JOIN auction_participants ap ON ap.id = ab.participant_id
        LEFT JOIN customers c ON c.id = ap.participant_id AND ap.participant_type = 'customer'
        LEFT JOIN employees e ON e.id = ap.participant_id AND ap.participant_type = 'employee'
        WHERE ab.auction_id = a.id
        ORDER BY ab.placed_at DESC LIMIT 100
      ) sub), '[]'::jsonb
    ),
    'activity', COALESCE(
      (SELECT jsonb_agg(sub) FROM (
        SELECT jsonb_build_object(
          'id', act.id,
          'activity_type', act.activity_type,
          'actor_name', act.actor_name,
          'message', act.message,
          'metadata', act.metadata,
          'created_at', act.created_at
        ) AS val FROM public.auction_activity act
        WHERE act.auction_id = a.id
        ORDER BY act.created_at DESC LIMIT 50
      ) sub), '[]'::jsonb
    )
  ) INTO v_result FROM public.auctions a WHERE a.id = p_auction_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_governed_auction_detail IS 'جلب تفاصيل مزاد كاملة مع المزايدات والنشاط وحالة المشاركة';

-- 13. governed_request_auction_participation ----------------------------------

CREATE OR REPLACE FUNCTION public.governed_request_auction_participation(
  p_token uuid,
  p_auction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_auction public.auctions;
  v_participant_id uuid;
  v_participant_type varchar(20);
  v_participant_owner_id uuid;
  v_company_name varchar(255);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUCTION_NOT_FOUND'); END IF;
  IF v_auction.status = 'ended' OR v_auction.status = 'cancelled' THEN
    RETURN jsonb_build_object('error', 'AUCTION_CLOSED');
  END IF;

  IF v_session.customer_id IS NOT NULL THEN
    v_participant_type := 'customer';
    v_participant_owner_id := v_session.customer_id;
    SELECT company_name INTO v_company_name FROM public.customers WHERE id = v_session.customer_id;
  ELSIF v_session.employee_id IS NOT NULL THEN
    v_participant_type := 'employee';
    v_participant_owner_id := v_session.employee_id;
    SELECT full_name INTO v_company_name FROM public.employees WHERE id = v_session.employee_id;
  ELSE
    RETURN jsonb_build_object('error', 'UNKNOWN_IDENTITY');
  END IF;

  -- Check if already requested
  IF EXISTS (SELECT 1 FROM public.auction_participants
    WHERE auction_id = p_auction_id AND participant_type = v_participant_type AND participant_id = v_participant_owner_id)
  THEN
    RETURN jsonb_build_object('error', 'ALREADY_REGISTERED');
  END IF;

  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid)
  VALUES (p_auction_id, v_participant_type, v_participant_owner_id, 'pending', false)
  RETURNING id INTO v_participant_id;

  -- Add activity
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message)
  VALUES (p_auction_id, 'participation_requested', v_company_name, v_company_name || ' طلبت المشاركة في المزاد');

  RETURN jsonb_build_object('success', true, 'participant_id', v_participant_id);
END;
$$;

COMMENT ON FUNCTION public.governed_request_auction_participation IS 'طلب المشاركة في مزاد';

-- 14. governed_place_bid ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_place_bid(
  p_token uuid,
  p_auction_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_auction public.auctions;
  v_participant public.auction_participants;
  v_current_top public.auction_bids;
  v_min_acceptable numeric;
  v_bid_id uuid;
  v_company_name varchar(255);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUCTION_NOT_FOUND'); END IF;
  IF v_auction.status != 'live' THEN RETURN jsonb_build_object('error', 'AUCTION_NOT_LIVE'); END IF;
  IF now() > v_auction.end_time THEN RETURN jsonb_build_object('error', 'AUCTION_ENDED'); END IF;

  -- Find participant
  IF v_session.customer_id IS NOT NULL THEN
    SELECT * INTO v_participant FROM public.auction_participants
    WHERE auction_id = p_auction_id AND participant_type = 'customer' AND participant_id = v_session.customer_id;
    SELECT company_name INTO v_company_name FROM public.customers WHERE id = v_session.customer_id;
  ELSIF v_session.employee_id IS NOT NULL THEN
    SELECT * INTO v_participant FROM public.auction_participants
    WHERE auction_id = p_auction_id AND participant_type = 'employee' AND participant_id = v_session.employee_id;
    SELECT full_name INTO v_company_name FROM public.employees WHERE id = v_session.employee_id;
  END IF;

  IF v_participant.id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_PARTICIPANT'); END IF;
  IF v_participant.status != 'approved' THEN RETURN jsonb_build_object('error', 'NOT_APPROVED'); END IF;

  -- Validate bid amount
  SELECT * INTO v_current_top FROM public.auction_bids
  WHERE auction_id = p_auction_id AND is_winning = true LIMIT 1;

  IF v_current_top.id IS NULL THEN
    v_min_acceptable := v_auction.starting_price;
  ELSE
    v_min_acceptable := v_current_top.amount + v_auction.bid_increment;
  END IF;

  IF p_amount < v_min_acceptable THEN
    RETURN jsonb_build_object('error', 'BID_TOO_LOW', 'minimum_acceptable', v_min_acceptable);
  END IF;

  -- Reset previous winning bids
  UPDATE public.auction_bids SET is_winning = false
  WHERE auction_id = p_auction_id AND is_winning = true;

  -- Insert new bid
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning)
  VALUES (p_auction_id, v_participant.id, p_amount, true)
  RETURNING id INTO v_bid_id;

  -- Update auction current price
  UPDATE public.auctions SET current_price = p_amount, updated_at = now() WHERE id = p_auction_id;

  -- Add activity
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata)
  VALUES (
    p_auction_id, 'bid_placed', v_company_name,
    v_company_name || ' رفعت السعر إلى ' || p_amount || ' جنيه',
    jsonb_build_object('amount', p_amount, 'participant_id', v_participant.id)
  );

  RETURN jsonb_build_object('success', true, 'bid_id', v_bid_id, 'new_current_price', p_amount);
END;
$$;

COMMENT ON FUNCTION public.governed_place_bid IS 'وضع مزايدة في مزاد مباشر';

-- 15. governed_approve_participant (employee only) ----------------------------

CREATE OR REPLACE FUNCTION public.governed_approve_participant(
  p_token uuid,
  p_participant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_participant public.auction_participants;
  v_company_name varchar(255);
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'auctions.manage');

  SELECT * INTO v_participant FROM public.auction_participants WHERE id = p_participant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PARTICIPANT_NOT_FOUND'); END IF;
  IF v_participant.status != 'pending' THEN RETURN jsonb_build_object('error', 'INVALID_STATE'); END IF;

  UPDATE public.auction_participants SET
    status = 'approved', approved_by = v_session.employee_id, approved_at = now()
  WHERE id = p_participant_id;

  -- Get company name
  SELECT COALESCE(c.company_name, e.full_name) INTO v_company_name
  FROM public.auction_participants ap
  LEFT JOIN customers c ON c.id = ap.participant_id AND ap.participant_type = 'customer'
  LEFT JOIN employees e ON e.id = ap.participant_id AND ap.participant_type = 'employee'
  WHERE ap.id = p_participant_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message)
  VALUES (v_participant.auction_id, 'participant_approved', v_company_name, v_company_name || ' تم اعتمادها للمشاركة');

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_approve_participant IS 'اعتماد مشارك في مزاد (موظف فقط)';

-- 16. governed_end_auction ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_end_auction(
  p_token uuid,
  p_auction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_auction public.auctions;
  v_winning_bid public.auction_bids;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  PERFORM check_capability(p_token, 'auctions.manage');

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUCTION_NOT_FOUND'); END IF;
  IF v_auction.status != 'live' THEN RETURN jsonb_build_object('error', 'AUCTION_NOT_LIVE'); END IF;

  -- Find winning bid
  SELECT * INTO v_winning_bid FROM public.auction_bids
  WHERE auction_id = p_auction_id AND is_winning = true LIMIT 1;

  UPDATE public.auctions SET
    status = 'ended',
    winner_id = v_winning_bid.participant_id,
    winner_amount = v_winning_bid.amount,
    updated_at = now()
  WHERE id = p_auction_id;

  -- Create award
  IF v_winning_bid.id IS NOT NULL THEN
    INSERT INTO public.auction_awards (auction_id, participant_id, amount, status, awarded_by, confirmation_deadline)
    VALUES (p_auction_id, v_winning_bid.participant_id, v_winning_bid.amount, 'pending', v_session.employee_id, now() + interval '1 hour');

    INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message)
    VALUES (p_auction_id, 'auction_ended', NULL, 'انتهى المزاد. جاري تأكيد الفائز.');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_end_auction IS 'إنهاء مزاد وتحديد الفائز (موظف فقط)';

-- ============================================================================
-- SEED TEST DATA
-- ============================================================================

DO $$
DECLARE
  v_auction_id uuid;
  v_employee_id uuid;
  v_shampoo_id uuid;
  v_dye_id uuid;
  v_cream_id uuid;
  v_participant1_id uuid;
  v_participant2_id uuid;
BEGIN
  -- Only seed if no auctions exist
  IF EXISTS (SELECT 1 FROM public.auctions LIMIT 1) THEN RETURN; END IF;

  -- Find employee
  SELECT e.id INTO v_employee_id FROM public.employees e
  JOIN public.employee_roles er ON er.employee_id = e.id
  JOIN public.roles r ON r.id = er.role_id
  WHERE r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN') LIMIT 1;
  IF v_employee_id IS NULL THEN
    SELECT id INTO v_employee_id FROM public.employees ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_employee_id IS NULL THEN RETURN; END IF;

  -- Find products
  SELECT id INTO v_shampoo_id FROM public.products WHERE product_name ILIKE '%شامبو%' OR product_name ILIKE '%سباركل%' LIMIT 1;
  SELECT id INTO v_dye_id FROM public.products WHERE product_name ILIKE '%صبغة%' OR product_name ILIKE '%باليت%' LIMIT 1;
  SELECT id INTO v_cream_id FROM public.products WHERE product_name ILIKE '%كريم%' OR product_name ILIKE '%شعر%' LIMIT 1;

  -- Create auction
  INSERT INTO public.auctions (
    code, title, description, image_url,
    starting_price, current_price, bid_increment, deposit_amount,
    start_time, end_time, status, created_by
  ) VALUES (
    'AUC-2026-000001', 'مزاد الباقة الذهبية',
    '100 كرتونة شامبو سباركل
50 كرتونة صبغة باليت
25 كرتونة كريم شعر

فرصة استثنائية للحصول على أفضل المنتجات بأقل الأسعار.',
    'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800',
    100000, 100000, 500, 5000,
    now() - interval '10 minutes', now() + interval '1 hour 50 minutes',
    'live', v_employee_id
  ) RETURNING id INTO v_auction_id;

  -- Add auction items
  IF v_shampoo_id IS NOT NULL THEN
    INSERT INTO public.auction_items (auction_id, product_id, quantity) VALUES (v_auction_id, v_shampoo_id, 100);
  END IF;
  IF v_dye_id IS NOT NULL THEN
    INSERT INTO public.auction_items (auction_id, product_id, quantity) VALUES (v_auction_id, v_dye_id, 50);
  END IF;
  IF v_cream_id IS NOT NULL THEN
    INSERT INTO public.auction_items (auction_id, product_id, quantity) VALUES (v_auction_id, v_cream_id, 25);
  END IF;

  -- Add activity for auction start
  INSERT INTO public.auction_activity (auction_id, activity_type, message)
  VALUES (v_auction_id, 'auction_started', 'بدأ المزاد');

  -- Create participants
  IF EXISTS (SELECT 1 FROM public.customers LIMIT 1) THEN
    INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at)
    SELECT v_auction_id, 'customer', id, 'approved', true, v_employee_id, now()
    FROM public.customers WHERE company_name ILIKE '%النور%' OR company_name ILIKE '%نور%' LIMIT 1
    RETURNING id INTO v_participant1_id;

    -- If no customer found, pick any customer
    IF v_participant1_id IS NULL THEN
      INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at)
      SELECT v_auction_id, 'customer', id, 'approved', true, v_employee_id, now()
      FROM public.customers LIMIT 1
      RETURNING id INTO v_participant1_id;
    END IF;

    INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at)
    SELECT v_auction_id, 'customer', id, 'approved', true, v_employee_id, now()
    FROM public.customers WHERE id NOT IN (SELECT participant_id FROM public.auction_participants
      WHERE auction_id = v_auction_id AND participant_type = 'customer') LIMIT 1
    RETURNING id INTO v_participant2_id;

    -- Add activity for participants
    IF v_participant1_id IS NOT NULL THEN
      INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message)
      SELECT v_auction_id, 'participant_approved', company_name, company_name || ' تم اعتمادها للمشاركة'
      FROM public.customers WHERE id = (SELECT participant_id FROM public.auction_participants WHERE id = v_participant1_id);
    END IF;
    IF v_participant2_id IS NOT NULL THEN
      INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message)
      SELECT v_auction_id, 'participant_approved', company_name, company_name || ' تم اعتمادها للمشاركة'
      FROM public.customers WHERE id = (SELECT participant_id FROM public.auction_participants WHERE id = v_participant2_id);
    END IF;

    -- Place test bids
    IF v_participant1_id IS NOT NULL AND v_participant2_id IS NOT NULL THEN
      -- Bid 1
      INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning)
      VALUES (v_auction_id, v_participant1_id, 100500, false);

      INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata)
      SELECT v_auction_id, 'bid_placed', company_name, company_name || ' رفعت السعر إلى 100,500 جنيه', jsonb_build_object('amount', 100500)
      FROM public.customers WHERE id = (SELECT participant_id FROM public.auction_participants WHERE id = v_participant1_id);

      -- Bid 2
      INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning)
      VALUES (v_auction_id, v_participant2_id, 101000, false);

      INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata)
      SELECT v_auction_id, 'bid_placed', company_name, company_name || ' رفعت السعر إلى 101,000 جنيه', jsonb_build_object('amount', 101000)
      FROM public.customers WHERE id = (SELECT participant_id FROM public.auction_participants WHERE id = v_participant2_id);

      -- Bid 3 (winning)
      INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning)
      VALUES (v_auction_id, v_participant1_id, 152000, true);

      UPDATE public.auctions SET current_price = 152000 WHERE id = v_auction_id;

      INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata)
      SELECT v_auction_id, 'bid_placed', company_name, company_name || ' رفعت السعر إلى 152,000 جنيه', jsonb_build_object('amount', 152000)
      FROM public.customers WHERE id = (SELECT participant_id FROM public.auction_participants WHERE id = v_participant1_id);
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- END OF AUCTION MODULE V2
-- ============================================================================
