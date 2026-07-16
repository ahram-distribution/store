export type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'prev_month' | 'custom'

export type ReportScope = 'company' | 'manager' | 'employee'

export type DrillLevel = 'company' | 'manager' | 'employee' | 'day' | 'records'

export interface ReportFilters {
  preset: ReportPreset
  dateFrom: string
  dateTo: string
  managerId: string | null
  employeeId: string | null
}

export interface ReportIdentity {
  title: string
  scope: ReportScope
  dateFrom: string
  dateTo: string
  generatedAt: string
  managerName?: string
  employeeName?: string
  employeeCode?: string
}

export interface KpiCardData {
  key: string
  label: string
  value: number | null
  format: 'number' | 'currency' | 'percentage'
  icon?: string
  color?: 'emerald' | 'amber' | 'blue' | 'violet'
}

export interface ReportPresetOption {
  key: ReportPreset
  label: string
}

export interface ActivityDailyRow {
  date: string
  start_time: string | null
  end_time: string | null
  net_minutes: number
  visits: number
  orders: number
  sales: number
  new_customers: number
  distance_meters: number
  has_activity: boolean
}

export interface ActivityKpi {
  sales: number
  orders: number
  visits: number
  customers: number
  netMinutes: number
  distanceMeters: number
}

export interface DayTimelineEvent {
  time: string
  type: string
  title: string
  description: string
  latitude?: string | null
  longitude?: string | null
}

export interface DayDetailData {
  timeline: {
    session: { start_time: string; end_time: string | null }
    events: DayTimelineEvent[]
  } | null
  mapData: {
    route: Array<{ latitude: number; longitude: number; time: string; type: string }>
    visit_locations: Array<{
      visit_id: string; customer_id: string; customer_name: string
      latitude: number; longitude: number
      check_in_at: string; check_out_at: string | null; visit_result: string
    }>
    long_stops?: Array<{
      start_time: string; end_time: string; duration_minutes: number
      latitude: number; longitude: number
    }>
    total_distance_km: number
    total_points: number
  } | null
}

export interface ActivityViewModel {
  employee: {
    employee_id: string
    full_name: string
    code: string
  }
  dateFrom: string
  dateTo: string
  kpi: ActivityKpi
  dailyRows: ActivityDailyRow[]
  detailData: {
    orders: any[]
    customers: any[]
    visits: any[]
  }
  loadDayData: (date: string) => Promise<DayDetailData>
  exportPdf: () => void
  exportExcel: () => void
}
