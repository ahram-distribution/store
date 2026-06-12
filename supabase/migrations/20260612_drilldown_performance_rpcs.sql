-- ============================================================
-- Drill-Down Performance RPCs for UpperManagementDashboard
-- Adds 4 new RPCs for Levels 2-5 drill-down navigation
-- No schema changes. No new tables.
-- ============================================================

-- ============================================================
-- RPC 1: get_kpi_contributors  (Level 2)
-- Returns all employees who contributed to a specific KPI
-- Managers/supervisors show team-aggregated values
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kpi_contributors(
  p_token uuid,
  p_kpi_type text,
  p_month int DEFAULT NULL,
  p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_target_month int;
  v_target_year int;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;
  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';

  WITH RECURSIVE ancestor_map AS (
    SELECT id AS descendant_id, id AS ancestor_id
    FROM public.employees WHERE is_active = true
    UNION ALL
    SELECT am.descendant_id, e.manager_id
    FROM ancestor_map am
    JOIN public.employees e ON e.id = am.ancestor_id
    WHERE e.manager_id IS NOT NULL
  ),
  delivered_orders AS (
    SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
    FROM public.orders o
    LEFT JOIN public.employees emp ON o.owner_id = emp.id
    LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
    WHERE o.status = 'delivered'
      AND o.delivered_at >= v_month_start
      AND o.delivered_at < v_month_end
  ),
  completed_visits AS (
    SELECT v.*
    FROM public.visits v
    WHERE v.status = 'completed'
      AND v.check_out_at >= v_month_start
      AND v.check_out_at < v_month_end
  ),
  emp_orders AS (
    SELECT resolved_employee_id AS employee_id,
      COUNT(DISTINCT id)::int AS order_count,
      COALESCE(SUM(total_amount), 0) AS sales_amount
    FROM delivered_orders
    GROUP BY resolved_employee_id
  ),
  emp_visits AS (
    SELECT employee_id, COUNT(*)::int AS visit_count
    FROM completed_visits
    GROUP BY employee_id
  ),
  emp_new_customers AS (
    SELECT resolved_employee_id AS employee_id,
      COUNT(DISTINCT customer_id)::int AS new_customer_count
    FROM delivered_orders do2
    WHERE do2.delivered_at = (
      SELECT MIN(o3.delivered_at)
      FROM public.orders o3
      WHERE o3.customer_id = do2.customer_id
        AND o3.status = 'delivered'
    )
    GROUP BY resolved_employee_id
  ),
  approved_returns AS (
    SELECT r.*, o.resolved_employee_id
    FROM public.returns r
    JOIN delivered_orders o ON o.id = r.order_id
    WHERE r.status = 'approved'
      AND r.created_at >= v_month_start
      AND r.created_at < v_month_end
  ),
  emp_returns AS (
    SELECT resolved_employee_id AS employee_id,
      COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
      COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
    FROM approved_returns r
    LEFT JOIN (
      SELECT r2.order_id
      FROM public.returns r2
      JOIN public.return_items ri ON ri.return_id = r2.id
      JOIN public.products p ON p.id = ri.product_id
      JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
      WHERE r2.status = 'approved'
        AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
      GROUP BY r2.order_id, oi3.total_pieces
      HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
    ) fr ON fr.order_id = r.order_id
    GROUP BY resolved_employee_id
  ),
  personal_kpis AS (
    SELECT
      e.id AS employee_id, e.code, e.full_name, e.manager_id,
      COALESCE(emt.sales_target, 0) AS sales_target,
      COALESCE(emt.visits_target, 0) AS visits_target,
      COALESCE(emt.orders_target, 0) AS orders_target,
      COALESCE(emt.new_customers_target, 0) AS new_customers_target,
      GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
      COALESCE(ev.visit_count, 0) AS personal_visits,
      GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
      COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مدير المبيعات', 'مدير تنفيذي')) THEN 'مدير مبيعات'
        WHEN EXISTS (SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id WHERE er2.employee_id = e.id AND r2.name IN ('مشرف مبيعات', 'مشرف تنفيذي')) THEN 'سوبر فايزر'
        ELSE 'مندوب'
      END AS role_type,
      EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
    FROM public.employees e
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
    LEFT JOIN emp_orders eo ON eo.employee_id = e.id
    LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id
    LEFT JOIN emp_returns er ON er.employee_id = e.id
    WHERE e.is_active = true
      AND e.code NOT IN ('SYS-OWNER', 'ADMIN-001')
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_roles er2 JOIN public.roles r2 ON r2.id = er2.role_id
        WHERE er2.employee_id = e.id AND r2.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة')
      )
      AND (
        emt.id IS NOT NULL
        OR COALESCE(eo.sales_amount, 0) > 0
        OR COALESCE(ev.visit_count, 0) > 0
        OR COALESCE(enc.new_customer_count, 0) > 0
        OR COALESCE(eo.order_count, 0) > 0
      )
  ),
  team_kpis AS (
    SELECT am.ancestor_id,
      SUM(pk.sales_target) AS team_sales_target,
      SUM(pk.visits_target) AS team_visits_target,
      SUM(pk.orders_target) AS team_orders_target,
      SUM(pk.new_customers_target) AS team_new_customers_target,
      SUM(pk.personal_sales) AS team_sales,
      SUM(pk.personal_visits) AS team_visits,
      SUM(pk.personal_orders) AS team_orders,
      SUM(pk.personal_new_customers) AS team_new_customers
    FROM ancestor_map am
    JOIN personal_kpis pk ON pk.employee_id = am.descendant_id
    GROUP BY am.ancestor_id
  ),
  final_data AS (
    SELECT pk.employee_id, pk.code, pk.full_name, pk.role_type, pk.has_team,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales_target, 0) ELSE pk.sales_target END AS disp_sales_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_sales, 0) ELSE pk.personal_sales END AS disp_sales,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits_target, 0) ELSE pk.visits_target END AS disp_visits_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_visits, 0) ELSE pk.personal_visits END AS disp_visits,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders_target, 0) ELSE pk.orders_target END AS disp_orders_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_orders, 0) ELSE pk.personal_orders END AS disp_orders,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers_target, 0) ELSE pk.new_customers_target END AS disp_nc_target,
      CASE WHEN pk.has_team THEN COALESCE(tk.team_new_customers, 0) ELSE pk.personal_new_customers END AS disp_nc
    FROM personal_kpis pk
    LEFT JOIN team_kpis tk ON tk.ancestor_id = pk.employee_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', fd.employee_id,
      'employee_code', fd.code,
      'employee_name', fd.full_name,
      'role_type', fd.role_type,
      'has_team', fd.has_team,
      'actual', CASE p_kpi_type
        WHEN 'sales' THEN fd.disp_sales
        WHEN 'orders' THEN fd.disp_orders
        WHEN 'visits' THEN fd.disp_visits
        WHEN 'new_customers' THEN fd.disp_nc
        ELSE 0
      END,
      'target', CASE p_kpi_type
        WHEN 'sales' THEN fd.disp_sales_target
        WHEN 'orders' THEN fd.disp_orders_target
        WHEN 'visits' THEN fd.disp_visits_target
        WHEN 'new_customers' THEN fd.disp_nc_target
        ELSE 0
      END,
      'achievement_pct', ROUND(
        CASE
          WHEN CASE p_kpi_type
            WHEN 'sales' THEN fd.disp_sales_target
            WHEN 'orders' THEN fd.disp_orders_target
            WHEN 'visits' THEN fd.disp_visits_target
            WHEN 'new_customers' THEN fd.disp_nc_target
            ELSE 0
          END > 0
          THEN (
            CASE p_kpi_type
              WHEN 'sales' THEN fd.disp_sales
              WHEN 'orders' THEN fd.disp_orders
              WHEN 'visits' THEN fd.disp_visits
              WHEN 'new_customers' THEN fd.disp_nc
              ELSE 0
            END::numeric /
            CASE p_kpi_type
              WHEN 'sales' THEN fd.disp_sales_target
              WHEN 'orders' THEN fd.disp_orders_target
              WHEN 'visits' THEN fd.disp_visits_target
              WHEN 'new_customers' THEN fd.disp_nc_target
              ELSE 1
            END::numeric * 100
          )
          ELSE 0
        END, 2
      )
    )
    ORDER BY fd.role_type, fd.full_name
  ) INTO v_result
  FROM final_data fd;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_kpi_contributors IS 'L2 drill-down: all KPI contributors with team aggregation for managers';

-- ============================================================
-- RPC 2: get_team_members_kpis  (Level 3)
-- Returns direct subordinates of a manager/supervisor
-- Shows personal KPIs (not team-aggregated)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_team_members_kpis(
  p_token uuid,
  p_manager_id uuid,
  p_kpi_type text,
  p_month int DEFAULT NULL,
  p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_target_month int;
  v_target_year int;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;
  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';

  WITH delivered_orders AS (
    SELECT o.*, COALESCE(emp.id, emp2.id) AS resolved_employee_id
    FROM public.orders o
    LEFT JOIN public.employees emp ON o.owner_id = emp.id
    LEFT JOIN public.employees emp2 ON o.owner_id = emp2.identity_id
    WHERE o.status = 'delivered'
      AND o.delivered_at >= v_month_start
      AND o.delivered_at < v_month_end
  ),
  completed_visits AS (
    SELECT * FROM public.visits v
    WHERE v.status = 'completed' AND v.check_out_at >= v_month_start AND v.check_out_at < v_month_end
  ),
  emp_orders AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT id)::int AS order_count, COALESCE(SUM(total_amount), 0) AS sales_amount
    FROM delivered_orders GROUP BY resolved_employee_id
  ),
  emp_visits AS (
    SELECT employee_id, COUNT(*)::int AS visit_count FROM completed_visits GROUP BY employee_id
  ),
  emp_new_customers AS (
    SELECT resolved_employee_id AS employee_id, COUNT(DISTINCT customer_id)::int AS new_customer_count
    FROM delivered_orders do2
    WHERE do2.delivered_at = (SELECT MIN(o3.delivered_at) FROM public.orders o3 WHERE o3.customer_id = do2.customer_id AND o3.status = 'delivered')
    GROUP BY resolved_employee_id
  ),
  approved_returns AS (
    SELECT r.*, o.resolved_employee_id FROM public.returns r JOIN delivered_orders o ON o.id = r.order_id
    WHERE r.status = 'approved' AND r.created_at >= v_month_start AND r.created_at < v_month_end
  ),
  emp_returns AS (
    SELECT resolved_employee_id AS employee_id,
      COALESCE(SUM(credit_note_amount), 0) AS return_deduction,
      COUNT(DISTINCT CASE WHEN fr.order_id IS NOT NULL THEN r.order_id END)::int AS full_returns
    FROM approved_returns r
    LEFT JOIN (
      SELECT r2.order_id FROM public.returns r2
      JOIN public.return_items ri ON ri.return_id = r2.id
      JOIN public.products p ON p.id = ri.product_id
      JOIN (SELECT oi2.order_id, SUM(oi2.piece_quantity) AS total_pieces FROM public.order_items oi2 GROUP BY oi2.order_id) oi3 ON oi3.order_id = r2.order_id
      WHERE r2.status = 'approved' AND r2.created_at >= v_month_start AND r2.created_at < v_month_end
      GROUP BY r2.order_id, oi3.total_pieces
      HAVING SUM(CASE WHEN ri.unit_type = 'piece' THEN ri.quantity WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12 WHEN ri.unit_type = 'carton' THEN ri.quantity * p.carton_quantity END) >= oi3.total_pieces
    ) fr ON fr.order_id = r.order_id
    GROUP BY resolved_employee_id
  ),
  personal_kpis AS (
    SELECT e.id AS employee_id, e.code, e.full_name,
      COALESCE(emt.sales_target, 0) AS sales_target,
      COALESCE(emt.visits_target, 0) AS visits_target,
      COALESCE(emt.orders_target, 0) AS orders_target,
      COALESCE(emt.new_customers_target, 0) AS new_customers_target,
      GREATEST(COALESCE(eo.sales_amount, 0) - COALESCE(er.return_deduction, 0), 0) AS personal_sales,
      COALESCE(ev.visit_count, 0) AS personal_visits,
      GREATEST(COALESCE(eo.order_count, 0) - COALESCE(er.full_returns, 0), 0) AS personal_orders,
      COALESCE(enc.new_customer_count, 0) AS personal_new_customers,
      EXISTS (SELECT 1 FROM public.employees sub WHERE sub.manager_id = e.id AND sub.is_active = true) AS has_team
    FROM public.employees e
    LEFT JOIN public.employee_monthly_targets emt ON emt.employee_id = e.id AND emt.target_month = v_target_month AND emt.target_year = v_target_year
    LEFT JOIN emp_orders eo ON eo.employee_id = e.id
    LEFT JOIN emp_visits ev ON ev.employee_id = e.id
    LEFT JOIN emp_new_customers enc ON enc.employee_id = e.id
    LEFT JOIN emp_returns er ON er.employee_id = e.id
    WHERE e.is_active = true AND e.manager_id = p_manager_id
      AND (
        emt.id IS NOT NULL
        OR COALESCE(eo.sales_amount, 0) > 0
        OR COALESCE(ev.visit_count, 0) > 0
        OR COALESCE(enc.new_customer_count, 0) > 0
        OR COALESCE(eo.order_count, 0) > 0
      )
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'employee_id', pk.employee_id,
      'employee_code', pk.code,
      'employee_name', pk.full_name,
      'has_team', pk.has_team,
      'actual', CASE p_kpi_type
        WHEN 'sales' THEN pk.personal_sales
        WHEN 'orders' THEN pk.personal_orders
        WHEN 'visits' THEN pk.personal_visits
        WHEN 'new_customers' THEN pk.personal_new_customers
        ELSE 0
      END,
      'target', CASE p_kpi_type
        WHEN 'sales' THEN pk.sales_target
        WHEN 'orders' THEN pk.orders_target
        WHEN 'visits' THEN pk.visits_target
        WHEN 'new_customers' THEN pk.new_customers_target
        ELSE 0
      END,
      'achievement_pct', ROUND(
        CASE
          WHEN CASE p_kpi_type
            WHEN 'sales' THEN pk.sales_target
            WHEN 'orders' THEN pk.orders_target
            WHEN 'visits' THEN pk.visits_target
            WHEN 'new_customers' THEN pk.new_customers_target
            ELSE 0
          END > 0
          THEN (
            CASE p_kpi_type
              WHEN 'sales' THEN pk.personal_sales
              WHEN 'orders' THEN pk.personal_orders
              WHEN 'visits' THEN pk.personal_visits
              WHEN 'new_customers' THEN pk.personal_new_customers
              ELSE 0
            END::numeric /
            CASE p_kpi_type
              WHEN 'sales' THEN pk.sales_target
              WHEN 'orders' THEN pk.orders_target
              WHEN 'visits' THEN pk.visits_target
              WHEN 'new_customers' THEN pk.new_customers_target
              ELSE 1
            END::numeric * 100
          )
          ELSE 0
        END, 2
      )
    )
    ORDER BY pk.full_name
  ) INTO v_result
  FROM personal_kpis pk;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_team_members_kpis IS 'L3 drill-down: team members for a manager/supervisor';

-- ============================================================
-- RPC 3: get_rep_customer_kpis  (Level 4)
-- Returns customers for a rep with all 4 KPIs
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rep_customer_kpis(
  p_token uuid,
  p_employee_id uuid,
  p_month int DEFAULT NULL,
  p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_target_month int;
  v_target_year int;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;
  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';

  WITH customer_delivered_orders AS (
    SELECT o.customer_id, o.id AS order_id, o.total_amount, o.delivered_at
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.status = 'delivered'
      AND o.delivered_at >= v_month_start
      AND o.delivered_at < v_month_end
      AND (c.owner_id = p_employee_id OR c.id IN (
        SELECT c2.id FROM public.customers c2
        JOIN public.employees e ON e.identity_id = c2.owner_id
        WHERE e.id = p_employee_id
      ))
  ),
  customer_visits AS (
    SELECT v.customer_id, COUNT(*)::int AS visit_count
    FROM public.visits v
    WHERE v.status = 'completed'
      AND v.check_out_at >= v_month_start
      AND v.check_out_at < v_month_end
      AND v.employee_id = p_employee_id
    GROUP BY v.customer_id
  ),
  customer_agg AS (
    SELECT
      c.id AS customer_id,
      c.company_name AS customer_name,
      COALESCE(SUM(cdo.total_amount), 0) AS total_sales,
      COUNT(DISTINCT cdo.order_id)::int AS total_orders,
      COALESCE(cv.visit_count, 0) AS total_visits,
      EXISTS (
        SELECT 1 FROM public.orders o2
        WHERE o2.customer_id = c.id
          AND o2.status = 'delivered'
          AND o2.delivered_at = (
            SELECT MIN(o3.delivered_at)
            FROM public.orders o3
            WHERE o3.customer_id = c.id AND o3.status = 'delivered'
          )
          AND o2.delivered_at >= v_month_start
          AND o2.delivered_at < v_month_end
      ) AS is_new_customer
    FROM public.customers c
    LEFT JOIN customer_delivered_orders cdo ON cdo.customer_id = c.id
    LEFT JOIN customer_visits cv ON cv.customer_id = c.id
    WHERE (c.owner_id = p_employee_id OR c.owner_id IN (SELECT identity_id FROM public.employees WHERE id = p_employee_id))
      AND c.is_active = true
    GROUP BY c.id, c.company_name, cv.visit_count
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'customer_id', ca.customer_id,
      'customer_name', ca.customer_name,
      'total_sales', ca.total_sales,
      'total_orders', ca.total_orders,
      'total_visits', ca.total_visits,
      'is_new_customer', ca.is_new_customer
    )
    ORDER BY ca.total_sales DESC
  ) INTO v_result
  FROM customer_agg ca
  WHERE ca.total_sales > 0 OR ca.total_visits > 0 OR ca.is_new_customer = true;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_rep_customer_kpis IS 'L4 drill-down: customer KPIs for a sales rep';

-- ============================================================
-- RPC 4: get_customer_delivered_orders  (Level 5)
-- Returns delivered orders for a customer in the given period
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_delivered_orders(
  p_token uuid,
  p_customer_id uuid,
  p_month int DEFAULT NULL,
  p_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_is_upper boolean;
  v_target_month int;
  v_target_year int;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.employee_roles er
    JOIN public.roles r ON r.id = er.role_id
    WHERE er.employee_id = v_session.employee_id
    AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')
  ) INTO v_is_upper;
  IF NOT v_is_upper THEN RETURN jsonb_build_object('error', 'FORBIDDEN'); END IF;

  v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_month_start := date_trunc('month', make_date(v_target_year, v_target_month, 1));
  v_month_end := v_month_start + INTERVAL '1 month';

  SELECT jsonb_agg(
    jsonb_build_object(
      'order_id', o.id,
      'order_code', o.order_number,
      'total_amount', o.total_amount,
      'delivered_at', o.delivered_at,
      'status', o.status
    )
    ORDER BY o.delivered_at DESC
  ) INTO v_result
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.status = 'delivered'
    AND o.delivered_at >= v_month_start
    AND o.delivered_at < v_month_end;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_customer_delivered_orders IS 'L5 drill-down: delivered orders for a customer';
