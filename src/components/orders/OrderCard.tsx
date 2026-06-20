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

export function OrderCard({ order, onClick }: OrderCardProps) {
  const dt = order.created_at ? new Date(order.created_at) : null
  const dateStr = dt ? formatDate(dt) : ''
  const timeStr = dt ? dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-border p-3.5 cursor-pointer active:bg-surface transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-text-secondary font-medium">{order.order_number}</p>
            {order.revision_number !== undefined && order.revision_number > 0 && (
              <span className="text-[9px] text-text-secondary bg-surface px-1 py-0.5 rounded">مراجعة #{order.revision_number}</span>
            )}
          </div>
          <p className="text-sm font-bold text-text mt-0.5">
            {order.customer_name || 'غير متوفر'}
          </p>
          {order.customer_phone && (
            <p className="text-[10px] text-text-secondary mt-0.5" dir="ltr">{order.customer_phone}</p>
          )}
        </div>
        <StatusBadge status={order.status} size="md" />
      </div>

      <div className="flex items-end justify-between mt-1.5">
        <div className="text-[11px] text-text-secondary space-y-1">
          {order.created_by_name && (
            <div>
              <span className="text-[9px] text-text-secondary">منشئ الطلب: </span>
              <span className="text-primary/70">{order.created_by_name}</span>
            </div>
          )}
          {(order.customer_owner_name) && (
            <div>
              <span className="text-[9px] text-text-secondary">التابع لـ: </span>
              <span className="text-text font-medium">{order.customer_owner_name}</span>
              {order.customer_owner_role && <span className="text-[10px] text-text-secondary"> ({order.customer_owner_role})</span>}
            </div>
          )}
          <p>{dateStr} {timeStr}</p>
        </div>
        <p className="text-sm font-bold text-text">
          {formatCurrencyShort(Number(order.total_amount) || 0)}
        </p>
      </div>

      {(order.delivery_mode || order.governorate || order.collection_badge) && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
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
