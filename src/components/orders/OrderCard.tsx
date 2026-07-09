import { formatCurrencyShort, formatDate } from '../../utils/format'
import { StatusBadge } from '../shared/StatusBadge'
import type { CustomerActivityLevel } from '../../types/unified-order'

interface OrderCardProps {
  order: {
    id: string
    order_number: string
    customer_name?: string
    customer_phone?: string
    owner_name?: string
    owner_phone?: string
    creator_name?: string
    created_by_name?: string
    creator_phone?: string
    customer_owner_name?: string
    customer_owner_role?: string
    total_amount: number | string
    status: string
    created_at: string
    updated_at?: string
    delivery_mode?: string
    revision_number?: number
    governorate?: string
    customer_display_address?: string | null
    customer_order_count?: number | null
    customer_lifetime_total?: number | null
    customer_average_order_value?: number | null
    customer_last_order_date?: string | null
    customer_activity_level?: CustomerActivityLevel | null
    collection_badge?: { label: string; className: string }
  }
  onClick?: () => void
}

const cardAccent: Record<string, string> = {
  draft: 'border-r-gray-200',
  submitted: 'border-r-blue-300',
  reviewing: 'border-r-blue-400',
  returned_for_revision: 'border-r-blue-300',
  approved: 'border-r-emerald-300',
  preparing: 'border-r-emerald-400',
  prepared: 'border-r-emerald-400',
  ready_for_dispatch: 'border-r-emerald-300',
  sent_to_delivery: 'border-r-emerald-400',
  dispatched: 'border-r-emerald-500',
  deferred: 'border-r-gray-300',
  cancelled: 'border-r-red-300',
  delivered: 'border-r-emerald-500',
}

const activityLevelStyle: Record<CustomerActivityLevel, { label: string; className: string }> = {
  NEW: { label: 'جديد', className: 'bg-blue-100 text-blue-700' },
  LOW: { label: 'منخفض', className: 'bg-amber-100 text-amber-700' },
  ACTIVE: { label: 'نشط', className: 'bg-emerald-100 text-emerald-700' },
  VIP: { label: 'VIP', className: 'bg-purple-100 text-purple-700' },
}

export function OrderCard({ order, onClick }: OrderCardProps) {
  const dt = order.created_at ? new Date(order.created_at) : null
  const dateStr = dt ? formatDate(dt) : ''
  const timeStr = dt ? dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''
  const accent = cardAccent[order.status] || 'border-r-gray-300'

  const actLvl = order.customer_activity_level
  const actStyle = actLvl ? activityLevelStyle[actLvl] : null

  return (
    <div
      onClick={onClick}
      className={'h-full rounded-xl border border-border border-r-4 bg-white p-3.5 cursor-pointer active:scale-[0.98] transition-all flex flex-col ' + accent}
    >
      <p className="text-base font-bold text-text mb-1 leading-snug">
        {order.customer_name || 'غير متوفر'}
      </p>

      {order.customer_display_address && (
        <p className="text-[11px] text-text-secondary mb-2 leading-snug">
          {order.customer_display_address}
        </p>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <StatusBadge status={order.status} size="md" />
        <div className="flex items-center gap-1">
          <p className="text-xs font-bold text-text font-mono tracking-tight">{order.order_number}</p>
          {order.revision_number !== undefined && order.revision_number > 0 && (
            <span className="text-[9px] text-text-secondary bg-surface px-1 py-0.5 rounded">مراجعة #{order.revision_number}</span>
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[11px] text-text-muted">قيمة الطلب:</span>
        <span className="text-lg font-bold text-text">{formatCurrencyShort(Number(order.total_amount) || 0)}</span>
      </div>

      {order.created_by_name && (
        <p className="text-[11px] text-text-secondary mb-0.5">
          <span className="text-text-muted">المسؤول: </span>
          <span className="text-primary/80 font-medium">{order.created_by_name}</span>
        </p>
      )}
      {!order.created_by_name && order.customer_owner_name && (
        <p className="text-[11px] text-text-secondary mb-0.5">
          <span className="text-text-muted">المسؤول: </span>
          <span className="text-text font-medium">{order.customer_owner_name}</span>
        </p>
      )}

      {(order.customer_order_count != null || order.customer_lifetime_total != null || order.customer_average_order_value != null || order.customer_last_order_date != null) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {order.customer_order_count != null && (
            <span className="text-[10px] text-text-secondary">
              <span className="text-text-muted">الطلبات: </span>
              <span className="font-medium">{order.customer_order_count}</span>
            </span>
          )}
          {order.customer_lifetime_total != null && (
            <span className="text-[10px] text-text-secondary">
              <span className="text-text-muted">المشتريات: </span>
              <span className="font-medium">{formatCurrencyShort(Number(order.customer_lifetime_total))}</span>
            </span>
          )}
          {order.customer_average_order_value != null && (
            <span className="text-[10px] text-text-secondary">
              <span className="text-text-muted">المتوسط: </span>
              <span className="font-medium">{formatCurrencyShort(Number(order.customer_average_order_value))}</span>
            </span>
          )}
          {order.customer_last_order_date && (
            <span className="text-[10px] text-text-secondary">
              <span className="text-text-muted">آخر طلب: </span>
              <span className="font-medium">{formatDate(new Date(order.customer_last_order_date))}</span>
            </span>
          )}
        </div>
      )}

      {actStyle && (
        <div className="mt-1">
          <span className={'text-[10px] px-1.5 py-0.5 rounded font-medium ' + actStyle.className}>
            {actStyle.label}
          </span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-border/50 flex-wrap">
        {order.delivery_mode && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (order.delivery_mode === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700')}>
            {order.delivery_mode === 'external' ? 'شركة شحن' : 'توصيل داخلي'}
          </span>
        )}
        {order.governorate && !order.customer_display_address && (
          <span className="text-[10px] text-text-secondary bg-surface px-1.5 py-0.5 rounded">{order.governorate}</span>
        )}
        {order.collection_badge && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded ' + order.collection_badge.className}>
            {order.collection_badge.label}
          </span>
        )}
      </div>

      <p className="text-[11px] text-text-secondary mt-1">{dateStr} {timeStr}</p>
    </div>
  )
}
