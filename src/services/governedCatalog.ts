import { supabase } from '../lib/supabase'

/**
 * Module-level TTL cache for the governed product catalog RPC.
 *
 * get_governed_products returns a large payload (every governed product with
 * nested product_units and inventory), and many screens (ProductManagerPage,
 * StorefrontPage, OrderDetailPage, SalesListPage, ...) fetch the same catalog on
 * mount. This cache shares those reads for a short window and deduplicates
 * parallel identical requests (inflight), cutting redundant egress without any
 * RPC/schema change.
 *
 * - Keyed by session token + canonical RPC params, so filtered/searched reads
 *   stay correct per caller. Params are normalized before keying:
 *   - null/undefined dropped;
 *   - false boolean params dropped (the RPC treats false === its DEFAULT false);
 *   - p_ids sorted + de-duplicated so the same id set reuses one entry;
 *   - empty p_search dropped (equivalent to no filter).
 * - TTL is 5 min; mutations must call invalidateGovernedCatalog() so admin
 *   product/unit changes appear immediately without short-TTL polling. Stock and
 *   reservation rules are enforced server-side by the governed RPCs (fresh DB
 *   reads), so a longer client cache never weakens business invariants.
 * - Inflight dedupe returns the SAME promise to concurrent identical calls.
 */
const CACHE_TTL_MS = 300_000
const inflight = new Map<string, Promise<{ data: any; error: any }>>()
const cache = new Map<string, { at: number; res: { data: any; error: any } }>()

const BOOLEAN_PARAMS = new Set([
  'p_active_only',
  'p_visible_only',
  'p_count_only',
  'p_inactive_only',
  'p_out_of_stock_only',
  'p_exclude_out_of_stock',
  'p_no_price',
  'p_no_image',
  'p_no_stock',
])

function canonicalValue(key: string, value: unknown): { drop: boolean; value?: unknown } {
  if (value === null || value === undefined) return { drop: true }
  if (key === 'p_ids') {
    if (Array.isArray(value)) {
      const ids = Array.from(new Set(value.map((v) => String(v)).filter(Boolean))).sort()
      if (ids.length === 0) return { drop: true }
      return { drop: false, value: ids }
    }
    return { drop: false, value: value }
  }
  if (key === 'p_search') {
    if (typeof value === 'string' && value.trim() === '') return { drop: true }
    return { drop: false, value: value }
  }
  if (BOOLEAN_PARAMS.has(key) && value === false) return { drop: true }
  return { drop: false, value: value }
}

function signature(params: Record<string, unknown>): string {
  const entries: Array<[string, unknown]> = []
  for (const [key, raw] of Object.entries(params)) {
    const c = canonicalValue(key, raw)
    if (c.drop) continue
    entries.push([key, c.value])
  }
  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries
    .map(([k, v]) => {
      if (k === 'p_ids' && Array.isArray(v)) return `p_ids=${(v as string[]).join(',')}`
      return `${k}=${JSON.stringify(v)}`
    })
    .join('&')
}

function cacheKey(params: Record<string, unknown>): string {
  const token = params?.p_token ?? null
  return `${String(token)}|${signature(params)}`
}

export function invalidateGovernedCatalog(): void {
  cache.clear()
  inflight.clear()
}

export async function governedCatalog(
  params: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  const key = cacheKey(params)
  const now = Date.now()

  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.res

  const running = inflight.get(key)
  if (running) return running

  const req = supabase
    .rpc('get_governed_products', params)
    .then((res) => {
      if (res.error) return res
      cache.set(key, { at: Date.now(), res })
      return res
    })
    .catch((err) => ({ data: null, error: err }))
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, req)
  return req
}

/**
 * Targeted batch fetch of specific product rows regardless of active/visible
 * state. Used by the cart store and order restore/edit flows so they can carry
 * inactive/out-of-stock historical lines without a full-catalog download.
 */
export async function fetchProductsByIds(
  token: string,
  ids: string[]
): Promise<any[]> {
  const fixed = Array.from(new Set(ids.filter(Boolean)))
  if (fixed.length === 0) return []
  const { data, error } = await governedCatalog({
    p_token: token,
    p_ids: fixed,
    p_active_only: false,
    p_visible_only: false,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}