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
      className="ds-card cursor-pointer active:bg-surface transition-colors"
    >
      <div className="flex items-start justify-between ds-gap-md">
        <div className="flex-1 min-w-0">
          <div className="flex items-center ds-gap-xs">
            <p className="ds-xs font-medium">{order.order_number}</p>
            {order.revision_number !== undefined && order.revision_number > 0 && (
              <span className="ds-badge bg-surface text-text-secondary">مراجعة #{order.revision_number}</span>
            )}
          </div>
          <p className="ds-body font-bold mt-0.5">
            {order.customer_name || 'غير متوفر'}
          </p>
          {order.customer_phone && (
            <p className="ds-xs mt-0.5" dir="ltr">{order.customer_phone}</p>
          )}
        </div>
        <StatusBadge status={order.status} size="md" />
      </div>

      <div className="flex items-end justify-between mt-1.5">
        <div className="ds-xs space-y-0.5">
          {order.created_by_name && (
            <div>
              <span className="ds-badge bg-surface text-text-secondary">منشئ الطلب: {order.created_by_name}</span>
            </div>
          )}
          {(order.customer_owner_name) && (
            <div>
              <span className="ds-badge bg-surface text-text-secondary">
                التابع لـ: {order.customer_owner_name}
                {order.customer_owner_role && <> ({order.customer_owner_role})</>}
              </span>
            </div>
          )}
          <p>{dateStr} {timeStr}</p>
        </div>
        <p className="ds-body font-bold">
          {formatCurrencyShort(Number(order.total_amount) || 0)}
        </p>
      </div>

      {(order.delivery_mode || order.governorate || order.collection_badge) && (
        <div className="flex items-center ds-gap-xs mt-3 pt-3 border-t border-border">
          {order.governorate && (
            <span className="ds-badge bg-surface text-text-secondary">{order.governorate}</span>
          )}
          {order.delivery_mode && (
            <span className={`ds-badge ${
              order.delivery_mode === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {order.delivery_mode === 'external' ? 'شركة شحن' : 'توصيل داخلي'}
            </span>
          )}
          {order.collection_badge && (
            <span className={`ds-badge ${order.collection_badge.className}`}>
              {order.collection_badge.label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
