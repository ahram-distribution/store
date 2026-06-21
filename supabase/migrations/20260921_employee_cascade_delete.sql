-- ============================================================================
-- Employee Cascade Delete Enhancement
-- Removes all FK blocking, cascade deletes every related record
-- ============================================================================

-- Helper: Get all order IDs created by the given employees
CREATE OR REPLACE FUNCTION public._emp_cascade_order_ids(p_ids uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT ARRAY(SELECT id FROM public.orders WHERE created_by = ANY(p_ids))
$$;

-- Helper: Get all customer IDs owned by the given employees
CREATE OR REPLACE FUNCTION public._emp_cascade_customer_ids(p_ids uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT ARRAY(SELECT id FROM public.customers WHERE owner_id = ANY(p_ids))
$$;

-- 1. Replace search RPC to show full FK relationship counts
CREATE OR REPLACE FUNCTION public.governed_deletion_search_employees(
    p_token uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_data jsonb;
    v_total int;
    v_oid uuid[];
    v_cid uuid[];
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', e.full_name,
        'code', e.code,
        'status', CASE WHEN e.is_active THEN 'active' ELSE 'inactive' END,
        'created_at', e.created_at,
        'related_counts', jsonb_build_object(
            -- Employee-specific tables
            'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles x WHERE x.employee_id = e.id),
            'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities x WHERE x.employee_id = e.id),
            'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets x WHERE x.employee_id = e.id),
            'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides x WHERE x.employee_id = e.id),
            'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies x WHERE x.employee_id = e.id),
            'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances x WHERE x.employee_id = e.id OR x.created_by = e.id OR x.approved_by = e.id),
            -- Attendance & tracking
            'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions x WHERE x.employee_id = e.id),
            'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks x WHERE x.employee_id = e.id),
            'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points x WHERE x.employee_id = e.id),
            'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log x WHERE x.employee_id = e.id),
            'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log x WHERE x.employee_id = e.id),
            'tracking_cleanup_log', (SELECT COUNT(*)::int FROM public.tracking_cleanup_log x WHERE x.executed_by = e.id),
            -- Field work
            'visits', (SELECT COUNT(*)::int FROM public.visits x WHERE x.employee_id = e.id),
            'delivery_tracking_assigned_to', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_to = e.id),
            'delivery_tracking_assigned_by', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_by = e.id),
            'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records x WHERE x.started_by = e.id OR x.completed_by = e.id OR x.cancelled_by = e.id OR x.reviewed_by = e.id),
            'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection x WHERE x.inspected_by = e.id),
            -- Financial
            'collections_created_by', (SELECT COUNT(*)::int FROM public.collections x WHERE x.created_by = e.id),
            'collections_approved_by', (SELECT COUNT(*)::int FROM public.collections x WHERE x.approved_by = e.id),
            'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions x WHERE x.created_by = e.id),
            'expenses', (SELECT COUNT(*)::int FROM public.expenses x WHERE x.created_by = e.id OR x.approved_by = e.id),
            'returns', (SELECT COUNT(*)::int FROM public.returns x WHERE x.created_by = e.id),
            -- Credit
            'credit_applications', (SELECT COUNT(*)::int FROM public.credit_applications x WHERE x.created_by = e.id OR x.doc_confirmed_by = e.id OR x.reviewed_by = e.id OR x.approved_by = e.id OR x.suspended_by = e.id),
            'credit_contracts', (SELECT COUNT(*)::int FROM public.credit_contracts x WHERE x.verified_by = e.id),
            'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger x WHERE x.created_by = e.id),
            'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts x WHERE x.activated_by = e.id),
            'credit_invoice_cheques', (SELECT COUNT(*)::int FROM public.credit_invoice_cheques x WHERE x.recorded_by = e.id),
            'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions x WHERE x.assigned_by = e.id),
            -- Products & deals
            'daily_deals', (SELECT COUNT(*)::int FROM public.daily_deals x WHERE x.created_by = e.id),
            'flash_offers', (SELECT COUNT(*)::int FROM public.flash_offers x WHERE x.created_by = e.id),
            'packages', (SELECT COUNT(*)::int FROM public.packages x WHERE x.created_by = e.id),
            -- Auctions
            'auctions', (SELECT COUNT(*)::int FROM public.auctions x WHERE x.created_by = e.id),
            'auction_participants', (SELECT COUNT(*)::int FROM public.auction_participants x WHERE x.approved_by = e.id),
            'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards x WHERE x.awarded_by = e.id),
            -- Ownership & customers
            'customer_ownership_history', (SELECT COUNT(*)::int FROM public.customer_ownership_history x WHERE x.previous_owner_id = e.id OR x.new_owner_id = e.id OR x.changed_by = e.id),
            'customers_owner', (SELECT COUNT(*)::int FROM public.customers x WHERE x.owner_id = e.id),
            -- Orders
            'orders', (SELECT COUNT(*)::int FROM public.orders x WHERE x.created_by = e.id),
            -- App sessions
            'app_sessions', (SELECT COUNT(*)::int FROM app.sessions x WHERE x.employee_id = e.id),
            -- Self
            'managed_employees', (SELECT COUNT(*)::int FROM public.employees x WHERE x.manager_id = e.id)
        )
    ) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_data
    FROM public.employees e
    WHERE (p_search IS NULL OR e.full_name ILIKE '%' || p_search || '%' OR e.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN e.is_active = true ELSE e.is_active = false END))
      AND (p_date_from IS NULL OR e.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR e.created_at < (p_date_to + 1)::timestamptz);

    SELECT COUNT(*)::int INTO v_total
    FROM public.employees e
    WHERE (p_search IS NULL OR e.full_name ILIKE '%' || p_search || '%' OR e.code ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR (CASE WHEN p_status = 'active' THEN e.is_active = true ELSE e.is_active = false END))
      AND (p_date_from IS NULL OR e.created_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR e.created_at < (p_date_to + 1)::timestamptz);

    RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$function$;

-- 2. Replace execute RPC with full cascade delete
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
    IF NOT public.check_capability(p_token, 'data.deletion_center') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Get order and customer IDs for transitive cascade
    v_order_ids := public._emp_cascade_order_ids(p_ids);
    v_customer_ids := public._emp_cascade_customer_ids(p_ids);

    -- Build comprehensive related counts for preview
    SELECT jsonb_build_object(
        -- Employee-specific tables
        'employee_roles', (SELECT COUNT(*)::int FROM public.employee_roles x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_capabilities', (SELECT COUNT(*)::int FROM public.employee_capabilities x WHERE x.employee_id = ANY(p_ids) OR x.assigned_by = ANY(p_ids)),
        'employee_monthly_targets', (SELECT COUNT(*)::int FROM public.employee_monthly_targets x WHERE x.employee_id = ANY(p_ids)),
        'employee_weight_overrides', (SELECT COUNT(*)::int FROM public.employee_weight_overrides x WHERE x.employee_id = ANY(p_ids)),
        'employee_work_policies', (SELECT COUNT(*)::int FROM public.employee_work_policies x WHERE x.employee_id = ANY(p_ids) OR x.updated_by = ANY(p_ids)),
        'employee_advances', (SELECT COUNT(*)::int FROM public.employee_advances x WHERE x.employee_id = ANY(p_ids) OR x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        -- Attendance & tracking
        'app_sessions', (SELECT COUNT(*)::int FROM app.sessions x WHERE x.employee_id = ANY(p_ids)),
        'tracking_points', (SELECT COUNT(*)::int FROM public.tracking_points x WHERE x.employee_id = ANY(p_ids)),
        'workday_breaks', (SELECT COUNT(*)::int FROM public.workday_breaks x WHERE x.employee_id = ANY(p_ids)),
        'workday_sessions', (SELECT COUNT(*)::int FROM public.workday_sessions x WHERE x.employee_id = ANY(p_ids)),
        'attendance_audit_log', (SELECT COUNT(*)::int FROM public.attendance_audit_log x WHERE x.employee_id = ANY(p_ids)),
        'session_recovery_log', (SELECT COUNT(*)::int FROM public.session_recovery_log x WHERE x.employee_id = ANY(p_ids)),
        'tracking_cleanup_log', (SELECT COUNT(*)::int FROM public.tracking_cleanup_log x WHERE x.executed_by = ANY(p_ids)),
        -- Field work
        'visits', (SELECT COUNT(*)::int FROM public.visits x WHERE x.employee_id = ANY(p_ids)),
        'visit_links', (SELECT COUNT(*)::int FROM public.visit_links x WHERE x.visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids)) OR x.session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids))),
        'delivery_tracking', (SELECT COUNT(*)::int FROM public.delivery_tracking x WHERE x.assigned_to = ANY(p_ids) OR x.assigned_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        'preparation_records', (SELECT COUNT(*)::int FROM public.preparation_records x WHERE x.started_by = ANY(p_ids) OR x.completed_by = ANY(p_ids) OR x.cancelled_by = ANY(p_ids) OR x.reviewed_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids)),
        -- Financial
        'treasury_transactions', (SELECT COUNT(*)::int FROM public.treasury_transactions x WHERE x.created_by = ANY(p_ids) OR (x.reference_type = 'collection' AND x.reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids) OR order_id = ANY(v_order_ids)))),
        'collections', (SELECT COUNT(*)::int FROM public.collections x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'expenses', (SELECT COUNT(*)::int FROM public.expenses x WHERE x.created_by = ANY(p_ids) OR x.approved_by = ANY(p_ids)),
        'returns', (SELECT COUNT(*)::int FROM public.returns x WHERE x.created_by = ANY(p_ids) OR x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'return_items', (SELECT COUNT(*)::int FROM public.return_items x WHERE x.return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids) OR order_id = ANY(v_order_ids) OR customer_id = ANY(v_customer_ids))),
        'return_inspection', (SELECT COUNT(*)::int FROM public.return_inspection x WHERE x.inspected_by = ANY(p_ids)),
        -- Orders (transitive)
        'orders', (SELECT COUNT(*)::int FROM public.orders x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'order_items', (SELECT COUNT(*)::int FROM public.order_items x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_status_history', (SELECT COUNT(*)::int FROM public.order_status_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_modification_history', (SELECT COUNT(*)::int FROM public.order_modification_history x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_daily_deals', (SELECT COUNT(*)::int FROM public.order_daily_deals x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        'order_flash_offers', (SELECT COUNT(*)::int FROM public.order_flash_offers x WHERE x.order_id = ANY(v_order_ids) OR x.order_id IN (SELECT id FROM public.orders WHERE customer_id = ANY(v_customer_ids))),
        -- Customers (transitive)
        'customers', (SELECT COUNT(*)::int FROM public.customers x WHERE x.owner_id = ANY(p_ids) OR (x.id = ANY(v_customer_ids))),
        'customer_addresses', (SELECT COUNT(*)::int FROM public.customer_addresses x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_contacts', (SELECT COUNT(*)::int FROM public.customer_contacts x WHERE x.customer_id = ANY(v_customer_ids)),
        'customer_ownership_history', (SELECT COUNT(*)::int FROM public.customer_ownership_history x WHERE x.customer_id = ANY(v_customer_ids) OR x.previous_owner_id = ANY(p_ids) OR x.new_owner_id = ANY(p_ids) OR x.changed_by = ANY(p_ids)),
        -- Credit
        'credit_applications', (SELECT COUNT(*)::int FROM public.credit_applications x WHERE x.created_by = ANY(p_ids) OR x.doc_confirmed_by = ANY(p_ids) OR x.reviewed_by = ANY(p_ids) OR x.approved_by = ANY(p_ids) OR x.suspended_by = ANY(p_ids)),
        'credit_contracts', (SELECT COUNT(*)::int FROM public.credit_contracts x WHERE x.verified_by = ANY(p_ids)),
        'customer_credit_ledger', (SELECT COUNT(*)::int FROM public.customer_credit_ledger x WHERE x.created_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'customer_credit_accounts', (SELECT COUNT(*)::int FROM public.customer_credit_accounts x WHERE x.activated_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        'credit_invoices', (SELECT COUNT(*)::int FROM public.credit_invoices x WHERE x.order_id = ANY(v_order_ids) OR x.customer_id = ANY(v_customer_ids)),
        'credit_invoice_cheques', (SELECT COUNT(*)::int FROM public.credit_invoice_cheques x WHERE x.recorded_by = ANY(p_ids) OR x.invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(v_order_ids) OR customer_id = ANY(v_customer_ids))),
        'tier_exceptions', (SELECT COUNT(*)::int FROM public.tier_exceptions x WHERE x.assigned_by = ANY(p_ids) OR x.customer_id = ANY(v_customer_ids)),
        -- Products & deals
        'daily_deals', (SELECT COUNT(*)::int FROM public.daily_deals x WHERE x.created_by = ANY(p_ids)),
        'flash_offers', (SELECT COUNT(*)::int FROM public.flash_offers x WHERE x.created_by = ANY(p_ids)),
        'packages', (SELECT COUNT(*)::int FROM public.packages x WHERE x.created_by = ANY(p_ids)),
        -- Auctions
        'auctions', (SELECT COUNT(*)::int FROM public.auctions x WHERE x.created_by = ANY(p_ids)),
        'auction_participants', (SELECT COUNT(*)::int FROM public.auction_participants x WHERE x.approved_by = ANY(p_ids)),
        'auction_awards', (SELECT COUNT(*)::int FROM public.auction_awards x WHERE x.awarded_by = ANY(p_ids)),
        -- Deletion audit (self)
        'deletion_audit_log', (SELECT COUNT(*)::int FROM public.deletion_audit_log x WHERE x.employee_id = ANY(p_ids)),
        -- Managed employees (self-ref via manager_id)
        'managed_employees', (SELECT COUNT(*)::int FROM public.employees x WHERE x.manager_id = ANY(p_ids)),
        -- Identity
        'identities', (SELECT COUNT(*)::int FROM public.identities x WHERE x.id IN (SELECT identity_id FROM public.employees WHERE id = ANY(p_ids)))
    ) INTO v_related;

    IF p_dry_run THEN
        RETURN jsonb_build_object('preview', true, 'direct_count', array_length(p_ids, 1), 'related', v_related);
    END IF;

    -- ========== EXECUTE CASCADE DELETE ==========
    BEGIN
        -- 1. Employee-specific tables (no transitive dependencies)
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
        DELETE FROM public.packages WHERE created_by = ANY(p_ids);
        DELETE FROM public.credit_contracts WHERE verified_by = ANY(p_ids);
        DELETE FROM public.credit_applications WHERE created_by = ANY(p_ids) OR doc_confirmed_by = ANY(p_ids) OR reviewed_by = ANY(p_ids) OR approved_by = ANY(p_ids) OR suspended_by = ANY(p_ids);
        DELETE FROM public.customer_credit_ledger WHERE created_by = ANY(p_ids);
        DELETE FROM public.customer_credit_accounts WHERE activated_by = ANY(p_ids);
        DELETE FROM public.expenses WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);
        DELETE FROM public.treasury_transactions WHERE created_by = ANY(p_ids);
        DELETE FROM public.return_inspection WHERE inspected_by = ANY(p_ids);

        -- 2. Visits (employee_id) and their visit_links
        DELETE FROM public.visit_links WHERE visit_id IN (SELECT id FROM public.visits WHERE employee_id = ANY(p_ids));
        DELETE FROM public.visits WHERE employee_id = ANY(p_ids);

        -- 3. Workday sessions (employee_id) and their children
        DELETE FROM public.visit_links WHERE session_id IN (SELECT id FROM public.workday_sessions WHERE employee_id = ANY(p_ids));
        DELETE FROM public.workday_sessions WHERE employee_id = ANY(p_ids);

        -- 4. Delivery tracking (assigned_to, assigned_by)
        DELETE FROM public.delivery_tracking WHERE assigned_to = ANY(p_ids) OR assigned_by = ANY(p_ids);

        -- 5. Returns created by employee (also cascades through orders)
        DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE created_by = ANY(p_ids));
        DELETE FROM public.returns WHERE created_by = ANY(p_ids);

        -- 6. Collections by employee
        DELETE FROM public.treasury_transactions
        WHERE reference_type = 'collection'
          AND reference_id IN (SELECT id FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids));
        DELETE FROM public.collections WHERE created_by = ANY(p_ids) OR approved_by = ANY(p_ids);

        -- 7. Customer ownership history (direct employee refs)
        DELETE FROM public.customer_ownership_history WHERE previous_owner_id = ANY(p_ids) OR new_owner_id = ANY(p_ids) OR changed_by = ANY(p_ids);

        -- 8. Credit invoice cheques recorded by employee
        DELETE FROM public.credit_invoice_cheques WHERE recorded_by = ANY(p_ids);

        -- 9. Auctions by employee
        DELETE FROM public.auction_awards WHERE awarded_by = ANY(p_ids);
        DELETE FROM public.auction_participants WHERE approved_by = ANY(p_ids);
        DELETE FROM public.auctions WHERE created_by = ANY(p_ids);

        -- 10. Transitive: Orders created by employee
        IF array_length(v_order_ids, 1) > 0 THEN
            DELETE FROM public.order_daily_deals WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_flash_offers WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_items WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_status_history WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.order_modification_history WHERE order_id = ANY(v_order_ids);

            -- Delivery & prep for these orders
            DELETE FROM public.delivery_tracking WHERE order_id = ANY(v_order_ids);
            DELETE FROM public.preparation_records WHERE order_id = ANY(v_order_ids);

            -- Returns for these orders
            DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.returns WHERE order_id = ANY(v_order_ids);

            -- Collections for these orders
            DELETE FROM public.treasury_transactions
            WHERE reference_type = 'collection'
              AND reference_id IN (SELECT id FROM public.collections WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.collections WHERE order_id = ANY(v_order_ids);

            -- Credit invoices for these orders
            DELETE FROM public.credit_invoice_cheques WHERE invoice_id IN (SELECT id FROM public.credit_invoices WHERE order_id = ANY(v_order_ids));
            DELETE FROM public.credit_invoices WHERE order_id = ANY(v_order_ids);

            -- The orders themselves
            DELETE FROM public.orders WHERE id = ANY(v_order_ids);
        END IF;

        -- 11. Transitive: Customers owned by employee
        IF array_length(v_customer_ids, 1) > 0 THEN
            -- Also cascade through their orders (not already deleted above)
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

            -- Customer-specific tables
            DELETE FROM public.customer_addresses WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_contacts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_accounts WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_credit_ledger WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.tier_exceptions WHERE customer_id = ANY(v_customer_ids);
            DELETE FROM public.customer_ownership_history WHERE customer_id = ANY(v_customer_ids);

            -- The customers themselves
            DELETE FROM public.customers WHERE id = ANY(v_customer_ids);
        END IF;

        -- 12. Employee record
        -- Clear manager_id for employees managed by the deleted employee
        UPDATE public.employees SET manager_id = NULL WHERE manager_id = ANY(p_ids);

        v_deleted_count := 0;
        FOREACH v_emp_id IN ARRAY p_ids LOOP
            -- Delete identity (app.identities)
            DELETE FROM public.identities WHERE id = (SELECT identity_id FROM public.employees WHERE id = v_emp_id);
            -- Delete the employee
            DELETE FROM public.employees WHERE id = v_emp_id;
            IF FOUND THEN v_deleted_count := v_deleted_count + 1; END IF;
        END LOOP;

        -- Audit log
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
