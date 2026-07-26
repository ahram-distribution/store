-- =============================================================
-- FIX 1: Baseline timestamp — existing data = viewed
-- FIX 2: Customer visibility filter for unseen counts
-- =============================================================

-- 1. Baseline table: per-employee activation timestamp
CREATE TABLE IF NOT EXISTS public.employee_baselines (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  baseline_at timestamptz NOT NULL DEFAULT now()
);

-- 2. ensure_baseline: set baseline on first call, return it
CREATE OR REPLACE FUNCTION public.ensure_baseline(p_token uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp_id uuid;
  v_baseline timestamptz;
BEGIN
  SELECT e.id INTO v_emp_id
  FROM app.sessions s
  JOIN public.employees e ON e.identity_id = s.identity_id
  WHERE s.token = p_token AND s.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN RETURN now(); END IF;

  INSERT INTO public.employee_baselines (employee_id, baseline_at)
  VALUES (v_emp_id, now())
  ON CONFLICT (employee_id) DO NOTHING;

  SELECT baseline_at INTO v_baseline
  FROM public.employee_baselines
  WHERE employee_id = v_emp_id;

  RETURN v_baseline;
END;
$$;

-- 3. Updated get_unseen_order_ids: filter by baseline_at
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
  bl AS (
    SELECT COALESCE(b.baseline_at, now()) AS baseline_at
    FROM sess
    LEFT JOIN public.employee_baselines b ON b.employee_id = sess.emp_id
  ),
  vis AS (
    SELECT public.get_visible_employee_ids(p_token) AS ids
  )
  SELECT o.id
  FROM public.orders o, sess, bl, vis
  WHERE o.status IN ('reviewing', 'submitted', 'approved', 'preparing', 'prepared', 'dispatched')
    AND o.created_at >= bl.baseline_at
    AND (vis.ids IS NULL OR o.owner_id = ANY(vis.ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.employee_entity_views v
      WHERE v.employee_id = sess.emp_id
        AND v.entity_type = 'order'
        AND v.entity_id = o.id
    );
$$;

-- 4. Updated get_unseen_customer_ids: filter by baseline_at + visibility
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
  ),
  bl AS (
    SELECT COALESCE(b.baseline_at, now()) AS baseline_at
    FROM sess
    LEFT JOIN public.employee_baselines b ON b.employee_id = sess.emp_id
  ),
  vis AS (
    SELECT public.get_visible_employee_ids(p_token) AS ids
  )
  SELECT c.id
  FROM public.customers c, sess, bl, vis
  WHERE c.is_active = true
    AND c.created_at >= bl.baseline_at
    AND (vis.ids IS NULL OR c.owner_id = ANY(vis.ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.employee_entity_views v
      WHERE v.employee_id = sess.emp_id
        AND v.entity_type = 'customer'
        AND v.entity_id = c.id
    );
$$;

-- 5. Updated get_unseen_counts: filter by baseline_at + visibility
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
  bl AS (
    SELECT COALESCE(b.baseline_at, now()) AS baseline_at
    FROM sess
    LEFT JOIN public.employee_baselines b ON b.employee_id = sess.emp_id
  ),
  vis AS (
    SELECT public.get_visible_employee_ids(p_token) AS ids
  )
  SELECT json_build_object(
    'unseen_orders', (
      SELECT COUNT(*)::int
      FROM public.orders o, bl, vis
      WHERE o.status IN ('reviewing', 'submitted', 'approved', 'preparing', 'prepared', 'dispatched')
        AND o.created_at >= bl.baseline_at
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
      FROM public.customers c, bl, vis
      WHERE c.is_active = true
        AND c.created_at >= bl.baseline_at
        AND (vis.ids IS NULL OR c.owner_id = ANY(vis.ids))
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_entity_views v, sess
          WHERE v.employee_id = sess.emp_id
            AND v.entity_type = 'customer'
            AND v.entity_id = c.id
        )
    )
  );
$$;
