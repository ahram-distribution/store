import type { UnitType } from '../types/storefront'

/**
 * Smart mixed-unit quantity formatting (BR-VIS-01 / BR-AUD-01).
 * Breaks `pieces` into whole cartons (cartonQuantity each) + remainder pieces,
 * or dozens + remainder pieces, preferring the caller's selling unit.
 *
 * Examples:
 *   (1080, 270)             -> "4 كرتونة"
 *   (295, 270)              -> "1 كرتونة + 25 قطعة"
 *   (295, 270, 'carton')    -> "1 كرتونة + 25 قطعة"
 *   (30, 270, 'dozen')      -> "2 دستة + 6 قطعة"
 *   (25, null)              -> "25 قطعة"
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
    if (whole > 0) return rem > 0 ? `${whole} كرتونة + ${rem} قطعة` : `${whole} كرتونة`
    return `${rem} قطعة`
  }

  if (preferredUnit === 'dozen') {
    const whole = Math.floor(p / 12)
    const rem = p % 12
    if (whole > 0) return rem > 0 ? `${whole} دستة + ${rem} قطعة` : `${whole} دستة`
    return `${rem} قطعة`
  }

  if (carton > 0 && p >= carton) {
    const whole = Math.floor(p / carton)
    const rem = p % carton
    if (whole > 0) return rem > 0 ? `${whole} كرتونة + ${rem} قطعة` : `${whole} كرتونة`
  }

  return `${p} قطعة`
}
