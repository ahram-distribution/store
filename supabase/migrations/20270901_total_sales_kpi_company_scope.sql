CREATE OR REPLACE FUNCTION public.get_total_sales_company(
  p_token uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_is_super boolean;
  v_visible uuid[];
  v_sales numeric;
  v_count int;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'NOT_EMPLOYEE');
  END IF;

  v_is_super := public.is_upper_management(v_session.employee_id);
  v_visible := COALESCE(public.get_visible_employee_ids(p_token), '{}'::uuid[]);

  SELECT COALESCE(SUM(o.total_amount), 0), COUNT(*)::int
  INTO v_sales, v_count
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.created_at::date >= p_from
    AND o.created_at::date <= p_to
    AND public.is_order_in_statistics(o.status)
    AND (v_is_super OR c.owner_id = ANY(v_visible));

  RETURN jsonb_build_object('sales', v_sales, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_total_sales_company TO authenticated;

COMMENT ON FUNCTION public.get_total_sales_company IS 'Company-scope Total Sales KPI: all statistical orders in the month, independent of employee ownership. Same month filter, status rule, and amount field (orders.total_amount) as the activity batch.';
