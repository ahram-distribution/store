import { supabase } from '../lib/supabase'

export interface GeoHiddenProductRow {
  product_id: string
  company_id: string
  rule_name: string
  scope: string
}

function parseHiddenRows(data: unknown): GeoHiddenProductRow[] {
  if (!Array.isArray(data)) return []
  const rows: GeoHiddenProductRow[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const productId = (row as { product_id?: unknown }).product_id
    if (typeof productId !== 'string') continue
    rows.push({
      product_id: productId,
      company_id: String((row as { company_id?: unknown }).company_id ?? ''),
      rule_name: String((row as { rule_name?: unknown }).rule_name ?? ''),
      scope: String((row as { scope?: unknown }).scope ?? ''),
    })
  }
  return rows
}

let epoch = 0
const cache = new Map<string, Promise<GeoHiddenProductRow[]>>()

export function bumpGeographicVisibilityEpoch(): void {
  epoch += 1
  cache.clear()
}

export async function getGeographicVisibilityHiddenProducts(
  governorateId: string
): Promise<GeoHiddenProductRow[]> {
  if (!governorateId) return []
  const key = `${epoch}|gov|${governorateId}`
  const hit = cache.get(key)
  if (hit) return hit
  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_geographic_visibility_hidden_products', {
        p_governorate_id: governorateId,
      })
      if (error) throw error
      return parseHiddenRows(data)
    } catch (e) {
      cache.delete(key)
      throw e
    }
  })()
  cache.set(key, promise)
  return promise
}

export async function getGeographicVisibilityHiddenProductsForSector(
  sectorId: string
): Promise<GeoHiddenProductRow[]> {
  if (!sectorId) return []
  const key = `${epoch}|sector|${sectorId}`
  const hit = cache.get(key)
  if (hit) return hit
  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_geographic_visibility_hidden_products_for_sector', {
        p_sector_id: sectorId,
      })
      if (error) throw error
      return parseHiddenRows(data)
    } catch (e) {
      cache.delete(key)
      throw e
    }
  })()
  cache.set(key, promise)
  return promise
}

export interface VisibilitySets {
  hiddenProductIds: Set<string>
  hiddenCompanyIds: Set<string>
}

export function toVisibilitySets(rows: GeoHiddenProductRow[]): VisibilitySets {
  const hiddenProductIds = new Set<string>()
  const hiddenCompanyIds = new Set<string>()
  for (const r of rows) {
    hiddenProductIds.add(r.product_id)
    if (r.company_id) hiddenCompanyIds.add(r.company_id)
  }
  return { hiddenProductIds, hiddenCompanyIds }
}

export function emptyVisibilitySets(): VisibilitySets {
  return { hiddenProductIds: new Set(), hiddenCompanyIds: new Set() }
}