import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeCartTotals } from '../pricing.ts'
import type { CartItem, TierConfig } from '../../types/storefront.ts'

function makeItem(overrides: Partial<CartItem> & { companyId: string; companyName: string }): CartItem {
  return {
    productId: 'p1',
    productName: 'Test Product',
    unitType: 'piece',
    unitQuantity: 1,
    pieceQuantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    ...overrides,
  }
}

function makeTier(overrides: Partial<TierConfig> = {}): TierConfig {
  return {
    id: 'tier-1',
    name: 'Tier',
    description: null,
    discountPercent: 5,
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

describe('Case 1: Unlimited / no config — unchanged behavior', () => {
  it('companyRule is null and meetsCompanyRules is true when no rules configured', () => {
    const items = [makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 500 })]
    const tier = makeTier({ minimumCompanyCount: null, maxCompanyPurchasePercent: null })
    const t = computeCartTotals(items, tier)
    assert.equal(t.companyRule, null)
    assert.equal(t.meetsCompanyRules, true)
  })

  it('companyRule is null when tier is null', () => {
    const items = [makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 100 })]
    const t = computeCartTotals(items, null)
    assert.equal(t.companyRule, null)
    assert.equal(t.meetsCompanyRules, true)
  })
})

describe('Case 2: 3 companies ordered, minimum = 4 → FAIL', () => {
  it('meetsCompanyRules is false, distinctCompanyCount is 3', () => {
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 100 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 100 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 100 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 4 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.distinctCompanyCount, 3)
    assert.equal(t.companyRule!.meetsMinimumCompanies, false)
  })
})

describe('Case 3: 4 companies ordered, minimum = 4 → PASS', () => {
  it('meetsCompanyRules is true with exactly 4 companies', () => {
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 100 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 100 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 100 }),
      makeItem({ companyId: 'c4', companyName: 'Co D', totalPrice: 100 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 4 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.distinctCompanyCount, 4)
    assert.equal(t.companyRule!.meetsMinimumCompanies, true)
  })
})

describe('Case 4: 6 companies ordered, minimum = 4 → PASS', () => {
  it('meetsCompanyRules is true with 6 companies', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ companyId: `c${i + 1}`, companyName: `Co ${i + 1}`, totalPrice: 100 })
    )
    const tier = makeTier({ minimumCompanyCount: 4 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.distinctCompanyCount, 6)
  })
})

describe('Case 5: 3 companies ordered, minimum = 6 → FAIL', () => {
  it('meetsCompanyRules is false with 3 companies when min is 6', () => {
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 200 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 150 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 100 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 6 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.distinctCompanyCount, 3)
  })
})

describe('Case 6: Company A = 26%, max = 25% → FAIL', () => {
  it('exceedsCap is true for the violating company', () => {
    // Tier value 1000 × 25% = 250 max per company. CoA = 260 (>250) → exceeds.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 260, baseUnitPrice: 260 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 740, baseUnitPrice: 740 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 2, maxCompanyPurchasePercent: 25 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.meetsCompanyCaps, false)
    const coA = t.companyRule!.companies.find((c) => c.companyId === 'c1')!
    assert.ok(coA.exceedsCap, 'Company A should exceed cap')
    assert.equal(coA.maxCompanyValue, 250)
    assert.equal(coA.percent > 25, true)
  })
})

describe('Case 7: Company = 25%, max = 25% → PASS (exactly 25% is allowed)', () => {
  it('meetsCompanyRules is true when every company is exactly at the cap', () => {
    // Tier value 1000 × 25% = 250. Four companies each exactly 250 → allowed.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c3', companyName: 'Company C', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c4', companyName: 'Company D', totalPrice: 250, baseUnitPrice: 250 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.meetsCompanyCaps, true)
    const coA = t.companyRule!.companies.find((c) => c.companyId === 'c1')!
    assert.equal(coA.percent, 25)
    assert.equal(coA.exceedsCap, false, '25% exactly should NOT exceed a 25% cap')
  })
})

describe('Case 6b: Company A = 30%, max = 40% → PASS under tier-value basis', () => {
  it('exceedsCap is identified precisely and not a whole-cart rejection', () => {
    // Tier value 1000 × 40% = 400 max per company. CoA 300, CoB 400, CoC 300.
    // CoC passes, min 3 met, none exceed 400 → PASS.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 300, baseUnitPrice: 300 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 400, baseUnitPrice: 400 }),
      makeItem({ companyId: 'c3', companyName: 'Company C', totalPrice: 300, baseUnitPrice: 300 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 3, maxCompanyPurchasePercent: 40 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.meetsCompanyCaps, true)
  })
})

describe('Case 8: company rule met AND tier minimum met', () => {
  it('both meetsTierMinimum and meetsCompanyRules are true', () => {
    // Tier value 300 × 60% = 180 max per company; both companies at 150 → pass.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 150, baseUnitPrice: 150 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 150, baseUnitPrice: 150 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 300, minimumCompanyCount: 2, maxCompanyPurchasePercent: 60 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsTierMinimum, true)
    assert.equal(t.meetsCompanyRules, true)
  })
})

describe('Case 9: no-config tier (minCount=null) preserves existing behavior', () => {
  it('companyRule null and meetsCompanyRules true even with single company', () => {
    const items = [makeItem({ companyId: 'c1', companyName: 'OnlyCo', totalPrice: 500 })]
    const tier = makeTier({ minimumCompanyCount: null, maxCompanyPurchasePercent: null, minimumOrderAmount: 100 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsTierMinimum, true)
    assert.equal(t.companyRule, null)
    assert.equal(t.meetsCompanyRules, true)
  })
})

describe('Edge: companies with baseUnitPrice undefined fall back to totalPrice', () => {
  it('computes company value from totalPrice when baseUnitPrice is undefined', () => {
    // Tier value 1000 × 40% = 400 max. A 300, B 300, C 400 → all within cap.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 300 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 300 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 400 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 3, maxCompanyPurchasePercent: 40 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.distinctCompanyCount, 3)
    const coA = t.companyRule!.companies.find((c) => c.companyId === 'c1')!
    assert.ok(coA.percent > 0)
    assert.equal(coA.exceedsCap, false)
    assert.ok(t.productBaseSubtotal > 0)
  })
})

describe('Edge: single-item cart with company rule', () => {
  it('a single company of 600 with a 50% cap on a 1000 tier exceeds the 500 max', () => {
    // Tier value 1000 × 50% = 500 max. Solo company 600 (>500) → exceeds the cap.
    const items = [makeItem({ companyId: 'c1', companyName: 'Solo', totalPrice: 600, baseUnitPrice: 600 })]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 2, maxCompanyPurchasePercent: 50 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.companies[0].percent, 60)
    assert.equal(t.companyRule!.companies[0].exceedsCap, true)
  })
})

describe('Subtotal independence — the cap never derives from the cart subtotal', () => {
  it('4 companies of 100 on a subtotal of 400 still respect the 1000-tier 25% (250) cap', () => {
    // Subtotal 400 = only 40% of the tier value; each company 100 < 250 → pass.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 100, baseUnitPrice: 100 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 100, baseUnitPrice: 100 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 100, baseUnitPrice: 100 }),
      makeItem({ companyId: 'c4', companyName: 'Co D', totalPrice: 100, baseUnitPrice: 100 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 1000, minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.companyRule!.maxCompanyValue, 250)
    assert.equal(t.meetsCompanyRules, true)
  })
})
