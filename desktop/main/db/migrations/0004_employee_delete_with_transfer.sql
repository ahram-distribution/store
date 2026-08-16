-- ============================================================================
-- 0004: governed_delete_employee_with_transfer
-- Upper-management feature: permanently delete an employee account after
-- atomically transferring ALL current business ownership to the fixed
-- destination employee (default EMP-2026-000037).
--
-- Behavior (single transaction, ALL or NOTHING):
--   1. Validate session + employees.manage capability
--   2. Validate fixed target exists and is active (and not the source)
--   3. Transfer current ownership in priority order:
--        customers -> orders -> visits -> collections -> returns
--        -> delivery assignments -> subordinates (manager_id)
--      Customers are recorded in customer_ownership_history (audit).
--   4. Verify ZERO current ownership remains for the source.
--   5. NULL historical/audit employee references (nullable FK behavior;
--      history/business rows are preserved, never re-pointed to the target,
--      never deleted). Historical created_by (identity) references stay
--      INTACT because the identity row is retained but deactivated.
--   6. Delete account-specific rows (roles, capabilities, targets, policies,
--      attendance/tracking, advances, notifications, sessions, ...).
--   7. Deactivate the identity (login disabled) and delete the employee row.
--
-- The destination EMP-2026-000037 is fixed and must NEVER be deleted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_delete_employee_with_transfer(
  p_token uuid,
  p_employee_id uuid,
  p_target_code text DEFAULT 'EMP-2026-000037'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_id uuid;
  v_target_code text;
  v_target_name text;
  v_source_code text;
  v_source_name text;
  v_source_identity_id uuid;
  v_count int;
  v_remaining int;
  v_customers int := 0;
  v_orders int := 0;
  v_visits int := 0;
  v_collections int := 0;
  v_returns int := 0;
  v_delivery int := 0;
  v_drivers int := 0;
  v_subordinates int := 0;
  v_sessions_deleted int := 0;
BEGIN
  -- Skip the sync_outbox capture trigger during this internal governed
  -- operation: it would fail on tables without an id column (e.g.
  -- employee_baselines) and must not replicate the bulk transfer/delete
  -- row-by-row. Local to this transaction.
  PERFORM set_config('app.sync_in_progress', 'true', true);

  -- 1. Session validation
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_SESSION'); END IF;

  -- 2. Existing capability authorization (both الإدارة العليا and الرئيس التنفيذي hold employees.manage)
  IF NOT public.check_capability(p_token, 'employees.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- 3. Source employee
  SELECT e.code, e.full_name, e.identity_id
    INTO v_source_code, v_source_name, v_source_identity_id
  FROM public.employees e WHERE e.id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  -- Guard: an admin must never delete their own account
  IF v_session.employee_id = p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_DELETE_SELF');
  END IF;

  -- 4. Fixed destination employee
  SELECT e.id, e.code, e.full_name INTO v_target_id, v_target_code, v_target_name
  FROM public.employees e WHERE e.code = p_target_code AND e.is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_NOT_FOUND'); END IF;
  IF v_target_id = p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_IS_SOURCE');
  END IF;

  -- ===================== 5. TRANSFER CURRENT OWNERSHIP =====================
  -- 5.1 customers (with ownership-history audit, mirroring governed_change_customer_ownership)
  SELECT COUNT(*) INTO v_customers FROM public.customers WHERE owner_id = p_employee_id;
  IF v_customers > 0 THEN
    INSERT INTO public.customer_ownership_history (customer_id, previous_owner_id, new_owner_id, changed_by, reason)
    SELECT id, owner_id, v_target_id, v_session.employee_id,
           'تحويل ملكية العميل عند حذف حساب ' || v_source_code || ' إلى ' || v_target_name
    FROM public.customers WHERE owner_id = p_employee_id;
    UPDATE public.customers SET owner_id = v_target_id WHERE owner_id = p_employee_id;
  END IF;

  -- 5.2 orders
  SELECT COUNT(*) INTO v_orders FROM public.orders WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_orders > 0 THEN
    UPDATE public.orders SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.3 visits
  SELECT COUNT(*) INTO v_visits FROM public.visits WHERE employee_id = p_employee_id;
  IF v_visits > 0 THEN
    UPDATE public.visits SET employee_id = v_target_id WHERE employee_id = p_employee_id;
  END IF;

  -- 5.4 collections
  SELECT COUNT(*) INTO v_collections FROM public.collections WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_collections > 0 THEN
    UPDATE public.collections SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.5 returns
  SELECT COUNT(*) INTO v_returns FROM public.returns WHERE owner_id = p_employee_id AND owner_type = 'employee';
  IF v_returns > 0 THEN
    UPDATE public.returns SET owner_id = v_target_id WHERE owner_id = p_employee_id AND owner_type = 'employee';
  END IF;

  -- 5.6 delivery assignments (assigned_to) and driver assignments (driver_id)
  SELECT COUNT(*) INTO v_delivery FROM public.delivery_tracking WHERE assigned_to = p_employee_id;
  IF v_delivery > 0 THEN
    UPDATE public.delivery_tracking SET assigned_to = v_target_id WHERE assigned_to = p_employee_id;
  END IF;
  SELECT COUNT(*) INTO v_drivers FROM public.delivery_tracking WHERE driver_id = p_employee_id;
  IF v_drivers > 0 THEN
    UPDATE public.delivery_tracking SET driver_id = v_target_id WHERE driver_id = p_employee_id;
  END IF;

  -- 5.7 subordinates (employees.manager_id) so the team is not orphaned
  SELECT COUNT(*) INTO v_subordinates FROM public.employees WHERE manager_id = p_employee_id;
  IF v_subordinates > 0 THEN
    UPDATE public.employees SET manager_id = v_target_id WHERE manager_id = p_employee_id;
  END IF;

  -- ===================== 6. VERIFY NO CURRENT OWNERSHIP REMAINS =============
  SELECT
    (SELECT COUNT(*) FROM public.customers WHERE owner_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.orders WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.visits WHERE employee_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.collections WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.returns WHERE owner_id = p_employee_id AND owner_type = 'employee')
    + (SELECT COUNT(*) FROM public.delivery_tracking WHERE assigned_to = p_employee_id OR driver_id = p_employee_id)
    + (SELECT COUNT(*) FROM public.employees WHERE manager_id = p_employee_id)
  INTO v_remaining;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'TRANSFER_INCOMPLETE: % records still owned by the source employee', v_remaining;
  END IF;

  -- ============= 7. NULL HISTORICAL / AUDIT EMPLOYEE REFERENCES =============
  -- Business/history rows are PRESERVED; only the FK reference is cleared
  -- (existing nullable FK behavior). Never re-pointed to the target.
  -- Customer ownership history
  UPDATE public.customer_ownership_history SET previous_owner_id = NULL WHERE previous_owner_id = p_employee_id;
  UPDATE public.customer_ownership_history SET new_owner_id = NULL WHERE new_owner_id = p_employee_id;
  UPDATE public.customer_ownership_history SET changed_by = NULL WHERE changed_by = p_employee_id;
  -- Auctions
  UPDATE public.auctions SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.auction_awards SET awarded_by = NULL WHERE awarded_by = p_employee_id;
  UPDATE public.auction_participants SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Collections / returns
  UPDATE public.collections SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.collections SET approved_by = NULL WHERE approved_by = p_employee_id;
  UPDATE public.returns SET created_by = NULL WHERE created_by = p_employee_id;
  -- Credit
  UPDATE public.credit_applications SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.credit_applications SET doc_confirmed_by = NULL WHERE doc_confirmed_by = p_employee_id;
  UPDATE public.credit_applications SET reviewed_by = NULL WHERE reviewed_by = p_employee_id;
  UPDATE public.credit_applications SET approved_by = NULL WHERE approved_by = p_employee_id;
  UPDATE public.credit_applications SET suspended_by = NULL WHERE suspended_by = p_employee_id;
  UPDATE public.credit_contracts SET verified_by = NULL WHERE verified_by = p_employee_id;
  UPDATE public.credit_invoice_cheques SET recorded_by = NULL WHERE recorded_by = p_employee_id;
  UPDATE public.customer_credit_accounts SET activated_by = NULL WHERE activated_by = p_employee_id;
  UPDATE public.customer_credit_ledger SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.tier_exceptions SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  -- Products & deals
  UPDATE public.daily_deals SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.flash_offers SET created_by = NULL WHERE created_by = p_employee_id;
  -- Field work actors
  UPDATE public.delivery_tracking SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.preparation_records SET started_by = NULL WHERE started_by = p_employee_id;
  UPDATE public.preparation_records SET completed_by = NULL WHERE completed_by = p_employee_id;
  UPDATE public.preparation_records SET cancelled_by = NULL WHERE cancelled_by = p_employee_id;
  UPDATE public.preparation_records SET reviewed_by = NULL WHERE reviewed_by = p_employee_id;
  UPDATE public.return_inspection SET inspected_by = NULL WHERE inspected_by = p_employee_id;
  UPDATE public.tracking_cleanup_log SET executed_by = NULL WHERE executed_by = p_employee_id;
  -- Financial actors
  UPDATE public.treasury_transactions SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.expenses SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.expenses SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Employee config actors (rows themselves are deleted below)
  UPDATE public.employee_roles SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.employee_capabilities SET assigned_by = NULL WHERE assigned_by = p_employee_id;
  UPDATE public.employee_work_policies SET updated_by = NULL WHERE updated_by = p_employee_id;
  UPDATE public.employee_advances SET created_by = NULL WHERE created_by = p_employee_id;
  UPDATE public.employee_advances SET approved_by = NULL WHERE approved_by = p_employee_id;
  -- Deletion audit log (historical rows that list the source as subject)
  UPDATE public.deletion_audit_log SET employee_id = NULL WHERE employee_id = p_employee_id;

  -- ============= 8. DELETE ACCOUNT-SPECIFIC RECORDS =========================
  DELETE FROM public.workday_breaks WHERE employee_id = p_employee_id;
  DELETE FROM public.tracking_points WHERE employee_id = p_employee_id;
  DELETE FROM public.workday_sessions WHERE employee_id = p_employee_id; -- cascades visit_links + session tracking_points
  DELETE FROM public.employee_work_policies WHERE employee_id = p_employee_id; -- after sessions (referenced by work_policy_id)
  DELETE FROM public.employee_baselines WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_entity_views WHERE employee_id = p_employee_id;
  DELETE FROM public.push_subscriptions WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_monthly_targets WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_weight_overrides WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_roles WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_capabilities WHERE employee_id = p_employee_id;
  DELETE FROM public.employee_advances WHERE employee_id = p_employee_id;
  DELETE FROM public.attendance_audit_log WHERE employee_id = p_employee_id;
  DELETE FROM public.session_recovery_log WHERE employee_id = p_employee_id;
  DELETE FROM public.notifications WHERE recipient_employee_id = p_employee_id;

  -- 9. Delete sessions, deactivate identity (kept so historical created_by
  --    references on orders/history/contracts stay valid), delete the employee
  DELETE FROM app.sessions WHERE identity_id = v_source_identity_id OR employee_id = p_employee_id;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;
  UPDATE public.identities SET is_active = false WHERE id = v_source_identity_id;
  DELETE FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_DELETE_FAILED'; END IF;

  -- 10. Audit trail for this operation (references the admin, not the deleted employee)
  INSERT INTO public.deletion_audit_log (employee_id, entity_type, entity_ids, record_count, related_tables)
  VALUES (
    v_session.employee_id,
    'employee_account_transfer_delete',
    ARRAY[p_employee_id],
    1,
    jsonb_build_object(
      'employee_code', v_source_code,
      'transferred', jsonb_build_object(
        'customers', v_customers,
        'orders', v_orders,
        'visits', v_visits,
        'collections', v_collections,
        'returns', v_returns,
        'delivery_assignments', v_delivery,
        'delivery_drivers', v_drivers,
        'subordinates', v_subordinates
      ),
      'target', jsonb_build_object('id', v_target_id, 'code', v_target_code)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', p_employee_id,
    'employee_code', v_source_code,
    'employee_name', v_source_name,
    'target_code', v_target_code,
    'target_name', v_target_name,
    'transferred', jsonb_build_object(
      'customers', v_customers,
      'orders', v_orders,
      'visits', v_visits,
      'collections', v_collections,
      'returns', v_returns,
      'delivery_assignments', v_delivery,
      'delivery_drivers', v_drivers,
      'subordinates', v_subordinates
    ),
    'sessions_deleted', v_sessions_deleted,
    'account_deleted', true,
    'identity_deactivated', true
  );
END;
$function$;

COMMENT ON FUNCTION public.governed_delete_employee_with_transfer(uuid, uuid, text) IS
  'حذف حساب موظف بعد نقل كامل الملكية الحالية إلى حساب وجهة ثابت (EMP-2026-000037) بشكل ذري';
-- No GRANT EXECUTE ... TO authenticated: the `authenticated` role does not exist
-- in the local desktop database. Web parity grant lives in the supabase migration.
