import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export const attendanceService = {
  async startWorkday(lat?: number, lng?: number, deviceStatus?: Record<string, unknown>) {
    const token = getToken()
    const { data, error } = await supabase.rpc('start_workday', {
      p_token: token,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_device_status: deviceStatus ?? null,
    })
    if (error) throw error
    return data as { session_id: string; started_at: string }
  },

  async endWorkday(sessionId: string, lat?: number, lng?: number, deviceStatus?: Record<string, unknown>) {
    const token = getToken()
    const { data, error } = await supabase.rpc('end_workday', {
      p_token: token,
      p_session_id: sessionId,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_device_status: deviceStatus ?? null,
    })
    if (error) throw error
    return data as {
      session_id: string
      ended_at: string
      auto_closed_breaks: number
      attendance_status: string
      late_minutes: number
      early_departure_minutes: number
    }
  },

  async startBreak(sessionId: string, lat?: number, lng?: number, reason?: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('start_break', {
      p_token: token,
      p_session_id: sessionId,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_reason: reason ?? null,
    })
    if (error) throw error
    return data as { break_id: string; break_start: string }
  },

  async endBreak(sessionId: string, breakId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('end_break', {
      p_token: token,
      p_session_id: sessionId,
      p_break_id: breakId,
    })
    if (error) throw error
    return data as { break_id: string; break_end: string; duration_seconds: number }
  },

  async getMyStatus() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_my_workday_status', { p_token: token })
    if (error) throw error
    return data as {
      status: string | null
      session_id?: string
      started_at?: string
      ended_at?: string
      duration_minutes?: number
      break_count?: number
      break_minutes?: number
      visit_count?: number
      net_work_minutes?: number
      on_break?: boolean
      open_break_id?: string
      employee_name?: string
      employee_code?: string
      work_location?: string | null
      schedule_type?: string | null
      attendance_enabled?: boolean | null
      required_daily_hours?: number
      today_orders?: number
      today_sales?: number
      today_collections?: number
      today_collection_amount?: number
      today_new_customers?: number
      daily_target_vs_actual?: Record<string, unknown>
    } | null
  },

  async getSettings() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_workday_settings', { p_token: token })
    if (error) throw error
    return data as Record<string, unknown> | null
  },

  async updateSettings(fields: Record<string, unknown>) {
    const token = getToken()
    const { data, error } = await supabase.rpc('update_workday_settings', {
      p_token: token,
      p_fields: fields,
    })
    if (error) throw error
    return data as { success: boolean }
  },

  async getLiveOverview() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_live_workday_overview', { p_token: token })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getAutoClosedToday() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_auto_closed_sessions_today', { p_token: token })
    if (error) throw error
    return data as Array<{
      employee_name: string
      employee_code: string
      close_reason: string
      last_seen_at: string
      auto_closed_at: string
      start_time: string
      date: string
    }>
  },

  async getAutoClosedMonth() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_auto_closed_sessions_month', { p_token: token })
    if (error) throw error
    return data as { total_count: number; by_reason: Record<string, number>; details: Array<Record<string, unknown>> }
  },

  async getEmployeeTimeline(employeeId: string, date?: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_employee_day_timeline', {
      p_token: token,
      p_employee_id: employeeId,
      p_date: date ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getEmployeeDayMap(employeeId: string, date?: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_employee_day_map', {
      p_token: token,
      p_employee_id: employeeId,
      p_date: date ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getEmployeeHistory(employeeId: string, from: string, to: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_employee_workday_history', {
      p_token: token,
      p_employee_id: employeeId,
      p_from: from,
      p_to: to,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getTeamMap() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_team_map', { p_token: token })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getReport(from: string, to: string, employeeIds?: string[]) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_workday_report', {
      p_token: token,
      p_from: from,
      p_to: to,
      p_employee_ids: employeeIds ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getAttendanceAnalysis(from: string, to: string, employeeIds?: string[]) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_attendance_analysis', {
      p_token: token,
      p_from: from,
      p_to: to,
      p_employee_ids: employeeIds ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getAlerts() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_alerts', { p_token: token })
    if (error) throw error
    return data as { active_alerts: unknown[]; resolved_alerts: unknown[] }
  },

  async getEmployeeCurrentLocation(employeeId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_employee_current_location', {
      p_token: token,
      p_employee_id: employeeId,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  // Work Policies
  async getEmployeeWorkPolicy(employeeId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_employee_work_policy', {
      p_token: token,
      p_employee_id: employeeId,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getMyWorkPolicy() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_my_work_policy', { p_token: token })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async upsertEmployeeWorkPolicy(params: {
    employee_id: string
    work_location?: string
    schedule_type?: string
    tracking_required?: boolean
    required_daily_hours?: number
    shift_start_time?: string
    shift_end_time?: string
    late_threshold_minutes?: number
    early_departure_threshold_minutes?: number
  }) {
    const token = getToken()
    const { data, error } = await supabase.rpc('upsert_employee_work_policy', {
      p_token: token,
      ...params,
    })
    if (error) throw error
    return data as { success: boolean; policy_id: string }
  },

  async batchUpsertWorkPolicies(policies: Record<string, unknown>[]) {
    const token = getToken()
    const { data, error } = await supabase.rpc('batch_upsert_work_policies', {
      p_token: token,
      p_policies: JSON.stringify(policies),
    })
    if (error) throw error
    return data as { success: boolean; updated: number; errors: unknown[] }
  },

  async listWorkPolicies() {
    const token = getToken()
    const { data, error } = await supabase.rpc('list_work_policies', { p_token: token })
    if (error) throw error
    return data as { policies: unknown[] }
  },

  async syncTrackingPoints(sessionId: string, points: Record<string, unknown>[]) {
    const token = getToken()
    const { data, error } = await supabase.rpc('sync_tracking_points', {
      p_token: token,
      p_session_id: sessionId,
      p_points: points,
    })
    if (error) throw error
    return data as { synced: number; rejected: number }
  },

  async getWorkdaySettings() {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_workday_settings', { p_token: token })
    if (error) throw error
    return data as { location_interval_seconds?: number; tracking_mode?: string } | null
  },

  // === Phase 2: Work Hours Ledger ===

  async calculateNetWorkHours(sessionId: string) {
    const { data, error } = await supabase.rpc('calculate_net_work_hours', {
      p_session_id: sessionId,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getWorkHoursLedger(employeeId?: string, from?: string, to?: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_work_hours_ledger', {
      p_token: token,
      p_employee_id: employeeId ?? null,
      p_from: from ?? null,
      p_to: to ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getDailyTargetVsActual(employeeId?: string, date?: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_daily_target_vs_actual', {
      p_token: token,
      p_employee_id: employeeId ?? null,
      p_date: date ?? null,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },

  async getCompletedWorkdaysHistory(params: {
    p_from: string
    p_to: string
    p_search?: string | null
    p_sort_by?: string
    p_sort_order?: string
    p_page?: number
    p_per_page?: number
  }) {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_completed_workdays_history', {
      p_token: token,
      p_from: params.p_from,
      p_to: params.p_to,
      p_search: params.p_search ?? null,
      p_sort_by: params.p_sort_by ?? 'total_net_minutes',
      p_sort_order: params.p_sort_order ?? 'desc',
      p_page: params.p_page ?? 1,
      p_per_page: params.p_per_page ?? 20,
    })
    if (error) throw error
    return data as Record<string, unknown>
  },
}
