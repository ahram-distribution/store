import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeCompanyRuleResult, companyDiversificationSentence, computeMainCompanyBaseSubtotal, evaluateCompanyMaxAdd } from '../pricing.ts'
import type { CartItem, TierConfig } from '../../types/storefront.ts'

function makeItem(overrides: Partial<CartItem> & { companyId: string; companyName: string }): CartItem {
  const unitQuantity = overrides.unitQuantity ?? 1
  const unitPrice = overrides.unitPrice ?? overrides.baseUnitPrice ?? 0
  return {
    productId: 'p1',
    productName: 'Test Product',
    unitType: 'piece',
    unitQuantity,
    pieceQuantity: unitQuantity,
    unitPrice,
    baseUnitPrice: overrides.baseUnitPrice ?? unitPrice,
    totalPrice: overrides.totalPrice ?? unitPrice * unitQuantity,
    companyId: overrides.companyId,
    companyName: overrides.companyName,
    isBonus: overrides.isBonus ?? false,
    ...overrides,
  }
}

function makeTier(overrides: Partial<TierConfig> = {}): TierConfig {
  return {
    id: 'tier-1',
    name: 'Tier',
    description: null,
    discountPercent: 5,
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

const TARGET_A = { productId: 'pa', unitType: 'piece' as const }
const TARGET_B = { productId: 'pb', unitType: 'piece' as const }

describe('computeMainCompanyBaseSubtotal', () => {
  it('sums base × quantity over MAIN products only', () => {
    const items = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 100, unitQuantity: 3, totalPrice: 300 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 50, unitQuantity: 2, totalPrice: 100 }),
    ]
    assert.equal(computeMainCompanyBaseSubtotal(items), 400)
  })

  it('excludes bonus items entirely', () => {
    const items = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 100, unitQuantity: 2, totalPrice: 200 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 999_999, unitQuantity: 1, totalPrice: 999_999, isBonus: true }),
    ]
    assert.equal(computeMainCompanyBaseSubtotal(items), 200)
  })
})

describe('evaluateCompanyMaxAdd — maxCompanyValue = TIER VALUE × maxPercent / 100 (never cart subtotal)', () => {
  it('2,000,000 × 25% = 500,000 — Company A at 490,000 + 10,001 → BLOCKED (requirement 8)', () => {
    const cur = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'Company A', baseUnitPrice: 490_000, unitQuantity: 1, totalPrice: 490_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'Company B', baseUnitPrice: 1_000, unitQuantity: 1, totalPrice: 1_000 }),
    ]
    const candidate = [
      ...cur,
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'Company A', baseUnitPrice: 10_001, unitQuantity: 1, totalPrice: 10_001 }),
    ]
    const g = evaluateCompanyMaxAdd(candidate, makeTier(), TARGET_A, cur)
    assert.equal(g.blocked, true)
    assert.equal(g.maxCompanyValue, 500_000)
    assert.equal(g.companyValue, 500_001)
    assert.equal(g.currentCompanyValue, 490_000)
    assert.equal(g.room, 10_000)
    assert.equal(g.tierValue, 2_000_000)
  })

  it('2,000,000 × 25% = 500,000 — Company A at 500,000 + ANY positive MAIN product → BLOCKED', () => {
    const cur = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'Company A', baseUnitPrice: 500_000, unitQuantity: 1, totalPrice: 500_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'Company B', baseUnitPrice: 1, unitQuantity: 1, totalPrice: 1 }),
    ]
    const candidate = [
      ...cur,
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'Company A', baseUnitPrice: 1, unitQuantity: 1, totalPrice: 1 }),
    ]
    assert.equal(evaluateCompanyMaxAdd(candidate, makeTier(), TARGET_A, cur).blocked, true)
  })

  it('1,000,000 × 25% = 250,000 — a 260,000 company is blocked', () => {
    const tier = makeTier({ minimumOrderAmount: 1_000_000 })
    const cur = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 240_000, unitQuantity: 1, totalPrice: 240_000 })]
    const candidate = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 240_000, unitQuantity: 1, totalPrice: 240_000 }),
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'A', baseUnitPrice: 20_000, unitQuantity: 1, totalPrice: 20_000 })]
    const g = evaluateCompanyMaxAdd(candidate, tier, TARGET_A, cur)
    assert.equal(g.blocked, true)
    assert.equal(g.maxCompanyValue, 250_000)
  })

  it('500,000 × 25% = 125,000 — a 130,000 company is blocked', () => {
    const tier = makeTier({ minimumOrderAmount: 500_000 })
    const cur = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 125_000, unitQuantity: 1, totalPrice: 125_000 })]
    const candidate = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 125_000, unitQuantity: 1, totalPrice: 125_000 }),
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'A', baseUnitPrice: 5_000, unitQuantity: 1, totalPrice: 5_000 })]
    const g = evaluateCompanyMaxAdd(candidate, tier, TARGET_A, cur)
    assert.equal(g.blocked, true)
    assert.equal(g.maxCompanyValue, 125_000)
  })

  it('current cart subtotal does NOT affect the maximum — a 520,000 company on a 4.5M subtotal is BLOCKED', () => {
    // Old (invalid) share math: 520,000 / 4,520,000 ≈ 11.5% < 25% → allowed.
    // Correct: company value > 500,000 → blocked, no matter the subtotal.
    const cur = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 500_000, unitQuantity: 1, totalPrice: 500_000 }),
      makeItem({ productId: 'p1', companyId: 'c1', companyName: 'X', baseUnitPrice: 800_000, unitQuantity: 1, totalPrice: 800_000 }),
      makeItem({ productId: 'p2', companyId: 'c2', companyName: 'Y', baseUnitPrice: 800_000, unitQuantity: 1, totalPrice: 800_000 }),
      makeItem({ productId: 'p3', companyId: 'c3', companyName: 'Z', baseUnitPrice: 800_000, unitQuantity: 1, totalPrice: 800_000 }),
    ]
    const candidate = [
      ...cur,
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'A', baseUnitPrice: 20_000, unitQuantity: 1, totalPrice: 20_000 }),
    ]
    assert.equal(computeMainCompanyBaseSubtotal(candidate) > 2_000_000, true)
    const g = evaluateCompanyMaxAdd(candidate, makeTier(), TARGET_A, cur)
    assert.equal(g.blocked, true)
    assert.equal(g.maxCompanyValue, 500_000)
  })

  it('current cart subtotal does NOT affect the maximum — a 400,000 company on a 400,000 subtotal is ALLOWED', () => {
    // Old (invalid) share math: 400,000 / 400,000 = 100% > 25% → blocked.
    // Correct: company value 400,000 < 500,000 → allowed, even at 100% share.
    const cur = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 })]
    const candidate = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 })]
    const g = evaluateCompanyMaxAdd(candidate, makeTier(), TARGET_A, cur)
    assert.equal(g.blocked, false)
    assert.equal(g.maxCompanyValue, 500_000)
  })

  it('exactly at the maximum (500,000) is ALLOWED', () => {
    const items = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 500_000, unitQuantity: 1, totalPrice: 500_000 })]
    const g = evaluateCompanyMaxAdd(items, makeTier(), TARGET_A, items)
    assert.equal(g.blocked, false)
    assert.equal(g.maxCompanyValue, 500_000)
  })

  it('0.01 over the maximum (500,000.01) is BLOCKED', () => {
    const items = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 500_000.01, unitQuantity: 1, totalPrice: 500_000.01 })]
    const g = evaluateCompanyMaxAdd(items, makeTier(), TARGET_A, items)
    assert.equal(g.blocked, true)
    assert.equal(g.companyValue, 500_000.01)
    assert.equal(g.maxCompanyValue, 500_000)
  })

  it('is a pure function — the candidate items are never mutated by the guard', () => {
    const items = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 600_000, unitQuantity: 1, totalPrice: 600_000 })]
    const snapshot = items.map((i) => ({ ...i }))
    const g = evaluateCompanyMaxAdd(items, makeTier(), TARGET_A, items)
    assert.equal(g.blocked, true)
    assert.deepEqual(items, snapshot)
  })

  it('decreasing the quantity restores the allowance (+ becomes available again)', () => {
    const high = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 600_000, unitQuantity: 1, totalPrice: 600_000 })]
    const low = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 490_000, unitQuantity: 1, totalPrice: 490_000 })]
    assert.equal(evaluateCompanyMaxAdd(high, makeTier(), TARGET_A, high).blocked, true)
    const g = evaluateCompanyMaxAdd(low, makeTier(), TARGET_A, low)
    assert.equal(g.blocked, false)
    assert.equal(g.currentCompanyValue, 490_000)
    assert.equal(g.room, 10_000)
  })

  it('BONUS products never affect company value — a huge bonus can neither rescue nor trip the cap', () => {
    const cur = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 520_000, unitQuantity: 1, totalPrice: 520_000 }),
    ]
    assert.equal(evaluateCompanyMaxAdd(cur, makeTier(), TARGET_A, cur).blocked, true)

    const under = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 }),
      makeItem({ productId: 'bg', companyId: 'cb', companyName: 'BonusCo', baseUnitPrice: 1_000_000, unitQuantity: 1, totalPrice: 1_000_000, isBonus: true }),
    ]
    const g = evaluateCompanyMaxAdd(under, makeTier(), TARGET_A, under)
    assert.equal(g.blocked, false, 'bonus cannot trip the cap')
  })

  it('no construction exemption — a single company of 600,000 is BLOCKED even though the 4-company minimum is unmet', () => {
    const tier = makeTier({ minimumCompanyCount: 4 })
    const items = [makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 600_000, unitQuantity: 1, totalPrice: 600_000 })]
    const g = evaluateCompanyMaxAdd(items, tier, TARGET_A, items)
    assert.equal(g.blocked, true, 'maximum company value applies always, regardless of company count')
    assert.equal(g.companyValue, 600_000)
    assert.equal(g.maxCompanyValue, 500_000)
  })

  it('reports remaining allowance (room) and whole-unit maxAllowedUnits for the target line', () => {
    const cur = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 100_000, unitQuantity: 4, totalPrice: 400_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'B', baseUnitPrice: 60_000, unitQuantity: 1, totalPrice: 60_000 }),
    ]
    const candidate = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 100_000, unitQuantity: 5, totalPrice: 500_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'B', baseUnitPrice: 60_000, unitQuantity: 1, totalPrice: 60_000 }),
    ]
    const g = evaluateCompanyMaxAdd(candidate, makeTier(), TARGET_A, cur)
    assert.equal(g.blocked, false)
    assert.equal(g.maxCompanyValue, 500_000)
    assert.equal(g.currentCompanyValue, 400_000)
    assert.equal(g.room, 100_000)
    assert.equal(g.maxAllowedUnits, 5)
  })

  it('without a target, every company is judged (full-state check)', () => {
    const items = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 600_000, unitQuantity: 1, totalPrice: 600_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'B', baseUnitPrice: 10, unitQuantity: 1, totalPrice: 10 }),
    ]
    const g = evaluateCompanyMaxAdd(items, makeTier())
    assert.equal(g.blocked, true)
    assert.equal(g.companyId, 'ca')
    assert.equal(g.companyValue, 600_000)
  })

  it('companies are independent — rebalancing from an under-cap company is allowed while the capped one is blocked', () => {
    const base = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 520_000, unitQuantity: 1, totalPrice: 520_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'B', baseUnitPrice: 100_000, unitQuantity: 1, totalPrice: 100_000 }),
    ]
    const growB = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 520_000, unitQuantity: 1, totalPrice: 520_000 }),
      makeItem({ productId: 'pb', companyId: 'cb', companyName: 'B', baseUnitPrice: 110_000, unitQuantity: 1, totalPrice: 110_000 }),
    ]
    const growA = [
      makeItem({ productId: 'pa', companyId: 'ca', companyName: 'A', baseUnitPrice: 520_000, unitQuantity: 1, totalPrice: 520_000 }),
      makeItem({ productId: 'px', companyId: 'ca', companyName: 'A', baseUnitPrice: 10, unitQuantity: 1, totalPrice: 10 }),
    ]
    assert.equal(evaluateCompanyMaxAdd(growB, makeTier(), TARGET_B, base).blocked, false, 'adding to an under-cap company is allowed')
    assert.equal(evaluateCompanyMaxAdd(growA, makeTier(), TARGET_A, base).blocked, true, 'adding to the capped company is blocked')
  })

  it('unlimited when no tier is selected, max is null/0, or the tier has no monetary value', () => {
    assert.equal(evaluateCompanyMaxAdd([makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 1_000_000 })], null, TARGET_A).unlimited, true)
    assert.equal(evaluateCompanyMaxAdd([makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 1_000_000 })], makeTier({ maxCompanyPurchasePercent: null }), TARGET_A).unlimited, true)
    assert.equal(evaluateCompanyMaxAdd([makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 1_000_000 })], makeTier({ maxCompanyPurchasePercent: 0 }), TARGET_A).unlimited, true)
    assert.equal(evaluateCompanyMaxAdd([makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 1_000_000 })], makeTier({ minimumOrderAmount: 0 }), TARGET_A).unlimited, true)
  })
})

describe('checkout computeCompanyRuleResult — same tier-value basis', () => {
  it('meetsCompanyCaps uses value vs tier-value-derived max, independently of subtotal', () => {
    const tier = makeTier({ minimumOrderAmount: 2_000_000, maxCompanyPurchasePercent: 25, minimumCompanyCount: 4 })
    const passing = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 1_000_000, unitQuantity: 1, totalPrice: 1_000_000 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 1_000_000, unitQuantity: 1, totalPrice: 1_000_000 }),
    ]
    const r1 = computeCompanyRuleResult(passing, tier)
    assert.equal(r1.companyRule!.maxCompanyValue, 500_000)
    assert.equal(r1.companyRule!.meetsCompanyCaps, false, 'each company at 1,000,000 > 500,000 cap → rule B fails')

    const split = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 }),
      makeItem({ companyId: 'cc', companyName: 'C', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 }),
      makeItem({ companyId: 'cd', companyName: 'D', baseUnitPrice: 400_000, unitQuantity: 1, totalPrice: 400_000 }),
    ]
    const r2 = computeCompanyRuleResult(split, tier)
    assert.equal(r2.companyRule!.maxCompanyValue, 500_000)
    assert.equal(r2.companyRule!.meetsCompanyCaps, true)
    assert.equal(r2.meetsCompanyRules, true, '4 companies of 400K each satisfy BOTH rules')
  })

  it('minimum company count is the SAVED value (4): 3 companies fail rule A regardless of cap', () => {
    const tier = makeTier({ minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const three = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 100, unitQuantity: 1, totalPrice: 100 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 100, unitQuantity: 1, totalPrice: 100 }),
      makeItem({ companyId: 'cc', companyName: 'C', baseUnitPrice: 100, unitQuantity: 1, totalPrice: 100 }),
    ]
    const r = computeCompanyRuleResult(three, tier)
    assert.equal(r.companyRule!.minimumCompanyCount, 4)
    assert.equal(r.companyRule!.distinctCompanyCount, 3)
    assert.equal(r.companyRule!.meetsMinimumCompanies, false)
    assert.equal(r.meetsCompanyRules, false)
  })

  it('bonus items never count toward company concentration (rule A and B are MAIN-only)', () => {
    const tier = makeTier({ minimumCompanyCount: 4, maxCompanyPurchasePercent: 25 })
    const withBonus = [
      makeItem({ companyId: 'ca', companyName: 'A', baseUnitPrice: 200, unitQuantity: 1, totalPrice: 200 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 200, unitQuantity: 1, totalPrice: 200 }),
      makeItem({ companyId: 'cb', companyName: 'B', baseUnitPrice: 5_000_000, unitQuantity: 1, totalPrice: 5_000_000, isBonus: true }),
    ]
    const r = computeCompanyRuleResult(withBonus, tier)
    assert.equal(r.companyRule!.distinctCompanyCount, 2, 'bonus company B does not add a third distinct company')
  })
})

describe('companyDiversificationSentence — dynamic from SAVED values', () => {
  it('reflects 4 companies / 25% exactly', () => {
    assert.equal(
      companyDiversificationSentence(4, 25),
      'يجب أن تتنوع الفاتورة بين 4 شركات على الأقل وأن لا تتجاوز قيمة المشتريات من كل شركة 25% بحد أقصى.'
    )
  })

  it('reflects 5 companies / 20% exactly', () => {
    assert.equal(
      companyDiversificationSentence(5, 20),
      'يجب أن تتنوع الفاتورة بين 5 شركات على الأقل وأن لا تتجاوز قيمة المشتريات من كل شركة 20% بحد أقصى.'
    )
  })
})