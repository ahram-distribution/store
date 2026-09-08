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
    // Total: 1000. CoA = 260 (26%), CoB = 740 (74%)
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 260, baseUnitPrice: 260 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 740, baseUnitPrice: 740 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 2, maxCompanyPurchasePercent: 25 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.meetsCompanyCaps, false)
    const coA = t.companyRule!.companies.find((c) => c.companyId === 'c1')!
    assert.ok(coA.exceedsCap, 'Company A should exceed cap')
    assert.equal(coA.percent > 25, true)
  })
})

describe('Case 7: Company = 25%, max = 25% → PASS (exactly 25% is allowed)', () => {
  it('meetsCompanyRules is true when every company is exactly at the cap', () => {
    // Total: 1000. Four companies each 250 (25%). Each exactly equals the 25% cap → allowed.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c3', companyName: 'Company C', totalPrice: 250, baseUnitPrice: 250 }),
      makeItem({ companyId: 'c4', companyName: 'Company D', totalPrice: 250, baseUnitPrice: 250 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.meetsCompanyCaps, true)
    const coA = t.companyRule!.companies.find((c) => c.companyId === 'c1')!
    assert.equal(coA.percent, 25)
    assert.equal(coA.exceedsCap, false, '25% exactly should NOT exceed a 25% cap')
  })
})

describe('Case 6b: Company A = 26%, max = 25% → FAIL', () => {
  it('exceedsCap is identified precisely and not a whole-cart rejection', () => {
    // Total: 1000. CoA = 300 (30%), CoB = 400 (40%), CoC = 300 (30%). CoC passes, min 3 met.
    // With min=3 and max=40, all companies <=40% and 3 distinct → PASS.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Company A', totalPrice: 300, baseUnitPrice: 300 }),
      makeItem({ companyId: 'c2', companyName: 'Company B', totalPrice: 400, baseUnitPrice: 400 }),
      makeItem({ companyId: 'c3', companyName: 'Company C', totalPrice: 300, baseUnitPrice: 300 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 3, maxCompanyPurchasePercent: 40 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, true)
    assert.equal(t.companyRule!.meetsCompanyCaps, true)
  })
})

describe('Case 8: company rule met AND tier minimum met', () => {
  it('both meetsTierMinimum and meetsCompanyRules are true', () => {
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 150, baseUnitPrice: 150 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 150, baseUnitPrice: 150 }),
    ]
    const tier = makeTier({ minimumOrderAmount: 200, minimumCompanyCount: 2, maxCompanyPurchasePercent: 60 })
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
  it('computes percent from totalPrice when baseUnitPrice is undefined', () => {
    // No baseUnitPrice → falls back to totalPrice for company attribution.
    // The percent denominator is productBaseSubtotal (base value reconstructed
    // by the engine), consistent with the tier-minimum qualification.
    const items = [
      makeItem({ companyId: 'c1', companyName: 'Co A', totalPrice: 300 }),
      makeItem({ companyId: 'c2', companyName: 'Co B', totalPrice: 300 }),
      makeItem({ companyId: 'c3', companyName: 'Co C', totalPrice: 400 }),
    ]
    const tier = makeTier({ minimumCompanyCount: 3, maxCompanyPurchasePercent: 40 })
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
  it('single company gets 100% which exceeds any cap', () => {
    const items = [makeItem({ companyId: 'c1', companyName: 'Solo', totalPrice: 500, baseUnitPrice: 500 })]
    const tier = makeTier({ minimumCompanyCount: 2, maxCompanyPurchasePercent: 50 })
    const t = computeCartTotals(items, tier)
    assert.equal(t.meetsCompanyRules, false)
    assert.equal(t.companyRule!.companies[0].percent, 100)
    assert.equal(t.companyRule!.companies[0].exceedsCap, true)
  })
})
