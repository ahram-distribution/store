import { StatusBadge } from '../shared/StatusBadge'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import { formatDateTime } from '../../utils/format'
import type { UnifiedOrder } from '../../types/unified-order'

interface OrderHeaderSectionProps {
  order: UnifiedOrder['order']
  currentOwner: string
  overLimit: boolean | null
  lastAction: { label: string; time: string } | null
  actions?: React.ReactNode
  onBack?: () => void
}

function renderCreator(order: UnifiedOrder['order']) {
  const name = order.order_creator_name
  const role = order.order_creator_role || 'عميل'
  if (!name) return <span className="text-text-secondary">—</span>
  return (
    <span>
      {name}
      <span className="text-text-secondary"> — {role}</span>
    </span>
  )
}

export function OrderHeaderSection({ order, currentOwner, overLimit, lastAction, actions, onBack }: OrderHeaderSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            {onBack && (
              <button onClick={onBack} className="text-text-secondary text-lg hover:text-text transition-colors">&larr;</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-secondary bg-surface px-2 py-0.5 rounded-full border border-border">
              Revision #{order.revision_number + 1}
            </span>
            <StatusBadge status={order.status} size="md" />
            {overLimit && (
              <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full border border-danger/30">
                تجاوز الحد الائتماني
              </span>
            )}
            {actions}
          </div>
        </div>

        <p className="text-lg font-bold text-text mb-3">{order.order_number}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">الحالة</span>
            <span className="font-medium text-text">{ORDER_STATUS_LABELS[order.status] || order.status}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">المسؤول</span>
            <span className="font-medium text-text">{currentOwner}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">منشئ الطلب</span>
            <span className="font-medium text-text">{renderCreator(order)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">التوصيل</span>
            <span className="font-medium text-text">{order.delivery_mode === 'internal' ? 'داخلى' : 'خارجى'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">آخر تحديث</span>
            <span className="font-medium text-text">{formatDateTime(order.updated_at)}</span>
          </div>
        </div>

        {lastAction && (
          <div className="mt-2 pt-2 border-t border-border text-[10px] text-text-secondary">
            آخر إجراء: <span className="font-medium text-text">{lastAction.label}</span>
            {' — '}
            <span>{lastAction.time}</span>
          </div>
        )}
      </div>
    </div>
  )
}
