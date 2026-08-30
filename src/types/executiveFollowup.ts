export interface ExecPolicy {
  inactivity_timeout_minutes: number
  location_interval_seconds: number
  official_start_time?: string | null
  official_end_time?: string | null
}

export interface ExecPolicyControl {
  attendance_enabled: boolean
  follow_up_enabled: boolean
  schedule_type: 'fixed' | 'flexible'
  late_calculation_enabled: boolean
  early_calculation_enabled: boolean
  show_in_screen: boolean
  official_start_time: string | null
  official_end_time: string | null
  source: 'employee_override' | 'role_default' | 'system_default'
}

export interface ExecLastLocation {
  latitude: number | null
  longitude: number | null
  at: string | null
  source: string | null
  has_location: boolean
  freshness?: string | null
  age_seconds?: number | null
}

export interface ExecLive {
  session_id: string | null
  status: string | null
  attendance_status: string | null
  late_minutes: number | null
  early_departure_minutes: number | null
  close_reason: string | null
  start_time: string | null
  end_time: string | null
  elapsed_minutes: number | null
  net_minutes: number | null
  on_visit: boolean
  on_break: boolean
  active_break_count: number
  last_seen_at: string | null
  distance_meters: number | null
  progress_pct: number | null
  last_location: ExecLastLocation
  last_event: { type: string | null; at: string | null; has_event: boolean }
}

export interface ExecEmployeePeriod {
  worked_days: number
  present_minutes: number
  break_count: number
  break_minutes: number
  late_days: number
  late_minutes_total: number
  early_days: number
  early_minutes_total: number
  auto_closed_days: number
  orders: number
  sales: number
  visits: number
  collections: number
  collection_amount: number
  new_customers: number
  distance_meters: number
}

export interface ExecEmployeeRow {
  employee_id: string
  code: string
  name: string
  role_name: string | null
  is_active: boolean
  manager_id: string | null
  work_location: string | null
  schedule_type: string | null
  required_daily_hours: number | null
  official_start_time: string | null
  official_end_time: string | null
  period: ExecEmployeePeriod
  connection_status: string
  first_activity_at: string | null
  last_activity_at: string | null
  last_activity_type: string | null
  policy: ExecPolicyControl
  live: ExecLive | null
}

export interface ExecFollowupResponse {
  error: string | null
  live_mode: boolean
  total: number
  period: { from: string; to: string }
  policy: ExecPolicy
  employees: ExecEmployeeRow[]
}

export interface ExecOverviewKpis {
  error: string | null
  live_mode: boolean
  period: { from: string; to: string }
  policy: ExecPolicy
  control: {
    shown_total: number
    hidden_total: number
    attendance_monitored: number
    follow_up_monitored: number
    flexible: number
    fixed: number
  } | null
  definition_note: string
  kpis: {
    workforce: number
    present_employees: number
    worked_days_total: number
    presence_hours_total: number
    avg_daily_presence_minutes: number
    late_days_total: number
    late_minutes_total: number
    early_days_total: number
    auto_closed_days_total: number
    attendance_monitored: number
    follow_up_monitored: number
    fixed_count: number
    flexible_count: number
    not_started: number
    absence_days: number
    sales_per_worked_hour: number
    avg_worked_hours: number
    total_orders: number
    total_sales: number
    total_visits: number
    total_collections: number
    collection_amount: number
    total_new_customers: number
    best_performer: { employee_id: string; name: string; code: string; sales: number; orders: number; presence_hours: number; sales_per_hour: number } | null
    worst_performer: { employee_id: string; name: string; code: string; sales: number; orders: number; presence_hours: number; sales_per_hour: number } | null
    live: {
      active_today: number
      on_visit_today: number
      on_break_today: number
      connected_today: number
      delayed_today: number
      lost_today: number
      no_data_today: number
      no_start_today: number
      ended_today: number
      auto_closed_today: number
      late_today: number
    } | null
  }
}

export interface ExecDaySession {
  session_id: string
  date: string
  start_time: string | null
  end_time: string | null
  status: string | null
  attendance_status: string | null
  late_minutes: number | null
  early_departure_minutes: number | null
  close_reason: string | null
  visit_count: number | null
  distance_meters: number | null
  elapsed_minutes: number | null
  net_minutes: number | null
  last_seen_at: string | null
}

export interface ExecDayDetail {
  error: string | null
  employee: {
    employee_id: string
    code: string
    name: string
    role_name: string | null
    is_active: boolean
    work_location: string | null
    schedule_type: string | null
    required_daily_hours: number | null
    shift_start_time: string | null
    shift_end_time: string | null
  }
  policy: ExecPolicy
  control: ExecPolicyControl
  can_view_all: boolean
  permission_note: string | null
  session: ExecDaySession | null
  working_time: {
    start: string | null
    end: string | null
    elapsed_minutes: number
    net_minutes: number
    break_minutes: number
    break_count: number
  } | null
  breaks: Array<{
    id: string
    break_start: string | null
    break_end: string | null
    duration_seconds: number | null
    break_reason: string | null
    auto_closed: boolean | null
    latitude: number | null
    longitude: number | null
  }>
  visits: Array<Record<string, unknown>>
  orders: Array<Record<string, unknown>>
  collections: Array<Record<string, unknown>>
  new_customers: Array<Record<string, unknown>>
  connection_status: string | null
  day_location: ExecLastLocation | null
  last_event: { type: string | null; at: string | null; has_event: boolean }
  auto_close: { reason: string; reason_label: string; policy_minutes: number } | null
  comparison: { prev_day: { date: string; net_minutes: number | null; orders: number; sales: number; visits: number; collections: number } }
}

export interface ExecTimelineEvent {
  t: string | null
  type: string
  label: string
  detail: string
  has_location: boolean
  latitude: number | null
  longitude: number | null
  location_source: string | null
  gap_minutes: number
}

export interface ExecTimeline {
  error: string | null
  date: string
  employee_id: string
  session: { session_id: string; start_time: string | null; end_time: string | null; status: string | null; close_reason: string | null } | null
  summary: {
    event_count: number
    tracking_count: number
    visit_count: number
    order_count: number
    collection_count: number
    break_count: number
    idle_minutes: number
    truncated: boolean
  }
  events: ExecTimelineEvent[]
}

export interface ExecTrackingPoint {
  id: string
  recorded_at: string
  point_type: string | null
  event_type: string
  event_label: string
  event_name: string | null
  event_details: string | null
  is_last_seen: boolean
  latitude: number
  longitude: number
  accuracy_meters: number | null
  speed_mps: number | null
  heading_degrees: number | null
}

export interface ExecTrackingPointsResponse {
  error: string | null
  date: string
  employee_id: string
  points: ExecTrackingPoint[]
}

export interface ExecAutoCloseReport {
  error: string | null
  period: { from: string; to: string }
  policy: ExecPolicy
  by_reason: {
    auto_closed_inactivity: number
    no_activity_timeout: number
    day_rollover: number
    total: number
  }
  sessions: Array<{
    session_id: string
    employee_id: string
    employee_name: string
    code: string
    date: string
    start_time: string | null
    end_time: string | null
    close_reason: string
    attendance_status: string | null
    last_activity_at: string | null
    inactive_minutes: number | null
  }>
}

export interface ExecWorkforceHistory {
  error: string | null
  period: { from: string; to: string }
  totals: {
    present_days: number
    presence_hours_total: number
    avg_daily_presence_hours: number
    late_days: number
    early_days: number
    auto_closed_days: number
    orders: number
    sales: number
    visits: number
    collections: number
    collection_amount: number
    new_customers: number
  }
  employees: Array<{
    employee_id: string
    code: string
    name: string
    role_name: string | null
    is_active: boolean
    work_location: string | null
    schedule_type: string | null
    required_daily_hours: number | null
    shift_start_time: string | null
    shift_end_time: string | null
    policy: {
      schedule_type: 'fixed' | 'flexible'
      late_calculation_enabled: boolean
      early_calculation_enabled: boolean
      source: 'employee_override' | 'role_default' | 'system_default'
    }
    days: Array<{
      date: string
      start_time: string | null
      end_time: string | null
      status: string | null
      attendance_status: string | null
      late_minutes: number | null
      early_minutes: number | null
      close_reason: string | null
      net_minutes: number
      break_count: number
      break_minutes: number
      visit_count: number
      orders: number
      sales: number
      collections: number
      collection_amount: number
      new_customers: number
    }>
  }>
  matrix: Array<{
    date: string
    employee_id: string
    code: string
    name: string
    present: boolean
    schedule_type: 'fixed' | 'flexible'
    net_minutes: number
    status: string | null
    attendance_status: string | null
    close_reason: string | null
  }>
}

export type ExecConnectionFilter = 'connected' | 'delayed' | 'lost' | 'no_data' | ''
export type ExecAttendanceFilter = 'working' | 'on_visit' | 'on_break' | 'no_start' | 'ended' | 'auto_closed' | 'late' | 'early' | 'absent' | ''
export type ExecWorkTypeFilter = 'maktabi' | 'midani' | ''
export type ExecShownFilter = 'included' | 'excluded' | ''
export type ExecSort = 'name' | 'sales' | 'present' | 'days' | 'connection'
export type ExecPeriodPreset = 'today' | 'yesterday' | 'current_week' | 'prev_week' | 'current_month' | 'prev_month' | 'custom'

export type ExecControlSource = 'employee_override' | 'role_default' | 'system_default'

export interface ExecControlRoleDefault {
  role_id: string
  role_name: string
  attendance_enabled: boolean
  follow_up_enabled: boolean
  schedule_type: 'fixed' | 'flexible'
  late_calculation_enabled: boolean
  early_calculation_enabled: boolean
  show_in_screen: boolean
  official_start_time: string | null
  official_end_time: string | null
  employee_count: number
}

export interface ExecControlEmployee {
  employee_id: string
  code: string
  name: string
  role_name: string
  override: Partial<ExecPolicyControl> | null
  attendance_enabled: boolean
  follow_up_enabled: boolean
  schedule_type: 'fixed' | 'flexible'
  work_type?: 'fixed' | 'flexible'
  late_calculation_enabled: boolean
  early_calculation_enabled: boolean
  show_in_screen: boolean
  official_start_time: string | null
  official_end_time: string | null
  last_changed_at: string | null
  source: ExecControlSource
}

export interface ExecControlAuditEntry {
  id: string
  entity_type: 'role' | 'employee'
  entity_id: string
  entity_label: string | null
  policy_key: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  changed_at: string
  changed_by_name: string | null
}

export interface ExecControlPolicyResponse {
  error: string | null
  stats: {
    roles_with_default: number
    employee_overrides: number
    shown_total: number
    hidden_total: number
    attendance_monitored: number
    follow_up_monitored: number
    flexible: number
    fixed: number
  }
  role_defaults: ExecControlRoleDefault[]
  employees: ExecControlEmployee[]
  audit: ExecControlAuditEntry[]
}

export interface ExecControlMutationResult {
  error: string | null
  role_id?: string
  role_name?: string
  employee_id?: string
  employee_name?: string
  cleared?: boolean
  changed_at?: string
  changed_by?: string
  audit_rows?: number
}
