import { ORDER_STATUS_LABELS, UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrder, UnifiedCustomerSummary, UnifiedModificationEntry, UnifiedOrderItem, OrderEventLogItem } from '../../types/unified-order'

const SYSTEM_REASON_LABELS: Record<string, string> = {
  'Order created': 'تم إنشاء الطلب',
}

const ITEM_CHANGE_LABELS: Record<string, string> = {
  added: 'إضافة صنف',
  removed: 'حذف صنف',
  quantity_changed: 'تعديل كمية صنف',
}

export interface ItemChange {
  product_id: string
  product_name: string
  product_code: string | null
  unit_name: string
  action: 'added' | 'removed' | 'quantity_changed'
  old_qty?: number
  new_qty?: number
}

export interface TimelineEvent {
  id: string
  label: string
  timestamp: string
  color: 'green' | 'blue' | 'yellow' | 'orange' | 'red'
  actor?: string
  reason?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  referenceNumber?: string | null
  itemChanges?: ItemChange[]
}

export function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (!then) return ''
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'الآن'
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  const diffDays = Math.floor(diffHours / 24)
  return `منذ ${diffDays} يوم`
}

export function getCurrentOwner(data: UnifiedOrder): string {
  const { status } = data.order
  const delivery = data.current_delivery
  switch (status) {
    case 'draft': return 'المسودة — لا يوجد مسؤول'
    case 'submitted': return 'بانتظار مدير البيع'
    case 'reviewing': return 'مدير البيع'
    case 'returned_for_revision': return 'مندوب المبيعات'
    case 'approved': return 'بانتظار المخزن'
    case 'preparing': return 'المخزن'
    case 'prepared': return 'بانتظار مدير البيع (قرار التسليم)'
    case 'delivered': return 'تم التسليم'
    case 'cancelled': return 'ملغى'
    default: return status
  }
}

export function getFullAddress(customer: UnifiedCustomerSummary | null, order?: { snapshot_customer_address?: string | null }): string {
  if (!customer && !order?.snapshot_customer_address) return ''
  const parts = [customer?.governorate, customer?.city, customer?.address_line1].filter(Boolean)
  if (parts.length > 0) return parts.join(' - ')
  return order?.snapshot_customer_address || ''
}

function computeItemChanges(m: UnifiedModificationEntry, items: UnifiedOrderItem[]): ItemChange[] {
  const productMap: Record<string, UnifiedOrderItem> = {}
  for (const it of items) productMap[it.product_id] = it
  const changes: ItemChange[] = []
  const oldItems: Record<string, any> = {}
  const newItems: Record<string, any> = {}
  if (Array.isArray(m.old_order_items)) for (const item of m.old_order_items) oldItems[item.product_id] = item
  if (Array.isArray(m.new_order_items)) for (const item of m.new_order_items) newItems[item.product_id] = item
  const allIds = new Set([...Object.keys(oldItems), ...Object.keys(newItems)])
  for (const pid of allIds) {
    const oldItem = oldItems[pid]
    const newItem = newItems[pid]
    const cur = productMap[pid]
    const product_name = cur?.product_name || newItem?.product_name || oldItem?.product_name || 'منتج'
    const product_code = cur?.legacy_code || newItem?.legacy_code || oldItem?.legacy_code || null
    const unit_type = cur?.unit_type || oldItem?.unit_type || newItem?.unit_type || 'piece'
    const unit_name = UNIT_LABELS[unit_type] || unit_type
    if (oldItem && !newItem) {
      changes.push({ product_id: pid, product_name, product_code, unit_name, action: 'removed', old_qty: Number(oldItem.unit_quantity || 0) })
    } else if (!oldItem && newItem) {
      changes.push({ product_id: pid, product_name, product_code, unit_name, action: 'added', new_qty: Number(newItem.unit_quantity || 0) })
    } else if (oldItem && newItem && Number(oldItem.unit_quantity || 0) !== Number(newItem.unit_quantity || 0)) {
      changes.push({
        product_id: pid, product_name, product_code, unit_name, action: 'quantity_changed',
        old_qty: Number(oldItem.unit_quantity || 0), new_qty: Number(newItem.unit_quantity || 0),
      })
    }
  }
  return changes
}

function getEditLabel(field_name: string, changes: ItemChange[]): string {
  if (field_name === 'REVISION_SNAPSHOT') return 'إعادة الطلب للتعديل'
  if (field_name === 'supreme_edit') return 'تم تحرير الطلب'
  if (field_name === 'content_replacement') return 'تم تحرير الطلب'
  return 'تم تعديل الطلب'
}

function getItemsSummary(changes: ItemChange[]): string {
  const added = changes.filter(c => c.action === 'added').length
  const removed = changes.filter(c => c.action === 'removed').length
  const changed = changes.filter(c => c.action === 'quantity_changed').length
  const parts: string[] = []
  if (added > 0) parts.push(`إضافة ${added} صنف`)
  if (removed > 0) parts.push(`حذف ${removed} صنف`)
  if (changed > 0) parts.push(`تعديل ${changed} صنف`)
  return parts.join('، ')
}

export function buildTimelineEvents(data: UnifiedOrder): TimelineEvent[] {
  const events: TimelineEvent[] = []

  events.push({
    id: 'created',
    label: 'إنشاء الطلب',
    timestamp: data.order.created_at,
    color: 'green',
    actor: data.order.order_creator_name || undefined,
  })

  for (const h of data.status_history) {
    const toLabel = ORDER_STATUS_LABELS[h.to_status] || h.to_status
    const fromLabel = h.from_status ? (ORDER_STATUS_LABELS[h.from_status] || h.from_status) : null
    const systemLabel = h.reason ? SYSTEM_REASON_LABELS[h.reason] : undefined
    events.push({
      id: `status-${h.id}`,
      label: fromLabel ? `تغيير الحالة من "${fromLabel}" إلى "${toLabel}"` : toLabel,
      timestamp: h.changed_at,
      color: h.to_status === 'cancelled' ? 'red' : h.to_status === 'delivered' ? 'green' : 'blue',
      actor: h.changed_by_name || undefined,
      reason: systemLabel || h.reason,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      referenceNumber: h.to_status === 'reviewing' ? h.reference_number : null,
    })
  }

  if (data.preparation?.started_at) {
    events.push({
      id: 'prep-start',
      label: 'بدء التجهيز',
      timestamp: data.preparation.started_at,
      color: 'yellow',
    })
  }
  if (data.preparation?.completed_at) {
    events.push({
      id: 'prep-complete',
      label: 'اكتمال التجهيز',
      timestamp: data.preparation.completed_at,
      color: 'blue',
    })
  }

  for (const d of data.delivery_history) {
    if (d.assigned_at) {
      events.push({
        id: `del-assign-${d.id}`,
        label: `إسناد التوصيل (محاولة #${d.attempt_number})`,
        timestamp: d.assigned_at,
        color: 'blue',
        actor: d.assigned_to_name || undefined,
      })
    }
    if (d.started_at) {
      events.push({
        id: `del-start-${d.id}`,
        label: `الخروج للتوصيل (محاولة #${d.attempt_number})`,
        timestamp: d.started_at,
        color: 'yellow',
        actor: d.assigned_to_name || undefined,
      })
    }
    if (d.completed_at) {
      const label = d.status === 'delivered' ? 'تم التسليم' : d.status === 'failed' ? 'فشل التوصيل' : 'اكتمال التوصيل'
      events.push({
        id: `del-end-${d.id}`,
        label: `${label} (محاولة #${d.attempt_number})`,
        timestamp: d.completed_at,
        color: d.status === 'delivered' ? 'green' : d.status === 'failed' ? 'red' : 'blue',
        actor: d.assigned_to_name || undefined,
      })
    }
  }

  for (const c of data.collections) {
    if (c.collected_at && c.status !== 'pending') {
      events.push({
        id: `col-${c.id}`,
        label: `تحصيل ${c.code}`,
        timestamp: c.collected_at,
        color: 'green',
      })
    }
  }

  for (const r of data.returns) {
    events.push({
      id: `ret-${r.id}`,
      label: `إنشاء مرتجع ${r.code}`,
      timestamp: r.created_at,
      color: 'orange',
    })
  }

  for (const m of data.modification_history || []) {
    const changes = computeItemChanges(m, data.items)
    const itemChanges: ItemChange[] = changes.length > 0 ? changes : undefined
    const count = changes.length
    const summary = count > 0 ? ` (تعديل ${count} صنف${count !== 1 ? 'ف' : ''})` : ''
    events.push({
      id: `mod-${m.id}`,
      label: `${getEditLabel(m.field_name, changes)}${summary}`,
      timestamp: m.modified_at,
      color: 'orange',
      actor: m.modified_by_name || undefined,
      reason: m.reason,
      itemChanges,
    })
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return events
}

export function getLastActionLabel(events: TimelineEvent[]): { label: string; time: string; actor?: string } | null {
  if (events.length === 0) return null
  if (events.length === 1 && events[0].id === 'created') return null
  const latest = events[0]
  return { label: latest.label, time: timeAgo(latest.timestamp), actor: latest.actor }
}

export interface EventDetailRow {
  label: string
  value: string
}

function signedChange(ev: OrderEventLogItem): string | null {
  if (ev.quantity_change == null) return null
  const v = Number(ev.quantity_change)
  return `${v > 0 ? '+' : ''}${v} قطعة`
}

/**
 * Business-language summary for the Order Event Log. Written for representatives
 * and managers: states what happened, why, and what it means for this order —
 * without engine terminology and never re-using the raw engine-written reason
 * text (legacy wording lives in inventory_movements.reason and is not rendered).
 */
export function describeInventoryEvent(ev: OrderEventLogItem): string {
  const product = ev.product_name ? `«${ev.product_name}»` : 'الصنف'
  const qty = ev.quantity_change == null ? '' : ` ${Math.abs(Number(ev.quantity_change))} قطعة`
  switch (ev.movement_type) {
    case 'RESERVATION_ALLOCATE':
      return `تم تأمين الكمية المطلوبة من ${product} لهذا الطلب.`
    case 'RESERVATION_NOTICE':
      return `الكمية المطلوبة من ${product} تتجاوز المتاح حاليًا — سيُقبل الطلب وقد تُخفَّض الكمية عند الاعتماد.`
    case 'RESERVATION_RELEASE':
      return `أُعيدت كمية ${product}${qty} إلى المتاح بعد تحرير الحجز.`
    case 'RESERVATION_UPDATE':
      return `تم تعديل الكمية المحجوزة للصنف ${product}.`
    case 'RESERVATION_REJECT':
      return `لم تُؤمَّن الكمية المطلوبة من ${product} — المطلوب يتجاوز المتاح.`
    case 'ORDER_ALLOCATION_TRIM':
      return `عُدِّلت كمية ${product} عند الاعتماد لتطابق الكمية المتاحة.`
    case 'ORDER_DEDUCTION':
      return `تم خصم كمية ${product}${qty} من المخزون عند بدء التنفيذ.`
    case 'ORDER_CANCELLATION_RESTORE':
      return `أُلغي الطلب وأُعيدت كمية ${product}${qty} إلى المتاح.`
    case 'ORDER_EDIT_RESTORE':
      return `تعديل الطلب — أُعيدت كمية ${product}${qty} إلى المتاح.`
    case 'ORDER_REVISION_RESTORE':
      return `أُعيد الطلب للتعديل وأُعيدت كمية ${product}${qty} إلى المتاح.`
    case 'ORDER_DELETION_RESTORE':
      return `حُذف الطلب وأُعيدت كمية ${product}${qty} إلى المتاح.`
    case 'ORDER_EXECUTION_ENTRY_ADJUST':
      return `عُدِّلت كمية ${product} قبل بدء التنفيذ لتطابق الكمية المتاحة.`
    case 'ORDER_EXECUTION_EXIT_RESTORE':
      return `خرج الطلب من التنفيذ وأُعيدت كمية ${product}${qty} إلى المتاح.`
    case 'ORDER_APPROVED_EXIT_RESTORE':
      return `تغيّرت حالة الطلب وأُعيدت كمية ${product}${qty} إلى المتاح.`
    default:
      return `تم تسجيل تغيير على كمية ${product}.`
  }
}

/**
 * Optional expandable details per event — product name, requested quantity,
 * executable quantity (when applicable), and the business reason. Kept as
 * compact label/value rows so the summary stays short.
 */
export function getEventDetailRows(ev: OrderEventLogItem): EventDetailRow[] {
  const rows: EventDetailRow[] = []
  if (ev.product_name) {
    rows.push({ label: 'الصنف', value: ev.product_name })
  }
  const change = ev.quantity_change == null ? null : Number(ev.quantity_change)
  switch (ev.movement_type) {
    case 'RESERVATION_ALLOCATE':
      if (change != null) rows.push({ label: 'الكمية المؤمَّنة', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'تأمين الكمية عند تقديم الطلب' })
      rows.push({ label: 'المعنى', value: 'الكمية محجوزة لهذا الطلب ولا تتأثر بالطلبات الأخرى.' })
      break
    case 'RESERVATION_NOTICE':
      if (change != null) rows.push({ label: 'الكمية المطلوبة', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'طلبات أخرى محجوزة على نفس الصنف' })
      rows.push({ label: 'المعنى', value: 'سيُقبل الطلب، وقد تُخفَّض الكمية عند الاعتماد حسب أولوية التقديم.' })
      break
    case 'RESERVATION_RELEASE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'المعنى', value: 'الكمية عادت إلى المتاح ويمكن استخدامها في طلبات أخرى.' })
      break
    case 'RESERVATION_UPDATE':
      if (change != null) rows.push({ label: 'التغيّر في الكمية', value: signedChange(ev) ?? '—' })
      rows.push({ label: 'السبب', value: 'تعديل كمية الطلب' })
      break
    case 'RESERVATION_REJECT':
      if (change != null) rows.push({ label: 'الكمية المطلوبة', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'الكمية المطلوبة تتجاوز المتاح حاليًا' })
      rows.push({ label: 'المعنى', value: 'لم تُؤمَّن الكمية لهذا الطلب.' })
      break
    case 'ORDER_ALLOCATION_TRIM':
      if (ev.previous_quantity != null) rows.push({ label: 'الكمية المطلوبة', value: `${ev.previous_quantity} قطعة` })
      if (ev.new_quantity != null) rows.push({ label: 'الكمية القابلة للتنفيذ', value: `${ev.new_quantity} قطعة` })
      rows.push({ label: 'السبب', value: 'الكمية المتاحة لا تكفي للكمية المطلوبة' })
      rows.push({ label: 'المعنى', value: 'يُنفَّذ من الصنف بالكمية المتاحة بعد الاعتماد.' })
      break
    case 'ORDER_DEDUCTION':
      if (change != null) rows.push({ label: 'الكمية المخصومة من المخزون', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'المعنى', value: 'دخل الطلب مرحلة التنفيذ وتم خصم الكمية من المخزون الفعلي.' })
      break
    case 'ORDER_CANCELLATION_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'إلغاء الطلب' })
      break
    case 'ORDER_EDIT_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'تعديل الطلب' })
      break
    case 'ORDER_REVISION_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'إعادة الطلب للتعديل' })
      break
    case 'ORDER_DELETION_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'حذف الطلب' })
      break
    case 'ORDER_EXECUTION_ENTRY_ADJUST':
      if (change != null) rows.push({ label: 'التغيّر في الكمية', value: signedChange(ev) ?? '—' })
      rows.push({ label: 'السبب', value: 'مطابقة الكمية مع المتاح قبل بدء التنفيذ' })
      break
    case 'ORDER_EXECUTION_EXIT_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'خروج الطلب من مرحلة التنفيذ' })
      break
    case 'ORDER_APPROVED_EXIT_RESTORE':
      if (change != null) rows.push({ label: 'الكمية المُعاد توفيرها', value: `${Math.abs(change)} قطعة` })
      rows.push({ label: 'السبب', value: 'تغيير حالة الطلب' })
      break
  }
  return rows
}
