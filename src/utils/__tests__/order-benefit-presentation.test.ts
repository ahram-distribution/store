import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VIRTUAL_BONUS_COMPANY_NAME,
  buildOrderFinancialPresentation,
  effectiveBenefitPercent,
  isBonusOrder,
  mainLineCredit,
  splitItemsByBonus,
} from '../order-benefit-presentation.ts'
import type { UnifiedOrderHeader, UnifiedOrderItem } from '../../types/unified-order.ts'

// ---------------------------------------------------------------------------
// ORDER BENEFIT — Order Details presentation (view-only, mode-aware)
//
// Pins the presentation contract to the real acceptance order
// (ORD-2026-000324, Bonus Tiers):
//   MAIN    صبغه باليت ×2 lines → base 48,000 + 2,880 = 50,880
//   BONUS   ايفا بادي ← 1,668 (gifted, bonus_applied_amount 1,272)
//   before bonus = 52,548 · credit 2.5% = 1,272 · final = 51,276
// ---------------------------------------------------------------------------

function makeHeader(overrides: Partial<UnifiedOrderHeader> = {}): UnifiedOrderHeader {
  const base: UnifiedOrderHeader = {
    id: 'o1', order_number: 'ORD-2026-000324', status: 'returned_for_revision',
    delivery_mode: 'internal', payment_method: 'installment', order_type: 'special',
    subtotal: 0, discount_amount: 0, tax_amount: 0, total_amount: 0,
    notes: null, revision_number: 0, last_revised_at: null,
    customer_id: 'c1', owner_type: 'customer', owner_id: null,
    created_by: 'u1', submitted_at: null, approved_at: null, delivered_at: null,
    cancelled_at: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
    deferred_until: null, defer_reason: null, cancel_reason: null,
    execution_latitude: null, execution_longitude: null, execution_accuracy_meters: null,
    execution_captured_at: null, execution_location_id: null,
    tier_id: null, payment_method_option_id: null, shipping_method_option_id: null,
    effective_discount_percent: null,
    snapshot_tier_name: null, snapshot_tier_discount: null,
    snapshot_payment_name: null, snapshot_payment_discount: null,
    snapshot_shipping_name: null, snapshot_shipping_discount: null,
    snapshot_customer_name: null, snapshot_customer_phone: null, snapshot_customer_address: null,
    snapshot_customer_code: null, snapshot_owner_name: null, snapshot_owner_phone: null,
    snapshot_owner_address: null, snapshot_sender_name: null, snapshot_sender_phone: null,
    snapshot_sender_address: null,
    customer_owner_name: '', customer_owner_role: '', customer_owner_id: null,
    order_creator_name: '', order_creator_role: null, order_creator_id: null,
    order_creator_type: null, current_owner_name: '',
    reference_number: null,
    bonus_mode_used: null, main_base_total: null, bonus_credit: null,
    bonus_products_total: null, bonus_applied: null, bonus_unused: null, bonus_overflow: null,
  }
  return { ...base, ...overrides }
}

function makeItem(overrides: Partial<UnifiedOrderItem> = {}): UnifiedOrderItem {
  const base: UnifiedOrderItem = {
    id: 'i1', product_id: 'p1', product_name: 'منتج', legacy_code: '1', image_url: null,
    company_id: 'co1', company_name: 'شركة اختبار', unit_type: 'carton',
    unit_quantity: 1, piece_quantity: 1, unit_price: 0, base_unit_price: 0, total_price: 0,
  }
  return { ...base, ...overrides }
}

function acceptanceOrder(): UnifiedOrderHeader {
  return makeHeader({
    total_amount: 51276,
    discount_amount: 1272,
    bonus_mode_used: true,
    main_base_total: 50880,
    bonus_credit: 1272,
    bonus_products_total: 1668,
    bonus_applied: 1272,
    bonus_unused: 0,
    bonus_overflow: 396,
    snapshot_tier_name: 'شريحة 50 ألف', snapshot_tier_discount: 0.5,
    snapshot_payment_name: 'دفع مسبق', snapshot_payment_discount: 1,
    snapshot_shipping_name: 'استلام من مخزن الشركة', snapshot_shipping_discount: 1,
  })
}

function acceptanceItems(): UnifiedOrderItem[] {
  return [
    makeItem({ id: 'm1', legacy_code: '1', product_name: 'صبغه باليت', unit_type: 'carton', unit_quantity: 50, piece_quantity: 50, base_unit_price: 960, unit_price: 960, total_price: 48000, is_bonus: false, bonus_applied_amount: null }),
    makeItem({ id: 'm2', legacy_code: '26', product_name: 'صبغه باليت', unit_type: 'carton', unit_quantity: 3, piece_quantity: 3, base_unit_price: 960, unit_price: 960, total_price: 2880, is_bonus: false, bonus_applied_amount: null }),
    makeItem({ id: 'b1', legacy_code: '1075', product_name: 'ايفا بادي سبلاش', unit_type: 'dozen', unit_quantity: 1, piece_quantity: 12, base_unit_price: 1668, unit_price: 1668, total_price: 1668, is_bonus: true, bonus_applied_amount: 1272 }),
  ]
}

describe('isBonusOrder', () => {
  it('is active only for orders created under Bonus Tiers mode (historical snapshot)', () => {
    assert.equal(isBonusOrder(makeHeader({ bonus_mode_used: true })), true)
    assert.equal(isBonusOrder(makeHeader({ bonus_mode_used: false })), false)
    assert.equal(isBonusOrder(makeHeader({ bonus_mode_used: null })), false)
    assert.equal(isBonusOrder(makeHeader()), false)
  })
})

describe('splitItemsByBonus', () => {
  it('splits persisted MAIN vs BONUS items by item.is_bonus', () => {
    const { mainItems, bonusItems } = splitItemsByBonus(acceptanceItems())
    assert.equal(mainItems.length, 2)
    assert.equal(bonusItems.length, 1)
    assert.equal(bonusItems[0].id, 'b1')
  })
  it('keeps items the same when nothing is marked bonus', () => {
    const items = [makeItem(), makeItem({ id: 'x' })]
    const { mainItems, bonusItems } = splitItemsByBonus(items)
    assert.equal(mainItems.length, 2)
    assert.equal(bonusItems.length, 0)
  })
})

describe('effectiveBenefitPercent', () => {
  it('sums tier + payment + shipping historical discounts (0.5 + 1 + 1 = 2.5)', () => {
    assert.equal(effectiveBenefitPercent(acceptanceOrder()), 2.5)
  })
  it('ignores missing snapshot discounts', () => {
    assert.equal(effectiveBenefitPercent(makeHeader({ bonus_mode_used: true, snapshot_tier_discount: 0.5 })), 0.5)
  })
})

// ---------------------------------------------------------------------------
// MODE DETECTION (historical, never the current global benefit mode)
// ---------------------------------------------------------------------------
describe('mode detection', () => {
  it('CASE C — Bonus Tiers when order.bonus_mode_used is true (even with 0 discount)', () => {
    const p = buildOrderFinancialPresentation(makeHeader({ bonus_mode_used: true, total_amount: 50000 }), [makeItem({ base_unit_price: 100, unit_price: 100, unit_quantity: 5, total_price: 500 })])
    assert.equal(p.mode, 'bonus')
  })
  it('CASE B — Direct Discount via persisted discount_amount', () => {
    const p = buildOrderFinancialPresentation(makeHeader({ discount_amount: 100, total_amount: 900 }), [makeItem({ base_unit_price: 100, unit_price: 90, unit_quantity: 10, total_price: 900 })])
    assert.equal(p.mode, 'direct')
  })
  it('CASE B — Direct Discount via discounted line prices when discount_amount is missing', () => {
    const p = buildOrderFinancialPresentation(makeHeader({ total_amount: 900 }), [makeItem({ base_unit_price: 100, unit_price: 90, unit_quantity: 10, total_price: 900 })])
    assert.equal(p.mode, 'direct')
  })
  it('CASE B — Direct Discount via persisted effective_discount_percent', () => {
    const p = buildOrderFinancialPresentation(makeHeader({ effective_discount_percent: 8 }), [makeItem({ base_unit_price: 100, unit_price: 92, unit_quantity: 10, total_price: 920 })])
    assert.equal(p.mode, 'direct')
  })
  it('CASE A — No benefit when snapshot NAMES exist but every discount is 0', () => {
    const p = buildOrderFinancialPresentation(makeHeader({
      snapshot_tier_name: 'شريحة 50 ألف', snapshot_tier_discount: 0,
      snapshot_payment_name: 'دفع مسبق', snapshot_payment_discount: 0,
    }), [makeItem({ base_unit_price: 100, unit_price: 100, unit_quantity: 10, total_price: 1000 })])
    assert.equal(p.mode, 'none')
  })
  it('CASE A — No benefit on a plain order with matching base prices', () => {
    const p = buildOrderFinancialPresentation(makeHeader({ total_amount: 1000 }), [makeItem({ base_unit_price: 100, unit_price: 100, unit_quantity: 10, total_price: 1000 })])
    assert.equal(p.mode, 'none')
    assert.equal(p.benefitInfoLabel, '')
  })
})

// ---------------------------------------------------------------------------
// CASE C — Bonus Tiers acceptance order
// ---------------------------------------------------------------------------
describe('CASE C — Bonus Tiers acceptance order ORD-2026-000324', () => {
  it('produces the exact summary numbers (50,880 / 1,668 / 52,548 / 1,272 / 51,276)', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    assert.equal(p.mode, 'bonus')
    assert.equal(p.mainBaseTotal, 50880)
    assert.equal(p.bonusProductsTotal, 1668)
    assert.equal(p.beforeBonusTotal, 52548)
    assert.equal(p.bonusCredit, 1272)
    assert.equal(p.finalTotal, 51276)
  })
  it('detects a uniform 2.5% benefit and exposes the benefit-info label (not inside the monetary summary)', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    assert.equal(p.uniform, true)
    assert.equal(p.perLineCreditPct, 2.5)
    assert.equal(p.benefitInfoLabel, 'إجمالي المنفعة: 2.5%')
  })
  it('groups MAIN products under their real company and BONUS under the virtual one', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    assert.equal(p.mainGroups.length, 1)
    assert.equal(p.mainGroups[0].company, 'شركة اختبار')
    assert.equal(p.mainGroups[0].subtotal, 50880)
    assert.ok(p.bonusGroup)
    assert.equal(p.bonusGroup.company, VIRTUAL_BONUS_COMPANY_NAME)
    assert.equal(p.bonusGroup.subtotal, 1668)
    assert.equal(p.bonusGroup.totalPieces, 12)
  })
  it('keeps per-line MAIN credits derived from the uniform percent (1200 + 72 = 1272)', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    const credits = p.mainGroups[0].items.map((i) => mainLineCredit(i, p.perLineCreditPct))
    assert.deepEqual(credits, [1200, 72])
    assert.equal(credits.reduce((s, c) => s + (c || 0), 0), p.bonusCredit)
  })
  it('bonus products stay at base/official prices and never carry a discount', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    const bonus = p.bonusGroup?.items[0]
    assert.ok(bonus)
    assert.equal(Number(bonus.unit_price), 1668)
    assert.equal(Number(bonus.base_unit_price), 1668)
  })
  it('never fabricates a percentage for the monetary credit line', () => {
    const p = buildOrderFinancialPresentation(acceptanceOrder(), acceptanceItems())
    assert.equal(p.benefitInfoLabel.includes('1,272'), false)
    assert.equal(p.bonusCredit, 1272)
  })
})

// ---------------------------------------------------------------------------
// CASE C — heterogeneous effective rates (product/company exceptions)
// ---------------------------------------------------------------------------
describe('CASE C — product/company exceptions (non-uniform)', () => {
  it('shows "المنفعة حسب المنتج" and NO single order-wide percentage when the credit ratio differs', () => {
    // Persisted credit 508 over main base 50,880 → 1.0% ≠ snapshot 2.5%
    const order = acceptanceOrder()
    order.bonus_credit = 508
    const p = buildOrderFinancialPresentation(order, acceptanceItems())
    assert.equal(p.uniform, false)
    assert.equal(p.benefitInfoLabel, 'المنفعة حسب المنتج')
    assert.equal(p.perLineCreditPct, null)
    assert.equal(p.bonusCredit, 508)
  })
  it('sums product-level credits only, never averaging or adding percentages (5% / 1% / 2.5% → 850)', () => {
    const items = [
      makeItem({ id: 'a', base_unit_price: 10000, unit_price: 10000, unit_quantity: 1, total_price: 10000 }),
      makeItem({ id: 'b', base_unit_price: 10000, unit_price: 10000, unit_quantity: 1, total_price: 10000 }),
      makeItem({ id: 'c', base_unit_price: 10000, unit_price: 10000, unit_quantity: 1, total_price: 10000 }),
    ]
    const credits = [mainLineCredit(items[0], 5), mainLineCredit(items[1], 1), mainLineCredit(items[2], 2.5)]
    assert.deepEqual(credits, [500, 100, 250])
    assert.equal(credits.reduce((s, c) => s + (c || 0), 0), 850)
  })
  it('keeps MAIN products at base prices even when exceptions apply', () => {
    const items = [makeItem({ base_unit_price: 10000, unit_price: 10000, unit_quantity: 1, total_price: 10000 })]
    const p = buildOrderFinancialPresentation(makeHeader({
      bonus_mode_used: true,
      snapshot_tier_discount: 2.5,
      main_base_total: 10000,
      bonus_credit: 350, // 3.5% ≠ snapshot 2.5% → exception(s) present
      total_amount: 9650,
    }), items)
    assert.equal(p.mode, 'bonus')
    assert.equal(Number(items[0].unit_price), 10000)
    assert.equal(p.benefitInfoLabel, 'المنفعة حسب المنتج')
  })
})

// ---------------------------------------------------------------------------
// CASE B — Direct Discount
// ---------------------------------------------------------------------------
describe('CASE B — Direct Discount', () => {
  it('produces the direct summary numbers without any Bonus terminology', () => {
    const order = makeHeader({ discount_amount: 150, total_amount: 1350 })
    const items = [
      makeItem({ base_unit_price: 500, unit_price: 470, unit_quantity: 1, total_price: 470 }),
      makeItem({ id: 'x', base_unit_price: 1000, unit_price: 880, unit_quantity: 1, total_price: 880 }),
    ]
    const p = buildOrderFinancialPresentation(order, items)
    assert.equal(p.mode, 'direct')
    assert.equal(p.directBaseTotal, 1500)
    assert.equal(p.directDiscountAmount, 150)
    assert.equal(p.finalTotal, 1350)
    assert.equal(p.bonusCredit, 0)
    assert.equal(p.bonusGroup, null)
    assert.equal(p.mainGroups.length, 0)
    assert.equal(p.benefitInfoLabel, '')
    assert.equal(p.perLineCreditPct, null)
  })
  it('falls back to base − net when the discount is not persisted but prices are discounted', () => {
    const order = makeHeader({ total_amount: 900 })
    const items = [makeItem({ base_unit_price: 100, unit_price: 90, unit_quantity: 10, total_price: 900 })]
    const p = buildOrderFinancialPresentation(order, items)
    assert.equal(p.mode, 'direct')
    assert.equal(p.directBaseTotal, 1000)
    assert.equal(p.directDiscountAmount, 100)
    assert.equal(p.finalTotal, 900)
  })
  it('CASE C (scenario) — Direct Discount with a product exception stays monetary, no Bonus wording', () => {
    const order = makeHeader({ discount_amount: 200, total_amount: 1800 })
    const items = [
      makeItem({ base_unit_price: 1000, unit_price: 900, unit_quantity: 1, total_price: 900 }),
      makeItem({ id: 'y', base_unit_price: 1000, unit_price: 1000, unit_quantity: 1, total_price: 1000 }),
    ]
    const p = buildOrderFinancialPresentation(order, items)
    assert.equal(p.mode, 'direct')
    assert.equal(p.directBaseTotal, 2000)
    assert.equal(p.directDiscountAmount, 200)
    assert.equal(Number(items[1].unit_price), 1000) // unaffected line keeps its price
    assert.equal(p.benefitInfoLabel, '')
  })
})

// ---------------------------------------------------------------------------
// CASE A — No Tier Discount / no applicable benefit
// ---------------------------------------------------------------------------
describe('CASE A — No Tier Discount', () => {
  it('produces no discount section, no invented percentage, only normal totals', () => {
    const order = makeHeader({ total_amount: 5000 })
    const items = [makeItem({ base_unit_price: 500, unit_price: 500, unit_quantity: 10, total_price: 5000 })]
    const p = buildOrderFinancialPresentation(order, items)
    assert.equal(p.mode, 'none')
    assert.equal(p.benefitInfoLabel, '')
    assert.equal(p.mainBaseTotal, 0)
    assert.equal(p.bonusProductsTotal, 0)
    assert.equal(p.beforeBonusTotal, 0)
    assert.equal(p.bonusCredit, 0)
    assert.equal(p.directBaseTotal, 0)
    assert.equal(p.directDiscountAmount, 0)
    assert.equal(p.finalTotal, 5000)
  })
})

// ---------------------------------------------------------------------------
// Edge cases (Bonus Tiers)
// ---------------------------------------------------------------------------
describe('CASE C — edge cases', () => {
  it('handles a bonus order with zero bonus items (main-only summary)', () => {
    const order = acceptanceOrder()
    order.bonus_products_total = 0
    const items = acceptanceItems().slice(0, 2) // main lines only
    const p = buildOrderFinancialPresentation(order, items)
    assert.equal(p.mode, 'bonus')
    assert.equal(p.bonusGroup, null)
    assert.equal(p.bonusProductsTotal, 0)
    assert.equal(p.beforeBonusTotal, 50880)
    assert.equal(p.finalTotal, 51276)
    assert.equal(p.uniform, true)
    assert.equal(p.perLineCreditPct, 2.5)
  })
  it('returns the persisted credit verbatim when present', () => {
    const order = acceptanceOrder()
    order.bonus_credit = 999.5
    const p = buildOrderFinancialPresentation(order, acceptanceItems())
    assert.equal(p.bonusCredit, 999.5)
  })
  it('does not fabricate a credit when nothing is persisted and ratio is unknown', () => {
    const order = acceptanceOrder()
    order.bonus_credit = null
    order.main_base_total = null
    const p = buildOrderFinancialPresentation(order, acceptanceItems())
    assert.equal(p.mode, 'bonus')
    assert.equal(p.bonusCredit, 0)
    assert.equal(p.uniform, false)
    assert.equal(p.benefitInfoLabel, 'المنفعة حسب المنتج')
  })
  it('rounds line totals and credits to 2 decimals', () => {
    const item = makeItem({ base_unit_price: 333.33, unit_quantity: 3, total_price: 999.99 })
    assert.equal(mainLineCredit(item, 0.5), 5)
    assert.equal(mainLineCredit(item, 2.5), 25)
  })
  it('uses the persisted final total as the authoritative closing number', () => {
    const order = acceptanceOrder()
    order.total_amount = 51276.5
    assert.equal(buildOrderFinancialPresentation(order, acceptanceItems()).finalTotal, 51276.5)
  })
  it('formats integer uniform benefit percents without decimals (2 → "2%")', () => {
    const order = makeHeader({
      bonus_mode_used: true, snapshot_tier_discount: 2, snapshot_payment_discount: 0, snapshot_shipping_discount: 0,
      main_base_total: 1000, bonus_credit: 20, total_amount: 980,
    })
    assert.equal(buildOrderFinancialPresentation(order, [makeItem({ base_unit_price: 250, unit_price: 250, unit_quantity: 4, total_price: 1000 })]).benefitInfoLabel, 'إجمالي المنفعة: 2%')
  })
})