import type {
  CartItem,
  CartDealItem,
  CartTotals,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  TierExceptionLookup,
  BonusItemEntitlement,
  BonusCreditResult,
  BonusSummary,
} from '../types/storefront'
import {
  computeEffectiveDiscountPercent,
  computeEffectivePaymentDiscountPercent,
  computeEffectiveShippingDiscountPercent,
  computeCompanyRuleResult,
  computeTotalDiscountPercent,
  round2,
} from './pricing.ts'

/**
 * Bonus Tiers engine (Phase 2) — centralized Bonus Credit / Bonus Summary math.
 *
 * Bonus mode (spec §7.2, D-O2/D-O5):
 *   main items stay at their geo-adjusted BASE price (no % deducted);
 *   Bonus Credit = Σ per-main-product entitlement using the existing
 *   Tier + Payment + Shipping precedence (Product > Company > Global);
 *   Bonus products use their BASE price (D-O8) and are never discounted;
 *   Applied = MIN(credit, Σ bonus); Unused = MAX(credit − Σ bonus, 0) → expires;
 *   Overflow = MAX(Σ bonus − credit, 0) → payable; Final Payable = Σ main + overflow.
 *
 * OFF mode is completely untouched — every function here is additive and only
 * invoked when Bonus Mode is ON. Money uses the existing 2-decimal engine (D-O1);
 * per-item round2 only, NO whole-EGP rounding.
 */

/** Geo-adjusted base value of a cart line: base unit price × qty when available, else totalPrice. */
function itemBaseValue(item: CartItem): number {
  if (typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0) {
    return round2(item.baseUnitPrice * item.unitQuantity)
  }
  return round2(item.totalPrice)
}

/**
 * D-O8 guarantee: a Bonus product is priced at its ORIGINAL BASE PRICE only.
 * Returns false when the item carries a discount (unitPrice below baseUnitPrice).
 */
export function assertBonusBasePrice(item: CartItem): boolean {
  if (typeof item.baseUnitPrice !== 'number' || item.baseUnitPrice < 0) return true
  return Math.abs(item.unitPrice - item.baseUnitPrice) <= 0.0100001
}

/**
 * Per-main-product entitlement: base_i × (tier% + pay% + ship%) / 100, resolved
 * with the existing precedence (Product > Company > Global) per group. round2 (D-O1).
 */
export function computeItemBonusEntitlement(
  item: CartItem,
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): BonusItemEntitlement {
  const tierPercent = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const paymentPercent = computeEffectivePaymentDiscountPercent(paymentOption, exceptionLookup)
  const shippingPercent = computeEffectiveShippingDiscountPercent(shippingOption, exceptionLookup)
  const combinedPercent = tierPercent + paymentPercent + shippingPercent
  const baseValue = itemBaseValue(item)
  const credit = round2((baseValue * combinedPercent) / 100)
  return {
    productId: item.productId,
    productName: item.productName,
    baseValue,
    tierPercent,
    paymentPercent,
    shippingPercent,
    combinedPercent,
    credit,
  }
}

/** Per-item credit is split across the three groups in proportion to each group's share. */
function splitGroupCredits(ent: BonusItemEntitlement): { tier: number; payment: number; shipping: number } {
  if (ent.combinedPercent <= 0) return { tier: 0, payment: 0, shipping: 0 }
  return {
    tier: round2(ent.credit * (ent.tierPercent / ent.combinedPercent)),
    payment: round2(ent.credit * (ent.paymentPercent / ent.combinedPercent)),
    shipping: round2(ent.credit * (ent.shippingPercent / ent.combinedPercent)),
  }
}

/**
 * Bonus Credit over every MAIN product (spec §11). Mirrors computeCartTotals'
 * per-item exception resolution via exceptionsByProduct fallback.
 */
export function computeBonusCredit(
  mainItems: CartItem[],
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null,
  exceptionsByProduct?: Record<string, TierExceptionLookup | null>
): BonusCreditResult {
  const lookupForItem = (item: CartItem): TierExceptionLookup | null | undefined => {
    if (exceptionsByProduct && item.productId in exceptionsByProduct) {
      return exceptionsByProduct[item.productId]
    }
    return exceptionLookup
  }

  let mainBaseTotal = 0
  let totalBonusCredit = 0
  let tierCredit = 0
  let paymentCredit = 0
  let shippingCredit = 0
  const items: BonusItemEntitlement[] = []

  for (const item of mainItems) {
    const lookup = lookupForItem(item)
    const ent = computeItemBonusEntitlement(item, tier, paymentOption, shippingOption, lookup ?? exceptionLookup)
    const split = splitGroupCredits(ent)
    mainBaseTotal += ent.baseValue
    totalBonusCredit += ent.credit
    tierCredit += split.tier
    paymentCredit += split.payment
    shippingCredit += split.shipping
    items.push(ent)
  }

  return {
    mainBaseTotal: round2(mainBaseTotal),
    totalBonusCredit: round2(totalBonusCredit),
    tierCredit: round2(tierCredit),
    paymentCredit: round2(paymentCredit),
    shippingCredit: round2(shippingCredit),
    items,
  }
}

/**
 * Full bonus-mode accounting (spec §13.3). Tier minimum is checked against the
 * MAIN subtotal only (§24.2); company diversification rules use main items' base
 * subtotal (bonus items never participate — D-O11). Final Payable = Σ main + overflow.
 */
export function computeBonusSummary(
  mainItems: CartItem[],
  bonusItems: CartItem[],
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null,
  exceptionsByProduct?: Record<string, TierExceptionLookup | null>
): BonusSummary {
  const credit = computeBonusCredit(mainItems, tier, paymentOption, shippingOption, exceptionLookup, exceptionsByProduct)

  const bonusProductsTotal = round2(bonusItems.reduce((sum, item) => sum + itemBaseValue(item), 0))
  const bonusApplied = round2(Math.min(credit.totalBonusCredit, bonusProductsTotal))
  const bonusUnused = round2(Math.max(credit.totalBonusCredit - bonusProductsTotal, 0))
  const bonusOverflow = round2(Math.max(bonusProductsTotal - credit.totalBonusCredit, 0))
  const finalPayable = round2(credit.mainBaseTotal + bonusOverflow)

  const tierMinimum = tier?.minimumOrderAmount ?? 0
  const meetsTierMinimum = credit.mainBaseTotal >= tierMinimum
  const remainingForMinimum = meetsTierMinimum ? 0 : round2(Math.max(0, tierMinimum - credit.mainBaseTotal))

  const { companyRule, meetsCompanyRules } = computeCompanyRuleResult(mainItems, tier, credit.mainBaseTotal)

  return {
    ...credit,
    bonusProductsTotal,
    bonusApplied,
    bonusUnused,
    bonusOverflow,
    finalPayable,
    tierMinimum,
    meetsTierMinimum,
    remainingForMinimum,
    companyRule,
    meetsCompanyRules,
  }
}

/**
 * Bonus-mode CartTotals — additive counterpart of computeCartTotals for the cart
 * store to call when Bonus Mode is ON. OFF mode keeps calling computeCartTotals.
 * The flat CartItem[] is split by the additive isBonus flag. Deals/Flash Offers
 * never generate or consume credit (D-O11); they only add to the payable.
 */
export function computeBonusModeTotals(
  items: CartItem[],
  tier: TierConfig | null,
  dealItems?: CartDealItem[],
  flashOfferItems?: CartDealItem[],
  exceptionLookup?: TierExceptionLookup | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionsByProduct?: Record<string, TierExceptionLookup | null>
): CartTotals {
  const mainItems = items.filter((item) => !item.isBonus)
  const bonusItems = items.filter((item) => item.isBonus)

  const summary = computeBonusSummary(
    mainItems,
    bonusItems,
    tier,
    paymentOption,
    shippingOption,
    exceptionLookup,
    exceptionsByProduct
  )

  const dealTotal =
    (dealItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0) +
    (flashOfferItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)

  return {
    subtotal: round2(summary.mainBaseTotal + summary.bonusProductsTotal + dealTotal),
    totalDiscount: 0,
    tierDiscount: 0,
    paymentDiscount: 0,
    shippingDiscount: 0,
    totalDiscountPercent: computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup),
    netTotal: round2(summary.finalPayable + dealTotal),
    itemCount: items.length + (dealItems?.length ?? 0) + (flashOfferItems?.length ?? 0),
    meetsTierMinimum: summary.meetsTierMinimum,
    remainingForMinimum: summary.remainingForMinimum,
    tierMinimum: summary.tierMinimum,
    dealTotal,
    productSubtotal: round2(summary.mainBaseTotal + summary.bonusProductsTotal),
    productBaseSubtotal: summary.mainBaseTotal,
    companyRule: summary.companyRule,
    meetsCompanyRules: summary.meetsCompanyRules,
    bonusMode: true,
    bonusCredit: summary.totalBonusCredit,
    bonusApplied: summary.bonusApplied,
    bonusUnused: summary.bonusUnused,
    bonusOverflow: summary.bonusOverflow,
    bonusProductsTotal: summary.bonusProductsTotal,
    mainBaseTotal: summary.mainBaseTotal,
    bonusSummary: summary,
  }
}