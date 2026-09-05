import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpService, type FollowUp } from '../../services/followUpService'
import { FollowUpCard } from '../../components/followups/FollowUpCard'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function isSameUtcDay(a: string, b: Date): boolean {
  const da = new Date(a)
  return (
    da.getFullYear() === b.getFullYear() &&
    da.getMonth() === b.getMonth() &&
    da.getDate() === b.getDate()
  )
}

export function FollowUpTodayPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    const load = async () => {
      setLoading(true)
      try {
        const items = await followUpService.getMyFollowUps()
        setFollowUps(items)
      } catch {
        setFollowUps([])
      }
      setLoading(false)
    }
    load()
  }, [token])

  const now = new Date()
  const today = followUps.filter(
    (f) => f.status !== 'completed' && f.status !== 'cancelled' && f.due_at && isSameUtcDay(f.due_at, now)
  )
  const overdue = followUps.filter(
    (f) => f.status !== 'completed' && f.status !== 'cancelled' && f.due_at && new Date(f.due_at) < now && !isSameUtcDay(f.due_at, now)
  )
  const upcoming = followUps.filter(
    (f) => f.status !== 'completed' && f.status !== 'cancelled' && (f.due_at === null || !isSameUtcDay(f.due_at, now) && new Date(f.due_at) >= now)
  )
  const openItems = today.length + overdue.length + upcoming.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">لوحة المتابعة</h1>
        <button
          onClick={() => navigate('/followups/new')}
          className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold"
        >
          + متابعة جديدة
        </button>
      </div>

      {/* Quick nav */}
      <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
        <button onClick={() => navigate('/followups/today')} className="flex-1 text-xs py-1.5 rounded-md font-semibold bg-primary text-white">متابعات اليوم</button>
        <button onClick={() => navigate('/followups/queue')} className="flex-1 text-xs py-1.5 rounded-md font-semibold text-text-secondary hover:bg-neutral-50">قائمة المتابعات</button>
        <button onClick={() => navigate('/followups/analytics')} className="flex-1 text-xs py-1.5 rounded-md font-semibold text-text-secondary hover:bg-neutral-50">تحليل</button>
        <button onClick={() => navigate('/customers')} className="flex-1 text-xs py-1.5 rounded-md font-semibold text-text-secondary hover:bg-neutral-50">العملاء</button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-amber-600" dir="ltr">{today.length}</div>
          <div className="text-[11px] text-text-muted">متابعات اليوم</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-danger" dir="ltr">{overdue.length}</div>
          <div className="text-[11px] text-text-muted">متأخرة</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-blue-600" dir="ltr">{upcoming.length}</div>
          <div className="text-[11px] text-text-muted">قادمة</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-text" dir="ltr">{openItems}</div>
          <div className="text-[11px] text-text-muted">إجمالي المفتوحة</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : followUps.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد متابعات بعد</div>
      ) : (
        <div className="space-y-4">
          {today.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-text-amber-600 mb-2">⏰ متابعات اليوم</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {today.map((f) => <FollowUpCard key={f.id} followUp={f} />)}
              </div>
            </section>
          )}
          {overdue.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-danger mb-2">⚠️ متابعات متأخرة</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {overdue.map((f) => <FollowUpCard key={f.id} followUp={f} />)}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-text mb-2">📅 قادمة</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {upcoming.map((f) => <FollowUpCard key={f.id} followUp={f} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}