import { ORDER_STATUS_LABELS } from '../../types/order-display'
import type { UnifiedOrder, UnifiedCustomerSummary } from '../../types/unified-order'

export interface TimelineEvent {
  id: string
  label: string
  timestamp: string
  color: 'green' | 'blue' | 'yellow' | 'orange' | 'red'
  actor?: string
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
  const parts = [customer?.governorate, customer?.city, customer?.address_line1, customer?.address_line2].filter(Boolean)
  if (parts.length > 0) return parts.join(' - ')
  return order?.snapshot_customer_address || ''
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
    if (m.field_name === 'REVISION_SNAPSHOT') {
      events.push({
        id: `mod-snap-${m.id}`,
        label: `إعادة الطلب للتعديل (المرة #${m.revision_number})`,
        timestamp: m.modified_at,
        color: 'orange',
        actor: m.reason || undefined,
      })
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  console.log('[DEBUG] buildTimelineEvents:', JSON.stringify(events.map(e => ({ id: e.id, label: e.label, actor: e.actor })), null, 2))
  return events
}

export function getLastActionLabel(events: TimelineEvent[]): { label: string; time: string; actor?: string } | null {
  if (events.length === 0) return null
  if (events.length === 1 && events[0].id === 'created') return null
  const latest = events[0]
  return { label: latest.label, time: timeAgo(latest.timestamp), actor: latest.actor }
}
