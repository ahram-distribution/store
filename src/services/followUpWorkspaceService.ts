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
}

export type TimelineEventType = 'followup' | 'contact' | 'order' | 'audit'

export interface TimelineEvent {
  type: TimelineEventType
  ts: string
  payload: Record<string, unknown>
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

interface RpcError {
  error?: string
}

function getToken(): string | null {
  return useAuthStore.getState().token
}

function isMissingRpc(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('Could not find the function') || msg.includes('PGRST202') || msg.includes('does not exist')
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
  }): Promise<GetterResult<FollowUpCustomerRow[]>> {
    const cls: Record<string, unknown> = { p_token: getToken() }
    if (params.search) cls.p_search = params.search
    if (params.assigneeId) cls.p_assignee_id = params.assigneeId
    if (params.status && params.status !== 'all') cls.p_status = params.status
    if (params.limit) cls.p_limit = params.limit
    const res = await callGet<{ customers?: FollowUpCustomerRow[] }>('get_follow_up_customer_screening', cls)
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.customers ?? [] }
  },

  async getSalesStats(customerId: string): Promise<GetterResult<CustomerSalesStats | null>> {
    const res = await callGet<CustomerSalesStats | null>('get_follow_up_customer_sales_stats', {
      p_token: getToken(),
      p_customer_id: customerId,
    })
    return res
  },

  async getTimeline(customerId: string): Promise<GetterResult<TimelineEvent[]>> {
    const res = await callGet<{ timeline?: TimelineEvent[] }>('get_follow_up_customer_timeline', {
      p_token: getToken(),
      p_customer_id: customerId,
    })
    if (!res.available) return { available: false, data: null }
    return { available: true, data: res.data?.timeline ?? [] }
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