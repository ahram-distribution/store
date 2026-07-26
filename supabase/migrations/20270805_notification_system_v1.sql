-- ============================================================================
-- NOTIFICATION SYSTEM V1
-- Central governed notification system for Ahram Distribution Runtime
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- 1a. Notifications table — persistent inbox
CREATE TABLE IF NOT EXISTS public.notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type                  varchar(50) NOT NULL,
  title                 varchar(255) NOT NULL,
  message               text NOT NULL,
  entity_type           varchar(50),
  entity_id             uuid,
  target_path           text,
  event_key             text,
  is_read               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications (recipient_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (recipient_employee_id, is_read) WHERE is_read = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_event_key ON public.notifications (recipient_employee_id, event_key) WHERE event_key IS NOT NULL;

COMMENT ON TABLE public.notifications IS 'Notification inbox for employees. One record per event per recipient.';

-- 1b. Push subscriptions — stores browser push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth_key      text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_endpoint ON public.push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee ON public.push_subscriptions (employee_id);

COMMENT ON TABLE public.push_subscriptions IS 'Browser PWA push subscriptions per employee/device.';


-- ============================================================================
-- 2. HELPER FUNCTIONS
-- ============================================================================

-- 2a. Resolve direct manager for an employee
CREATE OR REPLACE FUNCTION public.fn_resolve_manager(p_employee_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT manager_id FROM public.employees WHERE id = p_employee_id;
$$;

-- 2b. Get all Supreme Management employee IDs
CREATE OR REPLACE FUNCTION public.fn_resolve_supreme_management_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT er.employee_id), '{}'::uuid[])
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE r.name = 'الإدارة العليا';
$$;

-- 2c. Get employee display name
CREATE OR REPLACE FUNCTION public.fn_employee_name(p_employee_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(full_name, code, 'مستخدم') FROM public.employees WHERE id = p_employee_id;
$$;


-- ============================================================================
-- 3. CORE NOTIFICATION CREATION (idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_create_notification(
  p_recipient uuid,
  p_type varchar,
  p_title varchar,
  p_message text,
  p_entity_type varchar DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_target_path text DEFAULT NULL,
  p_event_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_recipient IS NULL THEN RETURN NULL; END IF;

  -- Idempotent: if event_key already exists for this recipient, skip
  IF p_event_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.notifications
    WHERE recipient_employee_id = p_recipient AND event_key = p_event_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.notifications (recipient_employee_id, type, title, message, entity_type, entity_id, target_path, event_key)
  VALUES (p_recipient, p_type, p_title, p_message, p_entity_type, p_entity_id, p_target_path, p_event_key)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Bulk create: create same notification for multiple recipients
CREATE OR REPLACE FUNCTION public.fn_create_notification_bulk(
  p_recipients uuid[],
  p_type varchar,
  p_title varchar,
  p_message text,
  p_entity_type varchar DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_target_path text DEFAULT NULL,
  p_event_key_prefix text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec uuid;
  v_key text;
BEGIN
  FOREACH v_rec IN ARRAY p_recipients LOOP
    v_key := CASE WHEN p_event_key_prefix IS NOT NULL THEN p_event_key_prefix || ':' || v_rec::text ELSE NULL END;
    PERFORM public.fn_create_notification(v_rec, p_type, p_title, p_message, p_entity_type, p_entity_id, p_target_path, v_key);
  END LOOP;
END;
$$;


-- ============================================================================
-- 4. TRIGGER FUNCTIONS — Business Event → Notifications
-- ============================================================================

-- 4a. Order Status History INSERT → handles "submitted" + "status changed"
CREATE OR REPLACE FUNCTION public.fn_notify_order_status_history()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_name text;
  v_order_number text;
  v_order_owner uuid;
  v_manager uuid;
  v_supreme uuid[];
  v_from_label text;
  v_to_label text;
  v_target text;
BEGIN
  -- Get order details
  SELECT o.order_number, o.owner_id INTO v_order_number, v_order_owner
  FROM public.orders o WHERE o.id = NEW.order_id;

  v_actor_name := public.fn_employee_name(public.resolve_employee_id(NEW.changed_by));

  -- Resolve order owner to employee
  v_order_owner := public.resolve_employee_id(v_order_owner);

  -- Status labels
  v_from_label := COALESCE(NEW.from_status, 'مسودة');
  v_to_label := COALESCE(NEW.to_status, NEW.from_status);
  v_target := '/orders/' || NEW.order_id;

  -- EVENT A: New Order Submitted (from_status IS NULL or draft → submitted)
  IF (NEW.from_status IS NULL OR NEW.from_status = 'draft') AND NEW.to_status = 'submitted' THEN
    -- Recipients: Sales Manager + Supreme Management
    v_manager := public.fn_resolve_manager(v_order_owner);
    v_supreme := public.fn_resolve_supreme_management_ids();

    PERFORM public.fn_create_notification(
      v_manager, 'order_submitted', 'طلب جديد',
      'قام ' || v_actor_name || ' بتقديم طلب جديد رقم ' || v_order_number,
      'order', NEW.order_id, v_target,
      'order_submitted:' || NEW.order_id
    );

    PERFORM public.fn_create_notification_bulk(
      v_supreme, 'order_submitted', 'طلب جديد',
      'قام ' || v_actor_name || ' بتقديم طلب جديد رقم ' || v_order_number,
      'order', NEW.order_id, v_target,
      'order_submitted:' || NEW.order_id
    );
  END IF;

  -- EVENT B: Order Status Changed (real transition, not initial)
  IF NEW.from_status IS NOT NULL AND NEW.from_status != NEW.to_status THEN
    -- Notify the order creator
    IF v_order_owner IS NOT NULL THEN
      PERFORM public.fn_create_notification(
        v_order_owner, 'order_status_changed', 'تحديث حالة الطلب',
        'تم تغيير حالة الطلب رقم ' || v_order_number || ' من ' || COALESCE(NEW.from_status, '') || ' إلى ' || COALESCE(NEW.to_status, ''),
        'order', NEW.order_id, v_target,
        'order_status:' || NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 4b. Customer INSERT → New Customer Created
CREATE OR REPLACE FUNCTION public.fn_notify_customer_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_manager uuid;
  v_supreme uuid[];
  v_target text;
BEGIN
  v_actor_name := public.fn_employee_name(NEW.owner_id);
  v_target := '/customers/' || NEW.id;

  v_manager := public.fn_resolve_manager(NEW.owner_id);
  v_supreme := public.fn_resolve_supreme_management_ids();

  PERFORM public.fn_create_notification(
    v_manager, 'customer_created', 'عميل جديد',
    'قام ' || v_actor_name || ' بإضافة عميل جديد: ' || NEW.company_name,
    'customer', NEW.id, v_target,
    'customer_created:' || NEW.id
  );

  PERFORM public.fn_create_notification_bulk(
    v_supreme, 'customer_created', 'عميل جديد',
    'قام ' || v_actor_name || ' بإضافة عميل جديد: ' || NEW.company_name,
    'customer', NEW.id, v_target,
    'customer_created:' || NEW.id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 4c. Visit UPDATE → Visit Completed
CREATE OR REPLACE FUNCTION public.fn_notify_visit_completed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_customer_name text;
  v_manager uuid;
  v_supreme uuid[];
  v_target text;
BEGIN
  -- Only fire when status changes to 'completed'
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.fn_employee_name(NEW.employee_id);

  SELECT company_name INTO v_customer_name
  FROM public.customers WHERE id = NEW.customer_id;

  v_target := '/visits/' || NEW.id;

  v_manager := public.fn_resolve_manager(NEW.employee_id);
  v_supreme := public.fn_resolve_supreme_management_ids();

  PERFORM public.fn_create_notification(
    v_manager, 'visit_completed', 'زيارة مكتملة',
    'أنهى ' || v_actor_name || ' زيارة العميل ' || COALESCE(v_customer_name, ''),
    'visit', NEW.id, v_target,
    'visit_completed:' || NEW.id
  );

  PERFORM public.fn_create_notification_bulk(
    v_supreme, 'visit_completed', 'زيارة مكتملة',
    'أنهى ' || v_actor_name || ' زيارة العميل ' || COALESCE(v_customer_name, ''),
    'visit', NEW.id, v_target,
    'visit_completed:' || NEW.id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 4d. Workday Sessions INSERT → Attendance Check-In
CREATE OR REPLACE FUNCTION public.fn_notify_attendance_checkin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_checkin_time text;
  v_manager uuid;
  v_supreme uuid[];
  v_target text;
BEGIN
  v_actor_name := public.fn_employee_name(NEW.employee_id);
  v_checkin_time := to_char(NEW.start_time AT TIME ZONE 'Cairo', 'HH24:MI');
  v_target := '/attendance';

  v_manager := public.fn_resolve_manager(NEW.employee_id);
  v_supreme := public.fn_resolve_supreme_management_ids();

  PERFORM public.fn_create_notification(
    v_manager, 'attendance_checkin', 'تسجيل حضور',
    'سجل ' || v_actor_name || ' الحضور الساعة ' || v_checkin_time,
    'attendance', NEW.id, v_target,
    'checkin:' || NEW.employee_id || ':' || NEW.date::text
  );

  PERFORM public.fn_create_notification_bulk(
    v_supreme, 'attendance_checkin', 'تسجيل حضور',
    'سجل ' || v_actor_name || ' الحضور الساعة ' || v_checkin_time,
    'attendance', NEW.id, v_target,
    'checkin:' || NEW.employee_id || ':' || NEW.date::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 4e. Workday Sessions UPDATE → Attendance Check-Out
CREATE OR REPLACE FUNCTION public.fn_notify_attendance_checkout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_checkout_time text;
  v_manager uuid;
  v_supreme uuid[];
  v_target text;
BEGIN
  -- Only fire when end_time transitions from NULL to non-NULL
  IF NEW.end_time IS NULL OR OLD.end_time IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.fn_employee_name(NEW.employee_id);
  v_checkout_time := to_char(NEW.end_time AT TIME ZONE 'Cairo', 'HH24:MI');
  v_target := '/attendance';

  v_manager := public.fn_resolve_manager(NEW.employee_id);
  v_supreme := public.fn_resolve_supreme_management_ids();

  PERFORM public.fn_create_notification(
    v_manager, 'attendance_checkout', 'تسجيل انصراف',
    'سجل ' || v_actor_name || ' الانصراف الساعة ' || v_checkout_time,
    'attendance', NEW.id, v_target,
    'checkout:' || NEW.employee_id || ':' || NEW.date::text
  );

  PERFORM public.fn_create_notification_bulk(
    v_supreme, 'attendance_checkout', 'تسجيل انصراف',
    'سجل ' || v_actor_name || ' الانصراف الساعة ' || v_checkout_time,
    'attendance', NEW.id, v_target,
    'checkout:' || NEW.employee_id || ':' || NEW.date::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- 4f. Products UPDATE → Recently Available (grouped by day)
CREATE OR REPLACE FUNCTION public.fn_notify_recently_available()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_count integer;
  v_supreme uuid[];
  v_managers uuid[];
  v_target text;
  v_event_key text;
  v_existing_id uuid;
BEGIN
  -- Only fire when recently_available_at transitions to non-NULL
  IF NEW.recently_available_at IS NULL OR (OLD.recently_available_at IS NOT NULL AND OLD.recently_available_at = NEW.recently_available_at) THEN
    RETURN NEW;
  END IF;

  v_today := NEW.recently_available_at::date;
  v_target := '/storefront/products';
  v_event_key := 'recently_available:' || v_today::text;

  -- Count products added today
  SELECT count(*) INTO v_count
  FROM public.products
  WHERE recently_available_at IS NOT NULL
    AND recently_available_at::date = v_today
    AND is_active = true AND is_visible = true;

  -- Get all Supreme Management
  v_supreme := public.fn_resolve_supreme_management_ids();

  -- Get all Sales Managers (role = مدير بيع)
  SELECT COALESCE(array_agg(DISTINCT er.employee_id), '{}'::uuid[])
  INTO v_managers
  FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE r.name = 'مدير بيع';

  -- Combined recipients (deduplicated)
  v_supreme := (
    SELECT array_agg(DISTINCT x) FROM (
      SELECT unnest(v_supreme) AS x
      UNION
      SELECT unnest(v_managers) AS x
    ) sub
  );

  -- Upsert: update count if notification already exists today, else create new
  PERFORM public.fn_create_notification_bulk(
    v_supreme, 'recently_available', 'وصل حديثًا',
    'تمت إضافة ' || v_count || ' منتجات جديدة',
    'product', NULL, v_target,
    v_event_key
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- 5a. Order status history
DROP TRIGGER IF EXISTS trg_notify_order_status_history ON public.order_status_history;
CREATE TRIGGER trg_notify_order_status_history
  AFTER INSERT ON public.order_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_order_status_history();

-- 5b. Customer created
DROP TRIGGER IF EXISTS trg_notify_customer_created ON public.customers;
CREATE TRIGGER trg_notify_customer_created
  AFTER INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_customer_created();

-- 5c. Visit completed
DROP TRIGGER IF EXISTS trg_notify_visit_completed ON public.visits;
CREATE TRIGGER trg_notify_visit_completed
  AFTER UPDATE ON public.visits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_visit_completed();

-- 5d. Attendance check-in
DROP TRIGGER IF EXISTS trg_notify_attendance_checkin ON public.workday_sessions;
CREATE TRIGGER trg_notify_attendance_checkin
  AFTER INSERT ON public.workday_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_attendance_checkin();

-- 5e. Attendance check-out
DROP TRIGGER IF EXISTS trg_notify_attendance_checkout ON public.workday_sessions;
CREATE TRIGGER trg_notify_attendance_checkout
  AFTER UPDATE ON public.workday_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_attendance_checkout();

-- 5f. Recently available
DROP TRIGGER IF EXISTS trg_notify_recently_available ON public.products;
CREATE TRIGGER trg_notify_recently_available
  AFTER UPDATE ON public.products
  FOR EACH ROW
  WHEN (NEW.recently_available_at IS DISTINCT FROM OLD.recently_available_at)
  EXECUTE FUNCTION public.fn_notify_recently_available();


-- ============================================================================
-- 6. RPCs — Inbox, Bell, Read Management
-- ============================================================================

-- 6a. Get my notifications (paginated, newest first)
CREATE OR REPLACE FUNCTION public.get_my_notifications(
  p_token uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;
  IF v_employee_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  RETURN (
    SELECT jsonb_build_object(
      'notifications', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'type', n.type,
            'title', n.title,
            'message', n.message,
            'entity_type', n.entity_type,
            'entity_id', n.entity_id,
            'target_path', n.target_path,
            'is_read', n.is_read,
            'created_at', n.created_at
          ) ORDER BY n.created_at DESC
        ),
        '[]'::jsonb
      ),
      'total', (SELECT count(*) FROM public.notifications WHERE recipient_employee_id = v_employee_id)
    )
    FROM (
      SELECT * FROM public.notifications
      WHERE recipient_employee_id = v_employee_id
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) n
  );
END;
$$;


-- 6b. Get unread count
CREATE OR REPLACE FUNCTION public.get_my_unread_count(
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_employee_id := v_session.employee_id;
  IF v_employee_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE recipient_employee_id = v_employee_id AND is_read = false;

  RETURN jsonb_build_object('count', v_count);
END;
$$;


-- 6c. Mark single notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_token uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_id AND recipient_employee_id = v_session.employee_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 6d. Mark all as read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
  v_updated integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  UPDATE public.notifications
  SET is_read = true
  WHERE recipient_employee_id = v_session.employee_id AND is_read = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'updated', v_updated);
END;
$$;


-- ============================================================================
-- 7. PUSH SUBSCRIPTION RPCs
-- ============================================================================

-- 7a. Save push subscription
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session app.sessions;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  INSERT INTO public.push_subscriptions (employee_id, endpoint, p256dh, auth_key, user_agent, last_used_at)
  VALUES (v_session.employee_id, p_endpoint, p_p256dh, p_auth, p_user_agent, now())
  ON CONFLICT (endpoint) DO UPDATE SET
    employee_id = v_session.employee_id,
    p256dh = EXCLUDED.p256dh,
    auth_key = EXCLUDED.auth_key,
    user_agent = EXCLUDED.user_agent,
    last_used_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 7b. Remove push subscription
CREATE OR REPLACE FUNCTION public.remove_push_subscription(
  p_endpoint text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
  RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_employee_isolation ON public.notifications
  FOR ALL
  USING (recipient_employee_id = app.current_employee_id())
  WITH CHECK (recipient_employee_id = app.current_employee_id());

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_employee_isolation ON public.push_subscriptions
  FOR ALL
  USING (employee_id = app.current_employee_id())
  WITH CHECK (employee_id = app.current_employee_id());


-- ============================================================================
-- 9. GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.notifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_notifications TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_unread_count TO anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription TO anon;
GRANT EXECUTE ON FUNCTION public.remove_push_subscription TO anon;
GRANT EXECUTE ON FUNCTION public.fn_create_notification TO anon;
