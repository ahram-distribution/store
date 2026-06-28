import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

async function rpcCall<T>(rpcName: string, params: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
  const result = await supabase.rpc(rpcName, params)
  if (result.error) return result
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data) && 'error' in result.data) {
    const errData = result.data as Record<string, unknown>
    return { data: null, error: new Error(String(errData.detail || errData.error)) }
  }
  return result
}

export const targetService = {
  async getCompanyTarget(month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_governed_company_monthly_target', { p_token: t, p_month: month ?? null, p_year: year ?? null })
  },

  async upsertCompanyTarget(
    month: number,
    year: number,
    salesTarget: number,
    visitsTarget: number,
    ordersTarget: number,
    newCustomersTarget: number,
    salesWeight: number,
    visitsWeight: number,
    ordersWeight: number,
    newCustomersWeight: number,
    collectionsWeight: number = 20,
    attendanceWeight: number = 15,
    token?: string
  ) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('governed_upsert_company_monthly_target', {
      p_token: t, p_target_month: month, p_target_year: year,
      p_sales_target: salesTarget, p_visits_target: visitsTarget,
      p_orders_target: ordersTarget, p_new_customers_target: newCustomersTarget,
      p_sales_weight_percent: salesWeight, p_visits_weight_percent: visitsWeight,
      p_orders_weight_percent: ordersWeight, p_new_customers_weight_percent: newCustomersWeight,
      p_collections_weight_percent: collectionsWeight, p_attendance_weight_percent: attendanceWeight,
    })
  },

  async getEmployeeTargets(month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_governed_employee_monthly_targets', { p_token: t, p_month: month ?? null, p_year: year ?? null })
  },

  async upsertEmployeeTarget(employeeId: string, month: number, year: number, salesTarget: number, visitsTarget: number, ordersTarget: number, newCustomersTarget: number, collectionsTarget: number = 0, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('governed_upsert_employee_monthly_target', {
      p_token: t, p_employee_id: employeeId, p_target_month: month, p_target_year: year,
      p_sales_target: salesTarget, p_visits_target: visitsTarget, p_orders_target: ordersTarget,
      p_new_customers_target: newCustomersTarget, p_collections_target: collectionsTarget,
    })
  },

  async getPerformance(month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_governed_target_performance', { p_token: t, p_month: month ?? null, p_year: year ?? null })
  },

  async getKpiContributors(kpiType: string, month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_kpi_contributors', { p_token: t, p_kpi_type: kpiType, p_month: month ?? null, p_year: year ?? null })
  },

  async getTeamMembersKpis(managerId: string, kpiType: string, month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_team_members_kpis', { p_token: t, p_manager_id: managerId, p_kpi_type: kpiType, p_month: month ?? null, p_year: year ?? null })
  },

  async getRepCustomerKpis(employeeId: string, month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_rep_customer_kpis', { p_token: t, p_employee_id: employeeId, p_month: month ?? null, p_year: year ?? null })
  },

  async getAllActiveEmployees(token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_governed_active_employees', { p_token: t })
  },

  async getCustomerDeliveredOrders(customerId: string, month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_customer_delivered_orders', { p_token: t, p_customer_id: customerId, p_month: month ?? null, p_year: year ?? null })
  },

  async getWeightOverrides(month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('get_employee_weight_overrides', { p_token: t, p_month: month ?? null, p_year: year ?? null })
  },

  async upsertWeightOverride(employeeId: string, month: number, year: number, salesWeight: number | null, collectionsWeight: number | null, visitsWeight: number | null, newCustomersWeight: number | null, attendanceWeight: number | null, reason: string | null, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('governed_upsert_employee_weight_override', {
      p_token: t, p_employee_id: employeeId, p_target_month: month, p_target_year: year,
      p_sales_weight_percent: salesWeight, p_collections_weight_percent: collectionsWeight,
      p_visits_weight_percent: visitsWeight, p_new_customers_weight_percent: newCustomersWeight,
      p_attendance_weight_percent: attendanceWeight, p_override_reason: reason,
    })
  },

  async deactivateWeightOverride(overrideId: string, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('deactivate_employee_weight_override', { p_token: t, p_override_id: overrideId })
  },

  async seedSalesRepTargets(dryRun: boolean = true, month?: number, year?: number, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return rpcCall('seed_sales_rep_monthly_targets', { p_token: t, p_month: month ?? null, p_year: year ?? null, p_dry_run: dryRun })
  },
}
