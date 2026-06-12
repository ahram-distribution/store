-- ============================================================================
-- HOTFIX: Governance security leak — subtree scoping for supervisors
-- Issue: #governance-leak
-- Date: 2026-06-18
--
-- Fixes:
--   1. get_governed_orders — add WHERE o.created_by = ANY(v_identity_ids)
--      OR o.customer_id IN (customers owned by subtree)
--   2. get_governed_employees — add WHERE e.id = ANY(v_subtree_ids)
--
-- Pattern: Same subtree governance used in get_governed_visits,
--   get_governed_collections, get_customer_analytics_list,
--   get_supervisor_dashboard
-- ============================================================================

-- ============================================================================
-- 1. Fix get_governed_orders — scope by subtree identity_ids + customer ownership
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_orders(
  p_token uuid, p_search text DEFAULT NULL, p_status varchar DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
  v_is_super_admin boolean; v_ali_id uuid; v_mahmoud_id uuid;
  v_subtree_ids uuid[]; v_identity_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Customer: own orders only
  IF v_session.identity_type = 'customer' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id,
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '',
      'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal,
      'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
      'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by,
      'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    WHERE o.created_by = v_session.identity_id
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Admin/Chairman: all orders
  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')
  ) INTO v_is_super_admin;
  IF v_is_super_admin THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'customer_id', o.customer_id,
      'customer_name', COALESCE(o.snapshot_customer_name, ''),
      'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
      'customer_address', COALESCE(o.snapshot_customer_address, ''),
      'customer_maps_url', '',
      'owner_type', o.owner_type, 'owner_id', o.owner_id,
      'owner_name', COALESCE(o.snapshot_owner_name, ''),
      'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
      'owner_address', COALESCE(o.snapshot_owner_address, ''),
      'status', o.status, 'subtotal', o.subtotal,
      'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
      'notes', o.notes, 'revision_number', o.revision_number,
      'created_by', o.created_by,
      'created_by_name', COALESCE(o.snapshot_sender_name, ''),
      'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
      'created_by_address', COALESCE(o.snapshot_sender_address, ''),
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
      'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
    ) ORDER BY o.created_at DESC) INTO v_result
    FROM orders o
    WHERE (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR o.status = p_status)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (p_created_by IS NULL OR o.created_by = p_created_by)
      AND (p_date_from IS NULL OR o.created_at >= p_date_from)
      AND (p_date_to IS NULL OR o.created_at <= p_date_to);
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Build subtree scope
  SELECT id INTO v_ali_id FROM public.employees WHERE code = 'WRQ1002' LIMIT 1;
  SELECT id INTO v_mahmoud_id FROM public.employees WHERE code = 'WRQ1004' LIMIT 1;
  IF v_session.employee_id IN (v_ali_id, v_mahmoud_id) THEN
    WITH RECURSIVE sub AS (
      SELECT e.id FROM public.employees e
        WHERE e.manager_id = (SELECT manager_id FROM public.employees WHERE id = v_ali_id)
      UNION ALL
      SELECT e.id FROM public.employees e JOIN sub s ON e.manager_id = s.id
    )
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_subtree_ids FROM sub;
  ELSE
    v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  END IF;

  -- Convert to identity_ids for created_by check
  SELECT COALESCE(array_agg(identity_id), '{}'::uuid[]) INTO v_identity_ids
  FROM public.employees WHERE id = ANY(v_subtree_ids);

  -- Scoped query: orders created by team OR orders for customers owned by team
  SELECT jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number,
    'customer_id', o.customer_id,
    'customer_name', COALESCE(o.snapshot_customer_name, ''),
    'customer_phone', COALESCE(o.snapshot_customer_phone, ''),
    'customer_address', COALESCE(o.snapshot_customer_address, ''),
    'customer_maps_url', '',
    'owner_type', o.owner_type, 'owner_id', o.owner_id,
    'owner_name', COALESCE(o.snapshot_owner_name, ''),
    'owner_phone', COALESCE(o.snapshot_owner_phone, ''),
    'owner_address', COALESCE(o.snapshot_owner_address, ''),
    'status', o.status, 'subtotal', o.subtotal,
    'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
    'notes', o.notes, 'revision_number', o.revision_number,
    'created_by', o.created_by,
    'created_by_name', COALESCE(o.snapshot_sender_name, ''),
    'created_by_phone', COALESCE(o.snapshot_sender_phone, ''),
    'created_by_address', COALESCE(o.snapshot_sender_address, ''),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'approved_at', o.approved_at, 'submitted_at', o.submitted_at,
    'item_count', (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  ) ORDER BY o.created_at DESC) INTO v_result
  FROM orders o
  WHERE (o.created_by = ANY(v_identity_ids)
      OR o.customer_id IN (SELECT c.id FROM public.customers c WHERE c.owner_id = ANY(v_subtree_ids)))
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
    AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_created_by IS NULL OR o.created_by = p_created_by)
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 2. Fix get_governed_employees — scope by subtree employee_ids
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_employees(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_session app.sessions; v_result jsonb;
  v_is_super_admin boolean; v_subtree_ids uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  -- Admin/Chairman: all employees
  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')
  ) INTO v_is_super_admin;
  IF v_is_super_admin THEN
    SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'identity_id', e.identity_id, 'code', e.code, 'full_name', e.full_name,
        'email', e.email, 'phone', i.phone, 'manager_id', e.manager_id,
        'is_active', e.is_active, 'address', e.address,
        'created_at', e.created_at,
        'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name))
             FROM employee_roles er JOIN roles r ON r.id = er.role_id
             WHERE er.employee_id = e.id), '[]'::jsonb),
        'role_names', COALESCE((SELECT string_agg(r.name, ', ')
             FROM employee_roles er JOIN roles r ON r.id = er.role_id
             WHERE er.employee_id = e.id), ''),
        'direct_capabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type))
             FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id
             WHERE ec.employee_id = e.id), '[]'::jsonb)
      ) ORDER BY e.created_at DESC
    ) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  -- Non-admin: subtree only
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);

  SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'identity_id', e.identity_id, 'code', e.code, 'full_name', e.full_name,
      'email', e.email, 'phone', i.phone, 'manager_id', e.manager_id,
      'is_active', e.is_active, 'address', e.address,
      'created_at', e.created_at,
      'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name))
           FROM employee_roles er JOIN roles r ON r.id = er.role_id
           WHERE er.employee_id = e.id), '[]'::jsonb),
      'role_names', COALESCE((SELECT string_agg(r.name, ', ')
           FROM employee_roles er JOIN roles r ON r.id = er.role_id
           WHERE er.employee_id = e.id), ''),
      'direct_capabilities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'grant_type', ec.grant_type))
           FROM employee_capabilities ec JOIN capabilities c ON c.id = ec.capability_id
           WHERE ec.employee_id = e.id), '[]'::jsonb)
    ) ORDER BY e.created_at DESC
  ) INTO v_result FROM employees e JOIN identities i ON i.id = e.identity_id
  WHERE e.id = ANY(v_subtree_ids);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
