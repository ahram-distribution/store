/*
 * ============================================================================
 * ORDER DISPLAY DATA v4 — Live-then-Snapshot Architecture
 * ============================================================================
 * Single source of truth for all order display contexts:
 * - UI (order detail, order list, طلباتي)
 * - WhatsApp text message
 * - PDF document
 *
 * RULE: Orders before delivery (status ≠ 'delivered') show LIVE customer data.
 *       Orders at/after delivery (status = 'delivered') show SNAPSHOT data.
 * ============================================================================
 */

export interface OrderCustomerData {
  id: string
  name: string
  phone: string
  code: string
  address: string
  mapsUrl: string
  responsibleName: string
}

export interface OrderPersonData {
  id: string
  name: string
  phone: string
  address: string
}

export interface OrderDisplayItem {
  id: string
  productId: string
  productName: string
  legacyCode: string
  imageUrl: string | null
  companyName: string
  unitType: string
  unitLabel: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface OrderLocationData {
  latitude: number
  longitude: number
  accuracy: number
  mapsUrl: string
  capturedAt: string
}

export interface OrderDisplayData {
  orderId: string
  orderNumber: string
  status: string
  statusLabel: string
  docType: 'order' | 'invoice'
  createdAt: string

  customer: OrderCustomerData
  owner: OrderPersonData | null
  creator: OrderPersonData
  creatorType: string

  items: OrderDisplayItem[]
  itemCount: number
  totalQuantity: number
  totalAmount: number

  executionLocation: OrderLocationData | null

  notes: string
  tierName: string
  paymentMethod: string
  orderType: string
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  submitted: 'طلب شراء',
  approved: 'معتمد',
  reviewing: 'تم القيد بالسيستم',
  preparing: 'قيد التجهيز',
  prepared: 'تم التجهيز',
  delivered: 'تم التسليم',
  returned_for_revision: 'معاد للتعديل',
  cancelled: 'ملغى',
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  credit: 'آجل',
  ittiman: 'ائتمان',
}

export const ORDER_TYPE_BADGE_CLASSES: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  credit: 'bg-purple-100 text-purple-700',
  ittiman: 'bg-blue-100 text-blue-700',
}

export function orderTypeLabel(type?: string | null): string {
  return (type && ORDER_TYPE_LABELS[type]) || 'نقدي'
}

export function orderTypeBadgeClass(type?: string | null): string {
  return (type && ORDER_TYPE_BADGE_CLASSES[type]) || 'bg-emerald-100 text-emerald-700'
}

export const UNIT_LABELS: Record<string, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

/**
 * Execution State Group (BR-EXEC-01): once an order enters this group its
 * quantities are finalized. Availability/inventory guidance (shortage warnings,
 * reservation status, business status cards) is PRE-EXECUTION ONLY and must
 * never appear on orders inside this group.
 * "تم القيد بالسيستم" (reviewing) is an INITIAL / PRE-EXECUTION status and is
 * NOT part of this group; the first execution state is "معتمد" (approved).
 */
export const EXECUTION_GROUP: ReadonlySet<string> = new Set([
  'approved',
  'preparing',
  'prepared',
  'delivered',
])

/**
 * The 7 approved user-facing statuses, in the exact order used by every
 * user-facing Order status filter and status display ordering, for EVERY user
 * (normal users and Upper Management alike). No fallback mapping to any of
 * these exists: an order always shows the REAL label of its technical status.
 */
export const USER_FACING_STATUS_ORDER: readonly string[] = [
  'submitted',
  'reviewing',
  'approved',
  'preparing',
  'prepared',
  'delivered',
  'returned_for_revision',
  'cancelled',
]

/**
 * Remaining internal operational statuses. They are NOT user-facing filter
 * options; they appear ONLY in Upper Management views and ONLY after "ملغى"
 * (see UPPER_MANAGEMENT_STATUS_ORDER). draft is intentionally not included.
 */
export const OPERATIONAL_STATUS_ORDER: readonly string[] = []

/**
 * Upper Management full status sequence: the 7 user-facing statuses first,
 * followed by the remaining operational statuses after "ملغى".
 * draft is never part of any user-facing status list/filter/control.
 */
export const UPPER_MANAGEMENT_STATUS_ORDER: readonly string[] = [
  ...USER_FACING_STATUS_ORDER,
  ...OPERATIONAL_STATUS_ORDER,
]

/** Effective Arabic status label shown in the UI (real label, no fallback mapping). */
export function visibleStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] || status || ''
}

export interface StatusFilterOption {
  value: string
  label: string
}

/**
 * Status filter/selector options.
 * - Normal users: exactly the 7 user-facing statuses.
 * - Upper Management: the same 7 first, then the remaining operational
 *   statuses after "ملغى". draft is never offered.
 */
export function statusFilterOptions(isUpperManagement = false): StatusFilterOption[] {
  const order = isUpperManagement ? UPPER_MANAGEMENT_STATUS_ORDER : USER_FACING_STATUS_ORDER
  return [
    { value: '', label: 'كل الحالات' },
    ...order.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] || s })),
  ]
}

/** Display order for status summaries (KPI chips) — same role rule as filters. */
export function statusDisplayOrder(isUpperManagement = false): readonly string[] {
  return isUpperManagement ? UPPER_MANAGEMENT_STATUS_ORDER : USER_FACING_STATUS_ORDER
}

/**
 * Build a unified OrderDisplayData.
 * When status ≠ 'delivered', uses live customer data (from UnifiedCustomerSummary).
 * When status = 'delivered', uses frozen snapshot data.
 */
function val(v: unknown, fallback = ''): string {
  if (v == null || v === '') return fallback
  return String(v)
}

function pick(o: any, keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

function liveAddr(c: any): string {
  if (!c) return ''
  const parts = [c.governorate, c.city, c.address_line1, c.address_line2].filter(Boolean)
  return parts.join(' - ')
}

export function buildOrderDisplayData(params: {
  order: any
  items: any[]
  liveCustomer?: any
}): OrderDisplayData {
  const o = params.order || {}
  const itemList = params.items || []
  const lc = params.liveCustomer
  const useLive = o.status !== 'delivered' && lc

  const docType = (o.status === 'submitted' || o.status === 'reviewing') ? 'order' : 'invoice'

  const customer: OrderCustomerData = {
    id: useLive ? val(lc.id) : val(o.snapshot_customer_id),
    name: useLive ? val(lc.company_name) : val(o.snapshot_customer_name),
    phone: useLive ? val(lc.phone) : val(o.snapshot_customer_phone),
    code: useLive ? val(lc.code) : val(o.snapshot_customer_code),
    address: useLive ? liveAddr(lc) : val(o.snapshot_customer_address),
    mapsUrl: '',
    responsibleName: useLive ? '' : val(o.responsible_name),
  }

  // Fallback chain: snapshot → live computed (from get_unified_order) → empty
  const ownerName = pick(o, ['owner_name', 'snapshot_owner_name', 'customer_owner_name'])
  const owner: OrderPersonData | null = ownerName
    ? {
        id: pick(o, ['owner_id', 'snapshot_owner_id', 'customer_owner_id']),
        name: ownerName,
        phone: pick(o, ['owner_phone', 'snapshot_owner_phone', 'customer_owner_phone']),
        address: pick(o, ['owner_address', 'snapshot_owner_address', 'customer_owner_address']),
      }
    : null

  const creatorType = o.owner_type === 'customer'
    ? 'عميل'
    : (o.created_by_id ?? o.order_creator_id) === o.owner_id ? 'مندوب مبيعات' : 'موظف'

  const creator: OrderPersonData = {
    id: pick(o, ['created_by', 'snapshot_sender_id', 'order_creator_id']),
    name: pick(o, ['created_by_name', 'snapshot_sender_name', 'order_creator_name']),
    phone: pick(o, ['created_by_phone', 'snapshot_sender_phone', 'order_creator_phone']),
    address: pick(o, ['created_by_address', 'snapshot_sender_address', 'order_creator_address']),
  }

  const items: OrderDisplayItem[] = itemList.map((i: any) => {
    const qty = Number(i.unit_quantity || 1)
    const price = Number(i.unit_price || 0)
    const isDozen = i.unit_type === 'dozen'
    return {
      id: i.id,
      productId: i.product_id,
      productName: i.product_name || i.products?.product_name || '',
      legacyCode: i.legacy_code || i.products?.legacy_code || '',
      imageUrl: i.image_url || i.products?.image_url || null,
      companyName: i.company_name || i.products?.companies?.company_name || '',
      unitType: i.unit_type || '',
      unitLabel: i.unit_type === 'dozen' ? UNIT_LABELS.piece : UNIT_LABELS[i.unit_type] || i.unit_type || 'قطعة',
      quantity: isDozen ? qty * 12 : qty,
      unitPrice: isDozen ? price / 12 : price,
      totalPrice: qty * price,
    }
  })

  const grandTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const totalQty = items.reduce((s, i) => s + i.quantity, 0)

  let executionLocation: OrderLocationData | null = null
  const execLat = Number(o.execution_latitude)
  const execLng = Number(o.execution_longitude)
  if (execLat && execLng) {
    executionLocation = {
      latitude: execLat,
      longitude: execLng,
      accuracy: Number(o.execution_accuracy_meters || 0),
      mapsUrl: 'https://maps.google.com/?q=' + execLat + ',' + execLng,
      capturedAt: o.execution_captured_at || '',
    }
  }

  return {
    orderId: o.id,
    orderNumber: o.order_number || '',
    status: o.status || '',
    statusLabel: visibleStatusLabel(o.status || ''),
    docType,
    createdAt: o.created_at || '',

    customer,
    owner,
    creator,
    creatorType,

    items,
    itemCount: items.length,
    totalQuantity: totalQty,
    totalAmount: Number(o.total_amount || grandTotal),

    executionLocation,

    notes: o.notes || '',
    tierName: o.tier_name || '',
    paymentMethod: o.payment_method || '',
    orderType: o.order_type || 'cash',
  }
}
