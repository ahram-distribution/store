import type {
  ComputedPrices,
  ProductWithPrice,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  UnitType,
  CartItem,
  CartDealItem,
  CartTotals,
  OrderBenefitRates,
  TierExceptionLookup,
  DiscountOverridePair,
  CompanyRuleResult,
  CompanyAddGuardResult,
} from '../types/storefront'

export function computePieceQuantity(unitQuantity: number, unitType: UnitType, cartonQuantity: number): number {
  const multiplier = unitType === 'piece' ? 1 : unitType === 'dozen' ? 12 : cartonQuantity
  return unitQuantity * multiplier
}

export function applyGeographicAdjustment(basePrice: number, adjustmentPercent: number): number {
  return basePrice * (1 + adjustmentPercent / 100)
}

export function computeTierPrice(basePrice: number, tier: TierConfig | null): number {
  if (!tier || tier.discountPercent === 0) return basePrice
  return basePrice * (1 - tier.discountPercent / 100)
}

export function computeEffectiveDiscountPercent(
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!tier) return 0
  if (exceptionLookup?.productException !== null && exceptionLookup?.productException !== undefined) {
    return exceptionLookup.productException
  }
  if (exceptionLookup?.companyException !== null && exceptionLookup?.companyException !== undefined) {
    return exceptionLookup.companyException
  }
  return tier.discountPercent
}

/** Resolves one override group: product override > company override > option global. */
function resolveGroupOverride(globalPercent: number, override?: DiscountOverridePair | null): number {
  if (override?.productException !== null && override?.productException !== undefined) {
    return override.productException
  }
  if (override?.companyException !== null && override?.companyException !== undefined) {
    return override.companyException
  }
  return globalPercent
}

export function computeEffectivePaymentDiscountPercent(
  paymentOption?: PaymentMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!paymentOption) return 0
  return resolveGroupOverride(paymentOption.discountPercent, exceptionLookup?.paymentOverride)
}

export function computeEffectiveShippingDiscountPercent(
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  if (!shippingOption) return 0
  return resolveGroupOverride(shippingOption.discountPercent, exceptionLookup?.shippingOverride)
}

/**
 * Sum of the three independent discount groups (Method B — sum then apply once).
 * Example: tier 2.5% + payment 1% + shipping 1% => 4.5% applied ONCE on the base price.
 */
export function computeTotalDiscountPercent(
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  const tierPart = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const paymentPart = computeEffectivePaymentDiscountPercent(paymentOption, exceptionLookup)
  const shippingPart = computeEffectiveShippingDiscountPercent(shippingOption, exceptionLookup)
  return tierPart + paymentPart + shippingPart
}

export function computeExceptionAwareTierPrice(
  basePrice: number,
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null
): number {
  const discountPercent = computeEffectiveDiscountPercent(tier, exceptionLookup)
  if (!tier || discountPercent === 0) return basePrice
  return basePrice * (1 - discountPercent / 100)
}

/**
 * Effective per-group rates for a set of per-product exception lookups.
 * `uniform: true` only when EVERY lookup resolves to the same Tier/Payment/
 * Shipping group — the single case where one order-wide percentage is honest.
 * An empty lookup list (no products) resolves the option defaults.
 */
export function computeOrderBenefitRates(
  lookups: Array<TierExceptionLookup | null | undefined>,
  tier: TierConfig | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null
): OrderBenefitRates {
  const rates = lookups.map((lk) => ({
    tier: computeEffectiveDiscountPercent(tier, lk),
    pay: computeEffectivePaymentDiscountPercent(paymentOption, lk),
    ship: computeEffectiveShippingDiscountPercent(shippingOption, lk),
  }))
  if (rates.length === 0) {
    const t = computeEffectiveDiscountPercent(tier, null)
    const p = computeEffectivePaymentDiscountPercent(paymentOption, null)
    const s = computeEffectiveShippingDiscountPercent(shippingOption, null)
    return { uniform: true, tierPct: t, payPct: p, shipPct: s, sumPct: t + p + s }
  }
  const first = rates[0]
  const uniform = rates.every((r) => r.tier === first.tier && r.pay === first.pay && r.ship === first.ship)
  return {
    uniform,
    tierPct: first.tier,
    payPct: first.pay,
    shipPct: first.ship,
    sumPct: uniform ? first.tier + first.pay + first.ship : 0,
  }
}

export function computeProductPrices(
  product: ProductWithPrice,
  tier: TierConfig | null,
  exceptionLookup?: TierExceptionLookup | null,
  geographicAdjustment?: number | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null
): ComputedPrices {
  const geoAdj = geographicAdjustment ?? 0
  const piecePrice = Math.round(applyGeographicAdjustment(product.piecePrice, geoAdj) * 100) / 100
  const dozenPrice = Math.round(applyGeographicAdjustment(product.dozenPrice, geoAdj) * 100) / 100
  const cartonPrice = Math.round(applyGeographicAdjustment(product.cartonPrice, geoAdj) * 100) / 100
  const effectiveDiscount = computeEffectiveDiscountPercent(tier, exceptionLookup)
  const effectiveTier = tier ? { ...tier, discountPercent: effectiveDiscount } : null
  const totalDiscountPercent = computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup)
  const totalTier = { ...(tier ?? {}), discountPercent: totalDiscountPercent } as TierConfig

  return {
    piecePrice,
    dozenPrice,
    cartonPrice,
    tierPiecePrice: computeTierPrice(piecePrice, effectiveTier),
    tierDozenPrice: computeTierPrice(dozenPrice, effectiveTier),
    tierCartonPrice: computeTierPrice(cartonPrice, effectiveTier),
    discountPercent: effectiveDiscount,
    paymentDiscountPercent: computeEffectivePaymentDiscountPercent(paymentOption, exceptionLookup),
    shippingDiscountPercent: computeEffectiveShippingDiscountPercent(shippingOption, exceptionLookup),
    totalDiscountPercent,
    finalPiecePrice: computeTierPrice(piecePrice, totalTier),
    finalDozenPrice: computeTierPrice(dozenPrice, totalTier),
    finalCartonPrice: computeTierPrice(cartonPrice, totalTier),
  }
}

export function getUnitBasePrice(prices: ComputedPrices, unitType: UnitType): number {
  switch (unitType) {
    case 'piece': return prices.piecePrice
    case 'dozen': return prices.dozenPrice
    case 'carton': return prices.cartonPrice
  }
}

export function getEffectiveUnitPrice(prices: ComputedPrices, unitType: UnitType, hasTier: boolean): number {
  if (!hasTier) return getUnitBasePrice(prices, unitType)
  switch (unitType) {
    case 'piece': return prices.tierPiecePrice
    case 'dozen': return prices.tierDozenPrice
    case 'carton': return prices.tierCartonPrice
  }
}

/** Final unit price after ALL discount groups are applied once (used by the cart). */
export function getFinalUnitPrice(prices: ComputedPrices, unitType: UnitType): number {
  switch (unitType) {
    case 'piece': return prices.finalPiecePrice
    case 'dozen': return prices.finalDozenPrice
    case 'carton': return prices.finalCartonPrice
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Company diversification rules (minimum distinct companies + per-company maximum)
 * evaluated over a given item set. Exact same logic as the block historically
 * inlined in computeCartTotals — extracted so the bonus engine can evaluate it.
 *
 * SINGLE BUSINESS RULE: company diversification applies to MAIN products only.
 * Bonus products (is_bonus = true) are a COMPLETE EXCEPTION from the ENTIRE
 * diversification rule — they never enter a company's value, never count toward
 * the distinct-company count, cannot trip the per-company cap, and cannot
 * satisfy the minimum-company-count requirement. This filter is enforced HERE
 * (the governed function) so every caller — Storefront/Cart totals, the bonus
 * engine, checkout eligibility — shares the same definition regardless of
 * whether it hands over main-only items or a flat mixed list of the full order.
 *
 * AUTHORITATIVE BASIS (2026 correction): the per-company maximum is derived from
 * the SELECTED TIER's own value, never from the current cart subtotal:
 *
 *   maxCompanyValue = tier.minimumOrderAmount × maxCompanyPurchasePercent / 100
 *
 *   e.g. 2,000,000 × 25% = 500,000 EGP — fixed regardless of the cart subtotal.
 *
 * A company's MAIN purchase value must never exceed maxCompanyValue. The
 * minimum-company-count rule (A) is independent of the per-company maximum (B)
 * and only gates final eligibility.
 */
export function computeCompanyRuleResult(
  items: CartItem[],
  tier: TierConfig | null
): { companyRule: CompanyRuleResult | null; meetsCompanyRules: boolean } {
  const minCompanyCount = tier?.minimumCompanyCount ?? null
  const maxCompanyPct = tier?.maxCompanyPurchasePercent ?? null
  const hasCompanyRules = minCompanyCount !== null || maxCompanyPct !== null

  if (!hasCompanyRules) return { companyRule: null, meetsCompanyRules: true }

  const tierValue = tier?.minimumOrderAmount ?? 0
  const maxCompanyValue =
    tierValue > 0 && maxCompanyPct !== null && maxCompanyPct > 0
      ? round2((tierValue * maxCompanyPct) / 100)
      : null

  const companyMap = new Map<string, { value: number; companyName: string }>()
  for (const item of items) {
    // BONUS EXCEPTION: Bonus Store lines never participate in diversification.
    // They are excluded here — not from a denominator alone, but from the whole
    // rule (company value × distinct count × caps × minimum eligibility).
    if (item.isBonus) continue
    const cid = item.companyId || ''
    const entry = companyMap.get(cid)
    const itemBase =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : item.totalPrice
    if (entry) {
      entry.value += itemBase
    } else {
      companyMap.set(cid, { value: itemBase, companyName: item.companyName || '' })
    }
  }

  const distinctCompanyCount = companyMap.size
  const meetsMinimumCompanies = minCompanyCount === null || distinctCompanyCount >= minCompanyCount

  const companies = Array.from(companyMap.entries()).map(([companyId, { value, companyName }]) => {
    // % is the company's share of the SELECTED TIER value (never the cart subtotal).
    const percent = tierValue > 0 ? (value / tierValue) * 100 : 0
    const exceedsCap = maxCompanyValue !== null && round2(value) > maxCompanyValue + 0.0001
    return {
      companyId,
      companyName,
      value: round2(value),
      percent: round2(percent),
      maxPercent: maxCompanyPct,
      maxCompanyValue,
      exceedsCap,
    }
  })

  const meetsCompanyCaps = maxCompanyValue === null || companies.every((c) => !c.exceedsCap)

  const meetsCompanyRules = meetsMinimumCompanies && meetsCompanyCaps

  const companyRule: CompanyRuleResult = {
    minimumCompanyCount: minCompanyCount,
    maxCompanyPurchasePercent: maxCompanyPct,
    tierValue: tierValue > 0 ? tierValue : undefined,
    maxCompanyValue: maxCompanyValue ?? undefined,
    distinctCompanyCount,
    meetsMinimumCompanies,
    meetsCompanyCaps,
    companies,
  }

  return { companyRule, meetsCompanyRules }
}

/**
 * MAIN-only base subtotal. Informational only — since the 2026 correction the
 * company cap is derived from the SELECTED TIER value, NOT from this subtotal.
 * Bonus items are never counted toward company concentration.
 */
export function computeMainCompanyBaseSubtotal(items: CartItem[]): number {
  let sum = 0
  for (const item of items) {
    if (item.isBonus) continue
    sum +=
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : item.totalPrice
  }
  return sum
}

export interface CompanyAddTarget {
  productId: string
  unitType: UnitType
}

/**
 * Dynamic user-facing condition for a LIMITED-tier diversification config.
 * Kept as a single governed helper so the Cart sentence always mirrors the
 * SAVED minimum_company_count / max_company_purchase_percent values.
 */
export function companyDiversificationSentence(minimumCompanyCount: number, maxCompanyPurchasePercent: number): string {
  return `يجب أن تتنوع الفاتورة بين ${minimumCompanyCount} شركات على الأقل وأن لا تتجاوز قيمة المشتريات من كل شركة ${maxCompanyPurchasePercent}% بحد أقصى.`
}

/**
 * Governed "can I add / increase this line?" guard for the SELECTED tier's
 * per-company maximum — the AUDITED values are read from the saved TierConfig
 * (no hardcoding anywhere). AUTHORITATIVE MATH:
 *
 *   maxCompanyValue = tier.minimumOrderAmount × maxCompanyPurchasePercent / 100
 *
 * A company's candidate MAIN value must never exceed maxCompanyValue. The
 * current cart subtotal plays NO part — the limit is fixed by the tier value
 * (e.g. 2,000,000 × 25% = 500,000 EGP regardless of subtotal).
 *
 * BONUS EXCEPTION: company diversification applies to MAIN products only. Bonus
 * lines never enter the company value (numerator or denominator), can never
 * trip the cap, and — when a Bonus line is the TARGET of the operation — the
 * guard bypasses diversification entirely (blocked:false, bonusBypass:true) so
 * a Bonus add/increment is governed only by Bonus-specific rules (Bonus Credit,
 * inventory, entitlement), which are validated outside this function.
 *
 * Rules:
 * - The maximum company value applies ALWAYS — there is no construction
 *   exemption; the minimum-company-count rule is independent and only gates
 *   final eligibility (checkout), never relaxes this cap.
 * - Only the TARGET company is judged (other companies are independent), which
 *   lets an operator rebalance an over-concentrated cart from other companies.
 * - Reductions/deletions always pass (they only lower concentration).
 *
 * `currentItems` (pre-operation) is optional and used only to report the
 * pre-operation company value + remaining allowance for the UI ("المتاح").
 */
export function evaluateCompanyMaxAdd(
  candidateItems: CartItem[],
  tier: TierConfig | null,
  target?: CompanyAddTarget | null,
  currentItems?: CartItem[] | null
): CompanyAddGuardResult {
  // BONUS EXCEPTION: the target is resolved from the FULL candidate set. Bonus
  // Store lines are exempt from the entire diversification rule, so an add or
  // increment of a Bonus line can never be blocked by company diversification.
  if (target) {
    const fullTarget = candidateItems.find(
      (i) => i.productId === target.productId && i.unitType === target.unitType
    )
    if (fullTarget?.isBonus) {
      return { blocked: false, reason: null, unlimited: true, bonusBypass: true }
    }
  }

  const maxPct = tier?.maxCompanyPurchasePercent ?? null
  if (!tier || maxPct === null || maxPct <= 0) {
    return { blocked: false, reason: null, unlimited: true }
  }
  const tierValue = tier?.minimumOrderAmount ?? 0
  if (tierValue <= 0) {
    // No monetary tier value → no cap basis to derive a limit from.
    return { blocked: false, reason: null, unlimited: true }
  }
  const maxCompanyValue = round2((tierValue * maxPct) / 100)

  const main = candidateItems.filter((i) => !i.isBonus)

  const targetLine = target
    ? main.find((i) => i.productId === target.productId && i.unitType === target.unitType)
    : undefined

  const map = new Map<string, { value: number; name: string }>()
  for (const item of main) {
    const cid = item.companyId || ''
    const v =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : item.totalPrice
    const entry = map.get(cid)
    if (entry) entry.value += v
    else map.set(cid, { value: v, name: item.companyName || '' })
  }

  // An add/increment only changes the target company; judge that company's final
  // value. When no target is supplied, judge every company (full-state check).
  const companyIdsToJudge = targetLine ? [targetLine.companyId || ''] : [...map.keys()]
  let offender: { id: string; name: string; value: number } | null = null
  for (const cid of companyIdsToJudge) {
    const entry = map.get(cid)
    if (!entry) continue
    // Money is 2-decimal; epsilon 1e-6 absorbs float noise while a real 0.01
    // overage is still rejected. Exact-at-the-maximum is allowed.
    if (round2(entry.value) > maxCompanyValue + 1e-6) {
      offender = { id: cid, name: entry.name, value: round2(entry.value) }
      break
    }
  }

  let maxAllowedUnits: number | undefined
  let currentCompanyValue: number | undefined
  let room: number | undefined
  if (targetLine) {
    const lineUnitBase =
      typeof targetLine.baseUnitPrice === 'number' && targetLine.baseUnitPrice >= 0
        ? targetLine.baseUnitPrice
        : targetLine.totalPrice / Math.max(1, targetLine.unitQuantity)
    const companyId = targetLine.companyId || ''
    let othersValue = 0
    for (const li of main) {
      if ((li.companyId || '') !== companyId) continue
      if (li.productId === target.productId && li.unitType === target.unitType) continue
      othersValue +=
        typeof li.baseUnitPrice === 'number' && li.baseUnitPrice >= 0
          ? li.baseUnitPrice * li.unitQuantity
          : li.totalPrice
    }
    maxAllowedUnits = lineUnitBase > 0
      ? Math.max(0, Math.floor((maxCompanyValue - othersValue) / lineUnitBase))
      : targetLine.unitQuantity

    // Pre-operation ("المشتريات الحالية") company value + remaining allowance.
    let curValue = 0
    for (const li of currentItems ?? candidateItems) {
      if (li.isBonus) continue
      if ((li.companyId || '') !== companyId) continue
      curValue +=
        typeof li.baseUnitPrice === 'number' && li.baseUnitPrice >= 0
          ? li.baseUnitPrice * li.unitQuantity
          : li.totalPrice
    }
    currentCompanyValue = round2(curValue)
    room = Math.max(0, maxCompanyValue - currentCompanyValue)
  }

  if (!offender) {
    return {
      blocked: false,
      reason: null,
      unlimited: false,
      tierValue,
      maxPercent: maxPct,
      maxCompanyValue,
      currentCompanyValue,
      room,
      maxAllowedUnits,
    }
  }

  return {
    blocked: true,
    reason: 'company-max',
    unlimited: false,
    tierValue,
    companyId: offender.id,
    companyName: offender.name,
    maxPercent: maxPct,
    maxCompanyValue,
    companyValue: offender.value,
    currentCompanyValue,
    room,
    maxAllowedUnits,
  }
}

export function computeCartTotals(
  items: CartItem[],
  tier: TierConfig | null,
  dealItems?: CartDealItem[],
  flashOfferItems?: CartDealItem[],
  exceptionLookup?: TierExceptionLookup | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionsByProduct?: Record<string, TierExceptionLookup | null>
): CartTotals {
  const dealTotal = (dealItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)
  const flashOfferTotal = (flashOfferItems ?? []).reduce((sum, d) => sum + d.totalPrice, 0)

  const totalDiscountPercent = computeTotalDiscountPercent(tier, paymentOption, shippingOption, exceptionLookup)
  const capPct = Math.min(totalDiscountPercent, 99.99)

  const lookupForItem = (item: CartItem): TierExceptionLookup | null | undefined => {
    if (exceptionsByProduct && item.productId in exceptionsByProduct) {
      return exceptionsByProduct[item.productId]
    }
    return exceptionLookup
  }

  let productBaseSubtotal = 0
  let productSubtotal = 0
  let tierDiscount = 0
  let paymentDiscount = 0
  let shippingDiscount = 0
  const itemLookups: Array<TierExceptionLookup | null | undefined> = []

  for (const item of items) {
    productSubtotal += item.totalPrice
    const lookup = lookupForItem(item)
    itemLookups.push(lookup ?? exceptionLookup)
    const itemTotalPct = computeTotalDiscountPercent(tier, paymentOption, shippingOption, lookup ?? exceptionLookup)
    const itemCapPct = Math.min(itemTotalPct, 99.99)
    const baseTotal =
      typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0
        ? item.baseUnitPrice * item.unitQuantity
        : itemTotalPct > 0
          ? item.totalPrice / (1 - itemCapPct / 100)
          : item.totalPrice
    productBaseSubtotal += baseTotal

    const itemDiscount = Math.max(0, baseTotal - item.totalPrice)
    if (itemTotalPct > 0 && itemDiscount > 0) {
      const itemTierPercent = computeEffectiveDiscountPercent(tier, lookup ?? exceptionLookup)
      const itemPaymentPercent = computeEffectivePaymentDiscountPercent(paymentOption, lookup ?? exceptionLookup)
      const itemShippingPercent = computeEffectiveShippingDiscountPercent(shippingOption, lookup ?? exceptionLookup)
      tierDiscount += round2(itemDiscount * (itemTierPercent / itemTotalPct))
      paymentDiscount += round2(itemDiscount * (itemPaymentPercent / itemTotalPct))
      shippingDiscount += round2(itemDiscount * (itemShippingPercent / itemTotalPct))
    }
  }

  const totalDiscount = Math.max(0, productBaseSubtotal - productSubtotal)

  const subtotal = round2(productSubtotal + dealTotal + flashOfferTotal)
  const netTotal = subtotal

  const tierMinimum = tier?.minimumOrderAmount ?? 0
  const meetsTierMinimum = productBaseSubtotal >= tierMinimum
  const remainingForMinimum = meetsTierMinimum ? 0 : Math.max(0, tierMinimum - productBaseSubtotal)

  // ── Company diversification rules ──────────────────────────────────────
  // Max company value is derived from the SELECTED TIER value (never subtotal).
  const { companyRule, meetsCompanyRules } = computeCompanyRuleResult(items, tier)

  return {
    subtotal,
    totalDiscount: round2(totalDiscount),
    tierDiscount,
    paymentDiscount,
    shippingDiscount,
    totalDiscountPercent,
    netTotal,
    itemCount: items.length + (dealItems?.length ?? 0) + (flashOfferItems?.length ?? 0),
    meetsTierMinimum,
    remainingForMinimum,
    tierMinimum,
    dealTotal: dealTotal + flashOfferTotal,
    productSubtotal: round2(productSubtotal),
    productBaseSubtotal: round2(productBaseSubtotal),
    benefitRates: computeOrderBenefitRates(itemLookups, tier, paymentOption, shippingOption),
    companyRule,
    meetsCompanyRules,
  }
}

export function recalculateCartItem(
  item: CartItem,
  product: ProductWithPrice,
  tier: TierConfig | null,
  geographicAdjustment?: number | null,
  paymentOption?: PaymentMethodOption | null,
  shippingOption?: ShippingMethodOption | null,
  exceptionLookup?: TierExceptionLookup | null
): CartItem {
  const prices = computeProductPrices(product, tier, exceptionLookup, geographicAdjustment, paymentOption, shippingOption)
  const hasTier = tier !== null
  const baseUnitPrice = getUnitBasePrice(prices, item.unitType)
  const finalUnitPrice = getFinalUnitPrice(prices, item.unitType)
  const totalPrice = finalUnitPrice * item.unitQuantity
  const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)

  return {
    ...item,
    baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
    unitPrice: Math.round(finalUnitPrice * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
    pieceQuantity,
  }
}

export { round2 }