import { supabase } from '../lib/supabase'
import { invalidateGovernedCatalog } from './governedCatalog'

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

/**
 * Removed: fetchBonusCatalogRows (2027-11-30).
 *
 * It called get_governed_bonus_products with NO p_page / p_per_page, which the
 * RPC previously answered with a 1,000,000-row default — a full Bonus catalog
 * download in one request (measured 568 rows / 1,214,756 B JSON /
 * 624,963 B gzip). It had no importers anywhere in src, so deleting it cannot
 * regress a caller. The RPC now also REFUSES a data-mode call without
 * pagination (returns {error: 'PAGINATION_REQUIRED'}) and clamps p_per_page to
 * 200, so the unbounded read is structurally unreachable.
 *
 * The two admin mutation helpers below do not read the catalog and are kept.
 */

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
  invalidateGovernedCatalog()
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
  invalidateGovernedCatalog()
  return {}
}