import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export interface SearchFilters {
  search?: string
  status?: string
  date_from?: string
  date_to?: string
  gov?: string
  company_id?: string
  rep_id?: string
  customer_id?: string
}

export interface DeletionRecord {
  id: string
  name: string
  code: string
  status: string
  created_at: string
  related_counts: Record<string, number>
  [key: string]: unknown
}

export interface SearchResult {
  data: DeletionRecord[]
  total: number
}

export interface PreviewResult {
  preview: true
  direct_count: number
  related: Record<string, number>
}

export interface ExecuteResult {
  preview: false
  deleted_count: number
  audit_id: string
}

export interface ErrorResult {
  error: string
  related?: Record<string, number>
}

const SEARCH_RPCS: Record<string, string> = {
  employees: 'governed_deletion_search_employees',
  customers: 'governed_deletion_search_customers',
  products: 'governed_deletion_search_products',
  companies: 'governed_deletion_search_companies',
  orders: 'governed_deletion_search_orders',
  collections: 'governed_deletion_search_collections',
  visits: 'governed_deletion_search_visits',
  workdays: 'governed_deletion_search_workdays',
  tracking: 'governed_deletion_search_tracking',
}

const EXECUTE_RPCS: Record<string, string> = {
  employees: 'governed_deletion_execute_employees',
  customers: 'governed_deletion_execute_customers',
  products: 'governed_deletion_execute_products',
  companies: 'governed_deletion_execute_companies',
  orders: 'governed_deletion_execute_orders',
  collections: 'governed_deletion_execute_collections',
  visits: 'governed_deletion_execute_visits',
  workdays: 'governed_deletion_execute_workdays',
  tracking: 'governed_deletion_execute_tracking',
}

export async function searchEntity(
  entityType: string,
  filters: SearchFilters
): Promise<SearchResult> {
  const token = getToken()
  if (!token) throw new Error('No session')

  const rpcName = SEARCH_RPCS[entityType]
  if (!rpcName) throw new Error(`Unknown entity: ${entityType}`)

  const params: Record<string, unknown> = {
    p_token: token,
    p_search: filters.search || null,
    p_status: filters.status || null,
    p_date_from: filters.date_from || null,
    p_date_to: filters.date_to || null,
  }

  if (entityType === 'customers') {
    params.p_gov = filters.gov || null
    params.p_company_id = filters.company_id || null
    params.p_rep_id = filters.rep_id || null
  }
  if (entityType === 'products') {
    params.p_company_id = filters.company_id || null
  }
  if (entityType === 'orders') {
    params.p_customer_id = filters.customer_id || null
    params.p_rep_id = filters.rep_id || null
  }
  if (entityType === 'collections') {
    params.p_customer_id = filters.customer_id || null
  }
  if (entityType === 'visits') {
    params.p_rep_id = filters.rep_id || null
    params.p_customer_id = filters.customer_id || null
  }
  if (entityType === 'workdays' || entityType === 'tracking') {
    params.p_rep_id = filters.rep_id || null
  }

  const { data, error } = await supabase.rpc(rpcName, params)
  if (error) throw error
  if (data?.error) throw new Error(data.error)

  return data as SearchResult
}

export async function previewDeletion(
  entityType: string,
  ids: string[]
): Promise<PreviewResult> {
  return executeDeletion(entityType, ids, true) as Promise<PreviewResult>
}

export async function executeDeletion(
  entityType: string,
  ids: string[],
  dryRun = false
): Promise<PreviewResult | ExecuteResult | ErrorResult> {
  const token = getToken()
  if (!token) throw new Error('No session')

  const rpcName = EXECUTE_RPCS[entityType]
  if (!rpcName) throw new Error(`Unknown entity: ${entityType}`)

  const { data, error } = await supabase.rpc(rpcName, {
    p_token: token,
    p_ids: ids,
    p_dry_run: dryRun,
  })
  if (error) throw error

  return data as PreviewResult | ExecuteResult | ErrorResult
}

export function getEntityLabel(entityType: string): string {
  const labels: Record<string, string> = {
    employees: 'الموظفين',
    customers: 'العملاء',
    products: 'المنتجات',
    companies: 'الشركات',
    orders: 'الطلبات',
    collections: 'التحصيلات',
    visits: 'الزيارات',
    workdays: 'أيام العمل',
    tracking: 'نقاط التتبع',
  }
  return labels[entityType] || entityType
}

export function getEntityLabelSingle(entityType: string): string {
  const labels: Record<string, string> = {
    employees: 'موظف',
    customers: 'عميل',
    products: 'منتج',
    companies: 'شركة',
    orders: 'طلب',
    collections: 'تحصيل',
    visits: 'زيارة',
    workdays: 'يوم عمل',
    tracking: 'نقطة تتبع',
  }
  return labels[entityType] || entityType
}
