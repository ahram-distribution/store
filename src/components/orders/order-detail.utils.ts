import { ORDER_STATUS_LABELS } from '../../types/order-display'
import type { UnifiedOrder, UnifiedCustomerSummary, UnifiedModificationEntry } from '../../types/unified-order'

export interface ItemChange {
  product_id: string
  product_name: string
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
    case 'prepared': return 'بانتظار مدير البيع (قرار الشحن)'
    case 'ready_for_dispatch': return 'بانتظار مدير البيع (إسناد التوصيل)'
    case 'sent_to_delivery':
    case 'dispatched':
      return delivery?.assigned_to_name ? `مندوب التوصيل: ${delivery.assigned_to_name}` : 'مندوب التوصيل'
    case 'delivered': return 'تم التسليم'
    case 'cancelled': return 'ملغي'
    case 'deferred': return data.order.defer_reason ? `مؤجل — ${data.order.defer_reason}` : 'مؤجل'
    default: return status
  }
}

export function getFullAddress(customer: UnifiedCustomerSummary | null, order?: { snapshot_customer_address?: string | null }): string {
  if (!customer && !order?.snapshot_customer_address) return ''
  const parts = [customer?.governorate, customer?.city, customer?.address_line1].filter(Boolean)
  if (parts.length > 0) return parts.join(' - ')
  return order?.snapshot_customer_address || ''
}

function computeItemChanges(m: UnifiedModificationEntry): ItemChange[] {
  const changes: ItemChange[] = []
  const oldItems: Record<string, any> = {}
  const newItems: Record<string, any> = {}
  if (Array.isArray(m.old_order_items)) for (const item of m.old_order_items) oldItems[item.product_id] = item
  if (Array.isArray(m.new_order_items)) for (const item of m.new_order_items) newItems[item.product_id] = item
  const allIds = new Set([...Object.keys(oldItems), ...Object.keys(newItems)])
  for (const pid of allIds) {
    const oldItem = oldItems[pid]
    const newItem = newItems[pid]
    if (oldItem && !newItem) {
      changes.push({ product_id: pid, product_name: '', action: 'removed', old_qty: Number(oldItem.unit_quantity || 0) })
    } else if (!oldItem && newItem) {
      changes.push({ product_id: pid, product_name: '', action: 'added', new_qty: Number(newItem.unit_quantity || 0) })
    } else if (oldItem && newItem && Number(oldItem.unit_quantity || 0) !== Number(newItem.unit_quantity || 0)) {
      changes.push({
        product_id: pid, product_name: '', action: 'quantity_changed',
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
    events.push({
      id: `status-${h.id}`,
      label: fromLabel ? `تغيير الحالة من "${fromLabel}" إلى "${toLabel}"` : toLabel,
      timestamp: h.changed_at,
      color: h.to_status === 'cancelled' ? 'red' : h.to_status === 'delivered' ? 'green' : 'blue',
      actor: h.changed_by_name || undefined,
      reason: h.reason,
      fromStatus: h.from_status,
      toStatus: h.to_status,
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
    const changes = computeItemChanges(m)
    const itemChanges: ItemChange[] = changes.length > 0 ? changes : undefined
    const summary = changes.length > 0 ? ` (${getItemsSummary(changes)})` : ''
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
