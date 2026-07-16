-- ============================================================================
-- PURGE LEGACY GOVERNANCE ROLES
-- Removes Super Admin, Admin, Chairman, Executive Manager from production.
-- Upper Management (الإدارة العليا) becomes the sole governance authority.
-- Executive Supervisor (مشرف تنفيذي) and all operational roles are untouched.
-- ============================================================================

-- ============================================================================
-- 1. register_customer — replace SUPER_ADMIN lookup with الإدارة العليا
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone             varchar,
  p_password          varchar,
  p_company_name      varchar,
  p_responsible_name  varchar,
  p_business_type     business_type,
  p_latitude          numeric,
  p_longitude         numeric,
  p_accuracy_meters   numeric,
  p_formatted_address text DEFAULT NULL,
  p_email             varchar DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_identity_id uuid;
  v_customer_id uuid;
  v_owner_id uuid;
  v_location_id uuid;
  v_session app.sessions;
  v_code varchar;
BEGIN
  IF p_phone !~ '^01[0-9]{9}$' THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف غير صالح');
  END IF;

  IF p_password !~ '^\d{6}$' THEN
    RETURN json_build_object('success', false, 'error', 'كلمة المرور يجب أن تكون 6 أرقام');
  END IF;

  IF EXISTS (SELECT 1 FROM identities WHERE phone = p_phone) THEN
    RETURN json_build_object('success', false, 'error', 'رقم الهاتف موجود بالفعل');
  END IF;

  v_identity_id := gen_random_uuid();
  v_customer_id := gen_random_uuid();
  v_location_id := gen_random_uuid();

  v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  WHILE EXISTS (SELECT 1 FROM customers WHERE code = v_code) LOOP
    v_code := 'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  END LOOP;

  INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
  VALUES (v_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());

  INSERT INTO identities (id, phone, password_hash, identity_type, is_active)
  VALUES (v_identity_id, p_phone, extensions.crypt(p_password::text, extensions.gen_salt('bf')), 'customer', true);

  SELECT e.id INTO v_owner_id
  FROM employees e
  JOIN employee_roles er ON er.employee_id = e.id
  JOIN roles r ON r.id = er.role_id
  WHERE r.name = 'الإدارة العليا'
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM identities WHERE id = v_identity_id;
    DELETE FROM unified_locations WHERE id = v_location_id;
    RETURN json_build_object('success', false, 'error', 'لا يوجد مسؤول من الإدارة العليا في النظام');
  END IF;

  INSERT INTO customers (id, identity_id, code, company_name, responsible_name, business_type, location_id, owner_type, owner_id, is_active, email, registered_at)
  VALUES (v_customer_id, v_identity_id, v_code, p_company_name, p_responsible_name, p_business_type, v_location_id, 'employee', v_owner_id, true, p_email, now());

  INSERT INTO customer_contacts (customer_id, full_name, phone, is_primary)
  VALUES (v_customer_id, p_responsible_name, p_phone, true);

  INSERT INTO app.sessions (identity_id, customer_id, identity_type)
  VALUES (v_identity_id, v_customer_id, 'customer')
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'token', v_session.token,
    'identity_type', 'customer',
    'customer', json_build_object(
      'id', v_customer_id,
      'company_name', p_company_name,
      'code', v_code,
      'business_type', p_business_type
    ),
    'expires_at', v_session.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.register_customer IS 'تسجيل عميل جديد — owner_id = الإدارة العليا';

-- ============================================================================
-- 2. get_kpi_contributors — remove legacy role refs from classification + exclusion
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_contributors(
  p_token uuid, p_kpi_type text, p_month int DEFAULT NULL, p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $function$
DECLARE
  v_session app.sessions;
  v_target_month int; v_target_year int;
  v_month_start timestamptz; v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF NOT public.is_upper_management(v_session.employee_id) THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;
  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';
  WITH RECURSIVE ancestor_map AS (
    SELECT id AS descendant_id, id AS ancestor_id FROM public.employees WHERE is_active = true
    UNION ALL
    SELECT am.descendant_id, e.manager_id FROM ancestor_map am
    JOIN public.employees e ON e.id = am.ancestor_id WHERE e.manager_id IS NOT NULL
  ), delivered_orders AS (
    SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
    FROM public.orders o LEFT JOIN public.employees emp ON o.owner_id = emp.id LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
    WHERE o.status = 'delivered' AND o.delivered_at >= v_month_start AND o.delivered_at < v_month_end
  ), completed_visits AS (
    SELECT * FROM public.visits v WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
  ), emp_orders AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT id)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_amount
    FROM delivered_orders GROUP BY resolved_employee_id
  ), emp_visits AS (
    SELECT employee_id, COUNT(*)::int AS visit_count FROM completed_visits GROUP BY employee_id
  ), emp_new_customers AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT customer_id)::int AS new_customer_count
    FROM delivered_orders do2 WHERE do2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = do2.customer_id AND o3.status = 'delivered')
    GROUP BY resolved_employee_id
  ), approved_returns AS (
    SELECT r.*, o.resolved_employee_id FROM public.returns r JOIN delivered_orders o ON o.id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
  ), emp_returns AS (
    SELECT resolved_employee_id AS employee_id, COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
      COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
    FROM approved_returns r LEFT JOIN (
      SELECT r2.order_id FROM public.returns r2 JOIN public.return_items ri ON ri.return_id = r2.id JOIN public.products p ON p.id = ri.product_id
      JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
      WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
      GROUP BY r2.order_id, oi3.total_pieces
      HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
    ) fr ON fr.order_id = r.order_id
    GROUP BY resolved_employee_id
  ), personal_kpis AS (
    SELECT e.id AS employee_id, e.code, e.full_name, e.manager_id,
      COALESCE(emt.sales_target, 0) AS sales_target, COALESCE(emt.visits_target, 0) AS visits_target,
      COALESCE(emt.orders_target, 0) AS orders_target, COALESCE(emt.new_customers_target, 0) AS new_customers_target,
      GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
      COALESCE(ev.visit_count, 0) AS personal_visits,
      GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
      COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name = 'مدير المبيعات') THEN 'مدير مبيعات'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END AS role_type,
      EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
    FROM public.employees e
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
    LEFT JOIN emp_orders eo ON eo.employee_id = e.id LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id LEFT JOIN emp_returns er ON er.employee_id = e.id
    WHERE e.is_active = true AND e.code NOT IN ('SYS-OWNER', 'ADMIN-001')
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id
        WHERE er2.employee_id = e.id AND r2.name = 'الإدارة العليا')
      AND (emt.id IS NOT NULL OR COALESCE(eo.sales_amount, 0) > 0 OR COALESCE(ev.visit_count, 0) > 0 OR COALESCE(enc.new_customer_count, 0) > 0 OR COALESCE(eo.order_count, 0) > 0)
  ), team_kpis AS (
    SELECT am.ancestor_id, SUM(pk.sales_target) AS team_sales_target, SUM(pk.visits_target) AS team_visits_target,
      SUM(pk.orders_target) AS team_orders_target, SUM(pk.new_customers_target) AS team_new_customers_target,
      SUM(pk.personal_sales) AS team_sales, SUM(pk.personal_visits) AS team_visits,
      SUM(pk.personal_orders) AS team_orders, SUM(pk.personal_new_customers) AS team_new_customers
    FROM ancestor_map am JOIN personal_kpis pk ON pk.employee_id = am.descendant_id GROUP BY am.ancestor_id
  ), final_data AS (
    SELECT pk.employee_id, pk.code, pk.full_name, pk.role_type, pk.has_team,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales_target, 0) ELSE pk.sales_target END AS disp_sales_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales, 0) ELSE pk.personal_sales END AS disp_sales,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits_target, 0) ELSE pk.visits_target END AS disp_visits_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits, 0) ELSE pk.personal_visits END AS disp_visits,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders_target, 0) ELSE pk.orders_target END AS disp_orders_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders, 0) ELSE pk.personal_orders END AS disp_orders,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers_target, 0) ELSE pk.new_customers_target END AS disp_nc_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers, 0) ELSE pk.personal_new_customers END AS disp_nc
    FROM personal_kpis pk LEFT JOIN team_kpis tk ON tk.ancestor_id = pk.employee_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'employee_id', fd.employee_id, 'employee_code', fd.code, 'employee_name', fd.full_name,
    'role_type', fd.role_type, 'has_team', fd.has_team,
    'actual', CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales WHEN 'orders' THEN fd.disp_orders WHEN 'visits' THEN fd.disp_visits WHEN 'new_customers' THEN fd.disp_nc ELSE 0 END,
    'target', CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 0 END,
    'achievement_pct', ROUND(CASE WHEN CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 0 END > 0
      THEN (CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales WHEN 'orders' THEN fd.disp_orders WHEN 'visits' THEN fd.disp_visits WHEN 'new_customers' THEN fd.disp_nc ELSE 0 END::numeric / CASE p_kpi_type WHEN 'sales' THEN fd.disp_sales_target WHEN 'orders' THEN fd.disp_orders_target WHEN 'visits' THEN fd.disp_visits_target WHEN 'new_customers' THEN fd.disp_nc_target ELSE 1 END::numeric * 100) ELSE 0 END, 2)
  ) ORDER BY fd.role_type, fd.full_name) INTO v_result
  FROM final_data fd;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ============================================================================
-- 3. seed_sales_rep_monthly_targets — remove legacy role refs from exclusion lists
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_sales_rep_monthly_targets(
    p_token uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL,
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int;
    v_target_year int;
    v_rep record;
    v_created int := 0;
    v_skipped int := 0;
    v_already_had int := 0;
    v_created_names text[] := '{}'::text[];
    v_skipped_names text[] := '{}'::text[];
    v_already_names text[] := '{}'::text[];
    v_total_reps int := 0;
    v_reps_with_targets int := 0;
    v_reps_without_targets int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    FOR v_rep IN
        WITH rep_candidates AS (
            SELECT e.id, e.code, e.full_name
            FROM public.employees e
            WHERE e.is_active = true
              AND EXISTS (
                  SELECT 1 FROM public.employee_roles er
                  JOIN public.roles r ON r.id = er.role_id
                  WHERE er.employee_id = e.id AND r.name = 'مندوب مبيعات'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.employee_roles er
                  JOIN public.roles r ON r.id = er.role_id
                  WHERE er.employee_id = e.id
                    AND r.name IN (
                        'الإدارة العليا',
                        'مدير البيع',
                        'مشرف مبيعات', 'مشرف تنفيذي', 'مشرف عام',
                        'مدير عمليات تنفيذية'
                    )
              )
        )
        SELECT rc.*,
               CASE WHEN et.id IS NOT NULL THEN true ELSE false END AS has_target
        FROM rep_candidates rc
        LEFT JOIN public.employee_monthly_targets et
            ON et.employee_id = rc.id
            AND et.target_month = v_target_month
            AND et.target_year = v_target_year
        ORDER BY rc.full_name
    LOOP
        v_total_reps := v_total_reps + 1;

        IF v_rep.has_target THEN
            v_reps_with_targets := v_reps_with_targets + 1;
            v_already_had := v_already_had + 1;
            v_already_names := array_append(v_already_names, v_rep.full_name || ' (' || v_rep.code || ')');
        ELSE
            v_reps_without_targets := v_reps_without_targets + 1;

            IF NOT p_dry_run THEN
                INSERT INTO public.employee_monthly_targets
                    (employee_id, target_month, target_year,
                     sales_target, visits_target, orders_target, new_customers_target)
                VALUES
                    (v_rep.id, v_target_month, v_target_year,
                     5000000, 250, 250, 30)
                ON CONFLICT (employee_id, target_month, target_year)
                DO NOTHING;

                IF FOUND THEN
                    v_created := v_created + 1;
                    v_created_names := array_append(v_created_names, v_rep.full_name || ' (' || v_rep.code || ')');
                ELSE
                    v_skipped := v_skipped + 1;
                    v_skipped_names := array_append(v_skipped_names, v_rep.full_name || ' (' || v_rep.code || ')');
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'dry_run', p_dry_run,
        'month', v_target_month,
        'year', v_target_year,
        'total_sales_reps', v_total_reps,
        'reps_with_targets', v_reps_with_targets,
        'reps_without_targets', v_reps_without_targets,
        'created', CASE WHEN p_dry_run THEN 0 ELSE v_created END,
        'skipped', CASE WHEN p_dry_run THEN 0 ELSE v_skipped END,
        'missing_list', COALESCE(CASE WHEN p_dry_run THEN
            (SELECT array_agg(full_name || ' (' || code || ')') FROM (
                SELECT e2.full_name, e2.code
                FROM public.employees e2
                WHERE e2.is_active = true
                  AND EXISTS (
                      SELECT 1 FROM public.employee_roles er2
                      JOIN public.roles r2 ON r2.id = er2.role_id
                      WHERE er2.employee_id = e2.id AND r2.name = 'مندوب مبيعات'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.employee_roles er2
                      JOIN public.roles r2 ON r2.id = er2.role_id
                      WHERE er2.employee_id = e2.id
                        AND r2.name IN (
                            'الإدارة العليا',
                            'مدير البيع',
                            'مشرف مبيعات', 'مشرف تنفيذي', 'مشرف عام',
                            'مدير عمليات تنفيذية'
                        )
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.employee_monthly_targets et2
                      WHERE et2.employee_id = e2.id
                        AND et2.target_month = v_target_month
                        AND et2.target_year = v_target_year
                  )
            ) missing
        ) ELSE v_created_names END, '{}'::text[]),
        'already_list', COALESCE(v_already_names, '{}'::text[]),
        'message', CASE
            WHEN p_dry_run THEN 'وضع المعاينة: ' || v_reps_without_targets || ' مندوب بدون هدف — جاهز للإنشاء'
            WHEN v_created > 0 THEN 'تم إنشاء ' || v_created || ' هدف للمناديب'
            ELSE 'جميع المناديب لديهم أهداف بالفعل'
        END
    );
END;
$function$;

-- ============================================================================
-- 4. get_governed_active_employees — remove legacy role ref from classification
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_active_employees(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE v_session app.sessions; v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', e.id, 'employee_code', e.code, 'employee_name', e.full_name,
      'employee_manager_id', e.manager_id,
      'role_type', CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name = 'الإدارة العليا') THEN 'مدير'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name = 'مدير البيع') THEN 'مدير البيع'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END,
      'has_team', EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id)
    ) ORDER BY e.full_name
  ) INTO v_result
  FROM public.employees e
  WHERE e.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_roles er JOIN public.roles r ON r.id = er.role_id
      WHERE er.employee_id = e.id AND r.name = 'الإدارة العليا'
    );
  RETURN COALESCE(v_result, jsonb_build_array());
END;
$function$;

-- ============================================================================
-- 5. get_governed_employees — replace legacy role check with is_upper_management
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

  -- Upper Management: all employees
  SELECT public.is_upper_management(v_session.employee_id) INTO v_is_super_admin;
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

-- ============================================================================
-- 6. DELETE legacy role rows (safety: unassign any employees first)
-- ============================================================================

DELETE FROM public.employee_roles
WHERE role_id IN (
  SELECT id FROM public.roles
  WHERE name IN (
    'SUPER_ADMIN', 'سوبر أدمن', 'سوبرادمن',
    'ADMIN', 'أدمن',
    'CHAIRMAN', 'رئيس مجلس الإدارة',
    'EXECUTIVE_MANAGER', 'مدير تنفيذي'
  )
);

DELETE FROM public.roles
WHERE name IN (
  'SUPER_ADMIN', 'سوبر أدمن', 'سوبرادمن',
  'ADMIN', 'أدمن',
  'CHAIRMAN', 'رئيس مجلس الإدارة',
  'EXECUTIVE_MANAGER', 'مدير تنفيذي'
);


