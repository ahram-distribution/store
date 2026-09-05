import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpService, type FollowUp } from '../../services/followUpService'
import { FollowUpCard } from '../../components/followups/FollowUpCard'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'open', label: 'مفتوحة' },
  { key: 'in_progress', label: 'جارية' },
  { key: 'completed', label: 'مكتملة' },
  { key: 'cancelled', label: 'ملغية' },
]

export function FollowUpQueuePage() {
  const navigate = useNavigate()
  const token = getToken()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState('all')
  const [showCompleted, setShowCompleted] = useState(false)

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const items = await followUpService.getQueue()
      setFollowUps(items)
    } catch {
      setFollowUps([])
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const filtered = followUps.filter((f) => {
    if (statusTab !== 'all' && f.status !== statusTab) return false
    if (f.status === 'completed' && !showCompleted) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">قائمة المتابعات</h1>
        <button
          onClick={() => navigate('/followups/new')}
          className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold"
        >
          + متابعة جديدة
        </button>
      </div>

      <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusTab(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${
              statusTab === t.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-neutral-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(e) => setShowCompleted(e.target.checked)}
          className="accent-primary"
        />
        عرض المكتملة
      </label>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد متابعات</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((f) => <FollowUpCard key={f.id} followUp={f} />)}
        </div>
      )}
    </div>
  )
}