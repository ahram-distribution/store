import { useState } from 'react'
import { formatDateTime } from '../../utils/format'
import type { TimelineEvent } from './order-detail.utils'

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
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
}

export function OrderTimelineSection({ timelineEvents }: OrderTimelineSectionProps) {
  const [expanded, setExpanded] = useState(false)
  console.log('[DEBUG] OrderTimelineSection timelineEvents:', JSON.stringify(timelineEvents.map(e => ({ id: e.id, label: e.label, actor: e.actor })), null, 2))

  if (timelineEvents.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 border-b border-border bg-surface/50 flex items-center justify-between text-xs"
      >
        <h3 className="font-semibold text-text">سجل الأحداث الموحد</h3>
        <span className="text-text-secondary">{expanded ? '−' : '+'} ({timelineEvents.length})</span>
      </button>
      {expanded && (
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {timelineEvents.map((ev) => (
            <div key={ev.id} className="px-3 py-2 text-[11px] flex items-start gap-2">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 mt-0.5 text-[9px] ${COLOR_CLASSES[ev.color]}`}>
                {COLOR_ICONS[ev.color]}
              </span>
              <div className="min-w-0">
                <p className="text-text font-medium leading-tight">{ev.label}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-text-secondary text-[10px]">{formatDateTime(ev.timestamp)}</span>
                  {ev.actor && <span className="text-text-secondary text-[9px]">— {ev.actor}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
