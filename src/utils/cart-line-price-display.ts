import type { CartItem, CartTotals } from '../types/storefront'
import { round2 } from '../engine/pricing'

export interface ResolvedLinePrice {
  /** Existing per-item effective benefit percent (bonus: from bonusSummary; direct: from base vs net). */
  percent: number
  /** Original governed unit price before the effective benefit. */
  originalUnit: number
  /** Net unit price after the effective benefit. */
  netUnit: number
  /** Original governed line total (qty × original unit). */
  originalLine: number
  /** Net line total (qty × net unit). */
  netLine: number
}

const round2c = round2

export interface BasePriceLineLike {
  baseUnitPrice?: number
  unitPrice?: number
  totalPrice: number
  unitQuantity: number
}

/**
 * The authoritative BASE unit price of a line. A stored base of 0 is NEVER a
 * real price — it means "not captured" (returned/bonus orders restored after a
 * legacy resubmit carry base_unit_price = 0). In that case the base falls back
 * to line.unitPrice (final/base price in the snapshot) and finally to the
 * derived total-per-unit, so restored orders can never display zero.
 */
export function itemBaseUnitPrice(item: BasePriceLineLike): number {
  if (typeof item.baseUnitPrice === 'number' && item.baseUnitPrice > 0) return item.baseUnitPrice
  if (typeof item.unitPrice === 'number' && item.unitPrice > 0) return item.unitPrice
  if (item.unitQuantity > 0 && item.totalPrice > 0) return round2c(item.totalPrice / item.unitQuantity)
  return 0
}

function itemBaseValue(item: CartItem): number {
  return round2c(itemBaseUnitPrice(item) * item.unitQuantity)
}

/** Locate the resolved entitlement for the line and derive the effective benefit percent. */
function combinedPercentFor(item: CartItem, totals: CartTotals | null | undefined): number {
  if (item.isBonus || !totals?.bonusSummary) return 0
  if (totals.bonusSummary.items.length === 0) return 0
  const baseValue = itemBaseValue(item)
  const exact = totals.bonusSummary.items.find(
    (e) => e.productId === item.productId && Math.abs(e.baseValue - baseValue) < 0.011
  )
  if (exact) return exact.combinedPercent || 0
  const scaled = totals.bonusSummary.items.find(
    (e) => e.productId === item.productId && Math.abs(e.baseValue - baseValue * item.unitQuantity) < 0.011
  )
  if (scaled) return scaled.combinedPercent || 0
  const byProduct = totals.bonusSummary.items.find((e) => e.productId === item.productId)
  return byProduct?.combinedPercent || 0
}

/**
 * Customer-facing presentation of one cart line using ONLY already-resolved
 * values (totals.bonusSummary per-item entitlements / the line's own base vs
 * net prices). No discount is re-resolved here.
 */
export function resolveLinePrice(item: CartItem, totals?: CartTotals | null): ResolvedLinePrice {
  const baseUnit = itemBaseUnitPrice(item)
  const originalUnit = round2c(baseUnit)
  const originalLine = round2c(originalUnit * item.unitQuantity)

  const percent = combinedPercentFor(item, totals)
  if (percent > 0) {
    const netUnit = round2c(originalUnit * (1 - percent / 100))
    const ent = item.isBonus
      ? undefined
      : totals?.bonusSummary?.items.find(
          (e) => e.productId === item.productId && Math.abs(e.baseValue - itemBaseValue(item)) < 0.011
        )
    const netLine = ent
      ? round2c(originalUnit * item.unitQuantity - ent.credit)
      : round2c(netUnit * item.unitQuantity)
    return { percent, originalUnit, netUnit, originalLine, netLine }
  }

  const netUnit = round2c(Math.min(originalUnit, item.unitPrice) || originalUnit)
  return { percent: 0, originalUnit, netUnit, originalLine, netLine: round2c(netUnit * item.unitQuantity) }
}

/** Compact "خصم 5%" style number (no Arabic-localized digits). */
export function percentText(pct: number): string {
  const p = Number(pct)
  return p % 1 === 0 ? String(p) : String(Number(Number(p).toFixed(1)))
}

export interface CartCompanyGroup {
  companyId: string
  companyName: string
  items: CartItem[]
}

const _companyCollator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator(['ar', 'en'], { sensitivity: 'base', numeric: false })
  : null

function _compareNames(a: string, b: string): number {
  return _companyCollator ? _companyCollator.compare(a || '', b || '') : (a || '').localeCompare(b || '')
}

export function groupAndSortCartItems(
  items: CartItem[],
  productCompanyMap?: Map<string, { id: string; name: string }>
): CartCompanyGroup[] {
  const map = new Map<string, CartCompanyGroup>()
  for (const item of items) {
    const company = productCompanyMap?.get(item.productId)
    const companyId = company?.id || item.companyId || 'unknown'
    const companyName = company?.name || item.companyName || 'غير معروف'
    let g = map.get(companyId)
    if (!g) { g = { companyId, companyName, items: [] }; map.set(companyId, g) }
    g.items.push(item)
  }
  const groups = Array.from(map.values())
  groups.sort((a, b) => _compareNames(a.companyName, b.companyName) || a.companyId.localeCompare(b.companyId))
  for (const g of groups) {
    g.items.sort(
      (a, b) =>
        _compareNames(a.productName, b.productName) ||
        a.productId.localeCompare(b.productId) ||
        a.unitType.localeCompare(b.unitType)
    )
  }
  return groups
}