import { supabase } from '../lib/supabase'
import { cairoDateComponents, getBusinessWeekStart } from '../lib/dateRange'
import { exportToPdf, kpiGridToHtml, tableToHtml } from './pdfExporter'
import * as XLSX from 'xlsx'
import type {
  ExecAttendanceFilter,
  ExecAutoCloseReport,
  ExecConnectionFilter,
  ExecControlMutationResult,
  ExecControlPolicyResponse,
  ExecDayDetail,
  ExecEmployeeRow,
  ExecFollowupResponse,
  ExecOverviewKpis,
  ExecPeriodPreset,
  ExecPolicy,
  ExecTimeline,
  ExecTrackingPointsResponse,
  ExecWorkforceHistory,
} from '../types/executiveFollowup'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function iso(y: number, m: number, d: number): string { return `${y}-${pad(m)}-${pad(d)}` }

function addDays(y: number, m: number, d: number, delta: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]
}

export interface ExecPeriodRange { from: string; to: string }

export function execPeriodRange(preset: ExecPeriodPreset, customFrom?: string, customTo?: string): ExecPeriodRange {
  const [y, m, d] = cairoDateComponents(new Date())
  switch (preset) {
    case 'today': return { from: iso(y, m, d), to: iso(y, m, d) }
    case 'yesterday': {
      const [yy, ym, yd] = addDays(y, m, d, -1)
      return { from: iso(yy, ym, yd), to: iso(yy, ym, yd) }
    }
    case 'current_week': {
      const { year: sy, month: sm, day: sd } = getBusinessWeekStart(y, m, d)
      return { from: iso(sy, sm, sd), to: iso(y, m, d) }
    }
    case 'prev_week': {
      const { year: sy, month: sm, day: sd } = getBusinessWeekStart(y, m, d)
      const [py, pm, pd] = addDays(sy, sm, sd, -7)
      const [ey, em, ed] = addDays(py, pm, pd, 6)
      return { from: iso(py, pm, pd), to: iso(ey, em, ed) }
    }
    case 'current_month': {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return { from: iso(y, m, 1), to: iso(y, m, last) }
    }
    case 'prev_month': {
      const pm = m === 1 ? 12 : m - 1
      const py = m === 1 ? y - 1 : y
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
      return { from: iso(py, pm, 1), to: iso(py, pm, last) }
    }
    case 'custom': {
      if (!customFrom || !customTo) return { from: iso(y, m, d), to: iso(y, m, d) }
      return { from: customFrom, to: customTo }
    }
  }
}

export const PERIOD_PRESETS: { key: ExecPeriodPreset; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'current_week', label: 'الأسبوع الحالي' },
  { key: 'prev_week', label: 'الأسبوع الماضي' },
  { key: 'current_month', label: 'الشهر الحالي' },
  { key: 'prev_month', label: 'الشهر الماضي' },
  { key: 'custom', label: 'مخصص' },
]

export const CONNECTION_OPTIONS: { key: ExecConnectionFilter; label: string }[] = [
  { key: 'connected', label: 'متصل' },
  { key: 'delayed', label: 'متأخر' },
  { key: 'lost', label: 'مفقود الاتصال' },
  { key: 'no_data', label: 'لا بيانات' },
]

export const ATTENDANCE_OPTIONS: { key: ExecAttendanceFilter; label: string }[] = [
  { key: 'working', label: 'يعمل الآن' },
  { key: 'on_visit', label: 'على زيارة' },
  { key: 'on_break', label: 'في استراحة' },
  { key: 'no_start', label: 'لم يبدأ' },
  { key: 'ended', label: 'أنهى اليوم' },
  { key: 'auto_closed', label: 'إغلاق تلقائي' },
  { key: 'late', label: 'متأخر' },
  { key: 'early', label: 'مغادرة مبكرة' },
  { key: 'absent', label: 'غائب' },
]

export const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: 'name', label: 'الاسم' },
  { key: 'sales', label: 'صافي المبيعات' },
  { key: 'present', label: 'دقائق الحضور' },
  { key: 'days', label: 'أيام العمل' },
  { key: 'connection', label: 'حالة الاتصال' },
]

export const WORK_TYPE_OPTIONS: { key: 'maktabi' | 'midani' | ''; label: string }[] = [
  { key: '', label: 'الكل' },
  { key: 'maktabi', label: 'مكتبي' },
  { key: 'midani', label: 'ميداني' },
]

export const SHOWN_OPTIONS: { key: 'included' | 'excluded' | ''; label: string }[] = [
  { key: 'included', label: 'المشمولون' },
  { key: 'excluded', label: 'غير المشمولين' },
  { key: '', label: 'الكل' },
]

export interface ExecListParams {
  from: string
  to: string
  includeInactive: boolean
  search?: string
  connection?: string
  attendance?: string
  workType?: 'maktabi' | 'midani' | ''
  shown?: 'included' | 'excluded' | ''
  page?: number
  pageSize?: number
  sort?: string
}

export const executiveService = {
  async getKpis(from: string, to: string, includeInactive: boolean): Promise<ExecOverviewKpis> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_overview_kpis', {
      p_token: token, p_from: from, p_to: to, p_include_inactive: includeInactive,
    })
    if (error) throw error
    return data as ExecOverviewKpis
  },

  async getFollowupList(params: ExecListParams): Promise<ExecFollowupResponse> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_followup_list', {
      p_token: token,
      p_from: params.from,
      p_to: params.to,
      p_include_inactive: params.includeInactive,
      p_search: params.search || null,
      p_connection: params.connection || null,
      p_attendance: params.attendance || null,
      p_page: params.page ?? 0,
      p_page_size: params.pageSize ?? 100,
      p_sort: params.sort || 'name',
      p_work_type: params.workType || null,
      p_shown: params.shown || null,
    })
    if (error) throw error
    return data as ExecFollowupResponse
  },

  async getAllForExport(params: ExecListParams): Promise<ExecEmployeeRow[]> {
    const rows: ExecEmployeeRow[] = []
    let page = 0
    const pageSize = 500
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await executiveService.getFollowupList({ ...params, page, pageSize })
      if (res.error) throw new Error(res.error)
      rows.push(...(res.employees || []))
      if (!res.employees || res.employees.length < pageSize) break
      if (rows.length >= res.total) break
      page += 1
      if (page > 50) break
    }
    return rows
  },

  async getDayDetail(employeeId: string, date: string): Promise<ExecDayDetail> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_employee_day_detail', {
      p_token: token, p_employee_id: employeeId, p_date: date,
    })
    if (error) throw error
    return data as ExecDayDetail
  },

  async getTimeline(employeeId: string, date: string): Promise<ExecTimeline> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_day_timeline', {
      p_token: token, p_employee_id: employeeId, p_date: date,
    })
    if (error) throw error
    return data as ExecTimeline
  },

  async getTrackingPoints(employeeId: string, date: string): Promise<ExecTrackingPointsResponse> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_tracking_points', {
      p_token: token, p_employee_id: employeeId, p_date: date,
    })
    if (error) throw error
    return data as ExecTrackingPointsResponse
  },

  async getAutoCloseReport(from: string, to: string): Promise<ExecAutoCloseReport> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_auto_close_report', {
      p_token: token, p_from: from, p_to: to,
    })
    if (error) throw error
    return data as ExecAutoCloseReport
  },

  async getWorkforceHistory(from: string, to: string, includeInactive: boolean): Promise<ExecWorkforceHistory> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_workforce_history', {
      p_token: token, p_from: from, p_to: to, p_include_inactive: includeInactive,
    })
    if (error) throw error
    return data as ExecWorkforceHistory
  },

  async getPolicy(): Promise<ExecPolicy> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_policy', { p_token: token })
    if (error) throw error
    return data as ExecPolicy
  },

  async setPolicy(minutes: number): Promise<{ old_value: number; new_value: number; changed_at: string }> {
    const token = getToken()
    const { data, error } = await supabase.rpc('set_executive_policy', {
      p_token: token, p_inactivity_timeout_minutes: minutes,
    })
    if (error) throw error
    return data as { old_value: number; new_value: number; changed_at: string }
  },

  async getControlPolicy(): Promise<ExecControlPolicyResponse> {
    const token = getToken()
    const { data, error } = await supabase.rpc('get_executive_control_policy', { p_token: token })
    if (error) throw error
    return data as ExecControlPolicyResponse
  },

  async setRoleDefault(args: {
    role_id: string
    attendance_enabled: boolean
    follow_up_enabled: boolean
    schedule_type: string
    late_calculation_enabled: boolean
    early_calculation_enabled: boolean
    show_in_screen?: boolean
    official_start_time?: string | null
    official_end_time?: string | null
    reason?: string
  }): Promise<ExecControlMutationResult> {
    const token = getToken()
    const { data, error } = await supabase.rpc('set_executive_role_default', {
      p_token: token,
      p_role_id: args.role_id,
      p_attendance_enabled: args.attendance_enabled,
      p_follow_up_enabled: args.follow_up_enabled,
      p_schedule_type: args.schedule_type,
      p_late_calculation_enabled: args.late_calculation_enabled,
      p_early_calculation_enabled: args.early_calculation_enabled,
      p_show_in_screen: args.show_in_screen ?? true,
      p_official_start_time: args.official_start_time ?? null,
      p_official_end_time: args.official_end_time ?? null,
      p_reason: args.reason ?? null,
    })
    if (error) throw error
    return data as ExecControlMutationResult
  },

  async setEmployeeOverride(args: {
    employee_id: string
    attendance_enabled: boolean
    follow_up_enabled: boolean
    schedule_type: string
    late_calculation_enabled: boolean
    early_calculation_enabled: boolean
    show_in_screen?: boolean
    official_start_time?: string | null
    official_end_time?: string | null
    clear?: boolean
    reason?: string
  }): Promise<ExecControlMutationResult> {
    const token = getToken()
    const { data, error } = await supabase.rpc('set_executive_employee_override', {
      p_token: token,
      p_employee_id: args.employee_id,
      p_attendance_enabled: args.attendance_enabled,
      p_follow_up_enabled: args.follow_up_enabled,
      p_schedule_type: args.schedule_type,
      p_late_calculation_enabled: args.late_calculation_enabled,
      p_early_calculation_enabled: args.early_calculation_enabled,
      p_show_in_screen: args.show_in_screen ?? true,
      p_official_start_time: args.official_start_time ?? null,
      p_official_end_time: args.official_end_time ?? null,
      p_clear_override: args.clear ?? false,
      p_reason: args.reason ?? null,
    })
    if (error) throw error
    return data as ExecControlMutationResult
  },
}

// ---------------------------------------------------------------------------
// تصدير Excel متعدد الأوراق (يعكس الفلاتر والنطاق الفعليين)
// ---------------------------------------------------------------------------

interface SheetSpec {
  name: string
  headers: string[]
  rows: (string | number | null)[][]
}

function buildSheet(spec: SheetSpec): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([spec.headers, ...spec.rows])
  ws['!freeze'] = { x: 0, y: 1 }
  ws['!cols'] = spec.headers.map((h) => ({ wch: Math.max(h.length * 2 + 2, 14) }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: spec.rows.length, c: spec.headers.length - 1 } }) }
  return ws
}

export function exportExecutiveExcel(args: {
  presetLabel: string
  from: string
  to: string
  filters: string[]
  kpis?: ExecOverviewKpis | null
  employees: ExecEmployeeRow[]
  policy: ExecPolicy | null
}): void {
  const now = new Date()
  const stamp = now.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }) +
    ' ' + now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })

  const sheets: SheetSpec[] = []

  // 1 — ملخص تنفيذي
  sheets.push({
    name: 'الملخص التنفيذي',
    headers: ['المؤشر', 'القيمة', 'الوصف'],
    rows: [
      ['الفترة', `${args.from} — ${args.to}`, args.presetLabel],
      ['تاريخ الطباعة', stamp, ''],
      ['عدد الموظفين', args.kpis?.kpis.workforce ?? null, 'القوى العاملة ضمن النطاق'],
      ['موظفون حاضرون', args.kpis?.kpis.present_employees ?? null, 'لديهم يوم عمل في الفترة'],
      ['أيام عمل (إجمالي)', args.kpis?.kpis.worked_days_total ?? null, ''],
      ['ساعات حضور (إجمالي)', args.kpis?.kpis.presence_hours_total ?? null, 'ساعة'],
      ['أيام تأخير', args.kpis?.kpis.late_days_total ?? null, ''],
      ['دقائق تأخير (إجمالي)', args.kpis?.kpis.late_minutes_total ?? null, ''],
      ['أيام مغادرة مبكرة', args.kpis?.kpis.early_days_total ?? null, ''],
      ['أيام إغلاق تلقائي', args.kpis?.kpis.auto_closed_days_total ?? null, ''],
      ['صافي المبيعات', args.kpis?.kpis.total_sales ?? null, ''],
      ['الطلبات', args.kpis?.kpis.total_orders ?? null, ''],
      ['الزيارات', args.kpis?.kpis.total_visits ?? null, ''],
      ['التحصيلات', args.kpis?.kpis.total_collections ?? null, ''],
      ['العملاء الجدد', args.kpis?.kpis.total_new_customers ?? null, ''],
      ['الأفضل أداءً', args.kpis?.kpis.best_performer ? `${args.kpis.kpis.best_performer.name} (${args.kpis.kpis.best_performer.sales_per_hour}/ساعة)` : '—', 'صافي المبيعات لكل ساعة حضور'],
      ['الأقل أداءً', args.kpis?.kpis.worst_performer ? `${args.kpis.kpis.worst_performer.name} (${args.kpis.kpis.worst_performer.sales_per_hour}/ساعة)` : '—', ''],
    ],
  })

  // 2 — الموظفون (الفترة + اللحظي)
  sheets.push({
    name: 'الموظفون',
    headers: ['الموظف', 'الكود', 'الدور', 'نشط', 'موقع العمل', 'الحالة اللحظية', 'حالة الاتصال', 'أيام عمل', 'دقائق حضور', 'دقائق استراحة', 'أيام تأخير', 'دقائق تأخير', 'أيام مبكر', 'أيام إغلاق تلقائي', 'طلبات', 'صافي مبيعات', 'زيارات', 'تحصيلات', 'قيمة تحصيلات', 'عملاء جدد', 'المسافة م'],
    rows: args.employees.map((e) => [
      e.name, e.code ?? '', e.role_name ?? '', e.is_active ? 'نعم' : 'لا', e.work_location ?? '',
      e.live?.status ?? '—', e.connection_status,
      e.period.worked_days, e.period.present_minutes, e.period.break_minutes,
      e.period.late_days, e.period.late_minutes_total, e.period.early_days, e.period.auto_closed_days,
      e.period.orders, e.period.sales, e.period.visits, e.period.collections,
      e.period.collection_amount, e.period.new_customers, e.period.distance_meters,
    ]),
  })

  // 3 — الحضور اليومي (المصفوفة)
  sheets.push({
    name: 'الحضور',
    headers: ['اليوم', 'الموظف', 'الحالة لحظي', 'حالة الحضور', 'التأخير د', 'مغادرة مبكرة د', 'المدة صافية د', 'عدد الاستراحات', 'دقائق الاستراحة', 'سبب/حالة الإغلاق'],
    rows: args.employees.flatMap((e) => {
      const live = e.live
      if (!live) return []
      return [[
        args.from === args.to ? args.from : '—',
        e.name,
        live.status ?? '—',
        live.attendance_status ?? '—',
        live.late_minutes ?? 0,
        live.early_departure_minutes ?? 0,
        live.net_minutes ?? 0,
        live.active_break_count,
        '—',
        live.close_reason ?? '—',
      ]]
    }),
  })

  // 4 — تعريفات المؤشرات
  sheets.push({
    name: 'تعريفات المؤشرات',
    headers: ['المؤشر', 'التعريف الموثق'],
    rows: [
      ['دقائق الحضور (net)', 'fixed_shift → المدة مطروحاً منها الاستراحات؛ المرن/بالساعة → المدة كما هي'],
      ['ساعات الحضور', 'مجموع دقائق الحضور ÷ 60'],
      ['الطلبات', 'طلبات غير draft/cancelled بتاريخ الإنشاء ضمن الفترة (resolve_employee_id للمالك)'],
      ['صافي المبيعات', 'مجموع total_amount للطلبات المستثناة أعلاه'],
      ['الزيارات', 'زيارات تاريخ الوصول (check_in_at) ضمن الفترة'],
      ['التحصيلات', 'جميع التحصيلات بتاريخ الإنشاء ضمن الفترة (عدد + مبلغ)'],
      ['العملاء الجدد', 'عملاء تاريخ الإنشاء ضمن الفترة'],
      ['مؤشر الأداء (best/worst)', 'صافي المبيعات ÷ ساعات الحضور لكل موظف'],
      ['حالة الاتصال', 'متصل (>5د) / متأخر (>25د) / مفقود / لا بيانات — من آخر نشاط خلال 24 ساعة'],
      ['الإغلاق التلقائي', 'auto_closed_inactivity / no_activity_timeout / day_rollover'],
      ['الأسبوع', 'السبت → الجمعة (توقيت القاهرة)'],
    ],
  })

  if (args.filters.length) {
    sheets.push({
      name: 'الفلاتر',
      headers: ['الفلاتر المطبقة'],
      rows: args.filters.map((f) => [f]),
    })
  }

  const wb = XLSX.utils.book_new()
  for (const spec of sheets) {
    XLSX.utils.book_append_sheet(wb, buildSheet(spec), spec.name.slice(0, 31))
  }
  wb.Workbook = { Views: [{ RTL: true }] }
  const periodPart = `${args.from}_${args.to}`
  XLSX.writeFile(wb, `الحضور_والمتابعة_${periodPart}.xlsx`)
}

// ---------------------------------------------------------------------------
// تصدير PDF (عبر مُصدِّر النظام العربي: طباعة نطاق مخصص)
// ---------------------------------------------------------------------------

export function exportExecutivePdf(args: {
  presetLabel: string
  from: string
  to: string
  filters: string[]
  kpis?: ExecOverviewKpis | null
  employees: ExecEmployeeRow[]
  byDate?: Record<string, Array<{ date: string; name: string; net_minutes: number | null; status: string | null }>>
}): void {
  const kpis = args.kpis?.kpis
  const kpiItems = kpis
    ? [
        { label: 'القوى العاملة', value: String(kpis.workforce), color: 'blue' },
        { label: 'موظفون حاضرون', value: String(kpis.present_employees), color: 'emerald' },
        { label: 'ساعات حضور (إجمالي)', value: String(kpis.presence_hours_total), color: 'blue' },
        { label: 'أيام عمل', value: String(kpis.worked_days_total), color: 'emerald' },
        { label: 'دقائق تأخير', value: String(kpis.late_minutes_total), color: 'amber' },
        { label: 'أيام إغلاق تلقائي', value: String(kpis.auto_closed_days_total), color: 'violet' },
        { label: 'صافي المبيعات', value: String(kpis.total_sales), color: 'emerald' },
        { label: 'الطلبات', value: String(kpis.total_orders), color: 'blue' },
        { label: 'الزيارات', value: String(kpis.total_visits), color: 'violet' },
        { label: 'التحصيلات', value: String(kpis.total_collections), color: 'emerald' },
        { label: 'العملاء الجدد', value: String(kpis.total_new_customers), color: 'blue' },
        { label: 'الأفضل/الأقل أداءً', value: `${kpis.best_performer ? kpis.best_performer.name : '—'} / ${kpis.worst_performer ? kpis.worst_performer.name : '—'}`, color: 'amber' },
      ]
    : []

  const empRows = args.employees.map((e) => [
    e.name,
    e.code ?? '',
    e.live?.status ?? '—',
    e.connection_status,
    e.period.worked_days,
    e.period.present_minutes,
    e.period.late_minutes_total,
    e.period.orders,
    e.period.sales,
    e.period.visits,
    e.period.collection_amount,
  ])

  exportToPdf({
    title: 'شاشة الحضور والمتابعة — تقرير',
    subtitle: `الحضور والمتابعة (${args.presetLabel} — ${args.from} إلى ${args.to})`,
    dateFrom: args.from,
    dateTo: args.to,
    orientation: 'landscape',
    sections: [
      {
        title: 'مؤشرات نظرة عامة',
        content: kpiItems.length ? kpiGridToHtml(kpiItems) : '<p class="text-muted">لا توجد بيانات.</p>',
      },
      {
        title: 'الفلاتر المطبقة',
        content: tableToHtml(['الفلاتر'], args.filters.map((f) => [f])),
      },
      {
        title: 'جدول الموظفين',
        content: tableToHtml(
          ['الموظف', 'الكود', 'الحالة اللحظية', 'حالة الاتصال', 'أيام عمل', 'دقائق حضور', 'دقائق تأخير', 'طلبات', 'صافي مبيعات', 'زيارات', 'قيمة تحصيلات'],
          empRows,
        ),
      },
    ],
  })
}

export { XLSX }
