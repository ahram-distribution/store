import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpService, type FollowUp } from '../../services/followUpService'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const VIEWS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'today', label: 'اليوم', icon: '📌' },
  { key: 'upcoming', label: 'القادم', icon: '📅' },
  { key: 'overdue', label: 'المتأخر', icon: '⚠️' },
  { key: 'completed', label: 'المكتمل', icon: '✅' },
  { key: 'cancelled', label: 'الملغي', icon: '🚫' },
]

const PRIORITY_LABELS: Record<string, string> = { low: 'منخفضة', normal: 'عادية', high: 'عالية', critical: 'عاجلة' }

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function FollowUpNotebookPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [view, setView] = useState('today')
  const [items, setItems] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      setItems(await followUpService.getQueue())
    } catch { setItems([]) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const now = new Date()
    const todayK = dayKey(now)
    return items.filter((f) => {
      const due = f.due_at ? new Date(f.due_at) : null
      switch (view) {
        case 'today':
          if (f.status !== 'open' && f.status !== 'in_progress') return false
          if (!due) return false
          return dayKey(due) === todayK
        case 'upcoming':
          if (f.status !== 'open' && f.status !== 'in_progress') return false
          if (!due) return false
          return due.getTime() >= now.getTime()
        case 'overdue':
          if (f.status !== 'open' && f.status !== 'in_progress') return false
          if (!due) return false
          return due.getTime() < now.getTime()
        case 'completed':
          return f.status === 'completed'
        case 'cancelled':
          return f.status === 'cancelled'
        default:
          return true
      }
    })
  }, [items, view])

  const groups = useMemo(() => {
    const g = new Map<string, FollowUp[]>()
    filtered.forEach((f) => {
      const due = f.due_at ? dayKey(new Date(f.due_at)) : 'بدون موعد'
      const list = g.get(due) || []
      list.push(f)
      g.set(due, list)
    })
    return Array.from(g.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  }, [filtered])

  const complete = async (id: string) => {
    try {
      await followUpService.completeFollowUp(id, 'مكتملة من المفكرة')
      await load()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">المفكرة اليومية</h1>
        <button onClick={() => navigate('/followups/new')} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ متابعة جديدة</button>
      </div>

      <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 text-[11px] py-1.5 rounded-md font-semibold transition-colors ${
              view === v.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-neutral-50'
            }`}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد متابعات في هذا التصنيف</div>
      ) : (
        <div className="space-y-3">
          {groups.map(([date, rows]) => (
            <div key={date}>
              <div className="text-[11px] font-bold text-text-muted mb-1">
                {date === 'بدون موعد' ? 'بدون موعد' : date === dayKey(new Date()) ? 'اليوم' : new Date(date).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div className="space-y-1.5">
                {rows.map((f) => (
                  <div key={f.id} className="bg-white rounded-lg border border-border p-2.5 flex items-center gap-2">
                    <button
                      onClick={() => { if (view === 'today') complete(f.id) }}
                      className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px] ${f.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent'}`}
                      title={view === 'today' ? 'إكمال' : f.status === 'completed' ? 'مكتملة' : ''}
                    >✓</button>
                    <button onClick={() => navigate(`/followups/${f.id}`)} className="flex-1 min-w-0 text-right">
                      <div className="text-xs font-bold text-text truncate">{f.customer_name || 'عميل'} — {f.title}</div>
                      <div className="text-[10px] text-text-secondary truncate flex gap-2">
                        {f.customer_phone && <span dir="ltr">{f.customer_phone}</span>}
                        <span className={f.priority === 'critical' ? 'text-danger font-semibold' : ''}>{PRIORITY_LABELS[f.priority] || f.priority}</span>
                        {f.assignee_name && <span>المسؤول: {f.assignee_name}</span>}
                      </div>
                    </button>
                    {f.customer_id && (
                      <button onClick={() => navigate(`/followups/customers/${f.customer_id}`)} className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-1 rounded-lg shrink-0">العميل</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}