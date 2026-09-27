import { supabase } from '../lib/supabase'

/**
 * SalesListPage-specific governed product reads.
 *
 * get_saleslist_products returns a slim (10-field) projection of only the
 * products eligible for the sales price list (active + visible + in-stock +
 * storefront-visible company), with server-side search / company filter /
 * geo-hidden exclusion / pagination / total count.
 *
 * Normal browsing requests ONE 20-product page (fetchSalesListPage). Excel / PDF /
 * Print exports perform a USER-INITIATED unbounded fetch (fetchSalesListAll)
 * with the same search/filter/eligibility criteria — export results are never
 * restricted to the current page, and the full export is never fetched on
 * screen open.
 *
 * Cache semantics mirror governedCatalog (5-min TTL keyed by canonical params
 * + inflight dedupe). No polling, no background refresh.
 */
const CACHE_TTL_MS = 300_000

export const SALES_LIST_PAGE_SIZE = 20

export interface SalesListProduct {
  id: string
  product_name: string
  legacy_code: string
  company_id: string
  company_name: string
  piece_price: number
  carton_price: number
  is_active: boolean
  is_visible: boolean
  is_out_of_stock: boolean
}

export interface SalesListCriteria {
  token: string
  search?: string
  companyId?: string
  hiddenIds?: Set<string>
  governorateId?: string
  sectorId?: string
}

export interface SalesListResult {
  rows: SalesListProduct[]
  total: number
}

interface CacheEntry {
  at: number
  res: SalesListResult
}

const inflight = new Map<string, Promise<SalesListResult>>()
const cache = new Map<string, CacheEntry>()

function signatureKey(criteria: SalesListCriteria, page: number | null, perPage: number | null): string {
  const parts: string[] = [`pg=${page ?? 'all'}`, `pp=${perPage ?? 'all'}`]
  const search = (criteria.search ?? '').trim()
  if (search) parts.push(`q=${search}`)
  if (criteria.companyId) parts.push(`co=${criteria.companyId}`)
  if (criteria.hiddenIds && criteria.hiddenIds.size > 0) parts.push(`hid=${Array.from(criteria.hiddenIds).sort().join(',')}`)
  if (criteria.governorateId) parts.push(`gov=${criteria.governorateId}`)
  if (criteria.sectorId) parts.push(`sec=${criteria.sectorId}`)
  return `${String(criteria.token)}|${parts.join('&')}`
}

function toBody(criteria: SalesListCriteria, page: number | null, perPage: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = { p_token: criteria.token }
  const search = (criteria.search ?? '').trim()
  if (search) body.p_search = search
  if (criteria.companyId) body.p_company_id = criteria.companyId
  if (criteria.hiddenIds && criteria.hiddenIds.size > 0) body.p_hidden_ids = Array.from(criteria.hiddenIds)
  if (criteria.governorateId) body.p_governorate_id = criteria.governorateId
  if (criteria.sectorId) body.p_sector_id = criteria.sectorId
  if (page != null && page > 0) body.p_page = page
  if (perPage != null) body.p_per_page = perPage
  return body
}

function parseResult(data: unknown): SalesListResult {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    throw new Error(String((data as { error: unknown }).error))
  }
  const rows = Array.isArray((data as { rows?: unknown } | null)?.rows)
    ? ((data as { rows: SalesListProduct[] }).rows)
    : []
  const total = typeof (data as { total?: unknown } | null)?.total === 'number'
    ? ((data as { total: number }).total)
    : rows.length
  return { rows, total }
}

async function fetchSalesList(
  criteria: SalesListCriteria,
  page: number | null,
  perPage: number | null
): Promise<SalesListResult> {
  const key = signatureKey(criteria, page, perPage)
  const now = Date.now()

  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.res

  const running = inflight.get(key)
  if (running) return running

  const req = (async (): Promise<SalesListResult> => {
    const { data, error } = await supabase.rpc('get_saleslist_products', toBody(criteria, page, perPage))
    if (error) throw error
    const res = parseResult(data)
    cache.set(key, { at: Date.now(), res })
    return res
  })()

  inflight.set(key, req)
  return req.finally(() => {
    inflight.delete(key)
  })
}

/** One 20-product page for normal SalesListPage browsing. */
export function fetchSalesListPage(criteria: SalesListCriteria, page: number): Promise<SalesListResult> {
  return fetchSalesList(criteria, page, SALES_LIST_PAGE_SIZE)
}

/** Unbounded slim fetch (user-initiated export / print only). p_per_page <= 0 = all. */
export function fetchSalesListAll(criteria: SalesListCriteria): Promise<SalesListResult> {
  return fetchSalesList(criteria, null, 0)
}