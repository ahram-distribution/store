import { useNavigate } from 'react-router-dom'
import type { FollowUp } from '../../services/followUpService'

export const FOLLOW_UP_PRIORITY_LABELS: Record<string, string> = {
  low: 'منخفضة',
  normal: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
}

export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغية',
}

export const FOLLOW_UP_PRIORITY_COLORS: Record<string, string> = {
  low: '#64748B',
  normal: '#2563EB',
  high: '#F59E0B',
  critical: '#DC2626',
}

export const FOLLOW_UP_STATUS_COLORS: Record<string, string> = {
  open: '#2563EB',
  in_progress: '#7C3AED',
  completed: '#059669',
  cancelled: '#94A3B8',
}

export function formatFollowUpDue(iso: string | null): { sameDay: boolean; overdue: boolean; label: string } {
  if (!iso) return { sameDay: false, overdue: false, label: 'بدون موعد' }
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const dateStr = d.toLocaleDateString('ar-EG-u-nu-latn', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
  const overdue = !sameDay && d < now && d.toDateString() !== now.toDateString()
  return {
    sameDay,
    overdue,
    label: `${sameDay ? 'اليوم' : dateStr} ${timeStr}`,
  }
}

interface FollowUpCardProps {
  followUp: FollowUp
}

export function FollowUpCard({ followUp }: FollowUpCardProps) {
  const navigate = useNavigate()
  const due = formatFollowUpDue(followUp.due_at)
  const priorityColor = FOLLOW_UP_PRIORITY_COLORS[followUp.priority] || '#2563EB'
  const statusColor = FOLLOW_UP_STATUS_COLORS[followUp.status] || '#64748B'

  return (
    <button
      onClick={() => navigate(`/followups/${followUp.id}`)}
      className="w-full text-right bg-white rounded-lg border border-border p-3 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityColor }} />
            <h3 className="text-sm font-bold text-text truncate">{followUp.title}</h3>
          </div>
          <p className="text-xs text-text-muted mt-1 truncate">{followUp.customer_name || 'عميل'}</p>
        </div>
        <span
          className="shrink-0 text-[10px] px-2 py-1 rounded-lg font-semibold"
          style={{ background: `${statusColor}18`, color: statusColor }}
        >
          {FOLLOW_UP_STATUS_LABELS[followUp.status] || followUp.status}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2 text-[11px] text-text-secondary flex-wrap">
        <span className={due.sameDay ? 'text-amber-600 font-semibold' : due.overdue ? 'text-danger font-semibold' : ''}>
          ⏰ {due.label}
        </span>
        {followUp.assignee_name && <span>· {followUp.assignee_name}</span>}
      </div>
    </button>
  )
}