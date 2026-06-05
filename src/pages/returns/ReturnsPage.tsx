import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'

const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', inspecting: 'فحص', approved: 'تم الاعتماد', rejected: 'مرفوض' }
const statusColors: Record<string, string> = { pending: 'bg-accent/10 text-accent', inspecting: 'bg-primary/10 text-primary', approved: 'bg-success/10 text-success', rejected: 'bg-danger/10 text-danger' }

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const filterLabels: Record<string, string> = {
  pending: 'مرتجعات معلقة',
}

export function ReturnsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filter = searchParams.get('filter')
  const [returns, setReturns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_returns', { p_token: token }).then(({ data }) => {
      let result = (data as any[]) || []
      if (filter === 'pending') {
        result = result.filter((r: any) => r.status === 'pending')
      }
      setReturns(result)
      setLoading(false)
    })
  }, [filter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {filter && <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>}
          <h1 className="text-lg font-bold text-text">{filter && filterLabels[filter] ? filterLabels[filter] : 'المرتجعات'}</h1>
        </div>
        {!filter && <button onClick={() => navigate('/returns/new')} className="bg-primary text-white text-xs px-3 py-2 rounded-lg">+ مرتجع جديد</button>}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : returns.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد مرتجعات بعد</div>
      ) : (
        <div className="space-y-2">
          {returns.map((r: any) => (
            <div
              key={r.id}
              onClick={() => navigate(`/returns/${r.id}`)}
              className="bg-white rounded-lg border border-border p-3 cursor-pointer active:bg-surface transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text">{r.code}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${statusColors[r.status] || 'bg-surface text-text-secondary'}`}>{statusLabels[r.status] || r.status}</span>
              </div>
              <div className="text-xs text-text-secondary">الطلب: {r.order_id}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-text-secondary">{formatDate(r.created_at)}</span>
                <span className="text-sm font-bold text-danger">{r.credit_note_amount ? formatCurrencyShort(r.credit_note_amount) : '-'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
