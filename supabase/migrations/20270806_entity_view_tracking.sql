-- =============================================================
-- VISUAL STATE FOR UNSEEN CUSTOMERS AND ORDERS
-- Tracks per-user viewed state for orders & customers.
-- Home badges now show unseen counts instead of raw totals.
-- =============================================================

-- 1. Table: per-user entity view tracking
CREATE TABLE IF NOT EXISTS public.employee_entity_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('order', 'customer')),
  entity_id   uuid NOT NULL,
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_eev_emp_type ON public.employee_entity_views(employee_id, entity_type);

ALTER TABLE public.employee_entity_views ENABLE ROW LEVEL SECURITY;

-- 2. RPC: mark an entity as viewed (idempotent)
CREATE OR REPLACE FUNCTION public.mark_entity_viewed(
  p_token uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp_id uuid;
BEGIN
  SELECT e.id INTO v_emp_id
  FROM app.sessions s
  JOIN public.employees e ON e.identity_id = s.identity_id
  WHERE s.token = p_token AND s.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.employee_entity_views (employee_id, entity_type, entity_id)
  VALUES (v_emp_id, p_entity_type, p_entity_id)
  ON CONFLICT (employee_id, entity_type, entity_id) DO NOTHING;
END;
$$;

-- 3. RPC: get unseen order IDs for current user (pending orders not yet viewed)
CREATE OR REPLACE FUNCTION public.get_unseen_order_ids(p_token uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH sess AS (
    SELECT e.id AS emp_id
    FROM app.sessions s
    JOIN public.employees e ON e.identity_id = s.identity_id
    WHERE s.token = p_token AND s.expires_at > now()
    LIMIT 1
  ),
  vis AS (
    SELECT public.get_visible_employee_ids(p_token) AS ids
  )
  SELECT o.id
  FROM public.orders o, sess, vis
  WHERE o.status IN ('reviewing', 'submitted', 'approved', 'preparing', 'prepared', 'dispatched')
    AND (vis.ids IS NULL OR o.owner_id = ANY(vis.ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.employee_entity_views v
      WHERE v.employee_id = sess.emp_id
        AND v.entity_type = 'order'
        AND v.entity_id = o.id
    );
$$;

-- 4. RPC: get unseen customer IDs for current user (active customers not yet viewed)
CREATE OR REPLACE FUNCTION public.get_unseen_customer_ids(p_token uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH sess AS (
    SELECT e.id AS emp_id
    FROM app.sessions s
    JOIN public.employees e ON e.identity_id = s.identity_id
    WHERE s.token = p_token AND s.expires_at > now()
    LIMIT 1
  )
  SELECT c.id
  FROM public.customers c, sess
  WHERE c.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.employee_entity_views v
      WHERE v.employee_id = sess.emp_id
        AND v.entity_type = 'customer'
        AND v.entity_id = c.id
    );
$$;

-- 5. RPC: unseen counts for dashboard badges (lightweight, for UpperManagementDashboard)
CREATE OR REPLACE FUNCTION public.get_unseen_counts(p_token uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH sess AS (
    SELECT e.id AS emp_id
    FROM app.sessions s
    JOIN public.employees e ON e.identity_id = s.identity_id
    WHERE s.token = p_token AND s.expires_at > now()
    LIMIT 1
  ),
  vis AS (
    SELECT public.get_visible_employee_ids(p_token) AS ids
  )
  SELECT json_build_object(
    'unseen_orders', (
      SELECT COUNT(*)::int
      FROM public.orders o, vis
      WHERE o.status IN ('reviewing', 'submitted', 'approved', 'preparing', 'prepared', 'dispatched')
        AND (vis.ids IS NULL OR o.owner_id = ANY(vis.ids))
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_entity_views v, sess
          WHERE v.employee_id = sess.emp_id
            AND v.entity_type = 'order'
            AND v.entity_id = o.id
        )
    ),
    'unseen_customers', (
      SELECT COUNT(*)::int
      FROM public.customers c, sess
      WHERE c.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_entity_views v
          WHERE v.employee_id = sess.emp_id
            AND v.entity_type = 'customer'
            AND v.entity_id = c.id
        )
    )
  );
$$;
