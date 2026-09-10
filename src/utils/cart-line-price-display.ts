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

function itemBaseValue(item: CartItem): number {
  return typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
    ? round2c(item.baseUnitPrice * item.unitQuantity)
    : round2c(item.totalPrice)
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
  const baseUnit =
    typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0 ? item.baseUnitPrice : item.unitPrice
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