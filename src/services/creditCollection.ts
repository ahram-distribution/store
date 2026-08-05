import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export interface CreditCollectionInvoice {
  order_id: string
  invoice_id: string | null
  order_number: string
  reference_number: string | null
  customer_id: string
  customer_name: string
  address: string | null
  phone: string | null
  location_latitude: number | null
  location_longitude: number | null
  invoice_amount: number
  collected_amount: number
  balance: number
  due_date: string | null
  check_number: string | null
  bank_name: string | null
  check_holder: string | null
  notes: string | null
  credit_status: string
  info_locked: boolean
  delivered_at: string | null
  overdue: boolean
  pending_amount: number
  pending_count: number
}

export interface PendingCollectionRequest {
  request_id: string
  invoice_id: string
  order_id: string
  order_number: string
  customer_name: string
  amount: number
  collected_at: string
  latitude: number | null
  longitude: number | null
  notes: string | null
  collector_name: string
  created_at: string
}

export interface CollectionHistoryItem {
  request_id: string
  invoice_id: string
  order_number: string
  customer_name: string
  amount: number
  collected_at: string
  status: string
  notes: string | null
  collector_name: string
  decided_by_name: string | null
  decided_at: string | null
  latitude: number | null
  longitude: number | null
}

export interface ManagementInvoice {
  invoice_id: string
  order_id: string
  order_number: string
  customer_id: string
  customer_name: string
  invoice_amount: number
  collected_amount: number
  balance: number
  due_date: string | null
  check_number: string | null
  bank_name: string | null
  check_holder: string | null
  notes: string | null
  credit_status: string
  info_locked: boolean
  delivered_at: string | null
  overdue: boolean
}

export interface ManagementSummary {
  collected_today: number
  outstanding: number
  overdue_count: number
  total_invoices: number
  fully_collected_count: number
  pending_requests: number
}

export interface ManagementData {
  invoices: ManagementInvoice[]
  pending_requests: PendingCollectionRequest[]
  summary: ManagementSummary
  history: CollectionHistoryItem[]
}

export const creditCollectionService = {
  async listCollectorInvoices(): Promise<CreditCollectionInvoice[]> {
    const token = getToken()
    if (!token) return []
    const { data } = await supabase.rpc('get_credit_collection_invoices', { p_token: token })
    return (data as CreditCollectionInvoice[]) || []
  },

  async saveInvoiceInfo(params: {
    orderId: string
    dueDate: string
    checkNumber: string
    bankName: string
    checkHolder: string
    notes?: string
  }): Promise<{ result?: Record<string, unknown>; error?: string }> {
    const token = getToken()
    if (!token) return { error: 'NO_SESSION' }
    const { data, error } = await supabase.rpc('save_credit_invoice_info', {
      p_token: token,
      p_order_id: params.orderId,
      p_due_date: params.dueDate,
      p_check_number: params.checkNumber,
      p_bank_name: params.bankName,
      p_check_holder: params.checkHolder,
      p_notes: params.notes ?? null,
    })
    if (error) return { error: error.message }
    const result = data as Record<string, unknown>
    if (result?.error) return { error: result.error as string }
    return { result }
  },

  async submitRequest(params: {
    invoiceId: string
    amount: number
    latitude: number
    longitude: number
    notes?: string
  }): Promise<{ result?: Record<string, unknown>; error?: string }> {
    const token = getToken()
    if (!token) return { error: 'NO_SESSION' }
    const { data, error } = await supabase.rpc('submit_credit_collection_request', {
      p_token: token,
      p_invoice_id: params.invoiceId,
      p_amount: params.amount,
      p_latitude: params.latitude,
      p_longitude: params.longitude,
      p_notes: params.notes ?? null,
    })
    if (error) return { error: error.message }
    const result = data as Record<string, unknown>
    if (result?.error) return { error: result.error as string }
    return { result }
  },

  async getManagementData(): Promise<ManagementData | null> {
    const token = getToken()
    if (!token) return null
    const { data } = await supabase.rpc('get_credit_invoices_management', { p_token: token })
    return (data as ManagementData) || null
  },

  async getInvoiceHistory(orderId: string): Promise<CollectionHistoryItem[]> {
    const token = getToken()
    if (!token) return []
    const { data } = await supabase.rpc('get_credit_collection_history', { p_token: token, p_order_id: orderId })
    if (!data || typeof data !== 'object' || Array.isArray(data)) return (data as CollectionHistoryItem[]) || []
    if ((data as { error?: string }).error) return []
    return []
  },

  async decideRequest(params: {
    requestId: string
    decision: 'approve' | 'reject'
    notes?: string
  }): Promise<{ result?: Record<string, unknown>; error?: string }> {
    const token = getToken()
    if (!token) return { error: 'NO_SESSION' }
    const { data, error } = await supabase.rpc('decide_credit_collection_request', {
      p_token: token,
      p_request_id: params.requestId,
      p_decision: params.decision,
      p_notes: params.notes ?? null,
    })
    if (error) return { error: error.message }
    const result = data as Record<string, unknown>
    if (result?.error) return { error: result.error as string }
    return { result }
  },
}
