import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeItemBonusEntitlement,
  computeBonusCredit,
  computeBonusSummary,
  computeBonusModeTotals,
  assertBonusBasePrice,
} from '../bonusPricing.ts'
import { computeCartTotals } from '../pricing.ts'
import type {
  CartItem,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  TierExceptionLookup,
} from '../../types/storefront.ts'

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 'p1',
    productName: 'Test Product',
    unitType: 'piece',
    unitQuantity: 1,
    pieceQuantity: 1,
    unitPrice: 52000,
    totalPrice: 52000,
    companyId: 'c1',
    companyName: 'Co A',
    baseUnitPrice: 52000,
    ...overrides,
  }
}

function makeTier(overrides: Partial<TierConfig> = {}): TierConfig {
  return {
    id: 'tier-1',
    name: 'Tier',
    description: null,
    discountPercent: 0,
    minimumOrderAmount: 0,
    minimumCompanyCount: null,
    maxCompanyPurchasePercent: null,
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

function makeLookup(overrides: Partial<TierExceptionLookup> = {}): TierExceptionLookup {
  return {
    productException: null,
    companyException: null,
    tierDefault: 1,
    paymentOverride: null,
    shippingOverride: null,
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// A. OFF-mode parity — existing behavior completely unchanged; no bonus fields.
// ──────────────────────────────────────────────────────────────────────────────
describe('A. OFF-mode parity (bonus engine is never invoked)', () => {
  it('computeCartTotals still produces Example A: 52,000 − 639.60 = 51,360.40', () => {
    const items = [makeItem({ unitPrice: 51360.4, totalPrice: 51360.4 })]
    const tier = makeTier({ discountPercent: 0.5 })
    const t = computeCartTotals(items, tier, [], [], null, makePayment(0.5), makeShipping(0.23))
    assert.equal(t.productBaseSubtotal, 52000)
    assert.equal(t.totalDiscount, 639.6)
    assert.equal(t.netTotal, 51360.4)
  })

  it('computeCartTotals exposes no bonus accounting fields (all undefined)', () => {
    const items = [makeItem({ unitPrice: 500, totalPrice: 500 })]
    const t = computeCartTotals(items, makeTier({ discountPercent: 1 }), [], [], null, makePayment(0), makeShipping(0))
    assert.equal(t.bonusMode, undefined)
    assert.equal(t.bonusCredit, undefined)
    assert.equal(t.bonusSummary, undefined)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// B. Bonus credit is per-product (D-O2) — Example G.
// ──────────────────────────────────────────────────────────────────────────────
describe('B. Per-product entitlement (spec §21.1 Example G)', () => {
  it('two products at 1% and 2% → credit 300.00, never an order-level single %', () => {
    const a = makeItem({ productId: 'pA', productName: 'A', baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const b = makeItem({ productId: 'pB', productName: 'B', baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const tier = makeTier({ discountPercent: 1 })
    const exceptionsByProduct = {
      pB: makeLookup({ productException: 2 }),
    }
    const credit = computeBonusCredit([a, b], tier, null, null, null, exceptionsByProduct)
    assert.equal(credit.mainBaseTotal, 20000)
    assert.equal(credit.totalBonusCredit, 300)
    assert.equal(credit.items[0].credit, 100)
    assert.equal(credit.items[1].credit, 200)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// C. Canonical example family (spec §21).
// ──────────────────────────────────────────────────────────────────────────────
describe('C. Canonical example family (Tier 0.5% + Payment 0.5% + Shipping 0.23% = 1.23%)', () => {
  const main = () => [
    makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 }),
  ]
  const tier = () => makeTier({ discountPercent: 0.5 })
  const payment = () => makePayment(0.5)
  const shipping = () => makeShipping(0.23)

  it('Example B: no bonus items → credit 639.60, applied 0, unused 639.60, payable 52,000.00', () => {
    const s = computeBonusSummary(main(), [], tier(), payment(), shipping())
    assert.equal(s.totalBonusCredit, 639.6)
    assert.equal(s.bonusProductsTotal, 0)
    assert.equal(s.bonusApplied, 0)
    assert.equal(s.bonusUnused, 639.6)
    assert.equal(s.bonusOverflow, 0)
    assert.equal(s.finalPayable, 52000)
  })

  it('Example C: bonus 500.00 → applied 500.00, unused 139.60, payable 52,000.00', () => {
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 })]
    const s = computeBonusSummary(main(), bonus, tier(), payment(), shipping())
    assert.equal(s.bonusApplied, 500)
    assert.equal(s.bonusUnused, 139.6)
    assert.equal(s.bonusOverflow, 0)
    assert.equal(s.finalPayable, 52000)
  })

  it('Example D: bonus 639.60 → exact use, no unused, no overflow, payable 52,000.00', () => {
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 639.6, unitPrice: 639.6, totalPrice: 639.6 })]
    const s = computeBonusSummary(main(), bonus, tier(), payment(), shipping())
    assert.equal(s.bonusApplied, 639.6)
    assert.equal(s.bonusUnused, 0)
    assert.equal(s.bonusOverflow, 0)
    assert.equal(s.finalPayable, 52000)
  })

  it('Example E: bonus 650.00 → overflow 10.40, payable 52,010.40', () => {
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 650, unitPrice: 650, totalPrice: 650 })]
    const s = computeBonusSummary(main(), bonus, tier(), payment(), shipping())
    assert.equal(s.bonusApplied, 639.6)
    assert.equal(s.bonusOverflow, 10.4)
    assert.equal(s.finalPayable, 52010.4)
  })

  it('Example F: 51,200 × 1.25% = 640.00 exact, bonus 640.00 → exact use, payable 51,200.00', () => {
    const mainItems = [makeItem({ baseUnitPrice: 51200, unitPrice: 51200, totalPrice: 51200 })]
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 640, unitPrice: 640, totalPrice: 640 })]
    const s = computeBonusSummary(mainItems, bonus, makeTier({ discountPercent: 0.5 }), makePayment(0.5), makeShipping(0.25))
    assert.equal(s.totalBonusCredit, 640)
    assert.equal(s.bonusApplied, 640)
    assert.equal(s.bonusUnused, 0)
    assert.equal(s.bonusOverflow, 0)
    assert.equal(s.finalPayable, 51200)
  })

  it('per-group credit breakdown mirrors the testimonial 260.00 / 260.00 / 119.60', () => {
    const s = computeBonusSummary(main(), [], tier(), payment(), shipping())
    assert.equal(s.tierCredit, 260)
    assert.equal(s.paymentCredit, 260)
    assert.equal(s.shippingCredit, 119.6)
    assert.equal(s.tierCredit + s.paymentCredit + s.shippingCredit, s.totalBonusCredit)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// D. Money precision (D-O1) — 639.60 stays 639.60; NO whole-EGP rounding.
// ──────────────────────────────────────────────────────────────────────────────
describe('D. Money precision', () => {
  it('credit is 639.60 exactly, never coerced to 640', () => {
    const s = computeBonusSummary(
      [makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })],
      [],
      makeTier({ discountPercent: 0.5 }),
      makePayment(0.5),
      makeShipping(0.23)
    )
    assert.equal(s.totalBonusCredit, 639.6)
    assert.equal(s.totalBonusCredit, 639.6 + 0.0)
    assert.notEqual(s.totalBonusCredit, 640)
  })

  it('per-item round2 only — sub-cent values are rounded, never accumulated raw', () => {
    const item = makeItem({ baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    const tier = makeTier({ discountPercent: 0.333 })
    const ent = computeItemBonusEntitlement(item, tier, null, null)
    assert.equal(ent.credit, 0.33)
  })

  it('multi-line accumulation — two lines of 25,600 @1.25% give 320.00 + 320.00 = 640.00', () => {
    const items = [
      makeItem({ productId: 'a', baseUnitPrice: 25600, unitPrice: 25600, totalPrice: 25600 }),
      makeItem({ productId: 'b', baseUnitPrice: 25600, unitPrice: 25600, totalPrice: 25600 }),
    ]
    const credit = computeBonusCredit(items, makeTier({ discountPercent: 0.5 }), makePayment(0.5), makeShipping(0.25))
    assert.equal(credit.items[0].credit, 320)
    assert.equal(credit.items[1].credit, 320)
    assert.equal(credit.totalBonusCredit, 640)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// E. Missing option group contributes 0%; base fallback when baseUnitPrice absent.
// ──────────────────────────────────────────────────────────────────────────────
describe('E. Missing groups and base fallback', () => {
  it('only tier selected → entitlement is the tier % alone', () => {
    const item = makeItem({ baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const tier = makeTier({ discountPercent: 2 })
    const ent = computeItemBonusEntitlement(item, tier, null, null)
    assert.equal(ent.combinedPercent, 2)
    assert.equal(ent.credit, 200)
  })

  it('no tiers/options at all → credit 0', () => {
    const item = makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })
    const ent = computeItemBonusEntitlement(item, null, null, null)
    assert.equal(ent.credit, 0)
  })

  it('item without baseUnitPrice falls back to totalPrice as the geo-adjusted base', () => {
    const item = makeItem({ baseUnitPrice: undefined, unitPrice: 52000, totalPrice: 52000 })
    const ent = computeItemBonusEntitlement(item, makeTier({ discountPercent: 0.5 }), makePayment(0.5), makeShipping(0.23))
    assert.equal(ent.baseValue, 52000)
    assert.equal(ent.credit, 639.6)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// F. Explicit 0.00 override is a real zero (spec §23.1/23.2) — Example H P3.
// ──────────────────────────────────────────────────────────────────────────────
describe('F. Precedence Product > Company > Global, empty ≠ zero (spec §21.2 Example H)', () => {
  it('P1/P2 → 3.0% (300 each), P3 → 2.0% (200, tier zeroed by product override) → 800.00', () => {
    const p1 = makeItem({ productId: 'p1', productName: 'P1', companyId: 'cC', companyName: 'Company C', baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const p2 = makeItem({ productId: 'p2', productName: 'P2', companyId: 'cC', companyName: 'Company C', baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const p3 = makeItem({ productId: 'p3', productName: 'P3', companyId: 'cC', companyName: 'Company C', baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })

    const tier = makeTier({ discountPercent: 1 })
    const payment = makePayment(0.5)
    const shipping = makeShipping(0.5)

    const exceptionsByProduct: Record<string, TierExceptionLookup> = {
      p1: makeLookup({ shippingOverride: { productException: null, companyException: 1.5 } }),
      p2: makeLookup({ shippingOverride: { productException: null, companyException: 1.5 } }),
      p3: makeLookup({ productException: 0, shippingOverride: { productException: null, companyException: 1.5 } }),
    }

    const credit = computeBonusCredit([p1, p2, p3], tier, payment, shipping, null, exceptionsByProduct)
    assert.equal(credit.items[0].combinedPercent, 3)
    assert.equal(credit.items[0].credit, 300)
    assert.equal(credit.items[1].combinedPercent, 3)
    assert.equal(credit.items[1].credit, 300)
    assert.equal(credit.items[2].combinedPercent, 2)
    assert.equal(credit.items[2].credit, 200)
    assert.equal(credit.totalBonusCredit, 800)
  })

  it('absence of an override falls back to the global percentage (empty ≠ 0)', () => {
    const item = makeItem({ baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 })
    const shipping = makeShipping(0.5)
    const ent = computeItemBonusEntitlement(item, makeTier({ discountPercent: 1 }), makePayment(0.5), shipping, makeLookup({ shippingOverride: { productException: null, companyException: null } }))
    assert.equal(ent.shippingPercent, 0.5)
    assert.equal(ent.combinedPercent, 2)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// G. Geographic adjustment — base includes geo (OQ-K) for both main and bonus.
// ──────────────────────────────────────────────────────────────────────────────
describe('G. Geographic-adjusted base drives credit and bonus totals (OQ-K)', () => {
  it('main base 53,040 (exp 52000 ×1.02) @1.23% → 652.39; bonus geo base 122.40', () => {
    const mainItems = [makeItem({ baseUnitPrice: 53040, unitPrice: 53040, totalPrice: 53040, geoAdjustPercent: 2 })]
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 122.4, unitPrice: 122.4, totalPrice: 122.4, geoAdjustPercent: 2 })]
    const s = computeBonusSummary(mainItems, bonus, makeTier({ discountPercent: 0.5 }), makePayment(0.5), makeShipping(0.23))
    assert.equal(s.totalBonusCredit, 652.39)
    assert.equal(s.bonusProductsTotal, 122.4)
    assert.equal(s.mainBaseTotal, 53040)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// H. Tier minimum is checked against MAIN subtotal only (D-O10 / §24.2).
// ──────────────────────────────────────────────────────────────────────────────
describe('H. Tier minimum — MAIN only', () => {
  it('main 100 < min 200 → fails; bonus products never contribute', () => {
    const mainItems = [makeItem({ baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })]
    const bonus = [makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 })]
    const tier = makeTier({ minimumOrderAmount: 200, discountPercent: 1 })
    const s = computeBonusSummary(mainItems, bonus, tier, null, null)
    assert.equal(s.meetsTierMinimum, false)
    assert.equal(s.remainingForMinimum, 100)
  })

  it('main 300 ≥ min 200 → passes even with zero bonus items', () => {
    const mainItems = [makeItem({ baseUnitPrice: 300, unitPrice: 300, totalPrice: 300 })]
    const tier = makeTier({ minimumOrderAmount: 200, discountPercent: 1 })
    const s = computeBonusSummary(mainItems, [], tier, null, null)
    assert.equal(s.meetsTierMinimum, true)
    assert.equal(s.remainingForMinimum, 0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// I. Company diversification rules — evaluated against MAIN products only.
// ──────────────────────────────────────────────────────────────────────────────
describe('I. Company diversification rules — MAIN only', () => {
  it('3 main companies with equal 40% caps pass; bonus items/companies are ignored', () => {
    const mainItems = [
      makeItem({ productId: 'a', companyId: 'c1', companyName: 'Co A', baseUnitPrice: 400, unitPrice: 400, totalPrice: 400 }),
      makeItem({ productId: 'b', companyId: 'c2', companyName: 'Co B', baseUnitPrice: 300, unitPrice: 300, totalPrice: 300 }),
      makeItem({ productId: 'c', companyId: 'c3', companyName: 'Co C', baseUnitPrice: 300, unitPrice: 300, totalPrice: 300 }),
    ]
    const bonus = [
      makeItem({ productId: 'x', companyId: 'c9', companyName: 'Bonus Co', isBonus: true, baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 }),
    ]
    const tier = makeTier({ discountPercent: 1, minimumCompanyCount: 3, maxCompanyPurchasePercent: 40 })
    const s = computeBonusSummary(mainItems, bonus, tier, null, null)
    assert.equal(s.meetsCompanyRules, true)
    assert.equal(s.companyRule!.distinctCompanyCount, 3)
    assert.equal(s.companyRule!.companies.length, 3)
  })

  it('single main company with a cap → fails; bonus-only extra companies do not rescue it', () => {
    const mainItems = [makeItem({ baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 })]
    const bonus = [
      makeItem({ productId: 'x', companyId: 'c9', companyName: 'Bonus Co', isBonus: true, baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 }),
    ]
    const tier = makeTier({ discountPercent: 1, minimumCompanyCount: 2, maxCompanyPurchasePercent: 50 })
    const s = computeBonusSummary(mainItems, bonus, tier, null, null)
    assert.equal(s.meetsCompanyRules, false)
    assert.equal(s.companyRule!.distinctCompanyCount, 1)
    assert.equal(s.companyRule!.maxCompanyPurchasePercent, 50)
  })

  it('Bonus credit ceiling still binds a Bonus line from a company already at the MAIN cap', () => {
    // Company A MAIN = 500,000 on a 2M tier × 25% (= exactly at the MAIN cap).
    // Bonus lines from the SAME company are exempt from diversification, but the
    // Bonus Credit/entitlement limits are untouched: applied = min(credit, bonus
    // products) and everything beyond credit becomes payable overflow.
    const mainItems = [makeItem({ companyId: 'c1', companyName: 'Co A', baseUnitPrice: 500000, unitPrice: 500000, totalPrice: 500000 })]
    const bonus = [
      makeItem({ productId: 'x', companyId: 'c1', companyName: 'Co A', isBonus: true, baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 }),
      makeItem({ productId: 'y', companyId: 'c1', companyName: 'Co A', isBonus: true, baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 }),
    ]
    const tier = makeTier({ discountPercent: 0, minimumOrderAmount: 2_000_000, minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const s = computeBonusSummary(mainItems, bonus, tier, null, null)
    // Diversification eligibility is computed on MAIN products only.
    assert.equal(s.companyRule!.companies.length, 1)
    assert.equal(s.companyRule!.companies[0].value, 500000)
    assert.equal(s.companyRule!.meetsCompanyCaps, true, 'MAIN exactly at the cap is allowed')
    assert.equal(s.meetsCompanyRules, false, 'minimum-company-count still fails on the single MAIN company')
    // Bonus entitlement (credit) limits remain fully active.
    assert.equal(s.totalBonusCredit, 0, '0% combined discount → no credit')
    assert.equal(s.bonusProductsTotal, 20000)
    assert.equal(s.bonusApplied, 0)
    assert.equal(s.bonusOverflow, 20000, 'bonus beyond credit remains payable overflow — a real limit')
    assert.equal(s.finalPayable, 520000)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// J. Deals / Flash Offers are outside the Tier/Bonus system (D-O11).
// ──────────────────────────────────────────────────────────────────────────────
describe('J. Deals / Flash Offers excluded from all bonus math (D-O11)', () => {
  it('computeBonusModeTotals adds deal/flash totals to payable but credit is main-items-only', () => {
    const items = [
      makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 }),
      makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 }),
    ]
    const tier = makeTier({ discountPercent: 0.5 })
    const deals = [
      { dealId: 'd1', dealTitle: 'Deal', fixedPrice: 100, totalPrice: 100, quantity: 1 },
      { dealId: 'f1', dealTitle: 'Flash', fixedPrice: 50, totalPrice: 50, quantity: 1 },
    ]
    const t = computeBonusModeTotals(items, tier, [deals[0]], [deals[1]], null, makePayment(0.5), makeShipping(0.23))
    assert.equal(t.bonusMode, true)
    assert.equal(t.bonusCredit, 639.6)
    assert.equal(t.bonusProductsTotal, 500)
    assert.equal(t.bonusUnused, 139.6)
    assert.equal(t.bonusOverflow, 0)
    assert.equal(t.dealTotal, 150)
    assert.equal(t.subtotal, 52000 + 500 + 150)
    assert.equal(t.netTotal, 52000 + 150)
    assert.equal(t.itemCount, 4)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// K. Cart with nothing but bonus items (spec §34.10) — no credit, all payable.
// ──────────────────────────────────────────────────────────────────────────────
describe('K. Edge: cart with only bonus items (§34.10)', () => {
  it('credit 0, bonus products total = overflow = final payable', () => {
    const bonus = [
      makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 300, unitPrice: 300, totalPrice: 300 }),
      makeItem({ productId: 'b2', isBonus: true, baseUnitPrice: 200, unitPrice: 200, totalPrice: 200 }),
    ]
    const s = computeBonusSummary([], bonus, makeTier({ discountPercent: 1 }), null, null)
    assert.equal(s.mainBaseTotal, 0)
    assert.equal(s.totalBonusCredit, 0)
    assert.equal(s.bonusProductsTotal, 500)
    assert.equal(s.bonusApplied, 0)
    assert.equal(s.bonusUnused, 0)
    assert.equal(s.bonusOverflow, 500)
    assert.equal(s.finalPayable, 500)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// L. D-O8 base-price invariant: bonus products are never discounted.
// ──────────────────────────────────────────────────────────────────────────────
describe('L. assertBonusBasePrice (D-O8)', () => {
  it('true when unit price equals the base price', () => {
    assert.equal(assertBonusBasePrice(makeItem({ isBonus: true, baseUnitPrice: 120, unitPrice: 120 })), true)
  })

  it('false when the unit price carries any discount (e.g. 120 × (1 − 2%) = 117.60)', () => {
    assert.equal(assertBonusBasePrice(makeItem({ isBonus: true, baseUnitPrice: 120, unitPrice: 117.6 })), false)
  })

  it('true (unverifiable) when baseUnitPrice is absent', () => {
    assert.equal(assertBonusBasePrice(makeItem({ isBonus: true, baseUnitPrice: undefined, unitPrice: 120 })), true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// M. computeBonusModeTotals — complete bonus-mode CartTotals contract.
// ──────────────────────────────────────────────────────────────────────────────
describe('M. computeBonusModeTotals splits main vs bonus by isBonus', () => {
  it('produces bonus-aware CartTotals with matching summary', () => {
    const items = [
      makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 }),
      makeItem({ productId: 'b1', isBonus: true, baseUnitPrice: 650, unitPrice: 650, totalPrice: 650 }),
    ]
    const tier = makeTier({ discountPercent: 0.5 })
    const t = computeBonusModeTotals(items, tier, [], [], null, makePayment(0.5), makeShipping(0.23))
    assert.equal(t.bonusMode, true)
    assert.equal(t.mainBaseTotal, 52000)
    assert.equal(t.bonusCredit, 639.6)
    assert.equal(t.bonusOverflow, 10.4)
    assert.equal(t.bonusUnused, 0)
    assert.equal(t.netTotal, 52010.4)
    assert.equal(t.totalDiscount, 0)
    assert.equal(t.tierDiscount, 0)
    assert.equal(t.productBaseSubtotal, 52000)
    assert.equal(t.bonusSummary!.finalPayable, 52010.4)
    assert.equal(t.meetsTierMinimum, true)
  })
})