import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bonusAddDecision,
  bonusAvailabilityStatus,
  type BonusAvailabilityView,
} from '../bonusInventory.ts'

/**
 * Bonus Inventory Policy (task: Bonus products comply with the EXISTING physical
 * inventory policy — no separate Bonus stock, no is_bonus bypass).
 *
 * The authoritative gate is the server reservation/deduction engine; these tests
 * pin the pure CLIENT decision shared by BonusCatalogPage, CartPage and
 * OrderReviewPage so Bonus quantities are governed by the same
 * governed_check_product_availability_v2 result as normal products:
 *   - over-stock is blocked and bounded to max_allowed_units (same selling unit)
 *   - zero stock blocks entirely
 *   - within-stock and no-result requests are allowed
 *   - prior reservations are visible (yellow) but never block
 */

function avail(partial: Partial<BonusAvailabilityView> = {}): BonusAvailabilityView {
  return {
    available: true,
    max_allowed_units: null,
    max_allowed_pieces: null,
    carton_quantity: null,
    prior_reservations_exist: false,
    ...partial,
  }
}

describe('bonusAddDecision', () => {
  it('allows quantity within stock (no result yet / RPC unavailable is optimistic)', () => {
    assert.deepEqual(bonusAddDecision(3, null), { allowed: true, boundedQty: 3 })
    assert.deepEqual(bonusAddDecision(3, avail({ available: true })), { allowed: true, boundedQty: 3 })
  })

  it('blocks over-stock and bounds to max_allowed_units in the same selling unit', () => {
    const result = bonusAddDecision(11, avail({ available: false, max_allowed_units: 10 }))
    assert.deepEqual(result, { allowed: false, boundedQty: 10 })
  })

  it('blocks entirely at zero stock', () => {
    assert.deepEqual(bonusAddDecision(1, avail({ available: false, max_allowed_units: 0 })), { allowed: false, boundedQty: 0 })
  })

  it('blocks when the RPC gives no max (hard unavailable)', () => {
    assert.deepEqual(bonusAddDecision(1, avail({ available: false, max_allowed_units: null })), { allowed: false, boundedQty: 0 })
  })

  it('does not increase the bounded quantity above the requested one', () => {
    assert.deepEqual(bonusAddDecision(4, avail({ available: false, max_allowed_units: 10 })), { allowed: false, boundedQty: 4 })
  })

  it('never returns a negative bound', () => {
    assert.deepEqual(bonusAddDecision(2, avail({ available: false, max_allowed_units: -1 })), { allowed: false, boundedQty: 0 })
  })
})

describe('bonusAvailabilityStatus', () => {
  it('maps unavailable to red', () => {
    assert.equal(bonusAvailabilityStatus(avail({ available: false })), 'red')
  })

  it('maps prior reservations to yellow even when available', () => {
    assert.equal(bonusAvailabilityStatus(avail({ available: true, prior_reservations_exist: true })), 'yellow')
  })

  it('maps fully available to green', () => {
    assert.equal(bonusAvailabilityStatus(avail({ available: true })), 'green')
  })

  it('maps no result to null (no card)', () => {
    assert.equal(bonusAvailabilityStatus(null), null)
  })
})