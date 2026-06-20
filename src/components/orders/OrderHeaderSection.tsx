import { useNavigate } from 'react-router-dom'
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

export function OrderHeaderSection({ order, currentOwner, overLimit, lastAction, actions, onBack }: OrderHeaderSectionProps) {
  const navigate = useNavigate()

  function renderCreator(creator: UnifiedOrder['order']) {
    const name = creator.order_creator_name
    const role = creator.order_creator_role || 'عميل'
    if (!name) return <span className="text-text-secondary">—</span>
    const target = creator.order_creator_type === 'customer'
      ? `/customers/${creator.order_creator_id}`
      : `/employees/${creator.order_creator_id}`
    if (!creator.order_creator_id) return <span>{name}<span className="text-text-secondary"> — {role}</span></span>
    return (
      <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(target)}>
        {name}
        <span className="text-text-secondary"> — {role}</span>
        <svg className="w-3 h-3 inline-block mr-0.5 -mt-0.5 text-text-secondary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
      </span>
    )
  }
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
