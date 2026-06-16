/* ============================
   SYSTEM STATE ARCHITECTURE
   ============================
   Every module must define:
   - States (ACTIVE/CLOSED, etc.)
   - Rules (which states allow calculations)
   - Normalizer (raw DB → typed state)
   - Validator (state × operation → boolean)
*/

// ─── Core Types ───────────────────────────────────────────
export interface StateModel<S extends string> {
  state: S
  allowCalc: boolean
}

export function createStateGuard<S extends string>(
  state: S | null | undefined,
  calcStates: S[],
): StateModel<S> {
  if (!state) return { state: null as unknown as S, allowCalc: false }
  return {
    state,
    allowCalc: calcStates.includes(state),
  }
}

// ─── 1. ATTENDANCE ────────────────────────────────────────
export const ATTENDANCE_STATES = {
  ACTIVE: 'ACTIVE' as const,
  CLOSED: 'CLOSED' as const,
} as const
export type AttendanceState = (typeof ATTENDANCE_STATES)[keyof typeof ATTENDANCE_STATES]

export const ATTENDANCE_CALC_STATES: AttendanceState[] = [ATTENDANCE_STATES.CLOSED]

export function getAttendanceState(endTime?: string | null): AttendanceState {
  return endTime ? ATTENDANCE_STATES.CLOSED : ATTENDANCE_STATES.ACTIVE
}

export function guardAttendanceState(endTime?: string | null): StateModel<AttendanceState> {
  return createStateGuard(getAttendanceState(endTime), ATTENDANCE_CALC_STATES)
}

// ─── 2. ORDERS ────────────────────────────────────────────
export const ORDER_STATES = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  REVIEWING: 'reviewing',
  RETURNED: 'returned_for_revision',
  APPROVED: 'approved',
  PREPARING: 'preparing',
  PREPARED: 'prepared',
  READY_FOR_DISPATCH: 'ready_for_dispatch',
  SENT_TO_DELIVERY: 'sent_to_delivery',
  DEFERRED: 'deferred',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const
export type OrderState = (typeof ORDER_STATES)[keyof typeof ORDER_STATES]

export const ORDER_CALC_STATES: OrderState[] = [
  ORDER_STATES.APPROVED,
  ORDER_STATES.PREPARING,
  ORDER_STATES.PREPARED,
  ORDER_STATES.DISPATCHED,
  ORDER_STATES.DELIVERED,
]

export const ORDER_ACTIVE_STATES: OrderState[] = [
  ORDER_STATES.DRAFT,
  ORDER_STATES.SUBMITTED,
  ORDER_STATES.REVIEWING,
  ORDER_STATES.RETURNED,
  ORDER_STATES.APPROVED,
  ORDER_STATES.PREPARING,
  ORDER_STATES.PREPARED,
  ORDER_STATES.READY_FOR_DISPATCH,
  ORDER_STATES.SENT_TO_DELIVERY,
  ORDER_STATES.DEFERRED,
  ORDER_STATES.DISPATCHED,
]

export function getOrderState(status?: string | null): OrderState {
  const s = status as OrderState
  if (s && Object.values(ORDER_STATES).includes(s)) return s
  return ORDER_STATES.DRAFT
}

export function guardOrderState(status?: string | null): StateModel<OrderState> {
  return createStateGuard(getOrderState(status), ORDER_CALC_STATES)
}

export function isOrderActive(status?: string | null): boolean {
  return ORDER_ACTIVE_STATES.includes(getOrderState(status))
}

export function isOrderCancelled(status?: string | null): boolean {
  return getOrderState(status) === ORDER_STATES.CANCELLED
}

export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  draft: 'مسودة',
  submitted: 'مقدم',
  reviewing: 'قيد المراجعة',
  returned_for_revision: 'معاد للتعديل',
  approved: 'معتمد',
  preparing: 'قيد التجهيز',
  prepared: 'تم التجهيز',
  ready_for_dispatch: 'بانتظار القرار',
  sent_to_delivery: 'أرسل للتوصيل',
  deferred: 'مؤجل',
  dispatched: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

export function getOrderStateLabel(status?: string | null): string {
  return ORDER_STATE_LABELS[getOrderState(status)] || status || 'غير معروف'
}

// ─── 3. CUSTOMERS ─────────────────────────────────────────
export const CUSTOMER_STATES = {
  COMPLETE: 'complete' as const,
  PARTIAL: 'partial' as const,
  BLOCKED: 'blocked' as const,
  NEW: 'new' as const,
} as const
export type CustomerState = (typeof CUSTOMER_STATES)[keyof typeof CUSTOMER_STATES]

export const CUSTOMER_CALC_STATES: CustomerState[] = [
  CUSTOMER_STATES.COMPLETE,
  CUSTOMER_STATES.PARTIAL,
]

export function getCustomerState(isActive: boolean | null | undefined, lastOrderDays?: number | null): CustomerState {
  if (isActive === false) return CUSTOMER_STATES.BLOCKED
  if (lastOrderDays == null) return CUSTOMER_STATES.NEW
  if (lastOrderDays <= 30) return CUSTOMER_STATES.COMPLETE
  if (lastOrderDays <= 60) return CUSTOMER_STATES.PARTIAL
  return CUSTOMER_STATES.BLOCKED
}

export function guardCustomerState(
  isActive: boolean | null | undefined,
  lastOrderDays?: number | null,
): StateModel<CustomerState> {
  return createStateGuard(getCustomerState(isActive, lastOrderDays), CUSTOMER_CALC_STATES)
}

export const CUSTOMER_STATE_LABELS: Record<CustomerState, string> = {
  complete: 'نشط',
  partial: 'يحتاج متابعة',
  blocked: 'متوقف',
  new: 'جديد',
}

export function getCustomerStateLabel(state: CustomerState): string {
  return CUSTOMER_STATE_LABELS[state] || 'غير معروف'
}

// ─── 4. INVENTORY / PRODUCTS ──────────────────────────────
export const INVENTORY_STATES = {
  AVAILABLE: 'available' as const,
  LOW_STOCK: 'low_stock' as const,
  OUT_OF_STOCK: 'out_of_stock' as const,
  UNKNOWN: 'unknown' as const,
} as const
export type InventoryState = (typeof INVENTORY_STATES)[keyof typeof INVENTORY_STATES]

export const INVENTORY_CALC_STATES: InventoryState[] = [
  INVENTORY_STATES.AVAILABLE,
  INVENTORY_STATES.LOW_STOCK,
]

export function getInventoryState(quantity: number | null | undefined, isActive: boolean | null | undefined): InventoryState {
  if (!isActive) return INVENTORY_STATES.UNKNOWN
  if (quantity == null) return INVENTORY_STATES.UNKNOWN
  if (quantity <= 0) return INVENTORY_STATES.OUT_OF_STOCK
  if (quantity < 10) return INVENTORY_STATES.LOW_STOCK
  return INVENTORY_STATES.AVAILABLE
}

export function guardInventoryState(
  quantity: number | null | undefined,
  isActive: boolean | null | undefined,
): StateModel<InventoryState> {
  return createStateGuard(getInventoryState(quantity, isActive), INVENTORY_CALC_STATES)
}

export const INVENTORY_STATE_LABELS: Record<InventoryState, string> = {
  available: 'متوفر',
  low_stock: 'مخزون منخفض',
  out_of_stock: 'غير متوفر',
  unknown: 'غير معروف',
}

export function getInventoryStateLabel(state: InventoryState): string {
  return INVENTORY_STATE_LABELS[state] || 'غير معروف'
}

// ─── 5. GPS / TRACKING ────────────────────────────────────
export const TRACKING_STATES = {
  ACTIVE_TRACKING: 'active_tracking' as const,
  IDLE: 'idle' as const,
  DISABLED: 'disabled' as const,
  ERROR: 'error' as const,
} as const
export type TrackingState = (typeof TRACKING_STATES)[keyof typeof TRACKING_STATES]

export function getTrackingState(
  running: boolean | null | undefined,
  gpsAvailable: boolean | null | undefined,
): TrackingState {
  if (!running) return TRACKING_STATES.IDLE
  if (!gpsAvailable) return TRACKING_STATES.ERROR
  return TRACKING_STATES.ACTIVE_TRACKING
}

export const TRACKING_STATE_LABELS: Record<TrackingState, string> = {
  active_tracking: 'تتبع نشط',
  idle: 'خامل',
  disabled: 'معطل',
  error: 'خطأ',
}

// ─── 6. VISITS ────────────────────────────────────────────
export const VISIT_STATES = {
  ACTIVE: 'active' as const,
  COMPLETED: 'completed' as const,
  CANCELLED: 'cancelled' as const,
} as const
export type VisitState = (typeof VISIT_STATES)[keyof typeof VISIT_STATES]

export const VISIT_CALC_STATES: VisitState[] = [VISIT_STATES.COMPLETED]

export function getVisitState(status?: string | null): VisitState {
  const s = status as VisitState
  if (Object.values(VISIT_STATES).includes(s)) return s
  return VISIT_STATES.CANCELLED
}

export function guardVisitState(status?: string | null): StateModel<VisitState> {
  return createStateGuard(getVisitState(status), VISIT_CALC_STATES)
}

export const VISIT_STATE_LABELS: Record<VisitState, string> = {
  active: 'نشط',
  completed: 'مكتمل',
  cancelled: 'ملغي',
}

// ─── GENERIC SAFE ACCESSOR ────────────────────────────────
export function safeValue<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback
}

export function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number' && isFinite(value)) return value
  const n = Number(value)
  return isFinite(n) ? n : fallback
}
