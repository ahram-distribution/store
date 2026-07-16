-- ============================================================================
-- Migration: Add Upper Management gate to all hierarchy-modification functions
-- 
-- Governance Rule: Only Upper Management may modify the organizational
-- hierarchy.
--
-- Affected functions:
--   1. governed_change_employee_manager    — changes manager_id
--   2. governed_create_employee            — adds employee nodes
--   3. governed_change_employee_role       — changes node level (promote/demote)
--   4. governed_deletion_execute_employees — removes employee nodes
-- ============================================================================

-- ============================================================================
-- 1. governed_change_employee_manager
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_change_employee_manager(
  p_token uuid,
  p_id uuid,
  p_manager_id uuid
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

  -- Only Upper Management may modify the organizational hierarchy
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'UPPER_MANAGEMENT_ONLY');
  END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  -- Prevent self-manager
  IF p_id = p_manager_id THEN RETURN jsonb_build_object('error', 'SELF_MANAGER'); END IF;

  UPDATE public.employees SET manager_id = p_manager_id, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_change_employee_manager IS 'تغيير المدير المسؤول للموظف — فقط الإدارة العليا';

-- ============================================================================
-- 2. governed_create_employee
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_create_employee(
  p_token uuid,
  p_full_name varchar,
  p_phone varchar,
  p_password varchar DEFAULT NULL,
  p_email varchar DEFAULT NULL,
  p_role_id uuid DEFAULT NULL,
  p_manager_id uuid DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
  v_identity_id uuid;
  v_code varchar(20);
  v_year integer := EXTRACT(YEAR FROM now());
  v_seq integer;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Only Upper Management may create employees (add nodes to the hierarchy)
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'UPPER_MANAGEMENT_ONLY');
  END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN jsonb_build_object('error', 'PHONE_EXISTS');
  END IF;

  INSERT INTO public.code_sequences (code_type, year, last_sequence)
  VALUES ('employee', v_year, 1)
  ON CONFLICT (code_type, year)
  DO UPDATE SET last_sequence = code_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  v_code := 'EMP-' || v_year::text || '-' || LPAD(v_seq::text, 6, '0');
  v_identity_id := gen_random_uuid();
  v_employee_id := gen_random_uuid();

  INSERT INTO public.identities (id, phone, password_hash, identity_type, is_active)
  VALUES (
    v_identity_id,
    p_phone,
    extensions.crypt(COALESCE(p_password, p_phone), extensions.gen_salt('bf')),
    'employee',
    true
  );

  INSERT INTO public.employees (id, identity_id, code, full_name, email, manager_id, address, is_active)
  VALUES (v_employee_id, v_identity_id, v_code, p_full_name, p_email, p_manager_id, p_address, true);

  IF p_role_id IS NOT NULL THEN
    INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
    VALUES (v_employee_id, p_role_id, v_session.employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_employee_id,
    'code', v_code,
    'full_name', p_full_name
  );
END;
$$;

COMMENT ON FUNCTION public.governed_create_employee IS 'إضافة موظف جديد — فقط الإدارة العليا';

-- ============================================================================
-- 3. governed_change_employee_role
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_change_employee_role(
  p_token uuid,
  p_id uuid,
  p_role_id uuid
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

  -- Only Upper Management may promote or demote employees (change hierarchy level)
  IF NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'UPPER_MANAGEMENT_ONLY');
  END IF;

  PERFORM check_capability(p_token, 'employees.manage');

  -- Remove existing roles
  DELETE FROM public.employee_roles WHERE employee_id = p_id;

  -- Assign new role
  INSERT INTO public.employee_roles (employee_id, role_id, assigned_by)
  VALUES (p_id, p_role_id, v_session.employee_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.governed_change_employee_role IS 'تغيير صلاحية الموظف — فقط الإدارة العليا';

-- ============================================================================
-- 4. governed_deletion_execute_employees
-- ============================================================================
CREATE OR REPLACE FUNCTION public.governed_deletion_execute_employees(
    p_token uuid,
    p_ids uuid[],
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_related jsonb;
    v_deleted_count int := 0;
    v_audit_id uuid;
    v_emp_id uuid;
    v_order_ids uuid[];
    v_customer_ids uuid[];
    v_error_msg text;
    v_constraint text;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- Only Upper Management may delete employees (remove nodes from the hierarchy)
    IF NOT public.is_upper_management(v_session.employee_id) THEN
        RETURN jsonb_build_object('error', 'UPPER_MANAGEMENT_ONLY');
    END IF;

    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Get order and customer IDs for transitive cascade
    v_order_ids := public._emp_cascade_order_ids(p_ids);
    v_customer_ids := public._emp_cascade_customer_ids(p_ids);

    -- Build comprehensive related counts for preview
    SELECT jsonb_build_object(
        'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets x WHERE x.employee_id = ANY(p_ids)),
        'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides x WHERE x.employee_id = ANY(p_ids)),
        'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies x WHERE x.employee_id = ANY(p_ids) OR x.updated_by = ANY(p_ids)),
        'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances x WHERE x.employee_id = ANY(p_ids) OR x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        'app_sessions', (SELECT COUNT(*)::int FROM app.sessions x WHERE x.employee_id = ANY(p_ids)),
        'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points x WHERE x.employee_id = ANY(p_ids)),
        'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks x WHERE x.employee_id = ANY(p_ids)),
        'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions x WHERE x.employee_id = ANY(p_ids)),
        'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log x WHERE x.employee_id = ANY(p_ids)),
        'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log x WHERE x.employee_id = ANY(p_ids)),
        'tracking_cleanup_log', (SELECT COUNT(*)::int FROM public.tracking_cleanup_log x WHERE x.executed_by = ANY(p_ids)),
        'visits', (SELECT COUNT(*)::int FROM public.visits x WHERE x.employee_id = ANY(p_ids)),
        'visit_links', (SELECT COUNT(*)::int FROM public.visit_links x WHERE x.visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids)) OR x.session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids))),
        'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_to = ANY(p_ids) OR x.assigned_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records x WHERE x.started_by = ANY(p_ids) OR x.completed_by = ANY(p_ids) OR x.cancelled_by = ANY(p_ids) OR x.reviewed_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions x WHERE x.created_by = ANY(p_ids) OR (x.reference_type = 'collection' AND x.reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids) OR order_id = ANY(v_order_ids)))),
        'collections', (SELECT COUNT(*)::int FROM public.collections x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'expenses', (SELECT COUNT(*)::int FROM public.expenses x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns x WHERE x.created_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'return_items', (SELECT COUNT(*)::int FROM public.return_items x WHERE x.return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids) OR order_id = ANY(v_order_ids) OR customer_id = ANY(v_customer_ids))),
        'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection x WHERE x.inspected_by = ANY(p_ids)),
        'orders', (SELECT COUNT(*)::int FROM public.orders x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'order_items', (SELECT COUNT(*)::int FROM public.order_items x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_status_history', (SELECT COUNT(*)::int FROM public.order_status_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_modification_history', (SELECT COUNT(*)::int FROM public.order_modification_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'customers', (SELECT COUNT(*)::int FROM public.customers x WHERE x.owner_id = ANY(p_ids) OR (x.id = ANY(v_customer_ids))),
        'customer_addresses', (SELECT COUNT(*)::int FROM public.customer_addresses x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_contacts', (SELECT COUNT(*)::int FROM public.customer_contacts x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_ownership_history', (SELECT COUNT(*)::int FROM public.customer_ownership_history x WHERE x.customer_id = ANY(v_customer_ids) OR x.previous_owner_id = ANY(p_ids) OR x.new_owner_id = ANY(p_ids) OR x.changed_by = ANY(p_ids)),
        'credit_applications', (SELECT COUNT(*)::int FROM public.credit_applications x WHERE x.created_by = ANY(p_ids) OR x.doc_confirmed_by = ANY(p_ids) OR x.reviewed_by = ANY(p_ids) OR x.approved_by = ANY(p_ids) OR x.suspended_by = ANY(p_ids)),
        'credit_contracts', (SELECT COUNT(*)::int FROM public.credit_contracts x WHERE x.verified_by = ANY(p_ids)),
        'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts x WHERE x.activated_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices x WHERE x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'credit_invoice_cheques', (SELECT COUNT(*)::int FROM public.credit_invoice_cheques x WHERE x.recorded_by = ANY(p_ids) OR x.invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(v_order_ids) OR customer_id = ANY(v_customer_ids))),
        'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions x WHERE x.assigned_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'daily_deals', (SELECT COUNT(*)::int FROM public.daily_deals x WHERE x.created_by = ANY(p_ids)),
        'flash_offers', (SELECT COUNT(*)::int FROM public.flash_offers x WHERE x.created_by = ANY(p_ids)),
        'packages', 0,
        'auctions', (SELECT COUNT(*)::int FROM public.auctions x WHERE x.created_by = ANY(p_ids)),
        'auction_participants', (SELECT COUNT(*)::int FROM public.auction_participants x WHERE x.approved_by = ANY(p_ids)),
        'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards x WHERE x.awarded_by = ANY(p_ids)),
        'deletion_audit_log', (SELECT COUNT(*)::int FROM public.deletion_audit_log x WHERE x.employee_id = ANY(p_ids)),
        'managed_employees', (SELECT COUNT(*)::int FROM public.employees x WHERE x.manager_id = ANY(p_ids)),
        'identities', (SELECT COUNT(*)::int FROM public.identities x WHERE x.id IN (SELECT identity_id FROM public.employees WHERE id = ANY(p_ids)))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- ========== EXECUTE CASCADE DELETE ==========
    BEGIN
        DELETE FROM public.employee_roles WHERE employee_id = ANY(p_ids) OR assigned_by = ANY(p_ids);
        DELETE FROM public.employee_capabilities WHERE employee_id = ANY(p_ids) OR assigned_by = ANY(p_ids);
        DELETE FROM public.employee_monthly_targets WHERE employee_id = ANY(p_ids);
        DELETE FROM public.employee_weight_overrides WHERE employee_id = ANY(p_ids);
        DELETE FROM public.employee_work_policies WHERE employee_id = ANY(p_ids) OR updated_by = ANY(p_ids);
        DELETE FROM public.employee_advances WHERE employee_id = ANY(p_ids) OR created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
        DELETE FROM public.tracking_points WHERE employee_id = ANY(p_ids);
        DELETE FROM public.workday_breaks WHERE employee_id = ANY(p_ids);
        DELETE FROM public.attendance_audit_log WHERE employee_id = ANY(p_ids);
        DELETE FROM public.session_recovery_log WHERE employee_id = ANY(p_ids);
        DELETE FROM public.tracking_cleanup_log WHERE executed_by = ANY(p_ids);
        DELETE FROM public.deletion_audit_log WHERE employee_id = ANY(p_ids);
        DELETE FROM app.sessions WHERE employee_id = ANY(p_ids);
        DELETE FROM public.tier_exceptions WHERE assigned_by = ANY(p_ids);
        DELETE FROM public.daily_deals WHERE created_by = ANY(p_ids);
        DELETE FROM public.flash_offers WHERE created_by = ANY(p_ids);
        -- packages table skipped — not deployed in production
        DELETE FROM public.credit_contracts WHERE verified_by = ANY(p_ids);
        DELETE FROM public.credit_applications WHERE created_by = ANY(p_ids) OR doc_confirmed_by = ANY(p_ids) OR reviewed_by = ANY(p_ids) OR approved_by = ANY(p_ids) OR suspended_by = ANY(p_ids);
        DELETE FROM public.customer_credit_ledger WHERE created_by = ANY(p_ids);
        DELETE FROM public.customer_credit_accounts WHERE activated_by = ANY(p_ids);
        DELETE FROM public.expenses WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
        DELETE FROM public.treasury_transactions WHERE created_by = ANY(p_ids);
        DELETE FROM public.return_inspection WHERE inspected_by = ANY(p_ids);

        DELETE FROM public.visit_links WHERE visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids));
        DELETE FROM public.visits WHERE employee_id = ANY(p_ids);

        DELETE FROM public.visit_links WHERE session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids));
        DELETE FROM public.workday_sessions WHERE employee_id = ANY(p_ids);

        DELETE FROM public.delivery_tracking WHERE assigned_to = ANY(p_ids) OR assigned_by = ANY(p_ids);

        DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids));
        DELETE FROM public.returns WHERE created_by = ANY(p_ids);

        DELETE FROM public.treasury_transactions
        WHERE reference_type = 'collection'
          AND reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids));
        DELETE FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);

        DELETE FROM public.customer_ownership_history WHERE previous_owner_id = ANY(p_ids) OR new_owner_id = ANY(p_ids) OR changed_by = ANY(p_ids);

        DELETE FROM public.credit_invoice_cheques WHERE recorded_by = ANY(p_ids);

        DELETE FROM public.auction_awards WHERE awarded_by = ANY(p_ids);
        DELETE FROM public.auction_participants WHERE approved_by = ANY(p_ids);
        DELETE FROM public.auctions WHERE created_by = ANY(p_ids);

        IF array_length(v_order_ids, 1) > 0 THEN
            DELETE FROM public.order_daily_deals WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_flash_offers WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_items WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_status_history WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_modification_history WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.delivery_tracking WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.preparation_records WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.returns WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.treasury_transactions
            WHERE reference_type = 'collection'
              AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.collections WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.credit_invoices WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.orders WHERE id = ANY(v_order_ids);
        END IF;

        IF array_length(v_customer_ids, 1) > 0 THEN
            DELETE FROM public.order_daily_deals WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_flash_offers WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_status_history WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.order_modification_history WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.delivery_tracking WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.preparation_records WHERE order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids));
            DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE customer_id = ANY(v_customer_ids));
            DELETE FROM public.returns WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.treasury_transactions WHERE reference_type = 'collection' AND reference_id IN (SELECT id FROM public.collections WHERE customer_id = ANY(v_customer_ids));
            DELETE FROM public.collections WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE customer_id = ANY(v_customer_ids));
            DELETE FROM public.credit_invoices WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.orders WHERE customer_id = ANY(v_customer_ids) AND created_by != ALL(p_ids);
            DELETE FROM public.customer_addresses WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_contacts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_accounts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_ledger WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.tier_exceptions WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_ownership_history WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customers WHERE id = ANY(v_customer_ids);
        END IF;

        -- Clear manager_id for subordinates of deleted employees
        UPDATE public.employees SET manager_id = NULL WHERE manager_id = ANY(p_ids);

        v_deleted_count := 0;
        FOREACH v_emp_id IN ARRAY p_ids LOOP
            DELETE FROM public.identities WHERE id = (SELECT identity_id FROM public.employees WHERE id = v_emp_id);
            DELETE FROM public.employees WHERE id = v_emp_id;
            IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
        END LOOP;

        INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
        VALUES (v_session.employee_id, 'employees', p_ids, v_deleted_count, v_related)
        RETURNING id INTO v_audit_id;

        RETURN jsonb_build_object('preview', false, 'deleted_count', v_deleted_count, 'audit_id', v_audit_id);

    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        v_error_msg := SQLERRM;
        RETURN jsonb_build_object(
            'error', 'FK_CONSTRAINT',
            'detail', CASE WHEN v_constraint IS NOT NULL THEN 'القيود المانعة: ' || v_constraint ELSE v_error_msg END,
            'constraint', v_constraint,
            'message', v_error_msg
        );
    END;
END;
$function$;

COMMENT ON FUNCTION public.governed_deletion_execute_employees IS 'حذف موظفين مع جميع البيانات المرتبطة — فقط الإدارة العليا';
