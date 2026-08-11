import { formatCurrencyShort } from '../../utils/format'
import { locationService } from '../../services/location'

export function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

/**
 * Journey display order. `customer_not_found` is an alternative to
 * `arrived_at_customer` (the arrival step) and maps to the same slot.
 */
export const DELIVERY_STEP_ORDER = ['received', 'moving_to_customer', 'arrived_at_customer', 'collected', 'returned_to_company'] as const
export type DeliveryStep = (typeof DELIVERY_STEP_ORDER)[number]

export const DELIVERY_ARRIVAL_OUTCOMES = ['arrived_at_customer', 'customer_not_found'] as const

export const DELIVERY_STEP_LABELS: Record<string, string> = {
  received: 'استلام الشحنة',
  moving_to_customer: 'بدء التحرك من الشركة',
  arrived_at_customer: 'تم الوصول للعميل',
  customer_not_found: 'لم يتم العثور على العميل',
  collected: 'تم التحصيل',
  returned_to_company: 'تم الرجوع لمقر الشركة',
}

export function deliveryStepLabel(step: string | null | undefined): string {
  if (!step) return 'بانتظار الاستلام'
  return DELIVERY_STEP_LABELS[step] || step
}

export function deliveryStepIndex(step: string | null | undefined): number {
  if (!step) return -1
  if (step === 'customer_not_found') return DELIVERY_STEP_ORDER.indexOf('arrived_at_customer')
  const i = DELIVERY_STEP_ORDER.indexOf(step as DeliveryStep)
  return i
}

export function isDeliveryCompleted(step: string | null | undefined): boolean {
  return step === 'returned_to_company'
}

/**
 * The operational action the employee must perform next (null = journey done).
 * Mirrors the sequence enforced in governed_delivery_action.
 */
export function nextDeliveryAction(
  step: string | null | undefined,
  collectionRequired: boolean | null | undefined,
): string | null {
  if (!step) return 'received'
  switch (step) {
    case 'received': return 'moving_to_customer'
    case 'moving_to_customer': return 'arrived_at_customer'
    case 'arrived_at_customer': return collectionRequired === false ? 'returned_to_company' : 'collected'
    case 'customer_not_found': return 'returned_to_company'
    case 'collected': return 'returned_to_company'
    case 'returned_to_company': return null
    default: return null
  }
}

export const DELIVERY_STEP_DOTS: Record<string, string> = {
  need_crew: 'bg-gray-300',
  received: 'bg-blue-400',
  moving_to_customer: 'bg-amber-400',
  arrived_at_customer: 'bg-violet-500',
  customer_not_found: 'bg-red-400',
  collected: 'bg-emerald-500',
  returned_to_company: 'bg-gray-400',
}

export const DELIVERY_STEP_CHIPS: Record<string, { chip: string; active: string }> = {
  need_crew: {
    chip: 'bg-gray-50 border-gray-200 text-gray-500',
    active: 'bg-gray-100 border-gray-400 text-gray-800 ring-1 ring-gray-200',
  },
  received: {
    chip: 'bg-blue-50 border-blue-100 text-blue-600',
    active: 'bg-blue-100 border-blue-300 text-blue-700 ring-1 ring-blue-200',
  },
  moving_to_customer: {
    chip: 'bg-amber-50 border-amber-100 text-amber-600',
    active: 'bg-amber-100 border-amber-300 text-amber-700 ring-1 ring-amber-200',
  },
  arrived_at_customer: {
    chip: 'bg-violet-50 border-violet-100 text-violet-600',
    active: 'bg-violet-100 border-violet-300 text-violet-700 ring-1 ring-violet-200',
  },
  customer_not_found: {
    chip: 'bg-red-50 border-red-100 text-red-600',
    active: 'bg-red-100 border-red-300 text-red-700 ring-1 ring-red-200',
  },
  collected: {
    chip: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    active: 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200',
  },
  returned_to_company: {
    chip: 'bg-gray-50 border-gray-200 text-gray-500',
    active: 'bg-gray-100 border-gray-400 text-gray-700 ring-1 ring-gray-200',
  },
}

export function stepChipStyles(step: string | null | undefined): { dot: string; chip: string; active: string } {
  const key = step || 'need_crew'
  return {
    dot: DELIVERY_STEP_DOTS[key] || DELIVERY_STEP_DOTS.need_crew,
    chip: DELIVERY_STEP_CHIPS[key]?.chip || DELIVERY_STEP_CHIPS.need_crew.chip,
    active: DELIVERY_STEP_CHIPS[key]?.active || DELIVERY_STEP_CHIPS.need_crew.active,
  }
}

export function fmtAmount(v: string | number | null | undefined): string {
  return formatCurrencyShort(Number(v || 0))
}

/* ============================ JOURNEY MODEL ============================ */

export type JourneyStatus = 'assigned' | 'in_progress' | 'returned'

export const JOURNEY_STATUS_LABELS: Record<string, string> = {
  assigned: 'لم تبدأ',
  in_progress: 'جارية',
  returned: 'تم الرجوع',
}

export function journeyStatusLabel(status: string | null | undefined): string {
  if (!status) return '--'
  return JOURNEY_STATUS_LABELS[status] || status
}

export function isJourneyReturned(status: string | null | undefined): boolean {
  return status === 'returned'
}

export function isJourneyActive(status: string | null | undefined): boolean {
  return status === 'assigned' || status === 'in_progress'
}

/**
 * Per-order step order inside a journey. The journey itself owns استلام الشحنة
 * and الرجوع لمقر الشركة; an order runs تحرك -> وصول -> نتيجة -> تحصيل.
 */
export const JOURNEY_ORDER_STEP_ORDER = ['moving_to_customer', 'arrived_at_customer', 'collected'] as const

/**
 * The next per-order action inside a journey (null = order done). Mirrors the
 * journey branch of governed_delivery_action.
 */
export function nextJourneyOrderAction(
  step: string | null | undefined,
  collectionRequired: boolean | null | undefined,
): string | null {
  if (!step) return 'moving_to_customer'
  switch (step) {
    case 'moving_to_customer': return 'arrived_at_customer'
    case 'arrived_at_customer': return 'collected'
    case 'customer_not_found': return null
    case 'collected': return null
    default: return null
  }
}

export function isJourneyOrderDone(step: string | null | undefined): boolean {
  return step === 'collected' || step === 'customer_not_found'
}

export interface JourneyCollection {
  id: string
  status: string
  amount: string | number
  collected_at: string | null
  approved_at: string | null
}

export interface JourneyOrder {
  delivery_id: string
  order_id: string
  order_number: string
  order_status: string
  customer_name: string
  customer_phone: string
  customer_address: string
  customer_latitude: string | null
  customer_longitude: string | null
  total_amount: string | number
  payment_method: string
  invoice_number: string | null
  invoice_total: string | number | null
  owner_name: string
  owner_phone: string
  items_count: number
  delivery_status: string
  delivery_step: string | null
  collection_required: boolean | null
  collection_amount: string | number | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  returned_at: string | null
  rep_name: string | null
  driver_name: string | null
  is_rep: boolean
  is_driver: boolean
  collected_amount: string | number | null
  collection: JourneyCollection | null
  actions: Array<{
    action: string
    employee_id?: string
    employee_name: string
    amount?: string | number | null
    latitude: string | null
    longitude: string | null
    captured_at: string | null
    created_at: string | null
  }>
}

export interface JourneyEvent {
  action: string
  employee_id?: string
  employee_name: string
  order_number?: string | null
  amount?: string | number | null
  latitude?: string | null
  longitude?: string | null
  captured_at: string | null
  created_at: string | null
}

export interface DeliveryJourneyItem {
  journey_id: string
  journey_code: string | null
  status: JourneyStatus
  is_virtual: boolean
  rep_name: string | null
  driver_name: string | null
  assigned_at: string | null
  started_at: string | null
  returned_at: string | null
  can_manage?: boolean
  orders: JourneyOrder[]
  totals: {
    orders_count: number
    total_value: string | number
    total_collected: string | number
    total_collection_required?: string | number
  }
  events: JourneyEvent[]
}

export function fmtTime(v: string | null | undefined): string {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function hasCoords(lat: string | number | null | undefined, lng: string | number | null | undefined): boolean {
  const a = Number(lat); const b = Number(lng)
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0
}

/**
 * Human-readable distance: meters for short distances, kilometers for longer.
 */
export function formatDistanceHuman(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '--'
  if (meters < 1000) return `${Math.round(meters)} متر`
  const km = meters / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} كم`
}

export interface JourneySegment {
  action: string
  hasCoords: boolean
  isFirst: boolean
  distanceMeters: number | null
}

export interface JourneyDistanceResult {
  segments: JourneySegment[]
  totalMeters: number
}

/**
 * Computes the traveled distance between consecutive recorded action locations
 * (haversine over the actual GPS coordinates) and the total journey distance.
 * Actions without a valid location do not contribute; a location-bearing action
 * is measured against the previous recorded location-bearing action.
 */
export function computeJourneyDistances(
  actions: Array<{ action: string; latitude?: string | number | null; longitude?: string | number | null }>,
): JourneyDistanceResult {
  let prevLat: number | null = null
  let prevLng: number | null = null
  let hasPrevious = false
  let total = 0
  const segments = (actions || []).map((a) => {
    const has = hasCoords(a.latitude, a.longitude)
    let distance: number | null = null
    let isFirst = false
    if (has) {
      const lat = Number(a.latitude)
      const lng = Number(a.longitude)
      if (hasPrevious && prevLat !== null && prevLng !== null) {
        distance = locationService.haversineDistance(prevLat, prevLng, lat, lng)
        total += distance
      } else {
        isFirst = true
      }
      prevLat = lat
      prevLng = lng
      hasPrevious = true
    }
    return { action: a.action, hasCoords: has, isFirst, distanceMeters: distance }
  })
  return { segments, totalMeters: total }
}
