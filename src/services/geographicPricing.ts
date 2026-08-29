import { supabase } from '../lib/supabase'

export interface GeoResolveTarget {
  id: string
  companyId: string
}

type ResolutionMap = Record<string, number>

export interface GeoAdjustmentRow {
  product_id: string
  company_id: string
  adjustment_percent: number
  rule_name: string
  scope: string
  applied_level: string
}

export interface GeoResolutionByProduct {
  map: ResolutionMap
  rows: GeoAdjustmentRow[]
}

function parseAdjustmentRows(data: unknown): GeoAdjustmentRow[] {
  if (!Array.isArray(data)) return []
  const rows: GeoAdjustmentRow[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const productId = (row as { product_id?: unknown }).product_id
    if (typeof productId !== 'string') continue
    const n = Number((row as { adjustment_percent?: unknown }).adjustment_percent)
    rows.push({
      product_id: productId,
      company_id: String((row as { company_id?: unknown }).company_id ?? ''),
      adjustment_percent: Number.isFinite(n) ? n : 0,
      rule_name: String((row as { rule_name?: unknown }).rule_name ?? ''),
      scope: String((row as { scope?: unknown }).scope ?? ''),
      applied_level: String((row as { applied_level?: unknown }).applied_level ?? ''),
    })
  }
  return rows
}

function toResolution(data: unknown, targets: GeoResolveTarget[]): GeoResolutionByProduct {
  const rows = parseAdjustmentRows(data)
  const map: ResolutionMap = {}
  for (const t of targets) map[t.id] = 0
  for (const r of rows) map[r.product_id] = r.adjustment_percent
  return { map, rows }
}

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

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

export async function getGovernorateAdjustmentRows(
  governorateId: string,
  targets: GeoResolveTarget[]
): Promise<GeoResolutionByProduct> {
  if (!governorateId || targets.length === 0) return { map: {}, rows: [] }
  const { data, error } = await supabase.rpc('get_effective_geographic_adjustments', {
    p_governorate_id: governorateId,
    p_company_ids: targets.map((t) => t.companyId),
    p_product_ids: targets.map((t) => t.id),
  })
  if (error) throw error
  return toResolution(data, targets)
}

export async function getSectorAdjustmentRows(
  sectorId: string,
  targets: GeoResolveTarget[]
): Promise<GeoResolutionByProduct> {
  if (!sectorId || targets.length === 0) return { map: {}, rows: [] }
  const token = getSessionToken()
  if (!token) throw new Error('NO_SESSION')
  const { data, error } = await supabase.rpc('get_effective_geographic_adjustments_for_sector', {
    p_token: token,
    p_sector_id: sectorId,
    p_company_ids: targets.map((t) => t.companyId),
    p_product_ids: targets.map((t) => t.id),
  })
  if (error) throw error
  return toResolution(data, targets)
}