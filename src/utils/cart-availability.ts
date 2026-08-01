import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import type { UnitType } from '../types/storefront'
import { UNIT_LABELS } from '../types/order-display'
import { formatMixedQuantity } from './quantity-format'

export interface AvailabilityResult {
  available: boolean
  error: string | null
  max_allowed_units: number | null
  max_allowed_pieces: number | null
  carton_quantity: number | null
  unit_type: UnitType
}

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

/**
 * Unit-aware availability guidance (BR-VIS-01).
 * Calls governed_check_product_availability_v2 — the approved RPC that reads the
 * global negative-selling policy and returns max_allowed_units in the SAME selling
 * unit the user selected (floor whole units) plus max_allowed_pieces (full usable
 * pieces) and carton_quantity for mixed-unit messaging. It never exposes raw
 * inventory/reservation numbers to sales reps.
 */
export async function checkProductAvailabilityV2(
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  const token = getSessionToken()
  const { data } = await supabase.rpc('governed_check_product_availability_v2', {
    p_product_id: productId,
    p_requested_quantity: unitQuantity,
    p_unit_type: unitType,
    p_token: token,
  })
  if (data && typeof data === 'object') {
    return {
      available: data.available !== false,
      error: typeof data.error === 'string' ? data.error : null,
      max_allowed_units: typeof data.max_allowed_units === 'number' ? data.max_allowed_units : null,
      max_allowed_pieces: typeof data.max_allowed_pieces === 'number' ? data.max_allowed_pieces : null,
      carton_quantity: typeof data.carton_quantity === 'number' ? data.carton_quantity : null,
      unit_type: (data.unit_type as UnitType) || unitType,
    }
  }
  return {
    available: true,
    error: null,
    max_allowed_units: null,
    max_allowed_pieces: null,
    carton_quantity: null,
    unit_type: unitType,
  }
}

export async function checkCartAvailability(
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  if (unitQuantity <= 0) {
    return { available: true, error: null, max_allowed_units: null, max_allowed_pieces: null, carton_quantity: null, unit_type: unitType }
  }
  return checkProductAvailabilityV2(productId, unitQuantity, unitType)
}

/**
 * Approved business wording for over-quantity guidance, always in the selling unit
 * the user selected (BR-VIS-01): rep sees the maximum allowed as full usable mixed
 * units (e.g. "3 كرتونة + 270 قطعة") — never raw stock/reservation numbers.
 */
export function buildAvailabilityMessage(result: AvailabilityResult): string {
  if (result.max_allowed_pieces !== null) {
    if (result.max_allowed_pieces <= 0) {
      return 'الكمية المطلوبة غير متاحة حاليًا بوحدة البيع المحددة، برجاء تقليل الكمية'
    }
    const maxLabel = formatMixedQuantity(result.max_allowed_pieces, result.carton_quantity, result.unit_type)
    return `الكمية المطلوبة غير متاحة حاليًا — الحد الأقصى المسموح به في هذه الفاتورة هو: ${maxLabel}`
  }
  if (result.max_allowed_units !== null) {
    if (result.max_allowed_units <= 0) {
      return 'الكمية المطلوبة غير متاحة حاليًا بوحدة البيع المحددة، برجاء تقليل الكمية'
    }
    const unitLabel = UNIT_LABELS[result.unit_type] || 'قطعة'
    return `الكمية المطلوبة غير متاحة حاليًا — الحد الأقصى المسموح به ${result.max_allowed_units} ${unitLabel}`
  }
  return 'الكمية المطلوبة غير متاحة حاليًا، برجاء تقليل الكمية'
}

export function showUnavailableToast(result: AvailabilityResult) {
  toast.error(buildAvailabilityMessage(result))
}

/**
 * Approved reservation-notice wording (BR-RS-03/05): the order is ACCEPTED but the
 * rep is told a previous reservation exists and quantities may be auto-adjusted at
 * approval. Shown after a successful submit when the RPC returns reservations_notice.
 */
export const RESERVATION_NOTICE_TEXT =
  'هناك فاتورة أخرى قامت بحجز كمية من هذا الصنف ولم يتم اعتمادها بعد. سيتم قبول طلبك. قد يتم تعديل الكمية تلقائيًا عند اعتماد الفواتير حسب أولوية التقديم.'

export function hasReservationNotices(submitData: unknown): boolean {
  const data = submitData as { reservations_notice?: unknown } | null
  return Array.isArray(data?.reservations_notice) && data.reservations_notice.length > 0
}

export function showReservationNotice(submitData: unknown) {
  if (!hasReservationNotices(submitData)) return
  toast(RESERVATION_NOTICE_TEXT, { icon: '🟡', duration: 8000 })
}
