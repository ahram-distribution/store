import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '../shared/StatusBadge'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import { formatDateTime } from '../../utils/format'
import type { UnifiedOrder, UnifiedModificationEntry } from '../../types/unified-order'

interface OrderHeaderSectionProps {
  order: UnifiedOrder['order']
  currentOwner: string
  overLimit: boolean | null
  lastAction: { label: string; time: string; actor?: string } | null
  modificationEntries?: UnifiedModificationEntry[]
  actions?: React.ReactNode
  onBack?: () => void
  onEditCreator?: () => void
}

export function OrderHeaderSection({ order, currentOwner, overLimit, lastAction, modificationEntries, actions, onBack, onEditCreator }: OrderHeaderSectionProps) {
  const navigate = useNavigate()

  const revisionCount = order.revision_number
  const totalEditCount = modificationEntries?.filter(e => e.field_name === 'REVISION_SNAPSHOT').length || 0

  function renderOwner(ord: UnifiedOrder['order']) {
    const name = ord.order_owner_name
    const role = ord.order_owner_role
    if (!name) return <span className="text-text-secondary">—</span>
    return (
      <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(`/employees/${ord.owner_id}`)}>
        {name}
        {role && <span className="text-text-secondary"> — {role}</span>}
        <svg className="w-3 h-3 inline-block mr-0.5 -mt-0.5 text-text-secondary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
      </span>
    )
  }

  const lastRevision = modificationEntries?.filter(e => e.field_name === 'REVISION_SNAPSHOT').sort((a, b) =>
    new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  )[0]

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

        {(revisionCount > 0 || order.status === 'returned_for_revision') && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
              Revision #{revisionCount + 1}
            </span>
            <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
              {totalEditCount} تعديل{totalEditCount !== 1 ? 'ات' : ''}
            </span>
            {lastRevision && (
              <span className="text-[10px] text-text-secondary">
                {lastRevision.reason && `سبب آخر تعديل: ${lastRevision.reason}`}
              </span>
            )}
          </div>
        )}

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
            <span className="text-text-secondary shrink-0">المسؤول عن الطلب</span>
            <span className="font-medium text-text">{renderOwner(order)}</span>
            {onEditCreator && (
              <button onClick={onEditCreator} className="text-accent hover:opacity-70 transition-opacity" title="تغيير المسؤول">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">التوصيل</span>
            <span className="font-medium text-text">{order.delivery_mode === 'internal' ? 'داخلى' : 'خارجى'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">آخر تحديث</span>
            <span className="font-medium text-text">{formatDateTime(order.updated_at)}</span>
          </div>
          {order.last_revised_at && (
            <div className="flex items-center gap-2">
              <span className="text-text-secondary shrink-0">آخر تعديل</span>
              <span className="font-medium text-text">{formatDateTime(order.last_revised_at)}</span>
            </div>
          )}
        </div>

        {lastAction && (
          <div className="mt-2 pt-2 border-t border-border text-[10px] text-text-secondary">
            آخر إجراء: <span className="font-medium text-text">{lastAction.label}</span>
            {lastAction.actor && <span className="font-medium text-text"> — {lastAction.actor}</span>}
            {' — '}
            <span>{lastAction.time}</span>
          </div>
        )}
      </div>
    </div>
  )
}
