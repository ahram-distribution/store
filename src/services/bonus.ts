import { supabase } from '../lib/supabase'

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function extractError(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    return String((data as { error: unknown }).error)
  }
  return null
}

/** Bonus catalog (design D.1 #3): active + visible + eligible products only. */
export async function fetchBonusCatalogRows(
  token?: string | null,
  opts?: { governorateId?: string | null }
): Promise<{ rows: any[]; error?: string }> {
  const t = token ?? getSessionToken()
  if (!t) return { rows: [] }
  const { data, error } = await supabase.rpc('get_governed_bonus_products', {
    p_token: t,
    p_governorate_id: opts?.governorateId || null,
  })
  if (error) return { rows: [], error: error.message }
  const rpcError = extractError(data)
  if (rpcError) return { rows: [], error: rpcError }
  return { rows: Array.isArray(data) ? data : [] }
}

/** Admin: toggle products.bonus_enabled via the governed superset (products.manage). */
export async function setProductBonusEnabled(id: string, enabled: boolean): Promise<{ error?: string }> {
  const token = getSessionToken()
  if (!token) return { error: 'No session' }
  const { error } = await supabase.rpc('governed_update_product', {
    p_token: token,
    p_id: id,
    p_bonus_enabled: enabled,
  })
  if (error) return { error: error.message }
  return {}
}

/** Admin: toggle companies.bonus_enabled via the governed superset (companies.manage). */
export async function setCompanyBonusEnabled(id: string, enabled: boolean): Promise<{ error?: string }> {
  const token = getSessionToken()
  if (!token) return { error: 'No session' }
  const { error } = await supabase.rpc('governed_update_company', {
    p_token: token,
    p_id: id,
    p_bonus_enabled: enabled,
  })
  if (error) return { error: error.message }
  return {}
}