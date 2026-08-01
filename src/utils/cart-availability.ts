import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { computePieceQuantity } from '../engine/pricing'
import type { UnitType } from '../types/storefront'
import { UNIT_LABELS } from '../types/order-display'

export interface AvailabilityResult {
  available: boolean
  error: string | null
  max_allowed_units: number | null
  unit_type: UnitType
}

function getSessionToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

/**
 * Unit-aware availability guidance (BR-VIS-01).
 * Calls governed_check_product_availability_v2 — the approved RPC that reads the
 * global negative-selling policy and computes max_allowed_units in the SAME selling
 * unit the user selected (floor whole units). It never exposes raw inventory/reservation
 * numbers to sales reps.
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
      unit_type: (data.unit_type as UnitType) || unitType,
    }
  }
  return { available: true, error: null, max_allowed_units: null, unit_type: unitType }
}

export async function checkCartAvailability(
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  if (unitQuantity <= 0) return { available: true, error: null, max_allowed_units: null, unit_type: unitType }
  return checkProductAvailabilityV2(productId, unitQuantity, unitType)
}

/**
 * Approved business wording for over-quantity guidance, always in the selling unit
 * the user selected (BR-VIS-01): rep sees only availability + the maximum allowed
 * whole units of his chosen unit — never raw stock/reservation numbers.
 */
export function buildAvailabilityMessage(result: AvailabilityResult): string {
  const unitLabel = UNIT_LABELS[result.unit_type] || 'قطعة'
  if (result.max_allowed_units !== null) {
    if (result.max_allowed_units <= 0) {
      return 'الكمية المطلوبة غير متاحة حاليًا بوحدة البيع المحددة، برجاء تقليل الكمية'
    }
    return `الكمية المطلوبة غير متاحة حاليًا — الحد الأقصى المسموح به ${result.max_allowed_units} ${unitLabel}`
  }
  return 'الكمية المطلوبة غير متاحة حاليًا، برجاء تقليل الكمية'
}

export function showUnavailableToast(result: AvailabilityResult) {
  toast.error(buildAvailabilityMessage(result))
}

/**
 * Approved business wording for a submission/edit rejection (reservations_rejected):
 * each rejected line shows the max allowed in the SAME selling unit the user selected
 * (BR-VIS-01) — never raw inventory/reservation numbers. Shared by the storefront
 * submit path and the order edit paths.
 */
export function buildOverQuantityRejectionMessage(
  rejected: any[],
  items: Array<{ product_id: string; product_name?: string | null; unit_type?: string | null }>,
  products: Array<{ id: string; productName?: string; cartonQuantity?: number }>
): string | null {
  if (!Array.isArray(rejected) || rejected.length === 0) return null
  const lines = rejected.slice(0, 3).map((r) => {
    const productId = String(r.product_id ?? '')
    const item = items.find((i) => i.product_id === productId)
    const product = products.find((p) => p.id === productId)
    const unitType = (item?.unit_type as UnitType) ?? 'piece'
    const piecesPerUnit = computePieceQuantity(1, unitType, product?.cartonQuantity ?? 0)
    const capacity = Number(r.available_capacity ?? 0)
    const maxUnits = piecesPerUnit > 0 ? Math.floor(capacity / piecesPerUnit) : 0
    const name = product?.productName || item?.product_name || 'منتج'
    return `${name}: الحد الأقصى المسموح ${maxUnits} ${UNIT_LABELS[unitType] || 'قطعة'}`
  })
  return `تعذر إرسال الطلب — الكمية المطلوبة تتجاوز الكمية المتاحة: ${lines.join('، ')}`
}
