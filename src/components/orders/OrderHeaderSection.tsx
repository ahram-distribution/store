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
}

export function OrderHeaderSection({ order, currentOwner, overLimit, lastAction, modificationEntries, actions, onBack }: OrderHeaderSectionProps) {
  const navigate = useNavigate()

  const revisionCount = order.revision_number
  const totalEditCount = modificationEntries?.filter(e => e.field_name === 'REVISION_SNAPSHOT').length || 0

  function renderCreator(creator: UnifiedOrder['order']) {
    const name = creator.order_creator_name
    const role = creator.order_creator_role || 'عميل'
    if (!name) return <span className="text-[#6B7280]">—</span>
    const target = creator.order_creator_type === 'customer'
      ? `/customers/${creator.order_creator_id}`
      : `/employees/${creator.order_creator_id}`
    if (!creator.order_creator_id) return <span>{name}<span className="text-[#6B7280]"> — {role}</span></span>
    return (
      <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(target)}>
        {name}
        <span className="text-[#6B7280]"> — {role}</span>
      </span>
    )
  }

  const lastRevision = modificationEntries?.filter(e => e.field_name === 'REVISION_SNAPSHOT').sort((a, b) =>
    new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  )[0]

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
      <div className="px-6 py-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              {onBack && (
                <button onClick={onBack} className="text-[#6B7280] text-xl hover:text-[#111827] transition-colors shrink-0 leading-none">&larr;</button>
              )}
              <h1 className="text-[21px] font-bold text-[#111827] truncate leading-tight">{order.order_number}</h1>
              <StatusBadge status={order.status} size="md" />
              {overLimit && (
                <span className="text-[10px] bg-[#FEF2F2] text-[#DC2626] px-2 py-0.5 rounded-full border border-[#FECACA] shrink-0 font-medium">
                  تجاوز الحد
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-[13px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[#9CA3AF] shrink-0">حالة:</span>
                <span className="font-medium text-[#111827]">{ORDER_STATUS_LABELS[order.status] || order.status}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9CA3AF] shrink-0">مسؤول:</span>
                <span className="font-medium text-[#111827]">{currentOwner}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9CA3AF] shrink-0">منشئ:</span>
                <span className="font-medium text-[#111827]">{renderCreator(order)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9CA3AF] shrink-0">توصيل:</span>
                <span className="font-medium text-[#111827]">{order.delivery_mode === 'internal' ? 'داخلى' : 'خارجى'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9CA3AF] shrink-0">التحديث:</span>
                <span className="font-medium text-[#111827]">{formatDateTime(order.updated_at)}</span>
              </div>
              {order.last_revised_at && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[#9CA3AF] shrink-0">تعديل:</span>
                  <span className="font-medium text-[#111827]">{formatDateTime(order.last_revised_at)}</span>
                </div>
              )}
            </div>
            {(revisionCount > 0 || order.status === 'returned_for_revision') && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[10px] bg-[#FFFBEB] text-[#D97706] px-2 py-0.5 rounded-full border border-[#FDE68A] font-medium">
                  Revision #{revisionCount + 1}
                </span>
                {totalEditCount > 0 && (
                  <span className="text-[10px] bg-[#EFF6FF] text-[#2563EB] px-2 py-0.5 rounded-full border border-[#BFDBFE] font-medium">
                    {totalEditCount} تعديل{totalEditCount !== 1 ? 'ات' : ''}
                  </span>
                )}
                {lastRevision?.reason && (
                  <span className="text-[10px] text-[#6B7280]">{lastRevision.reason}</span>
                )}
              </div>
            )}
            {lastAction && (
              <div className="mt-2 pt-2 border-t border-[#E5E7EB] text-[12px] text-[#6B7280]">
                <span className="font-medium">آخر إجراء: </span>
                <span className="font-medium text-[#111827]">{lastAction.label}</span>
                {lastAction.actor && <span className="text-[#111827] font-medium"> — {lastAction.actor}</span>}
                <span> — {lastAction.time}</span>
              </div>
            )}
          </div>
          {actions && (
            <div className="shrink-0 flex flex-wrap items-center gap-2.5">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}