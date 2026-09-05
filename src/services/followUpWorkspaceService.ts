// Customer Follow-up Workspace service — wraps the 0023 migration RPCs additively.
// Existing followUpService callers are untouched. Every getter degrades gracefully
// when the RPC is not yet deployed to the database (available:false) so the UI can
// show an empty/offline state instead of crashing.

import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export type ContactMethod = 'call' | 'visit' | 'meeting' | 'email' | 'sms' | 'live_chat' | 'other'
export type SelectOption = string

export const CONTACT_METHODS: { value: ContactMethod; label: string }[] = [
  { value: 'call', label: 'اتصال هاتفي' },
  { value: 'visit', label: 'زيارة' },
  { value: 'meeting', label: 'اجتماع' },
  { value: 'email', label: 'بريد إلكتروني' },
  { value: 'sms', label: 'رسالة نصية' },
  { value: 'live_chat', label: 'محادثة فورية' },
  { value: 'other', label: 'أخرى' },
]

export const CONTACT_RESULTS: { value: SelectOption; label: string }[] = [
  { value: 'تم التواصل', label: 'تم التواصل' },
  { value: 'مهتم', label: 'مهتم' },
  { value: 'تم إنشاء طلب', label: 'تم إنشاء طلب' },
  { value: 'متابعة لاحقة', label: 'متابعة لاحقة' },
  { value: 'لا يحتاج حاليًا', label: 'لا يحتاج حاليًا' },
  { value: 'رفض', label: 'رفض' },
  { value: 'لا يرد', label: 'لا يرد' },
  { value: 'رقم غير صحيح', label: 'رقم غير صحيح' },
  { value: 'طلب تحديث بيانات', label: 'طلب تحديث بيانات' },
  { value: 'طلب زيارة', label: 'طلب زيارة' },
  { value: 'مشكلة تحتاج تصعيد', label: 'مشكلة تحتاج تصعيد' },
]

export const NEXT_ACTIONS: { value: SelectOption; label: string }[] = [
  { value: 'متابعة هاتفية', label: 'متابعة هاتفية' },
  { value: 'زيارة في مقر العميل', label: 'زيارة في مقر العميل' },
  { value: 'انشاء عرض سعر', label: 'انشاء عرض سعر' },
  { value: 'إرسال قائمة أسعار', label: 'إرسال قائمة أسعار' },
  { value: 'طلب ورقي', label: 'طلب ورقي' },
  { value: 'متابعة بعد الطلب', label: 'متابعة بعد الطلب' },
  { value: 'تسليم الفاتورة', label: 'تسليم الفاتورة' },
  { value: 'لا شيء', label: 'لا شيء' },
]

export type DashboardScope = 'global' | 'own'

export interface DashboardSummary {
  due_today: number
  overdue: number
  upcoming: number
  no_contact_30d: number
  new_30d: number
  declined: number
  stopped: number
  executed_30d: number
  all_customers: number
  scope: DashboardScope
  scoped_followups: boolean
}

export interface FollowUpCustomerRow {
  id: string
  code: string | null
  company_name: string | null
  responsible_name: string | null
  phone: string | null
  owner_id: string | null
  owner_name: string | null
  follow_up_assignee_id: string | null
  follow_up_assignee_name: string | null
  created_at: string
  last_order_date: string | null
  days_since_last_order: number | null
  last_contact_date: string | null
  days_since_contact: number | null
  trend30d_pct: number | null
  current_30d_total: number
  previous_30d_total: number
  has_open_follow_up: boolean
  due_follow_up_at: string | null
  open_follow_up_status: string | null
  no_orders_ever: boolean
  requires_attention: boolean
  // ---- 0024: customer lifetime history (since creation) ----
  customer_age_days?: number | null
  total_orders?: number
  total_sales?: number
  first_order_date?: string | null
  avg_interval_days?: number | null
  total_visits?: number
  first_visit_date?: string | null
  last_visit_date?: string | null
  days_since_last_visit?: number | null
  total_contacts?: number
  first_contact_date?: string | null
  last_contact_result?: string | null
  total_follow_ups?: number
  completed_follow_ups?: number
  first_follow_up_date?: string | null
  // ---- 0024: range (period) analysis within [analysis_from, analysis_to] ----
  range_order_count?: number
  range_total_sales?: number
  range_first_order_date?: string | null
  range_last_order_date?: string | null
  range_avg_interval_days?: number | null
  range_visit_count?: number
  range_last_visit_date?: string | null
  range_contact_count?: number
  range_follow_up_count?: number
  range_completed_follow_ups?: number
  // ---- 0025: order types + previous events ----
  previous_order_date?: string | null
  previous_visit_date?: string | null
  order_types?: OrderTypeCount[]
  range_order_types?: OrderTypeCount[]
}

export interface CustomerSalesStats {
  order_count: number
  total_sales: number
  avg_order_value: number
  first_order_date: string | null
  last_order_date: string | null
  days_since_last_order: number | null
  avg_interval_days: number | null
  current_30d_total: number
  previous_30d_total: number
  trend30d_pct: number | null
  top_products: Array<{ name: string; qty: number; total: number }>
  top_companies: Array<{ name: string; total: number }>
  // ---- 0024 ----
  customer?: { created_at: string | null; customer_age_days: number | null }
  period?: CustomerSalesStatsPeriod
  visits?: { total: number; first_date: string | null; last_date: string | null; range_count: number; range_last_date: string | null }
  contacts?: { total: number; first_date: string | null; last_date: string | null; last_result: string | null; range_count: number }
  follow_ups?: { total: number; completed: number; first_date: string | null; range_count: number; range_completed: number }
  // ---- 0025 ----
  order_types?: OrderTypeCount[]
}

export type TimelineEventType = 'followup' | 'contact' | 'order' | 'audit' | 'visit' | 'creation'

export interface OrderTypeCount {
  order_type: string
  count: number
}

export interface TimelineEvent {
  type: TimelineEventType
  ts: string
  payload: Record<string, unknown>
}

export interface CustomerVisitAnalysisStats {
  total_visits: number
  successful_visits: number
  failed_visits: number
  avg_duration_minutes: number
  last_visit_date: string | null
  first_visit_date: string | null
  success_rate: number
}

export interface CustomerVisitRow {
  id: string
  code: string | null
  status: string | null
  visit_result: string | null
  check_in_at: string | null
  check_out_at: string | null
  duration_minutes: number | null
  employee_name: string | null
}

export interface CustomerSalesStatsPeriod {
  from: string | null
  to: string | null
  order_count: number
  total_sales: number
  first_order_date: string | null
  last_order_date: string | null
  days_since_last_order: number | null
  avg_interval_days: number | null
  // ---- 0025 ----
  order_types?: OrderTypeCount[]
}

export interface CustomerBehaviorStats {
  customer: { created_at: string | null; customer_age_days: number | null }
  period: CustomerSalesStatsPeriod
  visits: { total: number; first_date: string | null; last_date: string | null; range_count: number; range_last_date: string | null }
  contacts: { total: number; first_date: string | null; last_date: string | null; last_result: string | null; range_count: number }
  follow_ups: { total: number; completed: number; first_date: string | null; range_count: number; range_completed: number }
}

export interface ContactLogInput {
  customerId: string
  method: ContactMethod
  reason?: string | null
  result?: string | null
  notes?: string | null
  nextAction?: string | null
  nextFollowUpAt?: string | null
  orderCreated?: boolean
  contactAt?: string | null
}

export interface CustomerUpdateInput {
  customerId: string
  companyName?: string | null
  phone?: string | null
  responsibleName?: string | null
  email?: string | null
  businessType?: string | null
  address?: string | null
  notes?: string | null
}

export interface ReportRow {
  [key: string]: unknown
}

export type GetterResult<T> = { available: true; data: T } | { available: false; data: null }

export type SmartSuggestionKind = 'insufficient' | 'inactivity' | 'interval_elapsed' | 'expected_reorder' | 'sales_decline' | 'contact_stale'

export interface SmartSuggestion {
  kind: SmartSuggestionKind
  title: string
  reason: string
  suggested_at: string | null
  suggested_interval_days: number | null
}

export interface SmartReason {
  kind: string
  title: string
  reason: string
}

export const SMART_KIND_LABELS: Record<string, string> = {
  interval_elapsed: 'متأخر عن دورة الشراء',
  expected_reorder: 'قرب موعد الطلب المتوقع',
  inactivity: 'توقف عن الطلب',
  sales_decline: 'انخفاض المبيعات',
  contact_stale: 'انقطاع التواصل',
  insufficient: 'بيانات غير كافية',
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  ittiman: 'ائتماني',
}

export function orderTypeLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return ORDER_TYPE_LABELS[t] || t
}

export function orderTypeDistributionLabel(list: OrderTypeCount[] | undefined): string {
  if (!list || list.length === 0) return '—'
  return list.map((o) => `${orderTypeLabel(o.order_type)}: ${o.count}`).join(' · ')
}

interface RpcError {
  error?: string
}

function getToken(): string | null {
  return useAuthStore.getState().token
}

function isMissingRpc(err: unknown): boolean {
  const e = err as { message?: string; code?: string; details?: string } | Error | null
  const msg = e?.message ?? String(err)
  const code = e && 'code' in (e as object) ? (e as { code?: string }).code : undefined
  return code === 'PGRST202'
    || msg.includes('PGRST202')
    || msg.includes('Could not find the function')
    || msg.includes('does not exist')
    || msg.toLowerCase().includes('not found')
}

async function callGet<T>(
  fn: string,
  args: Record<string, unknown>
): Promise<GetterResult<T>> {
  const token = getToken()
  if (!token) return { available: false, data: null }
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw error
    if (data && (data as RpcError).error) {
      const code = (data as RpcError).error
      if (code === 'INVALID_SESSION' || code === 'FORBIDDEN') throw new Error(code)
      // Business errors (e.g. RPC returning error object while deployed) are surfaced.
      return { available: true, data: data as T }
    }
    return { available: true, data: data as T }
  } catch (err) {
    if (isMissingRpc(err)) return { available: false, data: null }
    throw err
  }
}

async function callMutate(fn: string, args: Record<string, unknown>): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('NO_SESSION')
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw error
    if (data && (data as RpcError).error) throw new Error((data as RpcError).error)
  } catch (err) {
    if (isMissingRpc(err)) throw new Error('FEATURE_UNAVAILABLE')
    throw err
  }
}

export const followUpWorkspaceService = {
  async getDashboard(): Promise<GetterResult<DashboardSummary>> {
    const res = await callGet<DashboardSummary>('get_followup_dashboard', { p_token: getToken() })
    if (!res.available) return res
    return res
  },

  async getScreening(params: {
    search?: string
    assigneeId?: string | null
    status?: string
    limit?: number
    customerId?: string | null
    dateFrom?: string | null
    dateTo?: string | null
  }): Promise<GetterResult<{ rows: FollowUpCustomerRow[]; analysisFrom: string | null; analysisTo: string | null; extended: boolean }>> {
    const token = getToken()
    const base: Record<string, unknown> = { p_token: token }
    if (params.search) base.p_search = params.search
    if (params.assigneeId) base.p_assignee_id = params.assigneeId
    if (params.status && params.status !== 'all') base.p_status = params.status
    if (params.limit) base.p_limit = params.limit

    type Raw = { customers?: FollowUpCustomerRow[]; analysis_from?: string | null; analysis_to?: string | null }

    // Attempt 1: full 0024 signature (p_customer_id / p_from / p_to scoped analysis).
    if (params.customerId || params.dateFrom || params.dateTo) {
      const full: Record<string, unknown> = { ...base }
      if (params.customerId) full.p_customer_id = params.customerId
      if (params.dateFrom) full.p_from = params.dateFrom
      if (params.dateTo) full.p_to = params.dateTo
      const res = await callGet<Raw>('get_follow_up_customer_screening', full)
      if (res.available) {
        return {
          available: true,
          data: {
            rows: res.data?.customers ?? [],
            analysisFrom: res.data?.analysis_from ?? params.dateFrom ?? null,
            analysisTo: res.data?.analysis_to ?? params.dateTo ?? null,
            extended: true,
          },
        }
      }
      // 0024 not deployed yet: retry with the pre-0024 signature so the profile
      // and list keep working; extended analysis fields simply won't exist.
      // When resolving a single customer by id, fetch the whole list (limit=1
      // would return an arbitrary first row and then filter to empty).
      const fb = await callGet<Raw>('get_follow_up_customer_screening', params.customerId ? { ...base, p_limit: 2000 } : base)
      if (!fb.available) return { available: false, data: null }
      const rows = (fb.data?.customers ?? []).filter((r) => (params.customerId ? r.id === params.customerId : true))
      return { available: true, data: { rows, analysisFrom: null, analysisTo: null, extended: false } }
    }

    const res = await callGet<Raw>('get_follow_up_customer_screening', base)
    if (!res.available) return { available: false, data: null }
    return {
      available: true,
      data: { rows: res.data?.customers ?? [], analysisFrom: null, analysisTo: null, extended: true },
    }
  },

  async getSalesStats(customerId: string, opts?: { dateFrom?: string | null; dateTo?: string | null }): Promise<GetterResult<CustomerSalesStats | null>> {
    const cls: Record<string, unknown> = {
      p_token: getToken(),
      p_customer_id: customerId,
    }
    if (opts?.dateFrom) cls.p_from = opts.dateFrom
    if (opts?.dateTo) cls.p_to = opts.dateTo
    const res = await callGet<CustomerSalesStats | null>('get_follow_up_customer_sales_stats', cls)
    return res
  },

  async getVisitsAnalysis(customerId: string, opts?: { dateFrom?: string | null; dateTo?: string | null }): Promise<GetterResult<{ visits: CustomerVisitRow[]; stats: CustomerVisitAnalysisStats | null }> | null> {
    const cls: Record<string, unknown> = { p_token: getToken(), p_customer_id: customerId }
    if (opts?.dateFrom) cls.p_from = opts.dateFrom.slice(0, 10)
    if (opts?.dateTo) cls.p_to = opts.dateTo.slice(0, 10)
    const res = await callGet<{ visits?: CustomerVisitRow[]; stats?: CustomerVisitAnalysisStats | null }>('get_customer_visits_analysis', cls)
    if (!res.available) return { available: false, data: null }
    return { available: true, data: { visits: res.data?.visits ?? [], stats: res.data?.stats ?? null } }
  },

  async getTimeline(customerId: string): Promise<GetterResult<TimelineEvent[]>> {
    const res = await callGet<{ timeline?: TimelineEvent[] }>('get_follow_up_customer_timeline', {
      p_token: getToken(),
      p_customer_id: customerId,
    })
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.timeline ?? [] }
  },

  async getSmartSuggestions(customerId: string): Promise<GetterResult<{ suggestions: SmartSuggestion[]; data: Record<string, unknown> | null }>> {
    const res = await callGet<{ suggestions?: SmartSuggestion[]; data?: Record<string, unknown> }>('get_smart_follow_up_suggestions', {
      p_token: getToken(),
      p_customer_id: customerId,
    })
    if (!res.available) return { available: false, data: null }
    return { available: true, data: { suggestions: res.data?.suggestions ?? [], data: res.data?.data ?? null } }
  },

  async logContact(input: ContactLogInput): Promise<void> {
    await callMutate('governed_log_follow_up_contact', {
      p_token: getToken(),
      p_customer_id: input.customerId,
      p_contact_method: input.method,
      p_contact_reason: input.reason ?? null,
      p_result: input.result ?? null,
      p_notes: input.notes ?? null,
      p_next_action: input.nextAction ?? null,
      p_next_follow_up_at: input.nextFollowUpAt ?? null,
      p_order_created: input.orderCreated ?? false,
      p_contact_at: input.contactAt ?? null,
    })
  },

  async updateCustomer(input: CustomerUpdateInput): Promise<void> {
    await callMutate('governed_followup_update_customer', {
      p_token: getToken(),
      p_customer_id: input.customerId,
      p_company_name: input.companyName ?? null,
      p_phone: input.phone ?? null,
      p_responsible_name: input.responsibleName ?? null,
      p_email: input.email ?? null,
      p_business_type: input.businessType ?? null,
      p_address: input.address ?? null,
      p_notes: input.notes ?? null,
    })
  },

  async assignAssignee(customerId: string, assigneeId: string | null, reason?: string | null): Promise<void> {
    await callMutate('governed_followup_assign_assignee', {
      p_token: getToken(),
      p_customer_id: customerId,
      p_assignee_id: assigneeId,
      p_reason: reason ?? null,
    })
  },

  async getFollowUpReport(params: {
    assigneeId?: string | null
    status?: string | null
    dateFrom?: string | null
    dateTo?: string | null
    limit?: number
  }): Promise<GetterResult<ReportRow[]>> {
    const cls: Record<string, unknown> = { p_token: getToken() }
    if (params.assigneeId) cls.p_assignee_id = params.assigneeId
    if (params.status) cls.p_status = params.status
    if (params.dateFrom) cls.p_date_from = params.dateFrom
    if (params.dateTo) cls.p_date_to = params.dateTo
    if (params.limit) cls.p_limit = params.limit
    const res = await callGet<{ rows?: ReportRow[] }>('get_follow_up_report', cls)
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.rows ?? [] }
  },

  async getContactsReport(params: {
    customerId?: string | null
    result?: string | null
    dateFrom?: string | null
    dateTo?: string | null
    limit?: number
  }): Promise<GetterResult<ReportRow[]>> {
    const cls: Record<string, unknown> = { p_token: getToken() }
    if (params.customerId) cls.p_customer_id = params.customerId
    if (params.result) cls.p_result = params.result
    if (params.dateFrom) cls.p_date_from = params.dateFrom
    if (params.dateTo) cls.p_date_to = params.dateTo
    if (params.limit) cls.p_limit = params.limit
    const res = await callGet<{ rows?: ReportRow[] }>('get_contacts_report', cls)
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.rows ?? [] }
  },

  async getCustomerUpdatesReport(params: {
    customerId?: string | null
    dateFrom?: string | null
    dateTo?: string | null
    limit?: number
  }): Promise<GetterResult<ReportRow[]>> {
    const cls: Record<string, unknown> = { p_token: getToken() }
    if (params.customerId) cls.p_customer_id = params.customerId
    if (params.dateFrom) cls.p_date_from = params.dateFrom
    if (params.dateTo) cls.p_date_to = params.dateTo
    if (params.limit) cls.p_limit = params.limit
    const res = await callGet<{ rows?: ReportRow[] }>('get_customer_updates_report', cls)
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.rows ?? [] }
  },

  async runDueNotifications(): Promise<{ enabled: boolean; notified_employees?: number }> {
    const res = await callGet<{ enabled: boolean; notified_employees?: number }>('run_follow_up_due_notifications', {
      p_token: getToken(),
      p_enable: true,
    })
    if (!res.available || !res.data) return { enabled: false }
    return res.data
  },
}

// ---------------------------------------------------------------------------
// Smart follow-up reasons — wires the EXISTING get_smart_follow_up_suggestions
// engine (0022) into the UI. The reason text always comes from the backend
// result; nothing is fabricated client-side.
// ---------------------------------------------------------------------------

async function fetchSmartReasonOnce(customerId: string): Promise<SmartReason | null> {
  try {
    const r = await followUpWorkspaceService.getSmartSuggestions(customerId)
    if (!r.available || !r.data || r.data.suggestions.length === 0) return null
    const s = r.data.suggestions[0]
    return { kind: s.kind, title: s.title, reason: s.reason }
  } catch {
    return null
  }
}

const REASON_FETCH_CHUNK = 6

export async function fetchSmartReasonsBatched(
  customerIds: string[],
  limit = 24,
): Promise<Record<string, SmartReason>> {
  const out: Record<string, SmartReason> = {}
  const ids = customerIds.slice(0, limit)
  if (ids.length === 0) return out
  for (let i = 0; i < ids.length; i += REASON_FETCH_CHUNK) {
    const chunk = ids.slice(i, i + REASON_FETCH_CHUNK)
    const results = await Promise.allSettled(chunk.map((id) => fetchSmartReasonOnce(id)))
    results.forEach((res, j) => {
      if (res.status === 'fulfilled' && res.value) out[chunk[j]] = res.value
    })
  }
  return out
}

export function smartReasonLabel(reason: SmartReason): string {
  return `${SMART_KIND_LABELS[reason.kind] || reason.kind} — ${reason.reason}`
}