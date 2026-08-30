-- Executive attendance follow-up: align workforce and activity ownership with
-- the canonical attendance screens. This does not alter legacy attendance RPCs.

-- The executive supervisor is barred from opening this screen, but is eligible
-- to be included in the workforce when upper management enables that employee.
CREATE OR REPLACE FUNCTION public.executive_followup_classification(p_employee_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1
            FROM public.employee_roles er
            JOIN public.roles r ON r.id = er.role_id
            WHERE er.employee_id = p_employee_id
              AND r.name IN ('الإدارة العليا', 'الرئيس التنفيذي', 'executive_director')
        ) THEN 'management'
        ELSE 'workforce'
    END;
$$;

COMMENT ON FUNCTION public.executive_followup_classification(uuid) IS
    'الإدارة العليا فقط خارج القوى العاملة. المشرف التنفيذي لا يملك دخول الشاشة، لكنه مرشح للقوى العاملة ويُشمل فقط عبر إعداد القوى العاملة.';

-- Visits are canonically owned by created_by after identity resolution. The
-- old executive functions used visits.employee_id, which differs for migrated
-- and delegated visits. Rebuild only the executive functions from their live
-- definitions with the canonical ownership expression.
DO $do$
DECLARE
    v_proc regprocedure;
    v_definition text;
BEGIN
    FOR v_proc IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'get_executive_followup_list',
              'get_executive_overview_kpis',
              'get_executive_employee_day_detail',
              'get_executive_day_timeline',
              'get_executive_workforce_history'
          )
    LOOP
        SELECT pg_get_functiondef(v_proc) INTO v_definition;
        v_definition := replace(v_definition, 'v.employee_id', 'public.resolve_employee_id(v.created_by)');

        -- Productivity belongs to every employee shown in this screen. Presence
        -- remains limited to the employees whose attendance is enabled.
        IF v_proc::text LIKE 'get_executive_overview_kpis(%' THEN
            v_definition := replace(v_definition, '''total_orders'', (SELECT COALESCE(SUM(order_count), 0)::int FROM att_staff)', '''total_orders'', (SELECT COALESCE(SUM(order_count), 0)::int FROM scoped)');
            v_definition := replace(v_definition, '''total_sales'', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM att_staff)', '''total_sales'', (SELECT COALESCE(SUM(sales_value), 0)::numeric FROM scoped)');
            v_definition := replace(v_definition, '''total_visits'', (SELECT COALESCE(SUM(visit_count), 0)::int FROM att_staff)', '''total_visits'', (SELECT COALESCE(SUM(visit_count), 0)::int FROM scoped)');
            v_definition := replace(v_definition, '''total_collections'', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM att_staff)', '''total_collections'', (SELECT COALESCE(SUM(collection_count), 0)::int FROM scoped)');
            v_definition := replace(v_definition, '''collection_amount'', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM att_staff)', '''collection_amount'', (SELECT COALESCE(SUM(collection_amount), 0)::numeric FROM scoped)');
            v_definition := replace(v_definition, '''total_new_customers'', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM att_staff)', '''total_new_customers'', (SELECT COALESCE(SUM(new_customer_count), 0)::int FROM scoped)');
        END IF;

        EXECUTE v_definition;
    END LOOP;
END;
$do$;

NOTIFY pgrst, 'reload schema';
