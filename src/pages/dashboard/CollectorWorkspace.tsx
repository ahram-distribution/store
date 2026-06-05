import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CollectorWorkspace() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_collections', { p_token: token }).then(({ data }) => {
      if (data) setCollections(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pending = collections.filter((c: any) => c.status === 'pending' || !c.collected_at)
  const today = collections.filter((c: any) => c.collected_at && new Date(c.collected_at).toDateString() === new Date().toDateString())
  const todayTotal = today.reduce((s, c) => s + Number(c.amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">محصل</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/collections?filter=pending')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pending.length}</span></div>
          <span className="text-sm font-semibold text-text">تحصيلات معلقة</span>
        </button>
        <button onClick={() => navigate('/collections/new')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{today.length}</span></div>
          <span className="text-sm font-semibold text-text">تم تحصيلها اليوم</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayTotal.toLocaleString('ar-EG')}</span></div>
          <span className="text-sm font-semibold text-text">قيمة المحصل اليوم</span>
        </div>
        <button onClick={() => navigate('/collections')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{collections.length}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي التحصيلات</span>
        </button>
      </div>

      {pending.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">تحصيلات معلقة</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {pending.slice(0, 5).map((c: any) => (
              <button key={c.id} onClick={() => navigate(`/collections/${c.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
                <span className="text-text font-semibold">{c.customer_name || c.id?.slice(0, 8)}</span>
                <span className="text-text-secondary">{Number(c.amount || 0).toLocaleString('ar-EG')} ج</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/collections/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">تسجيل تحصيل</button>
          <button onClick={() => navigate('/collections')} className="bg-primary text-white text-xs py-2.5 rounded-lg">كل التحصيلات</button>
          <button onClick={() => navigate('/customers')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">العملاء</button>
          <button onClick={() => navigate('/orders')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">الطلبات</button>
        </div>
      </div>
    </div>
  )
}
