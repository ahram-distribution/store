import { supabase } from '../lib/supabase'

/**
 * Module-level TTL cache for the governed product catalog RPC.
 *
 * get_governed_products returns a large payload (every governed product with
 * nested product_units and inventory), and many screens (ProductManagerPage,
 * StorefrontPage, OrderDetailPage, SalesListPage, ...) fetch the same catalog
 * afresh on every mount. This cache shares those reads for a short window and
 * deduplicates parallel identical requests (inflight), dramatically cutting
 * redundant egress without any RPC/schema change.
 *
 * - Keyed by session token + exact RPC params, so filtered/searched reads stay
 *   correct per caller.
 * - TTL is 5 min; mutations must call invalidateGovernedCatalog() so admin
 *   product/unit changes appear immediately without short-TTL polling. Stock and
 *   reservation rules are enforced server-side by the governed RPCs (fresh DB
 *   reads), so a longer client cache never weakens business invariants.
 * - Inflight dedupe returns the SAME promise to concurrent identical calls.
 */
const CACHE_TTL_MS = 300_000
const inflight = new Map<string, Promise<{ data: any; error: any }>>()
const cache = new Map<string, { at: number; res: { data: any; error: any } }>()

function signature(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort()
  return keys.map((k) => `${k}=${JSON.stringify(params[k])}`).join('&')
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