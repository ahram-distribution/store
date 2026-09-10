import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDiscountPricingContext,
  resolveExceptionLookup,
  type DiscountOptionsBundle,
} from '../discountResolution.ts'
import {
  computeEffectiveDiscountPercent,
  computeEffectivePaymentDiscountPercent,
  computeEffectiveShippingDiscountPercent,
  computeTotalDiscountPercent,
} from '../pricing.ts'
import { computeItemBonusEntitlement } from '../bonusPricing.ts'
import type {
  TierConfig,
  PaymentMethodOption,
  ShippingMethodOption,
  CartItem,
  TierRecord,
} from '../../types/storefront.ts'

function makeTier(overrides: Partial<TierConfig> = {}): TierConfig {
  return {
    id: '35f28dfa-7924-47f8-ac75-55013d148361',
    name: '٥٠ ألف',
    description: null,
    discountPercent: 0.5,
    minimumOrderAmount: 50_000,
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

function makePay(discountPercent: number, overrides: Partial<PaymentMethodOption> = {}): PaymentMethodOption {
  return {
    id: 'bede2f32',
    name: 'دفع مسبق',
    discountPercent,
    sortOrder: 1,
    isVisible: true,
    isActive: true,
    ...overrides,
  }
}

function makeShip(discountPercent: number, overrides: Partial<ShippingMethodOption> = {}): ShippingMethodOption {
  return {
    id: '5e060c40',
    name: 'استلام من مخزن الشركة',
    discountPercent,
    sortOrder: 1,
    isVisible: true,
    isActive: true,
    ...overrides,
  }
}

function makeBundle(
  tier: TierRecord,
  payments: PaymentMethodOption[],
  shippings: ShippingMethodOption[]
): DiscountOptionsBundle {
  return { tiers: [tier], paymentMethods: payments, shippingMethods: shippings }
}

function makeTierRecord(tier: TierConfig, productExceptions: Array<{ productId: string; discountPercent: number; appliesToAllTiers: boolean }>, companyExceptions: Array<{ companyId: string; discountPercent: number }> = []): TierRecord {
  return {
    ...tier,
    companyExceptions: companyExceptions.map((ce, i) => ({ id: `ce${i}`, companyId: ce.companyId, companyName: 'co', discountPercent: ce.discountPercent })),
    productExceptions: productExceptions.map((pe, i) => ({ id: `pe${i}`, productId: pe.productId, productName: 'p', discountPercent: pe.discountPercent, appliesToAllTiers: pe.appliesToAllTiers })),
  }
}

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 'e76d3446-495e-4996-9251-219f06bb01d9',
    productName: 'T',
    unitType: 'carton',
    unitQuantity: 10,
    pieceQuantity: 120,
    baseUnitPrice: 960,
    unitPrice: 960,
    totalPrice: 9600,
    companyId: '90d8078c-1ecf-4d63-a582-74f3856cc4e0',
    companyName: 'co',
    ...overrides,
  }
}

const TIER = makeTier()
const PAY = makePay(1)
const SHIP = makeShip(1)
const PRODUCT_ID = 'e76d3446-495e-4996-9251-219f06bb01d9'
const OTHER_PRODUCT = 'other-product-id'
const COMPANY_ID = '90d8078c-1ecf-4d63-a582-74f3856cc4e0'

// ---------------------------------------------------------------------------
// SERVER PARITY — all-tiers vs selected-tier precedence + explicit 0
// ---------------------------------------------------------------------------
describe('SERVER PARITY — all-tiers beats selected-tier, deterministically', () => {
  it('all-tiers exception wins over selected-tier, both array orders', () => {
    const specificFirst = makeTierRecord(TIER, [
      { productId: PRODUCT_ID, discountPercent: 0, appliesToAllTiers: false },
      { productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: true },
    ])
    const allFirst = makeTierRecord(TIER, [
      { productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: true },
      { productId: PRODUCT_ID, discountPercent: 0, appliesToAllTiers: false },
    ])
    const ctxA = buildDiscountPricingContext(makeBundle(specificFirst, [PAY], [SHIP]))
    const ctxB = buildDiscountPricingContext(makeBundle(allFirst, [PAY], [SHIP]))
    assert.equal(resolveExceptionLookup(ctxA, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)?.productException, 5)
    assert.equal(resolveExceptionLookup(ctxB, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)?.productException, 5)
  })

  it('explicit 0% selected-tier exception is preserved — no all-tiers row exists', () => {
    const tier = makeTierRecord(TIER, [{ productId: PRODUCT_ID, discountPercent: 0, appliesToAllTiers: false }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(lk?.productException, 0)
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 0)
  })

  it('NO cross-product leak — product A all-tiers never leaks into product B', () => {
    const tier = makeTierRecord(TIER, [{ productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: true }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    // product B has no exceptions → resolves its tier default, NOT product A's 5
    const lkB = resolveExceptionLookup(ctx, TIER, PAY, SHIP, OTHER_PRODUCT, COMPANY_ID)
    assert.equal(lkB?.productException, null)
    assert.equal(computeEffectiveDiscountPercent(TIER, lkB), 0.5)
  })

  it('deterministic across a shuffled exception array', () => {
    const list = [
      { productId: PRODUCT_ID, discountPercent: 0, appliesToAllTiers: false },
      { productId: OTHER_PRODUCT, discountPercent: 2, appliesToAllTiers: true },
      { productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: true },
    ]
    const a = buildDiscountPricingContext(makeBundle(makeTierRecord(TIER, list), [PAY], [SHIP]))
    const b = buildDiscountPricingContext(makeBundle(makeTierRecord(TIER, [...list].reverse()), [PAY], [SHIP]))
    assert.deepEqual(a, b)
  })
})

// ---------------------------------------------------------------------------
// PRECEDENCE — product > company > default; replace, never add
// ---------------------------------------------------------------------------
describe('PRECEDENCE — product > company > option global', () => {
  it('product override wins over company override and default', () => {
    const tier = makeTierRecord(TIER, [{ productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: false }], [{ companyId: COMPANY_ID, discountPercent: 1.5 }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 5)
  })

  it('company override applies when no product override', () => {
    const tier = makeTierRecord(TIER, [], [{ companyId: COMPANY_ID, discountPercent: 1.5 }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 1.5)
    // another company falls back to the tier default
    const lkOther = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, 'other-company')
    assert.equal(computeEffectiveDiscountPercent(TIER, lkOther), 0.5)
  })

  it('override REPLACES the default (5+1+1=7), never adds (0.5+5+1+1)', () => {
    const tier = makeTierRecord(TIER, [{ productId: PRODUCT_ID, discountPercent: 5, appliesToAllTiers: false }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lk), 7)
  })
})

// ---------------------------------------------------------------------------
// PAYMENT / SHIPPING groups — independent overrides, no cross-group leakage
// ---------------------------------------------------------------------------
describe('PAYMENT / SHIPPING — independent override groups', () => {
  it('payment product override resolves independently (pay 0, ship 0→1)', () => {
    const pay = makePay(1, { productExceptions: [{ id: 'pe', productId: PRODUCT_ID, productName: 'p', discountPercent: 0 }] })
    const ctx = buildDiscountPricingContext(makeBundle(makeTierRecord(TIER, []), [pay], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, pay, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeEffectivePaymentDiscountPercent(pay, lk), 0)
    assert.equal(computeEffectiveShippingDiscountPercent(SHIP, lk), 1)
    assert.equal(computeTotalDiscountPercent(TIER, pay, SHIP, lk), 0.5 + 0 + 1)
  })

  it('shipping company override resolves independently and never bleeds into tier', () => {
    const ship = makeShip(1, { companyExceptions: [{ id: 'se', companyId: COMPANY_ID, companyName: 'co', discountPercent: 3 }] })
    const ctx = buildDiscountPricingContext(makeBundle(makeTierRecord(TIER, []), [PAY], [ship]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, ship, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeEffectiveShippingDiscountPercent(ship, lk), 3)
    assert.equal(computeEffectivePaymentDiscountPercent(PAY, lk), 1)
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 0.5)
  })
})

// ---------------------------------------------------------------------------
// LIVE REGRESSION — صبغة باليت: 0% product exception must win on reloads too
// ---------------------------------------------------------------------------
describe('LIVE REGRESSION — صبغة باليت 10 cartons (base 9600)', () => {
  it('with the 0% product exception loaded: tier 0% + pay 1% + ship 1% = 2% → 192, NEVER 240', () => {
    const tier = makeTierRecord(TIER, [{ productId: PRODUCT_ID, discountPercent: 0, appliesToAllTiers: false }])
    const ctx = buildDiscountPricingContext(makeBundle(tier, [PAY], [SHIP]))
    const lk = resolveExceptionLookup(ctx, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(computeEffectiveDiscountPercent(TIER, lk), 0)
    assert.equal(computeTotalDiscountPercent(TIER, PAY, SHIP, lk), 2)
    const item = makeItem()
    const ent = computeItemBonusEntitlement(item, TIER, PAY, SHIP, lk)
    assert.equal(ent.tierPercent, 0)
    assert.equal(ent.paymentPercent, 1)
    assert.equal(ent.shippingPercent, 1)
    assert.equal(ent.combinedPercent, 2)
    assert.equal(ent.credit, 192)
  })

  it('the REGRESSION path — no loaded context (lookup null) leaks the tier DEFAULT 0.5% → 240', () => {
    // documents WHY the store must ALWAYS load the context (auto-loader + realtime):
    // the resolver cannot guess overrides it was never given.
    const lk = resolveExceptionLookup(null, TIER, PAY, SHIP, PRODUCT_ID, COMPANY_ID)
    assert.equal(lk, null)
    const item = makeItem()
    const ent = computeItemBonusEntitlement(item, TIER, PAY, SHIP, null)
    assert.equal(ent.tierPercent, 0.5)
    assert.equal(ent.combinedPercent, 2.5)
    assert.equal(ent.credit, 240)
  })
})