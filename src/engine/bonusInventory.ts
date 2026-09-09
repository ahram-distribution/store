/**
 * Bonus inventory policy (pure engine boundary, no supabase).
 *
 * Bonus products are REAL physical inventory items: Bonus is a financial
 * entitlement but the stock must comply with the exact same physical-inventory
 * policy as normal products (negative selling is disallowed globally). The
 * authoritative gate is server-side reservation/deduction; this helper is the
 * single client-side decision rule reused by the Bonus catalog, the cart and the
 * order review so Bonus quantities respect governed_check_product_availability_v2
 * exactly like normal products (cap at max_allowed_units, block over-stock,
 * keep prior-reservation visibility).
 */
export interface BonusAvailabilityView {
  available: boolean
  max_allowed_units: number | null
  max_allowed_pieces: number | null
  carton_quantity: number | null
  prior_reservations_exist: boolean
}

export type BonusAvailabilityStatus = 'green' | 'yellow' | 'red' | null

/**
 * Decide whether a Bonus quantity may be added.
 * - null (no result yet / RPC unavailable) → optimistic allow (server stays authoritative).
 * - available true → allow.
 * - available false → block and bound to max_allowed_units (in the SAME selling unit).
 */
export function bonusAddDecision(qty: number, avail: BonusAvailabilityView | null): { allowed: boolean; boundedQty: number } {
  if (!avail || avail.available) return { allowed: true, boundedQty: qty }
  const max = typeof avail.max_allowed_units === 'number' ? Math.max(0, avail.max_allowed_units) : 0
  return { allowed: false, boundedQty: Math.min(qty, max) }
}

/** Business card status for a Bonus availability result (red/yellow/green). */
export function bonusAvailabilityStatus(avail: BonusAvailabilityView | null): BonusAvailabilityStatus {
  if (!avail) return null
  if (!avail.available) return 'red'
  if (avail.prior_reservations_exist) return 'yellow'
  return 'green'
}