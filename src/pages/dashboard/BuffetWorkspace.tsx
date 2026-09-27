import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function BuffetWorkspace() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<{ total: number; submitted: number; preparing: number; ready: number }>({
    total: 0, submitted: 0, preparing: 0, ready: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    // This screen renders counters only — it never lists an order row. The RPC
    // summary returns the total plus per-status counts, replacing a full
    // order-dataset download that was only used for .length values.
    supabase.rpc('get_unified_orders', { p_token: token, p_summary: true }).then(({ data }) => {
      const d = data as any
      if (d && typeof d === 'object' && !d.error) {
        const sc = (d.status_counts && typeof d.status_counts === 'object') ? d.status_counts : {}
        const n = (k: string) => Number(sc[k] || 0)
        setCounts({
          total: Number(d.count || 0),
          submitted: n('submitted'),
          preparing: n('preparing') + n('approved'),
          ready: n('ready'),
        })
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pending = counts.submitted
  const preparing = counts.preparing
  const ready = counts.ready
  const total = counts.total

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-orange-700 to-orange-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">بوفيه</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/pos')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pending}</span></div>
          <span className="text-sm font-semibold text-text">طلبات جديدة</span>
        </button>
        <button onClick={() => navigate('/pos?filter=preparing')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{preparing}</span></div>
          <span className="text-sm font-semibold text-text">قيد التحضير</span>
        </button>
        <button onClick={() => navigate('/pos?filter=ready')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{ready}</span></div>
          <span className="text-sm font-semibold text-text">جاهزة للتسليم</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{total}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي الطلبات</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/pos')} className="bg-primary text-white text-xs py-2.5 rounded-lg">نقطة البيع</button>
          <button onClick={() => navigate('/kitchen')} className="bg-primary text-white text-xs py-2.5 rounded-lg">المطبخ</button>
        </div>
      </div>
    </div>
  )
}
