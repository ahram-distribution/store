import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeEffectiveDiscountPercent,
  computeEffectivePaymentDiscountPercent,
  computeEffectiveShippingDiscountPercent,
  computeTotalDiscountPercent,
  computeProductPrices,
  computeCartTotals,
  computeOrderBenefitRates,
  computeCompanyRuleResult,
} from '../pricing.ts'
import {
  computeItemBonusEntitlement,
  computeBonusSummary,
  computeBonusModeTotals,
  assertBonusBasePrice,
} from '../bonusPricing.ts'
import type {
  CartItem,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  TierExceptionLookup,
  ProductWithPrice,
} from '../../types/storefront.ts'

// ---------------------------------------------------------------------------
// Fixtures — acceptance-config defaults (Tier 3% / Payment 1% / Shipping 1%),
// with Company A exceptions (Tier 5% / Payment 0% / Shipping 2%).
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 'p1',
    productName: 'Test Product',
    unitType: 'piece',
    unitQuantity: 1,
    pieceQuantity: 1,
    unitPrice: 52,
    totalPrice: 52,
    companyId: 'c1',
    companyName: 'Co A',
    baseUnitPrice: 52,
    ...overrides,
  }
}

function makeTier(overrides: Partial<TierConfig> = {}): TierConfig {
  return {
    id: 'tier-1',
    name: 'Tier',
    description: null,
    discountPercent: 3,
    minimumOrderAmount: 2_000_000,
    minimumCompanyCount: 4,
    maxCompanyPurchasePercent: 25,
    iconUrl: null,
    color: null,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
    startsAt: null,
    endsAt: null,
    ...overrides,
  }
}

function makePayment(discountPercent: number, overrides: Partial<PaymentMethodOption> = {}): PaymentMethodOption {
  return {
    id: 'pay-1',
    name: 'Payment',
    discountPercent,
    sortOrder: 1,
    isVisible: true,
    isActive: true,
    ...overrides,
  }
}

function makeShipping(discountPercent: number, overrides: Partial<ShippingMethodOption> = {}): ShippingMethodOption {
  return {
    id: 'ship-1',
    name: 'Shipping',
    discountPercent,
    sortOrder: 1,
    isVisible: true,
    isActive: true,
    ...overrides,
  }
}

function makeProduct(overrides: Partial<ProductWithPrice> = {}): ProductWithPrice {
  return {
    id: 'p1',
    productName: 'Test Product',
    legacyCode: 'T1',
    cartonPrice: 1200,
    cartonQuantity: 12,
    piecePrice: 100,
    dozenPrice: 1200,
    isActive: true,
    isOutOfStock: false,
    isVisible: true,
    companyId: 'c1',
    companyName: 'Co A',
    unitPrices: [
      { unitType: 'piece', price: 100 },
      { unitType: 'dozen', price: 1200 },
      { unitType: 'carton', price: 1200 },
    ],
    availableUnitTypes: ['piece', 'dozen', 'carton'],
    ...overrides,
  }
}

/**
 * Builds a TierExceptionLookup that mirrors resolveExceptionLookup's output
 * contract (product override > company override > option global, per group).
 */
function lookup(over: {
  pProduct?: number
  pCompany?: number
  payProduct?: number
  payCompany?: number
  shipProduct?: number
  shipCompany?: number
} = {}): TierExceptionLookup {
  return {
    productException: over.pProduct !== undefined ? over.pProduct : null,
    companyException: over.pCompany !== undefined ? over.pCompany : null,
    tierDefault: 3,
    paymentOverride: {
      productException: over.payProduct !== undefined ? over.payProduct : null,
      companyException: over.payCompany !== undefined ? over.payCompany : null,
    },
    shippingOverride: {
      productException: over.shipProduct !== undefined ? over.shipProduct : null,
      companyException: over.shipCompany !== undefined ? over.shipCompany : null,
    },
  }
}

// Acceptance scenario values
const TIER = makeTier()
const PAY = makePayment(1)
const SHIP = makeShipping(1)
// Company A: tier 5%, payment 0%, shipping 2%
const LOOKUP_X = lookup({ pCompany: 5, payCompany: 0, shipCompany: 2 })
// Product Y: tier product override 7% (over Company A's 5%), else company 0/2
const LOOKUP_Y = lookup({ pProduct: 7, pCompany: 5, payCompany: 0, shipCompany: 2 })

// ---------------------------------------------------------------------------
// 1-4. PRODUCT OVERRIDE — replaces the default, never adds to it
// ---------------------------------------------------------------------------
describe('PRODUCT OVERRIDE (tier default 3% / payment 1% / shipping 1%)', () => {
  it('1. product tier override wins over the tier default', () => {
    assert.equal(computeEffectiveDiscountPercent(TIER, lookup({ pProduct: 7 })), 7)
  })

  it('2. product override REPLACES the default (7+1+1=9), never 3+7+1+1', () => {
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lookup({ pProduct: 7 })), 9)
  })

  it('3. payment-group product override resolves independently', () => {
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, lookup({ payProduct: 0.5 })), 0.5)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lookup({ payProduct: 0.25 })), 4.25)
  })

  it('4. shipping-group product override resolves independently', () => {
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, lookup({ shipProduct: 2 })), 2)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lookup({ shipProduct: 2.5 })), 6.5)
  })
})

// ---------------------------------------------------------------------------
// 5-7. COMPANY OVERRIDE — applies when no product override; product wins
// ---------------------------------------------------------------------------
describe('COMPANY OVERRIDE (acceptance: Company A = 5 / 0 / 2)', () => {
  it('5. company overrides apply per group when no product override → 5/0/2', () => {
    assert.equal(computeEffectiveDiscountPercent(TIER, LOOKUP_X), 5)
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, LOOKUP_X), 0)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, LOOKUP_X), 2)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, LOOKUP_X), 7)
  })

  it('6. company overrides beat the option global in every group', () => {
    assert.equal(computeEffectiveDiscountPercent(TIER, lookup({ pCompany: 8 })), 8)
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, lookup({ payCompany: 0.3 })), 0.3)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, lookup({ shipCompany: 1.75 })), 1.75)
  })

  it('7. PRODUCT > COMPANY precedence — 7 beats 5, 0.25 beats 0 in the same group', () => {
    const lk = lookup({ pProduct: 7, pCompany: 5, payProduct: 0.25, payCompany: 0 })
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 7)
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, lk), 0.25)
  })
})

// ---------------------------------------------------------------------------
// 8-9. ZERO is a real override, never treated as "no exception"
// ---------------------------------------------------------------------------
describe('ZERO override is real', () => {
  it('8. product 0% is a real override — effective tier is 0, not the 3% default', () => {
    assert.equal(computeEffectiveDiscountPercent(TIER, lookup({ pProduct: 0 })), 0)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lookup({ pProduct: 0 })), 2)
  })

  it('9. company 0% is a real override in every group — 5/0/2 shows payment 0, not 1', () => {
    assert.equal(computeEffectiveDiscountPercent(TIER, LOOKUP_X), 5)
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, LOOKUP_X), 0)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, LOOKUP_X), 2)
  })
})

// ---------------------------------------------------------------------------
// 10. INDEPENDENCE — no cross-group leakage
// ---------------------------------------------------------------------------
describe('INDEPENDENCE — each benefit group resolves on its own', () => {
  it('10. a tier override never leaks into payment/shipping and vice versa', () => {
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, lookup({ pProduct: 7 })), 1)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, lookup({ pProduct: 7 })), 1)
    assert.equal(computeEffectiveDiscountPercent(TIER, lookup({ payProduct: 0.5 })), 3)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, lookup({ payCompany: 0 })), 1)
  })
})

// ---------------------------------------------------------------------------
// 11-14. DIRECT DISCOUNT — product card, cart lines and totals
// ---------------------------------------------------------------------------
describe('DIRECT DISCOUNT surfaces', () => {
  it('11. product card money uses the effective %, not defaults (base 100 → 93 at 7%, 91 at 9%)', () => {
    const pX = makeProduct({ id: 'pX' })
    const pY = makeProduct({ id: 'pY' })
    assert.equal(computeProductPrices(pX, TIER, LOOKUP_X, null, PAY, SHIP).finalPiecePrice, 93)
    assert.equal(computeProductPrices(pY, TIER, LOOKUP_Y, null, PAY, SHIP).finalPiecePrice, 91)
    const cardX = computeProductPrices(pX, TIER, LOOKUP_X, null, PAY, SHIP)
    assert.equal(cardX.discountPercent, 5)
    assert.equal(cardX.paymentDiscountPercent, 0)
    assert.equal(cardX.shippingDiscountPercent, 2)
    assert.equal(cardX.totalDiscountPercent, 7)
  })

  it('12. cart line totals resolve per-item — X(7%) 100→93, Y(9%) 100→91', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 93, totalPrice: 93 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 })
    const t = computeCartTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(t.productBaseSubtotal, 200)
    assert.equal(t.productSubtotal, 184)
    assert.equal(t.totalDiscount, 16)
    assert.equal(t.tierDiscount, 12)
    assert.equal(t.paymentDiscount, 0)
    assert.equal(t.shippingDiscount, 4)
  })

  it('13. heterogeneous cart never reports one global % — benefitRates.uniform false, sumPct 0', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 93, totalPrice: 93 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 })
    const t = computeCartTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(t.benefitRates?.uniform, false)
    assert.equal(t.benefitRates?.sumPct, 0)
  })

  it('14. tier-minimum gate uses base subtotal — manual exceptions never lower the base', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 93, totalPrice: 93 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 })
    const t = computeCartTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(t.productBaseSubtotal, 200)
    assert.equal(t.meetsTierMinimum, false)
    assert.equal(t.remainingForMinimum, 2_000_000 - 200)
  })
})

// ---------------------------------------------------------------------------
// 15-17. BONUS TIERS — credit uses the effective %, Bonus Store stays exempt
// ---------------------------------------------------------------------------
describe('BONUS TIERS — effective % drives credit; Bonus Store exempt', () => {
  it('15. per-product entitlement uses the effective triple (Product Y → 7/0/2, credit 9 on 100)', () => {
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    const ent = computeItemBonusEntitlement(y, TIER, PAY, SHIP, LOOKUP_Y)
    assert.equal(ent.tierPercent, 7)
    assert.equal(ent.paymentPercent, 0)
    assert.equal(ent.shippingPercent, 2)
    assert.equal(ent.combinedPercent, 9)
    assert.equal(ent.credit, 9)
  })

  it('16. bonus credit splits per-item by effective groups (X 7 + Y 9 = 16)', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    const bonus = makeItem({ productId: 'pB', productName: 'Bonus', companyId: 'cB', companyName: 'B', baseUnitPrice: 200, unitPrice: 200, totalPrice: 200, isBonus: true })
    const t = computeBonusModeTotals([x, y, bonus], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(t.bonusCredit, 16)
    assert.equal(t.bonusSummary?.tierCredit, 12)
    assert.equal(t.bonusSummary?.paymentCredit, 0)
    assert.equal(t.bonusSummary?.shippingCredit, 4)
    assert.equal(t.bonusApplied, 16)
    assert.equal(t.bonusOverflow, 184)
    assert.equal(t.bonusSummary?.finalPayable, 384)
  })

  it('17. bonus product stays at its base price with credit intact (base-price guarantee)', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    const bonus = makeItem({ productId: 'pB', companyId: 'cB', companyName: 'B', baseUnitPrice: 200, unitPrice: 200, totalPrice: 200, isBonus: true })
    assert.equal(assertBonusBasePrice(bonus), true)
    const t = computeBonusModeTotals([x, bonus], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X })
    assert.equal(t.productSubtotal, 300)
  })
})

// ---------------------------------------------------------------------------
// 18-21. DIVERSIFICATION — manual exceptions never touch the cap or the gates
// ---------------------------------------------------------------------------
describe('DIVERSIFICATION untouched by manual exceptions', () => {
  it('18. cap stays tierValue × max% = 500,000 — exceptions (9% on Product Y) change nothing', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 480_000, unitPrice: 480_000, totalPrice: 480_000 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 19_999, unitPrice: 19_999, totalPrice: 19_999 })
    const r = computeCompanyRuleResult([x, y], TIER).companyRule!
    assert.equal(r.maxCompanyValue, 500_000)
    assert.equal(r.companies[0].value, 499_999)
    assert.equal(r.meetsCompanyCaps, true)
  })

  it('19. a company over 500,000 is blocked even when an override raises its card %, and % never enters', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 500_000, unitQuantity: 1, totalPrice: 500_000 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 1, unitQuantity: 1, totalPrice: 1 })
    const r = computeCompanyRuleResult([x, y], TIER).companyRule!
    assert.equal(r.companies[0].exceedsCap, true)
  })

  it('20. bonus lines are excluded from company value and count regardless of now higher effective %s', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 500_000, unitQuantity: 1, totalPrice: 500_000 })
    const bonus = makeItem({ productId: 'pB', companyId: 'cA', companyName: 'A', baseUnitPrice: 5_000_000, unitQuantity: 1, totalPrice: 5_000_000, isBonus: true })
    const r = computeCompanyRuleResult([x, bonus], TIER).companyRule!
    assert.equal(r.companies[0].value, 500_000)
    assert.equal(r.distinctCompanyCount, 1)
    assert.equal(r.meetsCompanyCaps, true)
  })

  it('21. minimum-company-count gate counts MAIN companies only — 4 required, overrides can not satisfy it', () => {
    const items = [
      makeItem({ productId: 'pA', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 }),
      makeItem({ productId: 'pB', companyId: 'cB', companyName: 'B', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 }),
      makeItem({ productId: 'pC', companyId: 'cC', companyName: 'C', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 }),
      makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 }),
    ]
    const three = items.slice(0, 3)
    const r3 = computeCompanyRuleResult(three, TIER).companyRule!
    assert.equal(r3.meetsMinimumCompanies, false)
    const r4 = computeCompanyRuleResult(items, TIER).companyRule!
    assert.equal(r4.distinctCompanyCount, 3)
    assert.equal(r4.meetsMinimumCompanies, false)
    const full = [
      ...items,
      makeItem({ productId: 'pD', companyId: 'cD', companyName: 'D', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 }),
    ]
    assert.equal(computeCompanyRuleResult(full, TIER).companyRule!.meetsMinimumCompanies, true)
  })
})

// ---------------------------------------------------------------------------
// 22-23. CONSISTENCY — one source of truth across card / cart / totals
// ---------------------------------------------------------------------------
describe('CONSISTENCY — one shared resolution', () => {
  it('22. card total % equals the sum of the three effective groups', () => {
    assert.equal(
      computeTotalDiscountPercent(TIER, PAY, SHIP, LOOKUP_X),
      computeEffectiveDiscountPercent(TIER, LOOKUP_X) +
        computeEffectivePaymentDiscountPercent(PAY, LOOKUP_X) +
        computeEffectiveShippingDiscountPercent(SHIP, LOOKUP_X)
    )
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, LOOKUP_X), 7)
  })

  it('23. computeOrderBenefitRates matches the cart totals resolution', () => {
    // uniform
    const uniform = computeOrderBenefitRates([LOOKUP_X, LOOKUP_X], TIER, PAY, SHIP)
    assert.equal(uniform.uniform, true)
    assert.equal(uniform.tierPct, 5)
    assert.equal(uniform.payPct, 0)
    assert.equal(uniform.shipPct, 2)
    assert.equal(uniform.sumPct, 7)
    // heterogeneous
    const mixed = computeOrderBenefitRates([LOOKUP_X, LOOKUP_Y], TIER, PAY, SHIP)
    assert.equal(mixed.uniform, false)
    assert.equal(mixed.sumPct, 0)
    assert.equal(mixed.tierPct, 5)
    // empty (no products yet) → option defaults
    const empty = computeOrderBenefitRates([], TIER, PAY, SHIP)
    assert.equal(empty.uniform, true)
    assert.equal(empty.sumPct, 5)
    // wired into computeCartTotals — same values as the stand-alone helper
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 93, totalPrice: 93 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 })
    const t = computeCartTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.deepEqual(t.benefitRates, mixed)
  })
})

// ---------------------------------------------------------------------------
// ACCEPTANCE SCENARIO — 2M tier / min 4 / max 25%; Product X → 5/0/2,
// Product Y → 7/0/2; cap stays 500,000; Bonus Store exempt.
// ---------------------------------------------------------------------------
describe('ACCEPTANCE SCENARIO (full acceptance behavior)', () => {
  it('Product X (no product exception) → 5/0/2 = 7%; Product Y (tier 7%) → 7/0/2 = 9%', () => {
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, LOOKUP_X), 7)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, LOOKUP_Y), 9)
  })

  it('cards, cart lines, order totals and bonus credit all agree', () => {
    const pX = makeProduct({ id: 'pX', piecePrice: 100 })
    const pY = makeProduct({ id: 'pY', piecePrice: 100 })
    assert.equal(computeProductPrices(pX, TIER, LOOKUP_X, null, PAY, SHIP).finalPiecePrice, 93)
    assert.equal(computeProductPrices(pY, TIER, LOOKUP_Y, null, PAY, SHIP).finalPiecePrice, 91)

    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 93, totalPrice: 93 })
    const y = makeItem({ productId: 'pY', companyId: 'cA', companyName: 'A', baseUnitPrice: 100, unitPrice: 91, totalPrice: 91 })
    const t = computeCartTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(t.productBaseSubtotal, 200)
    assert.equal(t.totalDiscount, 16)
    assert.equal(t.netTotal, 184)

    const b = computeBonusModeTotals([x, y], TIER, [], [], null, PAY, SHIP, { pX: LOOKUP_X, pY: LOOKUP_Y })
    assert.equal(b.bonusCredit, 16)
    assert.equal(b.benefitRates?.uniform, false)
  })

  it('cap remains tierValue × 25% = 500,000 with the exceptions active, Bonus excluded', () => {
    const x = makeItem({ productId: 'pX', companyId: 'cA', companyName: 'A', baseUnitPrice: 480_000, unitQuantity: 1, totalPrice: 480_000 })
    const bonus = makeItem({ productId: 'pB', companyId: 'cA', companyName: 'A', baseUnitPrice: 10_000_000, unitQuantity: 1, totalPrice: 10_000_000, isBonus: true })
    const { companyRule } = computeCompanyRuleResult([x, bonus], TIER)
    const r = companyRule!
    assert.equal(r.maxCompanyValue, 500_000)
    assert.equal(r.companies[0].value, 480_000)
    assert.equal(r.meetsCompanyCaps, true)
  })
})