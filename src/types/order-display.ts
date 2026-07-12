/*
 * ============================================================================
 * ORDER DISPLAY DATA v3 — Snapshot Architecture
 * ============================================================================
 * Single source of truth for all order display contexts:
 * - UI (order detail, order list, طلباتي)
 * - WhatsApp text message
 * - PDF document
 *
 * DATA SOURCE: Snapshot columns on orders table only
 * ============================================================================
 * جميع البيانات تقرأ من Snapshot المأخوذ وقت إنشاء الطلب.
 * ممنوع الرجوع إلى customers, employees, identities, customer_addresses,
 * unified_locations في أي شاشة عرض أو رسالة أو PDF أو تقرير.
 *
 * اسم العميل     → orders.snapshot_customer_name                            ✅
 * هاتف العميل    → orders.snapshot_customer_phone                           ✅
 * كود العميل     → orders.snapshot_customer_code                            ✅
 * عنوان العميل   → orders.snapshot_customer_address                         ✅
 *
 * اسم المسؤول    → orders.snapshot_owner_name                               ✅
 * هاتف المسؤول   → orders.snapshot_owner_phone                              ✅
 * عنوان المسؤول  → orders.snapshot_owner_address                            ✅
 *
 * اسم مرسل الطلب → orders.snapshot_sender_name                              ✅
 * هاتف مرسل الطلب → orders.snapshot_sender_phone                            ✅
 * عنوان مرسل الطلب → orders.snapshot_sender_address                         ✅
 *
 * رقم الطلب      → orders.order_number                                       ✅
 * الحالة         → orders.status                                             ✅
 * التاريخ        → orders.created_at                                         ✅
 * الأصناف        → order_items + products + companies                        ✅
 * الإجمالي       → orders.total_amount                                       ✅
 * موقع التنفيذ   → orders.execution_latitude/longitude/accuracy/captured_at  ✅
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

export const UNIT_LABELS: Record<string, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

/**
 * Build a unified OrderDisplayData from snapshot data only.
 * Pure transformer — reads from order RPC result (which contains snapshot fields).
 * ممنوع تمرير customer/owner/creator منفصلين — كلها مقروءة من Snapshot.
 */
function snapshotVal(o: any, keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

export function buildOrderDisplayData(params: {
  order: any
  items: any[]
}): OrderDisplayData {
  const o = params.order || {}
  const itemList = params.items || []

  const docType = (o.status === 'submitted' || o.status === 'reviewing') ? 'order' : 'invoice'

  const customer: OrderCustomerData = {
    id: snapshotVal(o, ['customer_id', 'snapshot_customer_id']),
    name: snapshotVal(o, ['customer_name', 'snapshot_customer_name']),
    phone: snapshotVal(o, ['customer_phone', 'snapshot_customer_phone']),
    code: snapshotVal(o, ['customer_code', 'snapshot_customer_code']),
    address: snapshotVal(o, ['customer_address', 'snapshot_customer_address']),
    mapsUrl: snapshotVal(o, ['customer_maps_url', '']),
    responsibleName: snapshotVal(o, ['responsible_name', '']),
  }

  // Fallback chain: snapshot → live computed (from get_unified_order) → empty
  const ownerName = snapshotVal(o, ['owner_name', 'snapshot_owner_name', 'customer_owner_name'])
  const owner: OrderPersonData | null = ownerName
    ? {
        id: snapshotVal(o, ['owner_id', 'snapshot_owner_id', 'customer_owner_id']),
        name: ownerName,
        phone: snapshotVal(o, ['owner_phone', 'snapshot_owner_phone', 'customer_owner_phone']),
        address: snapshotVal(o, ['owner_address', 'snapshot_owner_address', 'customer_owner_address']),
      }
    : null

  const creatorType = o.owner_type === 'customer'
    ? 'عميل'
    : o.created_by === o.owner_id ? 'مندوب مبيعات' : 'موظف'

  const creator: OrderPersonData = {
    id: snapshotVal(o, ['created_by', 'snapshot_sender_id', 'order_creator_id']),
    name: snapshotVal(o, ['created_by_name', 'snapshot_sender_name', 'order_creator_name']),
    phone: snapshotVal(o, ['created_by_phone', 'snapshot_sender_phone', 'order_creator_phone']),
    address: snapshotVal(o, ['created_by_address', 'snapshot_sender_address', 'order_creator_address']),
  }

  const items: OrderDisplayItem[] = itemList.map((i: any) => {
    const qty = Number(i.unit_quantity || 1)
    const price = Number(i.unit_price || 0)
    return {
      id: i.id,
      productId: i.product_id,
      productName: i.product_name || i.products?.product_name || '',
      legacyCode: i.legacy_code || i.products?.legacy_code || '',
      imageUrl: i.image_url || i.products?.image_url || null,
      companyName: i.company_name || i.products?.companies?.company_name || '',
      unitType: i.unit_type || '',
      unitLabel: UNIT_LABELS[i.unit_type] || i.unit_type || 'قطعة',
      quantity: qty,
      unitPrice: price,
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
    statusLabel: ORDER_STATUS_LABELS[o.status] || o.status || '',
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
