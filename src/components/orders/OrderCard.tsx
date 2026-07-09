import { formatCurrencyShort, formatDate } from '../../utils/format'
import { StatusBadge } from '../shared/StatusBadge'

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
    collection_badge?: { label: string; className: string }
  }
  onClick?: () => void
}

const cardStatusStyle: Record<string, { bg: string; border: string }> = {
  draft: { bg: 'bg-gray-50', border: 'border-gray-200' },
  submitted: { bg: 'bg-blue-50', border: 'border-blue-200' },
  reviewing: { bg: 'bg-yellow-50', border: 'border-yellow-200' },
  returned_for_revision: { bg: 'bg-amber-50', border: 'border-amber-200' },
  approved: { bg: 'bg-green-50', border: 'border-green-200' },
  preparing: { bg: 'bg-orange-50', border: 'border-orange-200' },
  prepared: { bg: 'bg-purple-50', border: 'border-purple-200' },
  ready_for_dispatch: { bg: 'bg-indigo-50', border: 'border-indigo-200' },
  sent_to_delivery: { bg: 'bg-cyan-50', border: 'border-cyan-200' },
  dispatched: { bg: 'bg-teal-50', border: 'border-teal-200' },
  deferred: { bg: 'bg-gray-50', border: 'border-gray-200' },
  cancelled: { bg: 'bg-red-50', border: 'border-red-200' },
  delivered: { bg: 'bg-emerald-50', border: 'border-emerald-200' },
}

export function OrderCard({ order, onClick }: OrderCardProps) {
  const dt = order.created_at ? new Date(order.created_at) : null
  const dateStr = dt ? formatDate(dt) : ''
  const timeStr = dt ? dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''
  const style = cardStatusStyle[order.status] || cardStatusStyle.draft

  return (
    <div
      onClick={onClick}
      className={'h-full rounded-xl border p-3.5 cursor-pointer active:scale-[0.98] transition-all flex flex-col ' + style.bg + ' ' + style.border}
    >
      <div className="flex justify-end mb-2">
        <StatusBadge status={order.status} size="md" />
      </div>

      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-xs font-bold text-text font-mono tracking-tight">{order.order_number}</p>
        {order.revision_number !== undefined && order.revision_number > 0 && (
          <span className="text-[9px] text-text-secondary bg-surface px-1 py-0.5 rounded">مراجعة #{order.revision_number}</span>
        )}
      </div>

      <p className="text-sm font-bold text-text mb-1.5">
        {order.customer_name || 'غير متوفر'}
      </p>

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
      {order.customer_owner_role && (
        <p className="text-[11px] text-text-secondary mb-0.5">
          <span className="text-text-muted">الدور: </span>
          <span>{order.customer_owner_role}</span>
        </p>
      )}

      <div className="flex-1" />

      <p className="text-lg font-bold text-text mt-2">
        {formatCurrencyShort(Number(order.total_amount) || 0)}
      </p>

      <p className="text-[11px] text-text-secondary mt-0.5">{dateStr} {timeStr}</p>

      {(order.delivery_mode || order.governorate || order.collection_badge) && (
        <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-border/50">
          {order.governorate && (
            <span className="text-[10px] text-text-secondary bg-surface px-1.5 py-0.5 rounded">{order.governorate}</span>
          )}
          {order.delivery_mode && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              order.delivery_mode === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {order.delivery_mode === 'external' ? 'شركة شحن' : 'توصيل داخلي'}
            </span>
          )}
          {order.collection_badge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.collection_badge.className}`}>
              {order.collection_badge.label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
