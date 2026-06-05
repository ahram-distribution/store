-- ============================================================================
-- AUCTION V2 — COMPREHENSIVE TEST SEED DATA
-- Replaces the thin seed from 20260603_auction_v2.sql
-- Safe to re-run: deletes existing data for code 'AUC-2026-000001' first
-- ============================================================================

DO $$
DECLARE
  v_auction_id uuid;
  v_employee_id uuid;
  v_shampoo_id uuid;
  v_dye_id uuid;
  v_cream_id uuid;

  -- participant UUIDs
  v_p1_id uuid; v_p2_id uuid; v_p3_id uuid; v_p4_id uuid; v_p5_id uuid;
  v_p6_id uuid; v_p7_id uuid;

  -- participant owner IDs (customer IDs)
  v_c1_id uuid; v_c2_id uuid; v_c3_id uuid; v_c4_id uuid; v_c5_id uuid;
  v_c6_id uuid; v_c7_id uuid;

  -- bid IDs
  v_bid_id uuid;

  -- owner reference for new customer records
  v_owner_type varchar(20);
  v_owner_id uuid;

  v_now timestamptz := now();
  v_start_time timestamptz;
  v_t timestamptz;
BEGIN
  -- Delete existing test auction data
  DELETE FROM public.auction_awards aa USING public.auctions a
    WHERE aa.auction_id = a.id AND a.code = 'AUC-2026-000001';
  DELETE FROM public.auction_activity aa USING public.auctions a
    WHERE aa.auction_id = a.id AND a.code = 'AUC-2026-000001';
  DELETE FROM public.auction_bids ab USING public.auctions a
    WHERE ab.auction_id = a.id AND a.code = 'AUC-2026-000001';
  DELETE FROM public.auction_participants ap USING public.auctions a
    WHERE ap.auction_id = a.id AND a.code = 'AUC-2026-000001';
  DELETE FROM public.auction_items ai USING public.auctions a
    WHERE ai.auction_id = a.id AND a.code = 'AUC-2026-000001';
  DELETE FROM public.auctions WHERE code = 'AUC-2026-000001';

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

  -- Set start time 25 minutes ago so activity feels lived-in
  v_start_time := v_now - interval '25 minutes';

  -- ==========================================================================
  -- CREATE AUCTION
  -- ==========================================================================
  INSERT INTO public.auctions (
    code, title, description, image_url,
    starting_price, current_price, bid_increment, deposit_amount,
    start_time, end_time, status, created_by
  ) VALUES (
    'AUC-2026-000001', 'مزاد الباقة الذهبية',
    E'باقة تجارية خاصة للموزعين\n\nتتكون من:\n100 كرتونة شامبو سباركل\n50 كرتونة صبغة باليت\n25 كرتونة كريم شعر',
    'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800',
    100000, 152000, 500, 5000,
    v_start_time, v_start_time + interval '2 hours',
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

  -- ==========================================================================
  -- ACTIVITY: Auction start
  -- ==========================================================================
  INSERT INTO public.auction_activity (auction_id, activity_type, message, created_at)
  VALUES (v_auction_id, 'auction_started', 'بدأ المزاد', v_start_time + interval '1 minute');

  -- ==========================================================================
  -- FIND OR CREATE CUSTOMERS for participants
  -- ==========================================================================

  -- Helper: find customer by name pattern, else create a placeholder
  -- We search for existing customers matching the test company names

  -- Resolve owner reference for new customer records
  SELECT owner_type, owner_id INTO v_owner_type, v_owner_id FROM public.customers WHERE owner_id IS NOT NULL LIMIT 1;
  IF v_owner_id IS NULL THEN
    v_owner_type := 'employee';
    v_owner_id := v_employee_id;
  END IF;

  -- Find or create customers
  SELECT id INTO v_c1_id FROM public.customers WHERE company_name ILIKE '%النور%' LIMIT 1;
  IF v_c1_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('شركة النور للتوزيع', 'CUST-TEST-01', 500000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c1_id;
  END IF;

  SELECT id INTO v_c2_id FROM public.customers WHERE company_name ILIKE '%البركة%' LIMIT 1;
  IF v_c2_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('شركة البركة للتجارة', 'CUST-TEST-02', 400000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c2_id;
  END IF;

  SELECT id INTO v_c3_id FROM public.customers WHERE company_name ILIKE '%المستقبل%' LIMIT 1;
  IF v_c3_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('مؤسسة المستقبل', 'CUST-TEST-03', 350000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c3_id;
  END IF;

  SELECT id INTO v_c4_id FROM public.customers WHERE company_name ILIKE '%الأمل%' OR company_name ILIKE '%الامل%' LIMIT 1;
  IF v_c4_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('شركة الأمل للتوزيع', 'CUST-TEST-04', 300000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c4_id;
  END IF;

  SELECT id INTO v_c5_id FROM public.customers WHERE company_name ILIKE '%الفجر%' LIMIT 1;
  IF v_c5_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('شركة الفجر', 'CUST-TEST-05', 250000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c5_id;
  END IF;

  SELECT id INTO v_c6_id FROM public.customers WHERE company_name ILIKE '%النهضة%' LIMIT 1;
  IF v_c6_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('مؤسسة النهضة', 'CUST-TEST-06', 200000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c6_id;
  END IF;

  SELECT id INTO v_c7_id FROM public.customers WHERE company_name ILIKE '%الرائد%' LIMIT 1;
  IF v_c7_id IS NULL THEN
    INSERT INTO public.customers (company_name, code, credit_limit, credit_days, owner_type, owner_id, is_active, created_at, updated_at)
    VALUES ('شركة الرائد', 'CUST-TEST-07', 180000, 30, v_owner_type, v_owner_id, true, v_now, v_now)
    RETURNING id INTO v_c7_id;
  END IF;

  v_t := v_start_time + interval '2 minutes';

  -- ==========================================================================
  -- CREATE PARTICIPANTS
  -- ==========================================================================

  -- Participant 1: شركة النور للتوزيع (approved, deposit paid)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at, created_at)
  VALUES (v_auction_id, 'customer', v_c1_id, 'approved', true, v_employee_id, v_t, v_t)
  RETURNING id INTO v_p1_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'شركة النور للتوزيع', 'شركة النور للتوزيع طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_approved', 'شركة النور للتوزيع', 'شركة النور للتوزيع تم اعتمادها للمشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- Participant 2: شركة البركة للتجارة (approved, deposit paid)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at, created_at)
  VALUES (v_auction_id, 'customer', v_c2_id, 'approved', true, v_employee_id, v_t, v_t)
  RETURNING id INTO v_p2_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'شركة البركة للتجارة', 'شركة البركة للتجارة طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_approved', 'شركة البركة للتجارة', 'شركة البركة للتجارة تم اعتمادها للمشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- Participant 3: مؤسسة المستقبل (approved, deposit paid)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at, created_at)
  VALUES (v_auction_id, 'customer', v_c3_id, 'approved', true, v_employee_id, v_t, v_t)
  RETURNING id INTO v_p3_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'مؤسسة المستقبل', 'مؤسسة المستقبل طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_approved', 'مؤسسة المستقبل', 'مؤسسة المستقبل تم اعتمادها للمشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- Participant 4: شركة الأمل للتوزيع (approved, deposit paid)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at, created_at)
  VALUES (v_auction_id, 'customer', v_c4_id, 'approved', true, v_employee_id, v_t, v_t)
  RETURNING id INTO v_p4_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'شركة الأمل للتوزيع', 'شركة الأمل للتوزيع طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_approved', 'شركة الأمل للتوزيع', 'شركة الأمل للتوزيع تم اعتمادها للمشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- Participant 5: شركة الفجر (approved, deposit paid)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, approved_by, approved_at, created_at)
  VALUES (v_auction_id, 'customer', v_c5_id, 'approved', true, v_employee_id, v_t, v_t)
  RETURNING id INTO v_p5_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'شركة الفجر', 'شركة الفجر طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_approved', 'شركة الفجر', 'شركة الفجر تم اعتمادها للمشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- Participant 6: مؤسسة النهضة (pending)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, created_at)
  VALUES (v_auction_id, 'customer', v_c6_id, 'pending', false, v_t)
  RETURNING id INTO v_p6_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'مؤسسة النهضة', 'مؤسسة النهضة طلبت المشاركة', v_t);

  v_t := v_t + interval '1 minute';

  -- Participant 7: شركة الرائد (rejected)
  INSERT INTO public.auction_participants (auction_id, participant_type, participant_id, status, deposit_paid, created_at)
  VALUES (v_auction_id, 'customer', v_c7_id, 'rejected', false, v_t)
  RETURNING id INTO v_p7_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participation_requested', 'شركة الرائد', 'شركة الرائد طلبت المشاركة', v_t);
  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, created_at)
  VALUES (v_auction_id, 'participant_rejected', 'شركة الرائد', 'شركة الرائد تم رفض طلب المشاركة', v_t + interval '30 seconds');

  v_t := v_t + interval '1 minute';

  -- ==========================================================================
  -- BID HISTORY
  -- ==========================================================================

  -- Bid 1: شركة النور — 150,000 (now winning runner-up, 22 min ago)
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p1_id, 150000, false, v_t)
  RETURNING id INTO v_bid_id;

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'شركة النور للتوزيع', 'شركة النور للتوزيع رفعت السعر إلى 150,000 جنيه', jsonb_build_object('amount', 150000, 'participant_id', v_p1_id), v_t);
  UPDATE public.auctions SET current_price = 150000 WHERE id = v_auction_id;

  v_t := v_t + interval '2 minutes';

  -- Bid 2: شركة البركة — 150,500 (21 min ago)
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p2_id, 150500, false, v_t);

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'شركة البركة للتجارة', 'شركة البركة للتجارة رفعت السعر إلى 150,500 جنيه', jsonb_build_object('amount', 150500, 'participant_id', v_p2_id), v_t);
  UPDATE public.auctions SET current_price = 150500 WHERE id = v_auction_id;

  v_t := v_t + interval '2 minutes';

  -- Bid 3: مؤسسة المستقبل — 151,000 (19 min ago)
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p3_id, 151000, false, v_t);

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'مؤسسة المستقبل', 'مؤسسة المستقبل رفعت السعر إلى 151,000 جنيه', jsonb_build_object('amount', 151000, 'participant_id', v_p3_id), v_t);
  UPDATE public.auctions SET current_price = 151000 WHERE id = v_auction_id;

  v_t := v_t + interval '3 minutes';

  -- Bid 4: شركة البركة — 151,500 (16 min ago)
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p2_id, 151500, false, v_t);

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'شركة البركة للتجارة', 'شركة البركة للتجارة رفعت السعر إلى 151,500 جنيه', jsonb_build_object('amount', 151500, 'participant_id', v_p2_id), v_t);
  UPDATE public.auctions SET current_price = 151500 WHERE id = v_auction_id;

  v_t := v_t + interval '3 minutes';

  -- Bid 5: شركة الأمل — 152,000 (13 min ago)
  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p4_id, 152000, false, v_t);

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'شركة الأمل للتوزيع', 'شركة الأمل للتوزيع رفعت السعر إلى 152,000 جنيه', jsonb_build_object('amount', 152000, 'participant_id', v_p4_id), v_t);
  UPDATE public.auctions SET current_price = 152000 WHERE id = v_auction_id;

  v_t := v_t + interval '5 minutes';

  -- Bid 6: شركة النور — 152,000 (8 min ago, WINNING — tied amount but later bid)
  -- Reset previous winning bids first
  UPDATE public.auction_bids SET is_winning = false WHERE auction_id = v_auction_id AND is_winning = true;

  INSERT INTO public.auction_bids (auction_id, participant_id, amount, is_winning, placed_at)
  VALUES (v_auction_id, v_p1_id, 152000, true, v_t);

  INSERT INTO public.auction_activity (auction_id, activity_type, actor_name, message, metadata, created_at)
  VALUES (v_auction_id, 'bid_placed', 'شركة النور للتوزيع', 'شركة النور للتوزيع رفعت السعر إلى 152,000 جنيه', jsonb_build_object('amount', 152000, 'participant_id', v_p1_id), v_t);

  -- Current leader is شركة النور at 152,000 (same price but later bid)
  -- Note: no current_price update because it's the same amount

  -- ==========================================================================
  -- WINNER FLOW (simulated — auction still live)
  -- ==========================================================================
  -- No award created yet because auction is still live.
  -- When governed_end_auction runs, it will:
  --   1. Set status = 'ended'
  --   2. Set winner_id = v_p1_id (شركة النور), winner_amount = 152000
  --   3. Create an award record with 1hr confirmation deadline
  --   4. Add activity 'انتهى المزاد. جاري تأكيد الفائز.'
  --
  -- The second-highest bidder is شركة الأمل at 152,000 (earlier bid, now outranked)
  -- If winner doesn't confirm within 1hr, award can be forfeited

  -- ==========================================================================
  -- VERIFICATION QUERY
  -- ==========================================================================
  -- After applying, open the auction page and verify:
  --   ✓ Countdown works (shows ~1h 35m remaining)
  --   ✓ Current price: 152,000
  --   ✓ Leader: شركة النور للتوزيع
  --   ✓ 5 approved participants + 1 pending + 1 rejected = 7 total, 5 approved
  --   ✓ 6 bids in history
  --   ✓ Activity feed shows 19+ entries
  --   ✓ Items: 3 products with quantities
  --   ✓ Image visible
  --   ✓ Participation flow visible (طلب المشاركة button when logged in)
  -- ==========================================================================

END;
$$;
