-- Update canonical statistical rule: exclude draft, submitted, cancelled
-- All consumers (get_statistical_orders, get_employee_detail_data, etc.)
-- automatically inherit this change via is_order_in_statistics().

CREATE OR REPLACE FUNCTION public.is_order_in_statistics(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('draft', 'submitted', 'cancelled')
$$;
