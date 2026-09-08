import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BONUS_GIFT_COMPANY_CODE,
  filterBonusCatalogRows,
  isProductBonusEligible,
  isBonusCatalogVisible,
  computeBonusCatalogBasePrices,
} from '../bonusEligibility.ts'

/**
 * Bonus Tiers — Phase 4: Bonus eligibility + Bonus catalog contracts.
 *
 * A  Product-level flag alone makes a product eligible (company irrelevant).
 * B  Company-level flag alone makes EVERY product of that company eligible.
 * C  Dedicated Bonus company (legacy 7000) is eligible regardless of flags.
 * D  No flags + not 7000 ⇒ not eligible (eligible is opt-in only).
 * E  Disabling the company flag removes eligibility UNLESS the product flag
 *    independently earns it (OR-only, no exclusion override).
 * F  Catalog filter = active + visible + eligible (mirrors the server RPC).
 * G  Geo-adjusted catalog base prices — base * (1 + adj/100), 2 decimals only.
 */

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    productName: 'P',
    isActive: true,
    isVisible: true,
    bonusEnabled: false,
    companyBonusEnabled: false,
    companyLegacyCode: '1000',
    ...overrides,
  }
}

describe('Phase 4 — isProductBonusEligible', () => {
  it('A: product-level flag alone makes a product eligible', () => {
    assert.equal(isProductBonusEligible(row({ bonusEnabled: true, companyBonusEnabled: false, companyLegacyCode: '1000' })), true)
    assert.equal(isProductBonusEligible(row({ bonusEnabled: true, companyBonusEnabled: true, companyLegacyCode: '1000' })), true)
  })

  it('B: company-level flag alone makes every company product eligible', () => {
    assert.equal(isProductBonusEligible(row({ companyBonusEnabled: true })), true)
  })

  it('C: dedicated Bonus company (legacy 7000) is eligible regardless of flags', () => {
    assert.equal(isProductBonusEligible(row({ companyLegacyCode: BONUS_GIFT_COMPANY_CODE })), true)
    assert.equal(isProductBonusEligible(row({ companyLegacyCode: BONUS_GIFT_COMPANY_CODE, bonusEnabled: false })), true)
  })

  it('D: no flags and not 7000 ⇒ not eligible', () => {
    assert.equal(isProductBonusEligible(row({})), false)
    assert.equal(isProductBonusEligible(row({ companyLegacyCode: undefined })), false)
  })

  it('E: disabling the company flag removes eligibility unless the product flag independently earns it', () => {
    const viaCompany = row({ companyBonusEnabled: true })
    const viaCompanyOnly = { ...viaCompany, companyBonusEnabled: false }
    assert.equal(isProductBonusEligible(viaCompany), true)
    assert.equal(isProductBonusEligible(viaCompanyOnly), false)
    assert.equal(isProductBonusEligible({ ...viaCompanyOnly, bonusEnabled: true }), true)
  })

  it('OR-only separation: product flag is independent of company flag', () => {
    const withBoth = row({ bonusEnabled: true, companyBonusEnabled: true })
    assert.equal(isProductBonusEligible({ ...withBoth, companyBonusEnabled: undefined }), true)
    assert.equal(isProductBonusEligible({ ...withBoth, bonusEnabled: undefined }), true)
  })
})

describe('Phase 4 — isBonusCatalogVisible / filterBonusCatalogRows', () => {
  it('F1: active + visible + eligible rows pass by default', () => {
    const rows = [
      row({ id: 'a', bonusEnabled: true }),
      row({ id: 'b', companyBonusEnabled: true }),
      row({ id: 'c', companyLegacyCode: '7000' }),
    ]
    const out = filterBonusCatalogRows(rows)
    assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'c'])
  })

  it('F2: inactive products are excluded from the catalog', () => {
    const out = filterBonusCatalogRows([
      row({ id: 'a', isActive: false, bonusEnabled: true }),
      row({ id: 'b', isActive: true, bonusEnabled: true }),
    ])
    assert.deepEqual(out.map((r) => r.id), ['b'])
  })

  it('F3: hidden products are excluded from the catalog', () => {
    const out = filterBonusCatalogRows([
      row({ id: 'a', isVisible: false, bonusEnabled: true }),
      row({ id: 'b', isVisible: true, bonusEnabled: true }),
    ])
    assert.deepEqual(out.map((r) => r.id), ['b'])
  })

  it('F4: ineligible products never appear even when active + visible', () => {
    const out = filterBonusCatalogRows([
      row({ id: 'a', bonusEnabled: false, companyBonusEnabled: false, companyLegacyCode: '1000' }),
    ])
    assert.deepEqual(out, [])
  })

  it('F5: filter options can turn off active/visible checks', () => {
    const hidden = row({ id: 'a', isVisible: false, bonusEnabled: true })
    assert.equal(isBonusCatalogVisible(hidden), false)
    assert.equal(isBonusCatalogVisible(hidden, { visibleOnly: false }), true)
  })
})

describe('Phase 4 — computeBonusCatalogBasePrices', () => {
  it('G1: geo adjustment applied to base unit prices', () => {
    const out = computeBonusCatalogBasePrices([
      { id: 'p1', piecePrice: 100, dozenPrice: 1100, cartonPrice: 12000, geoAdjustPercent: 10 },
    ])
    assert.equal(out[0].piecePrice, 110)
    assert.equal(out[0].dozenPrice, 1210)
    assert.equal(out[0].cartonPrice, 13200)
  })

  it('G2: no adjustment default keeps base prices intact', () => {
    const out = computeBonusCatalogBasePrices([{ id: 'p1', piecePrice: 100, dozenPrice: 1100, cartonPrice: 12000 }])
    assert.equal(out[0].piecePrice, 100)
    assert.equal(out[0].dozenPrice, 1100)
    assert.equal(out[0].cartonPrice, 12000)
  })

  it('G3: rounding stays at 2 decimals, never whole EGP', () => {
    const out = computeBonusCatalogBasePrices([{ id: 'p1', piecePrice: 99.99, dozenPrice: 1100, cartonPrice: 12000, geoAdjustPercent: 7.5 }])
    assert.equal(out[0].piecePrice, 107.49)
    assert.equal(out[0].piecePrice % 1 !== 0, true)
  })
})