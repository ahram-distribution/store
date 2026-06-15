-- Pre-migration: Drop all functions that will be recreated in the main migration
-- This is needed because CREATE OR REPLACE FUNCTION cannot change return type

-- Step 1: is_upper_management
DROP FUNCTION IF EXISTS public.is_upper_management(uuid) CASCADE;

-- Step 4: session_is_upper_management
DROP FUNCTION IF EXISTS public.session_is_upper_management() CASCADE;

-- Step 5: get_visible_employee_ids
DROP FUNCTION IF EXISTS public.get_visible_employee_ids(uuid) CASCADE;

-- Step 5: app.get_visibility_ids
DROP FUNCTION IF EXISTS app.get_visibility_ids() CASCADE;

-- Step 7: Dashboard
DROP FUNCTION IF EXISTS public.get_upper_management_dashboard(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_dashboard_management(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_dashboard_transport(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_dashboard_warehouse(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_delivery_dashboard_stats(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_credit_dashboard_stats(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_sales_ranking(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_dashboard_sales(uuid, integer) CASCADE;

-- Step 8: Collections & Returns
DROP FUNCTION IF EXISTS public.get_collection_followup_queue(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_collections(uuid, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.governed_approve_return(uuid, uuid) CASCADE;

-- Step 9: Customer Analytics
DROP FUNCTION IF EXISTS public.get_customer_analytics_list(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_brands(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_card(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_products(uuid, uuid) CASCADE;

-- Step 10: Recovery - Multiple functions
DROP FUNCTION IF EXISTS public.get_governed_credit_application(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_credit_applications(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_deliveries(uuid, character varying) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_order(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_preparation_queue(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_return(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_return_items(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_returns(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_visit(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_visits(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_waiting_preparations(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_visible_customer_ids(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_visible_employees(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_warehouse_analytics(uuid) CASCADE;

-- Step 10: Order Dispatch
DROP FUNCTION IF EXISTS public.governed_dispatch_decision(uuid, uuid, text, uuid, text, timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS public.governed_reopen_cancelled(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.governed_return_to_preparation(uuid, uuid, text) CASCADE;

-- Step 10: Command Center
DROP FUNCTION IF EXISTS public.get_command_center(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_command_center_v2(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_module_detail(uuid, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.update_module_owner_field(uuid, varchar, varchar, text) CASCADE;
DROP FUNCTION IF EXISTS public.delete_module(uuid, varchar) CASCADE;

-- Step 10: Governance
DROP FUNCTION IF EXISTS public.get_governed_customer_contacts(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_customer_addresses(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.governed_global_search(uuid, text) CASCADE;

-- Step 14: Work Policies
DROP FUNCTION IF EXISTS public.get_work_policies_report(uuid, date, date, uuid[]) CASCADE;

-- Step 15: Active Employees
DROP FUNCTION IF EXISTS public.get_governed_active_employees(uuid) CASCADE;

-- Step 16: Monthly Targets New Customers
DROP FUNCTION IF EXISTS public.get_governed_company_monthly_target(uuid, integer, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.governed_upsert_company_monthly_target(uuid, integer, integer, integer, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_employee_monthly_targets(uuid, integer, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.governed_upsert_employee_monthly_target(uuid, uuid, integer, integer, integer, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.get_governed_target_performance(uuid, integer, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_upper_management_dashboard(uuid) CASCADE;

-- Step 17: Drilldown Performance
DROP FUNCTION IF EXISTS public.get_kpi_contributors(uuid, integer, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_team_members_kpis(uuid, date, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_rep_customer_kpis(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_customer_delivered_orders(uuid, uuid, integer, integer) CASCADE;

-- Step 18: Attendance Module
DROP FUNCTION IF EXISTS public.get_workday_settings(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_workday_settings(uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.get_workday_cleanup_log(uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_day_timeline(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_day_map(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_workday_history(uuid, uuid, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_attendance_analysis(uuid, date, date, uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_current_location(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_tracking_data(uuid, integer) CASCADE;

-- Step 19: Customer Code Snapshot
DROP FUNCTION IF EXISTS public.get_governed_orders(uuid, integer, integer, text) CASCADE;
