import { StatusBadge } from '../shared/StatusBadge'

function formatDateTime(dt: string): string {
  try {
    const d = new Date(dt)
    const date = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
    const time = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    return date + ' ' + time
  } catch { return dt }
}

function calcDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'أقل من دقيقة'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return hours > 0
    ? hours + 'س ' + (rem > 0 ? rem + 'د' : '')
    : rem + ' دقيقة'
}

interface VisitCardProps {
  visit: any
  customerName?: string
  employeeName?: string
  onClick: () => void
}

export function VisitCard({ visit, customerName, employeeName, onClick }: VisitCardProps) {
  const isActive = visit.status === 'active'
  const isCompleted = visit.status === 'completed'
  const hasEnd = !!visit.check_out_at

  let cardBorder = 'border border-border'
  let headerBg = 'bg-gradient-to-l from-primary/10 to-primary/5 border-b border-primary/10'
  let codeBg = 'bg-primary text-white'
  let durationColor = 'text-text-secondary'
  if (isActive) {
    cardBorder = 'border border-accent/40'
    headerBg = 'bg-gradient-to-l from-accent/15 to-accent/5 border-b border-accent/10'
    codeBg = 'bg-accent text-white'
    durationColor = 'text-accent font-semibold'
  } else if (isCompleted) {
    cardBorder = 'border border-success/30'
    headerBg = 'bg-gradient-to-l from-success/10 to-success/5 border-b border-success/10'
    codeBg = 'bg-success text-white'
    durationColor = 'text-success font-semibold'
  }

  const name = customerName || visit.customer_name || ''
  const emp = employeeName || visit.employee_name || ''

  return (
    <div onClick={onClick}
      className={'rounded-xl cursor-pointer active:scale-[0.98] transition-all bg-white ' + cardBorder}>
      <div className={'rounded-t-xl px-3 py-2 flex items-center justify-between ' + headerBg}>
        <span className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + codeBg}>
          {visit.code || '—'}
        </span>
        <StatusBadge status={visit.status} />
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-bold text-text">{name}</p>

        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          {emp && (
            <>
              <span className="text-text-secondary">بواسطة</span>
              <span className="text-text font-medium">{emp}</span>
            </>
          )}

          {visit.check_in_at && (
            <>
              <span className="text-text-secondary">البداية</span>
              <span className="text-text">{formatDateTime(visit.check_in_at)}</span>
            </>
          )}

          {hasEnd && (
            <>
              <span className="text-text-secondary">النهاية</span>
              <span className="text-text">{formatDateTime(visit.check_out_at)}</span>
            </>
          )}

          {visit.check_in_at && hasEnd && (
            <>
              <span className="text-text-secondary">المدة</span>
              <span className={durationColor}>{calcDuration(visit.check_in_at, visit.check_out_at)}</span>
            </>
          )}
        </div>

        {visit.notes && (
          <p className="text-[11px] bg-surface/50 rounded-lg px-2 py-1.5 text-text-secondary leading-relaxed mt-1">
            {visit.notes.replace(/^طلب:[a-f0-9-]+\|/, '')}
          </p>
        )}
      </div>
    </div>
  )
}
