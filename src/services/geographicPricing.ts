import { supabase } from '../lib/supabase'

export interface GeoResolveTarget {
  id: string
  companyId: string
}

type ResolutionMap = Record<string, number>

let epoch = 0
let cached: { key: string; map: ResolutionMap } | null = null
let inflight: { key: string; promise: Promise<ResolutionMap> } | null = null

function makeKey(governorateId: string, targets: GeoResolveTarget[]): string {
  const ids = targets.map((t) => t.id).sort().join(',')
  return `${epoch}|${governorateId}|${ids}`
}

export function currentGeoEpoch(): number {
  return epoch
}

export function invalidateGeographicResolutions(): void {
  epoch += 1
  cached = null
  inflight = null
}

function parseBatchRows(data: unknown, fallback: ResolutionMap): ResolutionMap {
  const map: ResolutionMap = { ...fallback }
  if (!Array.isArray(data)) return map
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const productId = (row as { product_id?: unknown }).product_id
    if (typeof productId !== 'string') continue
    const n = Number((row as { adjustment_percent?: unknown }).adjustment_percent)
    map[productId] = Number.isFinite(n) ? n : 0
  }
  return map
}

export async function getGeographicAdjustmentsForProducts(
  governorateId: string,
  targets: GeoResolveTarget[]
): Promise<ResolutionMap> {
  if (!governorateId || targets.length === 0) return {}
  const key = makeKey(governorateId, targets)
  if (cached?.key === key) return cached.map

  const fallback: ResolutionMap = {}
  for (const t of targets) fallback[t.id] = 0

  if (inflight?.key === key) return inflight.promise

  const promise = (async (): Promise<ResolutionMap> => {
    try {
      const { data, error } = await supabase.rpc('get_effective_geographic_adjustments', {
        p_governorate_id: governorateId,
        p_company_ids: targets.map((t) => t.companyId),
        p_product_ids: targets.map((t) => t.id),
      })
      if (error) throw error
      const result = parseBatchRows(data, fallback)
      if (cached?.key !== key) cached = { key, map: result }
      return result
    } finally {
      if (inflight?.key === key) inflight = null
    }
  })()

  inflight = { key, promise }
  return promise
}