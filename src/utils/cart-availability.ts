import { supabase } from '../lib/supabase'
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
  prior_reservations_exist: boolean
  expected_executable_pieces: number | null
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
 *
 * p_exclude_order_id (Phase B — Order Details) excludes the order being viewed
 * from "earlier orders", so a submitted order does not count its own reservation
 * as a prior reservation. Same single engine + centralized formatter.
 */
async function runAvailabilityRpc(
  productId: string,
  unitQuantity: number,
  unitType: UnitType,
  excludeOrderId?: string | null
): Promise<AvailabilityResult> {
  const token = getSessionToken()
  const { data } = await supabase.rpc('governed_check_product_availability_v2', {
    p_product_id: productId,
    p_requested_quantity: unitQuantity,
    p_unit_type: unitType,
    p_token: token,
    p_exclude_order_id: excludeOrderId ?? null,
  })
  if (data && typeof data === 'object') {
    return {
      available: data.available !== false,
      error: typeof data.error === 'string' ? data.error : null,
      max_allowed_units: typeof data.max_allowed_units === 'number' ? data.max_allowed_units : null,
      max_allowed_pieces: typeof data.max_allowed_pieces === 'number' ? data.max_allowed_pieces : null,
      carton_quantity: typeof data.carton_quantity === 'number' ? data.carton_quantity : null,
      unit_type: (data.unit_type as UnitType) || unitType,
      prior_reservations_exist: data.prior_reservations_exist === true,
      expected_executable_pieces: typeof data.expected_executable_pieces === 'number' ? data.expected_executable_pieces : null,
    }
  }
  return {
    available: true,
    error: null,
    max_allowed_units: null,
    max_allowed_pieces: null,
    carton_quantity: null,
    unit_type: unitType,
    prior_reservations_exist: false,
    expected_executable_pieces: null,
  }
}

export async function checkProductAvailabilityV2(
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  return runAvailabilityRpc(productId, unitQuantity, unitType, null)
}

/**
 * Order Details (Phase B): availability for an EXISTING order item — the viewed
 * order is excluded from "earlier orders" so its own submitted reservation does
 * not turn the card YELLOW. Same engine + formatter, never blocks.
 */
export async function checkOrderItemAvailability(
  orderId: string,
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  return runAvailabilityRpc(productId, unitQuantity, unitType, orderId)
}

export async function checkCartAvailability(
  productId: string,
  unitQuantity: number,
  unitType: UnitType
): Promise<AvailabilityResult> {
  if (unitQuantity <= 0) {
    return { available: true, error: null, max_allowed_units: null, max_allowed_pieces: null, carton_quantity: null, unit_type: unitType, prior_reservations_exist: false, expected_executable_pieces: null }
  }
  return runAvailabilityRpc(productId, unitQuantity, unitType, null)
}

/**
 * Business Status Card data (Rev 5 — frozen wording, ONE unified business language).
 * Answers the single question under the buy button: "what happens to the quantity I chose?"
 *
 *   GREEN  🟢  the quantity will be fully executed — no earlier orders for the product.
 *   YELLOW 🟡  the order is ACCEPTED, never blocked; earlier orders exist, so the card
 *              shows the expected executable quantity if those are approved first
 *              (same single calculation engine — Rule 1).
 *   RED    🔴  the quantity exceeds physical stock — cannot be added; the card shows the
 *              maximum allowed in the invoice only.
 *
 * Never exposes raw stock/reservation numbers (BR-VIS-01) — only smart mixed units.
 */
export type BusinessStatus = 'green' | 'yellow' | 'red'

export interface BusinessStatusCardData {
  status: BusinessStatus | null
  verdict: string
  detail?: string
  lead?: string
  chipLabel?: string
  /** Order Details context (BR-AUD-01): product + requested + expected executable. */
  productName?: string
  requestedLabel?: string
  executableLabel?: string
}

export interface BusinessCardContext {
  productName?: string
  requestedPieces?: number | null
}

const GREEN_LINE = 'سيتم تنفيذ هذه الكمية بالكامل.'
const YELLOW_VERDICT = 'سيتم قبول طلبك.'
const YELLOW_DETAIL = 'يوجد طلبات سابقة لهذا الصنف لم يتم اعتمادها بعد.'
const YELLOW_LEAD = 'إذا تم اعتماد الطلبات السابقة أولاً، فسيكون المتاح لتنفيذ طلبك:'
const RED_VERDICT = 'لا يمكن إضافة هذه الكمية.'
const RED_ORDER_ITEM_VERDICT = 'الكمية المطلوبة لهذا الصنف تتجاوز الكمية المتاحة حاليًا.'
const RED_LEAD = 'الحد الأقصى المسموح به في هذه الفاتورة هو:'

/**
 * Order Details context enrichment (BR-AUD-01): every reservation-related card
 * must state the product, the requested quantity and the expected executable
 * quantity — all via the Smart Quantity Formatter, never raw numbers.
 */
function orderItemFields(result: AvailabilityResult, context?: BusinessCardContext): Partial<BusinessStatusCardData> {
  if (!context || (context.productName == null && context.requestedPieces == null)) return {}
  const fields: Partial<BusinessStatusCardData> = {}
  if (context.productName) fields.productName = context.productName
  if (context.requestedPieces != null) {
    fields.requestedLabel = formatMixedQuantity(context.requestedPieces, result.carton_quantity, result.unit_type)
  }
  return fields
}

export function buildBusinessStatusCard(result: AvailabilityResult, context?: BusinessCardContext): BusinessStatusCardData {
  if (result.available === false) {
    const chipLabel =
      result.max_allowed_pieces !== null
        ? formatMixedQuantity(result.max_allowed_pieces, result.carton_quantity, result.unit_type)
        : result.max_allowed_units !== null
          ? `${result.max_allowed_units} ${UNIT_LABELS[result.unit_type] || 'قطعة'}`
          : undefined
    const isOrderItem = Boolean(context?.productName)
    return {
      status: 'red',
      verdict: isOrderItem ? RED_ORDER_ITEM_VERDICT : RED_VERDICT,
      lead: isOrderItem ? undefined : RED_LEAD,
      chipLabel: isOrderItem ? undefined : chipLabel,
      ...orderItemFields(result, context),
      executableLabel:
        context?.requestedPieces != null && result.expected_executable_pieces != null
          ? formatMixedQuantity(result.expected_executable_pieces, result.carton_quantity, result.unit_type)
          : context?.requestedPieces != null
            ? '0 قطعة'
            : undefined,
    }
  }
  if (result.prior_reservations_exist) {
    const isOrderItem = Boolean(context?.productName)
    const chipLabel =
      result.expected_executable_pieces !== null && !isOrderItem
        ? formatMixedQuantity(result.expected_executable_pieces, result.carton_quantity, result.unit_type)
        : undefined
    const fields = orderItemFields(result, context)
    if (context?.requestedPieces != null && result.expected_executable_pieces != null) {
      fields.executableLabel = formatMixedQuantity(result.expected_executable_pieces, result.carton_quantity, result.unit_type)
    }
    return {
      status: 'yellow',
      verdict: YELLOW_VERDICT,
      detail: isOrderItem ? undefined : YELLOW_DETAIL,
      lead: isOrderItem ? undefined : YELLOW_LEAD,
      chipLabel,
      ...fields,
    }
  }
  const fields = orderItemFields(result, context)
  if (context?.requestedPieces != null) {
    fields.executableLabel = formatMixedQuantity(context.requestedPieces, result.carton_quantity, result.unit_type)
  }
  return { status: 'green', verdict: GREEN_LINE, ...fields }
}

/**
 * Approved reservation-notice wording (BR-RS-03/05): the order is ACCEPTED but the
 * rep is told a previous reservation exists and quantities may be auto-adjusted at
 * approval. Shown after a successful submit when the RPC returns reservations_notice.
 */
