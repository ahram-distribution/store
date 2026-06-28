import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function WarehouseManagerWorkspace() {
  const navigate = useNavigate()
  const [counters, setCounters] = useState<Record<string, number>>({})
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_dashboard_warehouse', { p_token: token }),
      supabase.rpc('get_governed_waiting_preparations', { p_token: token }),
    ]).then(([cnt, q]) => {
      const map: Record<string, number> = {}
      ;(cnt.data || []).forEach((row: any) => { map[row.counter] = Number(row.value) })
      setCounters(map)
      if (q.data) setQueue(Array.isArray(q.data) ? q.data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-amber-700 to-amber-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مدير المستودع</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/warehouse?tab=waiting')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{counters['waiting_preparation'] ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">بانتظار التجهيز</span>
        </button>
        <button onClick={() => navigate('/warehouse?tab=in_progress')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{counters['in_preparation'] ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">قيد التجهيز</span>
        </button>
        <button onClick={() => navigate('/warehouse/review')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{counters['ready_for_delivery'] ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">جاهز للمراجعة</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-warning flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{counters['delayed_preps'] ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">متأخر</span>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">بانتظار التجهيز ({queue.length})</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {queue.slice(0, 5).map((item: any) => (
              <button key={item.id} onClick={() => navigate(`/warehouse/prep/${item.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
                <span className="text-text font-semibold">{item.order_number || item.id?.slice(0, 8)}</span>
                <span className="text-text-secondary">{item.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/warehouse')} className="bg-primary text-white text-xs py-2.5 rounded-lg">المستودع</button>
          <button onClick={() => navigate('/warehouse/review')} className="bg-primary text-white text-xs py-2.5 rounded-lg">مراجعة</button>
          <button onClick={() => navigate('/products/manage')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">المنتجات</button>
          <button onClick={() => navigate('/inventory')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">المخزون</button>
        </div>
      </div>
    </div>
  )
}
