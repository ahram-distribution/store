import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBonusCredit,
  computeBonusModeTotals,
  computeBonusSummary,
  assertBonusBasePrice,
} from '../bonusPricing.ts'
import { computeCartTotals } from '../pricing.ts'
import type {
  CartItem,
  CartDealItem,
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
} from '../../types/storefront.ts'

/**
 * Phase 3 — Bonus Mode cart state contracts (A–K).
 *
 * The cart store (Zustand) cannot run in `node --test` (its module graph pulls in
 * electron-bound supabase lib, import.meta.env and react-hot-toast). These tests
 * therefore pin the PURE ENGINE contracts the cart store delegates to, which is the
 * repo's existing unit-test boundary:
 *   A  OFF regression — computeCartTotals untouched, no bonus fields leak
 *   B  ON base pricing + credit via bonusPricing (main items at BASE, deal/flash out)
 *   C  Bonus separation — isBonus drives split; bonus never generates credit
 *   D  applied / unused / overflow / payable matrices (D-O9, D-O11)
 *   E  Deals / Flash never in credit, always added to payable
 *   F  Tier minimum client-side vs MAIN subtotal only (D-O10, §24.2)
 *   G  Company diversification vs MAIN items only (D-O11)
 *   H  OFF <-> ON transition reprice observable (switch back and forth)
 *   I  Empty bonus selection is valid: unused = credit, overflow 0, never blocks
 *   J  639.60 precision — no whole-EGP rounding (D-O1)
 *   K  Zero-discount OFF == Bonus-mode ON (additive wrapper does not disturb OFF)
 */

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

function makeDeal(totalPrice: number, overrides: Partial<CartDealItem> = {}): CartDealItem {
  return {
    dealId: 'deal-1',
    dealTitle: 'Deal',
    fixedPrice: totalPrice,
    totalPrice,
    quantity: 1,
    ...overrides,
  }
}

// A: OFF regression — computeCartTotals is byte-identical to before Phase 3.
describe('A. OFF regression (direct-discount mode untouched)', () => {
  it('applies tier+payment+shipping discounts exactly and leaks no bonus fields', () => {
    const tier = makeTier({ discountPercent: 2.5 })
    const items = [makeItem({ baseUnitPrice: 52000, unitPrice: 49660, totalPrice: 49660 })]
    const totals = computeCartTotals(items, tier, [], [], undefined, makePayment(1), makeShipping(1))

    assert.equal(totals.productBaseSubtotal, 52000)
    assert.equal(totals.productSubtotal, 49660)
    assert.equal(totals.totalDiscount, 2340)
    assert.equal(totals.tierDiscount, 1300)
    assert.equal(totals.paymentDiscount, 520)
    assert.equal(totals.shippingDiscount, 520)
    assert.equal(totals.netTotal, 49660)
    assert.equal(totals.bonusMode, undefined)
    assert.equal(totals.bonusCredit, undefined)
    assert.equal(totals.bonusSummary, undefined)
  })
})

// B: ON mode — main items at BASE price, credit via bonusPricing.
describe('B. Bonus mode base pricing + credit', () => {
  it('keeps main payable at base, t=2.5 + pay=1 + ship=1 => credit 2340', () => {
    const tier = makeTier({ discountPercent: 2.5 })
    const totals = computeBonusModeTotals(
      [makeItem()],
      tier,
      [],
      [],
      undefined,
      makePayment(1),
      makeShipping(1)
    )

    assert.equal(totals.bonusMode, true)
    assert.equal(totals.mainBaseTotal, 52000)
    assert.equal(totals.totalDiscount, 0)
    assert.equal(totals.tierDiscount, 0)
    assert.equal(totals.paymentDiscount, 0)
    assert.equal(totals.shippingDiscount, 0)
    assert.equal(totals.bonusCredit, 2340)
    assert.equal(totals.netTotal, 52000)
  })

  it('never leaks a negative discount line when credit exists (خصم -2340 forbidden)', () => {
    const tier = makeTier({ discountPercent: 2.5 })
    const totals = computeBonusModeTotals([makeItem()], tier, [], [], undefined, makePayment(1), makeShipping(1))
    assert.ok(totals.totalDiscount === 0 && totals.tierDiscount === 0 && totals.paymentDiscount === 0 && totals.shippingDiscount === 0)
    assert.ok(totals.bonusCredit === 2340)
    assert.ok(totals.netTotal === 52000)
  })
})

// C: Bonus separation — the additive isBonus flag drives the split.
describe('C. Bonus item separation', () => {
  it('splits main vs bonus, bonus items never generate credit', () => {
    const main = makeItem({ productId: 'p1', companyId: 'c1', baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })
    const bonus = makeItem({ productId: 'gift-1', productName: 'Gift', companyId: 'c7000', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100, isBonus: true })

    const totals = computeBonusModeTotals([main, bonus], makeTier({ discountPercent: 2.5 }), [], [], undefined, makePayment(1), makeShipping(1))

    assert.equal(totals.itemCount, 2)
    assert.equal(totals.mainBaseTotal, 52000)
    assert.equal(totals.bonusProductsTotal, 100)
    assert.equal(totals.bonusCredit, 2340)
    assert.equal(totals.productBaseSubtotal, 52000)
    assert.equal(totals.productSubtotal, 52100)
    assert.equal(totals.bonusSummary?.items.length, 1)
    assert.equal(totals.bonusSummary?.items[0].productId, 'p1')
  })

  it('flagged bonus items satisfy D-O8 (base price only: assertBonusBasePrice)', () => {
    const bonus = makeItem({ isBonus: true, baseUnitPrice: 100, unitPrice: 100, totalPrice: 100 })
    assert.equal(assertBonusBasePrice(bonus), true)
    assert.equal(assertBonusBasePrice({ ...bonus, unitPrice: 95 }), false)
  })
})

// D: applied / unused / overflow / payable (D-O9 matrix).
describe('D. Applied / Unused / Overflow / Payable', () => {
  const base = makeTier({ discountPercent: 4.5 })

  it('bonus below credit: applied = bonus, unused = diff, overflow 0, payable = main', () => {
    const totals = computeBonusModeTotals(
      [makeItem()],
      base,
      [],
      [],
      undefined,
      undefined,
      undefined
    )
    // credit 4.5% of 52000 = 2340
    assert.equal(totals.bonusCredit, 2340)
    const withBonus = computeBonusModeTotals(
      [makeItem(), makeItem({ productId: 'gift', isBonus: true, baseUnitPrice: 500, unitPrice: 500, totalPrice: 500 })],
      base
    )
    assert.equal(withBonus.bonusApplied, 500)
    assert.equal(withBonus.bonusUnused, 1840)
    assert.equal(withBonus.bonusOverflow, 0)
    assert.equal(withBonus.netTotal, 52000)
  })

  it('bonus exactly equal to credit: applied full, unused 0, overflow 0', () => {
    const totals = computeBonusModeTotals(
      [makeItem(), makeItem({ productId: 'gift', isBonus: true, baseUnitPrice: 2340, unitPrice: 2340, totalPrice: 2340 })],
      base
    )
    assert.equal(totals.bonusApplied, 2340)
    assert.equal(totals.bonusUnused, 0)
    assert.equal(totals.bonusOverflow, 0)
    assert.equal(totals.netTotal, 52000)
  })

  it('bonus above credit: overflow payable, unused 0 (D-O9)', () => {
    const totals = computeBonusModeTotals(
      [makeItem(), makeItem({ productId: 'gift', isBonus: true, baseUnitPrice: 3000, unitPrice: 3000, totalPrice: 3000 })],
      base
    )
    assert.equal(totals.bonusApplied, 2340)
    assert.equal(totals.bonusUnused, 0)
    assert.equal(totals.bonusOverflow, 660)
    assert.equal(totals.netTotal, 52660)
  })
})

// E: deals / flash offers are outside the Tier/Bonus system (D-O11).
describe('E. Deals / Flash excluded from credit, added to payable', () => {
  it('deal only increases payable, never touches credit', () => {
    const tier = makeTier({ discountPercent: 2.5 })
    const deal = makeDeal(2000)
    const flash = makeDeal(1500, { dealId: 'flash-1' })

    const totals = computeBonusModeTotals([makeItem()], tier, [deal], [flash], undefined, makePayment(1), makeShipping(1))

    assert.equal(totals.bonusCredit, 2340)
    assert.equal(totals.dealTotal, 3500)
    assert.equal(totals.netTotal, 55500)
    assert.equal(totals.bonusSummary?.bonusCredit ?? totals.bonusCredit, 2340)
  })

  it('OFF mode keeps deals in computeCartTotals unchanged', () => {
    const deal = makeDeal(2000)
    const discounted = makeItem({ baseUnitPrice: 52000, unitPrice: 49660, totalPrice: 49660 })
    const totals = computeCartTotals([discounted], makeTier({ discountPercent: 2.5 }), [deal], [], undefined, makePayment(1), makeShipping(1))
    assert.equal(totals.dealTotal, 2000)
    assert.equal(totals.netTotal, 51660)
  })
})

// F: tier minimum is client-side vs MAIN subtotal only (D-O10 / §24.2).
describe('F. Tier minimum — main only', () => {
  it('a big bonus item does NOT satisfy the tier minimum', () => {
    const tier = makeTier({ discountPercent: 2.5, minimumOrderAmount: 55000 })
    const totals = computeBonusModeTotals(
      [
        makeItem(),
        makeItem({ productId: 'gift', isBonus: true, baseUnitPrice: 10000, unitPrice: 10000, totalPrice: 10000 }),
      ],
      tier
    )
    assert.equal(totals.mainBaseTotal, 52000)
    assert.equal(totals.bonusProductsTotal, 10000)
    assert.equal(totals.meetsTierMinimum, false)
    assert.equal(totals.remainingForMinimum, 3000)
    assert.equal(totals.tierMinimum, 55000)
  })

  it('OFF mode minimum uses productBaseSubtotal unchanged', () => {
    const tier = makeTier({ discountPercent: 2.5, minimumOrderAmount: 55000 })
    const totals = computeCartTotals([makeItem()], tier)
    assert.equal(totals.meetsTierMinimum, false)
    assert.equal(totals.remainingForMinimum, 3000)
  })
})

// G: company diversification vs MAIN items only (D-O11).
describe('G. Company rules — main only', () => {
  it('bonus company never helps reach minimumCompanyCount', () => {
    const tier = makeTier({ minimumCompanyCount: 2, discountPercent: 1 })
    const totals = computeBonusModeTotals(
      [
        makeItem({ companyId: 'c1', companyName: 'Co A' }),
        makeItem({ productId: 'gift', companyId: 'c7000', companyName: 'هدايا و بونص', baseUnitPrice: 100, unitPrice: 100, totalPrice: 100, isBonus: true }),
      ],
      tier
    )
    assert.equal(totals.companyRule?.distinctCompanyCount, 1)
    assert.equal(totals.meetsCompanyRules, false)
  })

  it('OFF company rules computation unchanged', () => {
    const tier = makeTier({ minimumCompanyCount: 2 })
    const totals = computeCartTotals([makeItem({ companyId: 'c1', companyName: 'Co A' })], tier)
    assert.equal(totals.companyRule?.distinctCompanyCount, 1)
    assert.equal(totals.meetsCompanyRules, false)
  })
})

// H: OFF <-> ON transition reprice observable (spec §34.14).
describe('H. OFF <-> ON transition on an open draft', () => {
  const tier = makeTier({ discountPercent: 2.5 })
  const pay = makePayment(1)
  const ship = makeShipping(1)

  it('ON -> OFF restores the direct discount (store reprices to FINAL)', () => {
    // After the ON->OFF flip the store reprices main items at the discounted FINAL price.
    const repriceToFinal = [makeItem({ baseUnitPrice: 52000, unitPrice: 49660, totalPrice: 49660 })]
    const off = computeCartTotals(repriceToFinal, tier, [], [], undefined, pay, ship)
    assert.equal(off.totalDiscount, 2340)
    assert.equal(off.netTotal, 49660)
  })

  it('OFF -> ON reprices to base and creates credit from the SAME items', () => {
    // After the OFF->ON flip the store reprices main items at BASE.
    const repriceToBase = [makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })]
    const on = computeBonusModeTotals(repriceToBase, tier, [], [], undefined, pay, ship)
    assert.equal(on.netTotal, 52000)
    assert.equal(on.bonusCredit, 2340)
  })

  it('mode flip is deterministic (functions are pure — same input, same output)', () => {
    const onItems = [makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })]
    const on1 = computeBonusModeTotals(onItems, tier, [], [], undefined, pay, ship)
    const on2 = computeBonusModeTotals(onItems, tier, [], [], undefined, pay, ship)
    assert.deepEqual(on1, on2)

    const offItems = [makeItem({ baseUnitPrice: 52000, unitPrice: 49660, totalPrice: 49660 })]
    const off1 = computeCartTotals(offItems, tier, [], [], undefined, pay, ship)
    const off2 = computeCartTotals(offItems, tier, [], [], undefined, pay, ship)
    assert.deepEqual(off1, off2)

    // The same base cart is cheaper for the customer under direct discount than in bonus mode.
    assert.ok(on1.netTotal > off1.netTotal)
  })
})

// I: an empty bonus selection is perfectly valid (credit simply unused).
describe('I. No-bonus-products cart remains valid', () => {
  it('unused = full credit, overflow = 0, tier/minimum and item count intact', () => {
    const tier = makeTier({ discountPercent: 2.5, minimumOrderAmount: 40000 })
    const totals = computeBonusModeTotals([makeItem()], tier, [], [], undefined, makePayment(1), makeShipping(1))

    assert.equal(totals.bonusProductsTotal, 0)
    assert.equal(totals.bonusApplied, 0)
    assert.equal(totals.bonusUnused, 2340)
    assert.equal(totals.bonusOverflow, 0)
    assert.equal(totals.netTotal, 52000)
    assert.equal(totals.meetsTierMinimum, true)
    assert.equal(totals.itemCount, 1)
  })
})

// J: 639.60 precision — per-item round2, no whole-EGP rounding (D-O1).
describe('J. 639.60 sub-cent precision', () => {
  const tier = makeTier({ discountPercent: 2 })
  const pay = makePayment(2)
  const ship = makeShipping(0.5)

  it('credit computes to exactly 639.60 and covers an exact 639.60 bonus set', () => {
    const main = makeItem({ baseUnitPrice: 14213.33, unitPrice: 14213.33, totalPrice: 14213.33 })
    const totals = computeBonusModeTotals(
      [main, makeItem({ productId: 'gift', isBonus: true, baseUnitPrice: 639.60, unitPrice: 639.60, totalPrice: 639.60 })],
      tier,
      [],
      [],
      undefined,
      pay,
      ship
    )
    assert.equal(totals.bonusCredit, 639.60)
    assert.equal(totals.bonusApplied, 639.60)
    assert.equal(totals.bonusUnused, 0)
    assert.equal(totals.bonusOverflow, 0)
    assert.equal(totals.netTotal, 14213.33)
  })

  it('item credit is round2 only (never Math.round to whole EGP)', () => {
    const ent = computeBonusCredit([makeItem({ baseUnitPrice: 14213.33, unitPrice: 14213.33, totalPrice: 14213.33 })], tier, pay, ship)
    assert.equal(ent.totalBonusCredit, 639.60)
  })
})

// K: additive wrapper does not disturb OFF when no discount is configured.
describe('K. Zero-discount OFF == Bonus-mode ON totals', () => {
  it('identical net/subtotal when tier/pay/ship discounts are all 0 and no bonus items', () => {
    const items = [makeItem()]
    const tier = makeTier({ discountPercent: 0 })
    const off = computeCartTotals(items, tier)
    const on = computeBonusModeTotals(items, tier)
    assert.equal(off.netTotal, on.netTotal)
    assert.equal(off.subtotal, on.subtotal)
    assert.equal(off.netTotal, 52000)
  })

  it('computeBonusSummary agrees with computeBonusModeTotals on the same cart', () => {
    const items = [makeItem({ baseUnitPrice: 52000, unitPrice: 52000, totalPrice: 52000 })]
    const tier = makeTier({ discountPercent: 4.5 })
    const summary = computeBonusSummary(items, [], tier)
    const totals = computeBonusModeTotals(items, tier)
    assert.equal(totals.bonusCredit, summary.totalBonusCredit)
    assert.equal(totals.bonusUnused, summary.bonusUnused)
    assert.equal(totals.finalPayable ?? totals.netTotal, summary.finalPayable)
  })
})