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
    creator_phone?: string
    total_amount: number | string
    status: string
    created_at: string
    updated_at?: string
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
          <p className="text-xs text-text-secondary font-medium">{order.order_number}</p>
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
          {order.owner_name && (
            <div>
              <span className="text-[9px] text-text-secondary">المسؤول: </span>
              <span className="text-text font-medium">{order.owner_name}</span>
              {order.owner_phone && <span className="text-[10px] text-text-secondary" dir="ltr"> ({order.owner_phone})</span>}
            </div>
          )}
          {order.creator_name && (
            <div>
              <span className="text-[9px] text-text-secondary">مرسل: </span>
              <span className="text-primary/70">{order.creator_name}</span>
              {order.creator_phone && <span className="text-[10px] text-text-secondary" dir="ltr"> ({order.creator_phone})</span>}
            </div>
          )}
          <p>{dateStr} {timeStr}</p>
        </div>
        <p className="text-sm font-bold text-text">
          {formatCurrencyShort(Number(order.total_amount) || 0)}
        </p>
      </div>
    </div>
  )
}
