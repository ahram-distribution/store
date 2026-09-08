import { applyGeographicAdjustment } from './pricing.ts'

/**
 * Dedicated Bonus/Gift company legacy code ("هدايا و بونص", Phase 1).
 * Its products are Bonus-eligible through companies.bonus_enabled = true;
 * the explicit code check below is defense-in-depth parity with the approved
 * eligibility rule (products.bonus_enabled OR companies.bonus_enabled OR 7000).
 * Products are NEVER physically reassigned into this company.
 */
export const BONUS_GIFT_COMPANY_CODE = '7000'

export interface BonusEligibilityInput {
  bonusEnabled?: boolean
  companyBonusEnabled?: boolean
  companyLegacyCode?: string
}

/**
 * Approved single eligibility predicate (no second system, no exclusion override):
 *   product.bonus_enabled OR company.bonus_enabled OR company legacy code 7000.
 * OR-only, independent of Tier / Payment / Shipping discount exceptions.
 */
export function isProductBonusEligible(p: BonusEligibilityInput): boolean {
  if (p.bonusEnabled === true) return true
  if (p.companyBonusEnabled === true) return true
  return p.companyLegacyCode === BONUS_GIFT_COMPANY_CODE
}

export interface BonusCatalogFilterOptions {
  activeOnly?: boolean
  visibleOnly?: boolean
}

/** Catalog visibility filter (active + visible), additive on top of eligibility. */
export function isBonusCatalogVisible<T extends { isActive?: boolean; isVisible?: boolean }>(
  row: T,
  options: BonusCatalogFilterOptions = {}
): boolean {
  const { activeOnly = true, visibleOnly = true } = options
  if (activeOnly && row.isActive !== true) return false
  if (visibleOnly && row.isVisible !== true) return false
  return true
}

/** Rows eligible AND visible (mirrors get_governed_bonus_products server filter). */
export function filterBonusCatalogRows<T extends BonusEligibilityInput & { isActive?: boolean; isVisible?: boolean }>(
  rows: T[],
  options: BonusCatalogFilterOptions = {}
): T[] {
  return rows.filter((r) => isBonusCatalogVisible(r, options) && isProductBonusEligible(r))
}

export interface BonusCatalogDisplayPrice {
  productId: string
  /** Geo-adjusted BASE unit prices — never discounted. */
  piecePrice: number
  dozenPrice: number
  cartonPrice: number
}

/**
 * Builds the geo-adjusted base unit prices shown in the Bonus catalog exactly
 * like the main storefront: base * (1 + adjustment/100), rounded to 2 decimals.
 */
export function computeBonusCatalogBasePrices(
  products: { id: string; piecePrice: number; dozenPrice: number; cartonPrice: number; geoAdjustPercent?: number }[],
  round: (n: number) => number = (n) => Math.round(n * 100) / 100
): BonusCatalogDisplayPrice[] {
  return products.map((p) => {
    const adj = p.geoAdjustPercent ?? 0
    return {
      productId: p.id,
      piecePrice: round(applyGeographicAdjustment(p.piecePrice, adj)),
      dozenPrice: round(applyGeographicAdjustment(p.dozenPrice, adj)),
      cartonPrice: round(applyGeographicAdjustment(p.cartonPrice, adj)),
    }
  })
}