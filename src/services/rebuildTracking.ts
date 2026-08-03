import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export interface BusinessEventCounts {
  start_workday: number
  end_workday: number
  visit_checkin: number
  visit_checkout: number
  customer_created: number
  customer_location_updated: number
}

export interface RebuildPreview {
  employee_id: string
  employee_name: string
  employee_code?: string
  date: string
  existing_tracking_points: number
  events_found: number
  business_events: Partial<BusinessEventCounts>
  to_create: number
  skipped: number
  skips_breakdown: {
    missing_gps: number
    already_tracked: number
  }
}

export interface RebuildResult {
  ok: boolean
  employee_id: string
  employee_name: string
  date: string
  existing_tracking_points: number
  events_found: number
  business_events: Partial<BusinessEventCounts>
  points_created: number
  points_skipped: number
  skips_breakdown: {
    missing_gps: number
    already_tracked: number
    deduplicated: number
  }
  audit_id?: number
}

export interface RebuildError {
  error: string
}

async function callRpc(name: string, params: Record<string, unknown>): Promise<any> {
  const token = getToken()
  if (!token) throw new Error('No session')
  const { data, error } = await supabase.rpc(name, { p_token: token, ...params })
  if (error) throw error
  return data
}

export async function hasRebuild(employeeId: string, date: string): Promise<boolean> {
  return callRpc('has_tracking_rebuild', { p_employee_id: employeeId, p_date: date })
}

export async function previewRebuild(employeeId: string, date: string): Promise<RebuildPreview | RebuildError> {
  return callRpc('preview_rebuild_missing_tracking', { p_employee_id: employeeId, p_date: date })
}

export async function executeRebuild(employeeId: string, date: string): Promise<RebuildResult | RebuildError> {
  return callRpc('rebuild_missing_tracking', { p_employee_id: employeeId, p_date: date })
}

export const BUSINESS_EVENT_LABELS: Record<string, string> = {
  start_workday: 'بدء يوم العمل',
  end_workday: 'إنهاء يوم العمل',
  visit_checkin: 'دخول زيارة',
  visit_checkout: 'خروج زيارة',
  customer_created: 'إنشاء عميل',
  customer_location_updated: 'تحديث موقع عميل',
}
