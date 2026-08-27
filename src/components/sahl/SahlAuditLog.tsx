import { memo } from 'react'
import { formatDate } from '../../utils/format'

export interface AuditEntry {
  id: string
  action: string
  actionAr?: string
  performedBy?: string
  performedAt: string
  details?: string
  oldValue?: string
  newValue?: string
}

interface SahlAuditLogProps {
  entries: AuditEntry[]
  emptyText?: string
}

const actionColorMap: Record<string, string> = {
  create: 'bg-success/10 text-success',
  approve: 'bg-primary/10 text-primary',
  post: 'bg-success/10 text-success',
  cancel: 'bg-danger/10 text-danger',
  void: 'bg-danger/10 text-danger',
  edit: 'bg-accent/10 text-accent',
  update: 'bg-accent/10 text-accent',
}

export default memo(function SahlAuditLog({ entries, emptyText = 'لا توجد سجلات تغييرات' }: SahlAuditLogProps) {
  if (!entries.length) return <div className="text-center py-6 text-text-secondary text-[10px]">{emptyText}</div>

  return (
    <div className="space-y-2">
      {entries.map((e) => {
        const actionKey = e.action.toLowerCase()
        const colorClass = Object.entries(actionColorMap).find(([k]) => actionKey.includes(k))?.[1] || 'bg-surface text-text-secondary'
        return (
          <div key={e.id} className="flex items-start gap-3 text-xs border-b border-border/40 pb-2 last:border-0">
            <div className="shrink-0 mt-0.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${colorClass}`}>
                {e.actionAr || e.action}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {e.performedBy && <span className="font-semibold text-text">{e.performedBy}</span>}
                <span className="text-text-secondary">{formatDate(e.performedAt)}</span>
              </div>
              {e.details && <div className="text-[10px] text-text-secondary mt-0.5">{e.details}</div>}
              {(e.oldValue || e.newValue) && (
                <div className="text-[10px] mt-0.5">
                  {e.oldValue && <span className="text-danger line-through">{e.oldValue}</span>}
                  {e.oldValue && e.newValue && <span className="text-text-secondary mx-1">→</span>}
                  {e.newValue && <span className="text-success">{e.newValue}</span>}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
