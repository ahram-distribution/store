import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export type FollowUpPriority = 'low' | 'normal' | 'high' | 'critical'
export type FollowUpStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type ContactType = 'call' | 'visit' | 'meeting' | 'email' | 'sms' | 'other'

export interface FollowUp {
  id: string
  customer_id: string
  customer_name: string | null
  customer_phone: string | null
  assignee_id: string | null
  assignee_name: string | null
  title: string
  description: string | null
  priority: FollowUpPriority
  status: FollowUpStatus
  due_at: string | null
  completed_at: string | null
  result: string | null
  created_by: string | null
  creator_name: string | null
  created_at: string
}

export interface FollowUpAssignee {
  id: string
  full_name: string
  code: string | null
}

export interface CustomerFollowUpHistory {
  followups: Array<{
    id: string
    title: string
    description: string | null
    priority: FollowUpPriority
    status: FollowUpStatus
    due_at: string | null
    completed_at: string | null
    result: string | null
    assignee_name: string | null
    created_at: string
  }>
  contacts: Array<{
    id: string
    contact_type: ContactType
    notes: string | null
    contact_at: string
    employee_name: string | null
  }>
}

interface RpcResult {
  error?: string
  items?: FollowUp[]
  followups?: CustomerFollowUpHistory['followups']
  contacts?: CustomerFollowUpHistory['contacts']
  id?: string
  ok?: boolean
}

function getToken(): string | null {
  return useAuthStore.getState().token
}

async function call<T = RpcResult>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  if (data && (data as RpcResult).error) {
    throw new Error((data as RpcResult).error)
  }
  return data as T
}

export const followUpService = {
  async getMyFollowUps(status?: string, assigneeId?: string): Promise<FollowUp[]> {
    const token = getToken()
    if (!token) return []
    const params: Record<string, unknown> = { p_token: token }
    if (status) params.p_status = status
    if (assigneeId) params.p_assignee_id = assigneeId
    const data = await call<RpcResult>('get_my_follow_ups', params)
    return data?.items ?? []
  },

  async getQueue(status?: string, assigneeId?: string, dateFrom?: string, dateTo?: string): Promise<FollowUp[]> {
    const token = getToken()
    if (!token) return []
    const params: Record<string, unknown> = { p_token: token }
    if (status) params.p_status = status
    if (assigneeId) params.p_assignee_id = assigneeId
    if (dateFrom) params.p_date_from = dateFrom
    if (dateTo) params.p_date_to = dateTo
    const data = await call<RpcResult>('get_follow_up_queue', params)
    return data?.items ?? []
  },

  async getAssignees(): Promise<FollowUpAssignee[]> {
    const token = getToken()
    if (!token) return []
    const data = await call<FollowUpAssignee[]>('get_follow_up_assignees', { p_token: token })
    return Array.isArray(data) ? data : []
  },

  async createFollowUp(params: {
    customerId: string
    title: string
    description?: string
    priority?: FollowUpPriority
    dueAt?: string
    assigneeId?: string
  }): Promise<{ id: string; assignee_id: string | null }> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    const data = await call<{ id: string; assignee_id: string | null }>('governed_create_follow_up', {
      p_token: token,
      p_customer_id: params.customerId,
      p_title: params.title,
      p_description: params.description ?? null,
      p_priority: params.priority ?? 'normal',
      p_due_at: params.dueAt ?? null,
      p_assignee_id: params.assigneeId ?? null,
    })
    return data
  },

  async updateFollowUp(params: {
    id: string
    title?: string
    description?: string
    priority?: FollowUpPriority
    dueAt?: string
    status?: FollowUpStatus
    assigneeId?: string
  }): Promise<void> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    await call<RpcResult>('governed_update_follow_up', {
      p_token: token,
      p_follow_up_id: params.id,
      p_title: params.title ?? null,
      p_description: params.description ?? null,
      p_priority: params.priority ?? null,
      p_due_at: params.dueAt ?? null,
      p_status: params.status ?? null,
      p_assignee_id: params.assigneeId ?? null,
    })
  },

  async completeFollowUp(id: string, result?: string): Promise<void> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    await call<RpcResult>('governed_complete_follow_up', {
      p_token: token,
      p_follow_up_id: id,
      p_result: result ?? null,
    })
  },

  async deleteFollowUp(id: string): Promise<void> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    await call<RpcResult>('governed_delete_follow_up', {
      p_token: token,
      p_follow_up_id: id,
    })
  },

  async addContact(customerId: string, contactType: ContactType, notes?: string, contactAt?: string): Promise<void> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    await call<RpcResult>('governed_add_customer_contact', {
      p_token: token,
      p_customer_id: customerId,
      p_contact_type: contactType,
      p_notes: notes ?? null,
      p_contact_at: contactAt ?? null,
    })
  },

  async getHistory(customerId: string): Promise<CustomerFollowUpHistory> {
    const token = getToken()
    if (!token) return { followups: [], contacts: [] }
    const data = await call<RpcResult>('get_customer_follow_up_history', {
      p_token: token,
      p_customer_id: customerId,
    })
    return {
      followups: data?.followups ?? [],
      contacts: data?.contacts ?? [],
    }
  },
}