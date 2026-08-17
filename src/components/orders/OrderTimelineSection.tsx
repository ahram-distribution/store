import { useState } from 'react'
import { formatDateTime } from '../../utils/format'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import type { TimelineEvent, ItemChange } from './order-detail.utils'

interface OrderTimelineSectionProps {
  timelineEvents: TimelineEvent[]
}

const COLOR_ICONS: Record<string, string> = {
  green: '🟢',
  blue: '🔵',
  yellow: '🟡',
  orange: '🟠',
  red: '🔴',
}

const COLOR_CLASSES: Record<string, string> = {
  green: 'bg-[#ECFDF5] text-[#059669]',
  blue: 'bg-[#EFF6FF] text-[#2563EB]',
  yellow: 'bg-[#FFFBEB] text-[#D97706]',
  orange: 'bg-[#FFF7ED] text-[#EA580C]',
  red: 'bg-[#FEF2F2] text-[#DC2626]',
}

function ItemChangeRow({ change }: { change: ItemChange }) {
  const codeLine = change.product_code ? <div>كود الصنف: {change.product_code}</div> : null
  if (change.action === 'added') {
    return (
      <div className="text-[12px] text-green-700 space-y-0.5">
        <div>تمت إضافة صنف</div>
        <div>الصنف: {change.product_name}</div>
        {codeLine}
        <div>الوحدة: {change.unit_name}</div>
        <div>الكمية: {change.new_qty} {change.unit_name}</div>
      </div>
    )
  }
  if (change.action === 'removed') {
    return (
      <div className="text-[12px] text-red-600 space-y-0.5">
        <div>تم حذف صنف</div>
        <div>الصنف: {change.product_name}</div>
        {codeLine}
        <div>الوحدة: {change.unit_name}</div>
        <div>الكمية السابقة: {change.old_qty} {change.unit_name}</div>
      </div>
    )
  }
  if (change.action === 'quantity_changed') {
    const diff = (change.new_qty ?? 0) - (change.old_qty ?? 0)
    const diffLabel = diff > 0 ? `زيادة ${diff}` : `نقص ${Math.abs(diff)}`
    return (
      <div className="text-[12px] text-[#D97706] space-y-0.5">
        <div>تم تعديل صنف</div>
        <div>الصنف: {change.product_name}</div>
        {codeLine}
        <div>الوحدة: {change.unit_name}</div>
        <div>الكمية السابقة: {change.old_qty} {change.unit_name}</div>
        <div>الكمية الجديدة: {change.new_qty} {change.unit_name}</div>
        <div>التغيير: {diffLabel}</div>
      </div>
    )
  }
  return null
}

export function OrderTimelineSection({ timelineEvents }: OrderTimelineSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (timelineEvents.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#F9FAFB] transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-bold text-[#111827]">سجل الأحداث</h3>
          <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">{timelineEvents.length}</span>
        </div>
        <svg className={`w-4 h-4 text-[#9CA3AF] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="divide-y divide-[#E5E7EB] max-h-80 overflow-y-auto border-t border-[#E5E7EB]">
          {timelineEvents.map((ev) => (
            <div key={ev.id} className="px-5 py-3 text-[13px] flex items-start gap-3 hover:bg-[#F9FAFB]/50 transition-colors">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 mt-0.5 text-[11px] ${COLOR_CLASSES[ev.color]}`}>
                {COLOR_ICONS[ev.color]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[#111827] font-semibold leading-tight">{ev.label}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[#6B7280] text-[12px]">{formatDateTime(ev.timestamp)}</span>
                  {ev.actor && <span className="text-[#6B7280] text-[11px]">— {ev.actor}</span>}
                </div>
                {(ev.reason || ev.itemChanges || ev.referenceNumber) && (
                  <div className="mt-1.5 space-y-0.5">
                    {ev.reason && <div className="text-[12px] text-[#6B7280]">الملاحظة: {ev.reason}</div>}
                    {ev.referenceNumber && (
                      <div className="text-[12px] text-[#6B7280]">
                        الرقم المرجعى: <span className="font-mono font-semibold text-[#111827]">{ev.referenceNumber}</span>
                      </div>
                    )}
                    {ev.itemChanges?.map((ch, i) => <ItemChangeRow key={i} change={ch} />)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}