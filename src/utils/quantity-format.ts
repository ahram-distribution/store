import type { UnitType } from '../types/storefront'

/**
 * Smart mixed-unit quantity formatting (BR-VIS-01 / BR-AUD-01).
 * Breaks `pieces` into whole cartons (cartonQuantity each) + remainder pieces,
 * or dozens + remainder pieces, preferring the caller's selling unit.
 *
 * The remainder is NEVER hidden — even when it is zero — and a unit chosen by
 * the user (piece/dozen/carton) is never converted into another unit:
 *
 *   (1710, 480, 'carton')  -> "3 كرتونة + 270 قطعة"
 *   (505,  480, 'carton')  -> "1 كرتونة + 25 قطعة"
 *   (1920, 480, 'carton')  -> "4 كرتونة + 0 قطعة"
 *   (270,  480, 'dozen')   -> "22 دستة + 6 قطعة"
 *   (270,  480, 'piece')   -> "270 قطعة"
 */
export function formatMixedQuantity(
  pieces: number,
  cartonQuantity?: number | null,
  preferredUnit: UnitType = 'piece'
): string {
  const p = Math.max(0, Math.floor(Number(pieces) || 0))
  const carton = Math.max(0, Math.floor(Number(cartonQuantity) || 0))

  if (p <= 0) return '0 قطعة'

  if (preferredUnit === 'carton' && carton > 0) {
    const whole = Math.floor(p / carton)
    const rem = p % carton
    if (whole > 0) return `${whole} كرتونة + ${rem} قطعة`
    return `${p} قطعة`
  }

  if (preferredUnit === 'dozen') {
    const whole = Math.floor(p / 12)
    const rem = p % 12
    if (whole > 0) return `${whole} دستة + ${rem} قطعة`
    return `${p} قطعة`
  }

  return `${p} قطعة`
}
