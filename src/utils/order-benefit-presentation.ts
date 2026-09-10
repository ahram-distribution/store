/*
 * ============================================================================
 * ORDER BENEFIT — ORDER DETAILS PRESENTATION (view-only)
 * ============================================================================
 * Pure helpers that turn the persisted snapshot fields on an order into the
 * presentation contract used by the Order Details products section.
 *
 * The page is mode-aware and reads ONLY the historical persisted snapshot:
 *   mode 'bonus'  → order.bonus_mode_used === true  (Bonus Tiers)
 *   mode 'direct' → a real monetary discount existed (persisted discount
 *                   amount, discounted line prices, or an effective %)
 *   mode 'none'   → no applicable Tier discount/benefit
 *
 * Never from today's global benefit mode. No values are invented here:
 * monetary numbers come from persisted fields and the item lines, and the
 * final total always equals the persisted order total.
 * ============================================================================
 */

import type { UnifiedOrderHeader, UnifiedOrderItem } from '../types/unified-order'

/** Virtual grouping name under which ALL bonus-gifted products are displayed. */
export const VIRTUAL_BONUS_COMPANY_NAME = 'شركة بونص وهدايا'

export type OrderBenefitMode = 'none' | 'direct' | 'bonus'

export interface BonusGroupResult {
  company: string
  items: UnifiedOrderItem[]
  subtotal: number
  totalPieces: number
}

export interface OrderFinancialPresentation {
  /** Historical benefit mode of the order: none | direct | bonus. */
  mode: OrderBenefitMode
  /** True when a single % applies to every MAIN product (Bonus Tiers only). */
  uniform: boolean
  /**
   * Benefit information section text:
   *   bonus + uniform → "إجمالي المنفعة: 2.5%"
   *   bonus + mixed   → "المنفعة حسب المنتج"
   *   direct / none   → ""
   */
  benefitInfoLabel: string
  /** Historical sum of tier + payment + shipping snapshot discounts. */
  effectivePercent: number
  /** Per-line credit percent (numeric) for MAIN lines when uniform, else null. */
  perLineCreditPct: number | null
  mainGroups: BonusGroupResult[]
  bonusGroup: BonusGroupResult | null
  /** Sum of official base line totals of MAIN products. */
  mainBaseTotal: number
  /** Sum of official base line totals of BONUS products. */
  bonusProductsTotal: number
  /** mainBaseTotal + bonusProductsTotal (المطلوب قبل حساب البونص). */
  beforeBonusTotal: number
  /** Persisted bonus credit (fallback: uniform ratio × main base total). */
  bonusCredit: number
  /** Sum of official base line totals of ALL products (Direct Discount). */
  directBaseTotal: number
  /** Actual monetary discount (persisted, or base − net). */
  directDiscountAmount: number
  /** Persisted order total = the authoritative closing amount. */
  finalTotal: number
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function lineBaseTotal(item: UnifiedOrderItem): number {
  const qty = num(item.unit_quantity)
  const base = num(item.base_unit_price)
  if (qty > 0 && base > 0) return round2(qty * base)
  return num(item.total_price)
}

function piecesOf(item: UnifiedOrderItem): number {
  const qty = num(item.unit_quantity)
  if (item.unit_type === 'dozen') return qty * 12
  const stored = num(item.piece_quantity)
  return stored > 0 ? stored : qty
}

export function isBonusOrder(order: UnifiedOrderHeader): boolean {
  return order?.bonus_mode_used === true
}

/** Split persisted items into MAIN products vs BONUS (gifted) products. */
export function splitItemsByBonus(items: UnifiedOrderItem[]): {
  mainItems: UnifiedOrderItem[]
  bonusItems: UnifiedOrderItem[]
} {
  const mainItems: UnifiedOrderItem[] = []
  const bonusItems: UnifiedOrderItem[] = []
  for (const item of items) {
    if (item.is_bonus === true) bonusItems.push(item)
    else mainItems.push(item)
  }
  return { mainItems, bonusItems }
}

/** Historical sum: tier + payment + shipping snapshot discounts. */
export function effectiveBenefitPercent(order: UnifiedOrderHeader): number {
  return round2((num(order.snapshot_tier_discount) + num(order.snapshot_payment_discount) + num(order.snapshot_shipping_discount)))
}

function buildGroups(items: UnifiedOrderItem[]): BonusGroupResult[] {
  const byCompany = new Map<string, UnifiedOrderItem[]>()
  for (const item of items) {
    const key = item.company_name || 'أخرى'
    const list = byCompany.get(key)
    if (list) list.push(item)
    else byCompany.set(key, [item])
  }
  const groups: BonusGroupResult[] = []
  for (const [company, groupItems] of byCompany.entries()) {
    groups.push({
      company,
      items: groupItems,
      subtotal: round2(groupItems.reduce((s, i) => s + lineBaseTotal(i), 0)),
      totalPieces: groupItems.reduce((s, i) => s + piecesOf(i), 0),
    })
  }
  return groups
}

const formatPct = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)))

/** Detect a REAL monetary discount on non-bonus orders from persisted evidence. */
function hasDirectDiscount(order: UnifiedOrderHeader, items: UnifiedOrderItem[]): boolean {
  if (num(order.discount_amount) > 0) return true
  const hasNetPrices = items.some((i) => {
    const base = num(i.base_unit_price)
    const unit = num(i.unit_price)
    return base > 0 && Math.abs(base - unit) > 0.009
  })
  if (hasNetPrices) return true
  if (num(order.effective_discount_percent) > 0) return true
  if (effectiveBenefitPercent(order) > 0) return true
  return false
}

function buildBonusPresentation(order: UnifiedOrderHeader, items: UnifiedOrderItem[]): OrderFinancialPresentation {
  const { mainItems, bonusItems } = splitItemsByBonus(items)
  const mainBaseTotal = round2(mainItems.reduce((s, i) => s + lineBaseTotal(i), 0))
  const bonusProductsTotal = round2(bonusItems.reduce((s, i) => s + lineBaseTotal(i), 0))
  const beforeBonusTotal = round2(mainBaseTotal + bonusProductsTotal)

  const effectivePercent = effectiveBenefitPercent(order)
  const persistedCredit = num(order.bonus_credit)
  const mainBase = num(order.main_base_total) > 0 ? num(order.main_base_total) : mainBaseTotal
  const creditRatio = mainBase > 0 && persistedCredit > 0 ? round2((persistedCredit / mainBase) * 100) : 0
  const uniform = creditRatio > 0 && Math.abs(creditRatio - effectivePercent) <= 0.01

  const bonusCredit = persistedCredit > 0
    ? persistedCredit
    : uniform
      ? round2((mainBase * effectivePercent) / 100)
      : 0

  return {
    mode: 'bonus',
    uniform,
    benefitInfoLabel: effectivePercent > 0
      ? uniform
        ? `إجمالي المنفعة: ${formatPct(effectivePercent)}%`
        : 'المنفعة حسب المنتج'
      : '',
    effectivePercent,
    perLineCreditPct: uniform ? effectivePercent : null,
    mainGroups: buildGroups(mainItems),
    bonusGroup: bonusItems.length > 0 ? {
      company: VIRTUAL_BONUS_COMPANY_NAME,
      items: bonusItems,
      subtotal: bonusProductsTotal,
      totalPieces: bonusItems.reduce((s, i) => s + piecesOf(i), 0),
    } : null,
    mainBaseTotal,
    bonusProductsTotal,
    beforeBonusTotal,
    bonusCredit,
    directBaseTotal: 0,
    directDiscountAmount: 0,
    finalTotal: num(order.total_amount),
  }
}

export function buildOrderFinancialPresentation(
  order: UnifiedOrderHeader,
  items: UnifiedOrderItem[],
): OrderFinancialPresentation {
  const finalTotal = num(order.total_amount)

  if (isBonusOrder(order)) {
    return buildBonusPresentation(order, items)
  }

  if (!hasDirectDiscount(order, items)) {
    return {
      mode: 'none',
      uniform: false,
      benefitInfoLabel: '',
      effectivePercent: 0,
      perLineCreditPct: null,
      mainGroups: [],
      bonusGroup: null,
      mainBaseTotal: 0,
      bonusProductsTotal: 0,
      beforeBonusTotal: 0,
      bonusCredit: 0,
      directBaseTotal: 0,
      directDiscountAmount: 0,
      finalTotal,
    }
  }

  const directBaseTotal = round2(items.reduce((s, i) => s + lineBaseTotal(i), 0))
  const netGrand = round2(items.reduce((s, i) => s + num(i.total_price), 0))
  const persistedDiscount = num(order.discount_amount)
  const directDiscountAmount = persistedDiscount > 0
    ? persistedDiscount
    : round2(directBaseTotal - netGrand)

  return {
    mode: 'direct',
    uniform: false,
    benefitInfoLabel: '',
    effectivePercent: 0,
    perLineCreditPct: null,
    mainGroups: [],
    bonusGroup: null,
    mainBaseTotal: 0,
    bonusProductsTotal: 0,
    beforeBonusTotal: 0,
    bonusCredit: 0,
    directBaseTotal,
    directDiscountAmount,
    finalTotal,
  }
}

/** Per-line bonus credit value for a MAIN product line when a uniform % applies. */
export function mainLineCredit(item: UnifiedOrderItem, pct: number | null): number | null {
  if (pct == null) return null
  const base = lineBaseTotal(item)
  if (base <= 0) return null
  return round2((base * pct) / 100)
}