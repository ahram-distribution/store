import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { CreditAccountRecord, CreditInvoiceRecord, CreditInvoiceDetailRecord, CreditDashboardStats } from '../types/storefront'

function getToken(): string | null {
  return useAuthStore.getState().token
}

export const creditService = {
  async getCustomerAccount(): Promise<CreditAccountRecord | null> {
    const token = getToken()
    if (!token) return null
    const { data, error } = await supabase.rpc('get_governed_customer_credit_account', { p_token: token })
    if (error) throw error
    if (data?.error) return null
    return data as CreditAccountRecord
  },

  async activateAccount(customerId: string, programId: string, guaranteeChequeAmount?: number): Promise<{ success: boolean; account_id?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_activate_credit_account', {
      p_token: token, p_customer_id: customerId, p_program_id: programId,
      p_guarantee_cheque_amount: guaranteeChequeAmount,
    })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true, account_id: data.account_id }
  },

  async suspendAccount(customerId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_suspend_credit_account', { p_token: token, p_customer_id: customerId, p_reason: reason })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async reactivateAccount(customerId: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_reactivate_credit_account', { p_token: token, p_customer_id: customerId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async getInvoices(customerId?: string): Promise<CreditInvoiceRecord[]> {
    const token = getToken()
    if (!token) return []
    const params: any = { p_token: token }
    if (customerId) params.p_customer_id = customerId
    const { data, error } = await supabase.rpc('get_governed_credit_invoices', params)
    if (error) throw error
    return (data ?? []) as CreditInvoiceRecord[]
  },

  async getInvoiceDetail(invoiceId: string): Promise<CreditInvoiceDetailRecord | null> {
    const token = getToken()
    if (!token) return null
    const { data, error } = await supabase.rpc('get_governed_credit_invoice_detail', { p_token: token, p_invoice_id: invoiceId })
    if (error) throw error
    if (data?.error === 'NOT_FOUND') return null
    return data as CreditInvoiceDetailRecord
  },

  async recordCheque(invoiceId: string, chequeNumber: string, bankName: string, amount: number, dueDate: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_record_cheque', {
      p_token: token, p_invoice_id: invoiceId, p_cheque_number: chequeNumber,
      p_bank_name: bankName, p_amount: amount, p_due_date: dueDate,
    })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async recordPayment(invoiceId: string, paymentMethod?: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_record_credit_payment', { p_token: token, p_invoice_id: invoiceId, p_payment_method: paymentMethod })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async reserveCreditForOrder(orderId: string): Promise<{ success: boolean; reserved?: number; over_limit?: boolean; available?: number; required?: number; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_reserve_credit_for_order', { p_token: token, p_order_id: orderId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error, available: data.available, required: data.required }
    if (data?.over_limit) return { success: true, over_limit: true, available: Number(data.available), required: Number(data.required) }
    return { success: true, reserved: Number(data.reserved) }
  },

  async checkOrderOverLimit(orderId: string): Promise<{ over_limit: boolean; available: number; required: number; error?: string }> {
    const token = getToken()
    if (!token) return { over_limit: false, available: 0, required: 0, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_check_order_over_limit', { p_token: token, p_order_id: orderId })
    if (error) return { over_limit: false, available: 0, required: 0, error: error.message }
    return { over_limit: !!data?.over_limit, available: Number(data?.available || 0), required: Number(data?.required || 0) }
  },

  async releaseCreditReservation(orderId: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_release_credit_reservation', { p_token: token, p_order_id: orderId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async convertReservationToOutstanding(orderId: string): Promise<{ success: boolean; invoice_id?: string; invoice_number?: string; due_date?: string; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_convert_credit_reservation_to_outstanding', { p_token: token, p_order_id: orderId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true, invoice_id: data.invoice_id, invoice_number: data.invoice_number, due_date: data.due_date }
  },

  async getDashboard(): Promise<CreditDashboardStats | null> {
    const token = getToken()
    if (!token) return null
    const { data, error } = await supabase.rpc('get_governed_credit_dashboard', { p_token: token })
    if (error) throw error
    return data as CreditDashboardStats
  },

  async autoSuspendOverdue(): Promise<{ success: boolean; suspended?: number; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_auto_suspend_overdue_accounts', {})
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true, suspended: data.suspended }
  },

  async getPrograms(includeInactive?: boolean): Promise<any[]> {
    const token = getToken()
    if (!token) return []
    const { data, error } = await supabase.rpc('governed_get_credit_programs', { p_token: token, p_include_inactive: includeInactive ?? false })
    if (error) throw error
    return data ?? []
  },

  async createProgram(name: string, creditLimit: number, creditDays: number, terms: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_create_credit_program', { p_token: token, p_name: name, p_credit_limit: creditLimit, p_credit_days: creditDays, p_terms: terms })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async toggleProgram(programId: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_toggle_credit_program', { p_token: token, p_program_id: programId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async createApplication(programId: string): Promise<{ success: boolean; error?: string }> {
    const token = getToken()
    if (!token) return { success: false, error: 'INVALID_SESSION' }
    const { data, error } = await supabase.rpc('governed_create_credit_application', { p_token: token, p_program_id: programId })
    if (error) return { success: false, error: error.message }
    if (data?.error) return { success: false, error: data.error }
    return { success: true }
  },

  async getApplications(): Promise<any[]> {
    const token = getToken()
    if (!token) return []
    const { data, error } = await supabase.rpc('get_governed_credit_applications', { p_token: token })
    if (error) throw error
    return data ?? []
  },
}
