import { useState } from 'react'
import { formatDateTime } from '../../utils/format'
import { describeInventoryEvent, getEventDetailRows } from './order-detail.utils'
import type { OrderEventLogItem } from '../../types/unified-order'

interface OrderEventLogSectionProps {
  events: OrderEventLogItem[]
}

const DOT_COLORS: Record<string, string> = {
  RESERVATION_ALLOCATE: 'bg-emerald-500',
  RESERVATION_NOTICE: 'bg-amber-500',
  RESERVATION_RELEASE: 'bg-blue-500',
  RESERVATION_UPDATE: 'bg-blue-500',
  RESERVATION_REJECT: 'bg-red-500',
  ORDER_ALLOCATION_TRIM: 'bg-orange-500',
  ORDER_DEDUCTION: 'bg-emerald-500',
  ORDER_CANCELLATION_RESTORE: 'bg-blue-500',
  ORDER_EDIT_RESTORE: 'bg-blue-500',
  ORDER_REVISION_RESTORE: 'bg-amber-500',
  ORDER_DELETION_RESTORE: 'bg-blue-500',
  ORDER_EXECUTION_ENTRY_ADJUST: 'bg-orange-500',
  ORDER_EXECUTION_EXIT_RESTORE: 'bg-blue-500',
  ORDER_APPROVED_EXIT_RESTORE: 'bg-blue-500',
}

function dotColor(type: string): string {
  return DOT_COLORS[type] ?? 'bg-gray-400'
}

export function OrderEventLogSection({ events }: OrderEventLogSectionProps) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!events || events.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#F9FAFB] transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-bold text-[#111827]">سجل أحداث الطلب</h3>
          <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">{events.length}</span>
        </div>
        <svg className={`w-4 h-4 text-[#9CA3AF] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-[#E5E7EB] max-h-[400px] overflow-y-auto border-t border-[#E5E7EB]">
          {events.map(ev => {
            const details = getEventDetailRows(ev)
            const isOpen = expandedId === ev.id
            return (
              <div key={ev.id}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : ev.id)}
                  className="w-full px-5 py-3 text-right flex items-start gap-3 hover:bg-[#F9FAFB]/50 transition-colors"
                >
                  <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor(ev.movement_type)}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-[#111827] font-medium leading-snug">{describeInventoryEvent(ev)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[#6B7280] text-[12px]">{formatDateTime(ev.created_at)}</span>
                      {ev.created_by_name && <span className="text-[#6B7280] text-[11px]">— {ev.created_by_name}</span>}
                    </div>
                  </div>
                  {details.length > 0 && (
                    <svg className={`w-3.5 h-3.5 text-[#9CA3AF] transition-transform shrink-0 mt-1 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {isOpen && details.length > 0 && (
                  <div className="px-5 pb-3 pr-[44px]">
                    <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 space-y-1.5">
                      {details.map(row => (
                        <div key={row.label} className="text-[12px] flex gap-2 items-baseline">
                          <span className="text-[#6B7280] shrink-0">{row.label}:</span>
                          <span className="text-[#111827] font-medium">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
