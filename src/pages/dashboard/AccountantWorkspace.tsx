import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function AccountantWorkspace() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_collections', { p_token: token }),
      supabase.rpc('get_governed_orders', { p_token: token }),
    ]).then(([col, ord]) => {
      if (col.data) setCollections(Array.isArray(col.data) ? col.data : [])
      if (ord.data) setOrders(Array.isArray(ord.data) ? ord.data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pendingCol = collections.filter((c: any) => c.status === 'pending' || !c.collected_at)
  const todayCol = collections.filter((c: any) => c.collected_at && new Date(c.collected_at).toDateString() === new Date().toDateString())
  const todayColTotal = todayCol.reduce((s, c) => s + Number(c.amount || 0), 0)
  const pendingTotal = pendingCol.reduce((s, c) => s + Number(c.amount || 0), 0)
  const deliveredNotCollected = orders.filter((o: any) => o.status === 'delivered')

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-teal-700 to-teal-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">محاسب</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pendingCol.length}</span></div>
          <span className="text-sm font-semibold text-text">تحصيلات معلقة</span>
        </div>
        <button onClick={() => navigate('/collections')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{formatCurrencyShort(pendingTotal)}</span></div>
          <span className="text-sm font-semibold text-text">قيمة معلقة</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayCol.length}</span></div>
          <span className="text-sm font-semibold text-text">تحصيلات اليوم</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{formatCurrencyShort(todayColTotal)}</span></div>
          <span className="text-sm font-semibold text-text">قيمة اليوم</span>
        </div>
      </div>

      {deliveredNotCollected.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">طلبات تم تسليمها (بانتظار التحصيل) — {deliveredNotCollected.length}</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {deliveredNotCollected.slice(0, 5).map((o: any) => (
              <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
                <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
                <span className="text-text-secondary">{formatCurrencyShort(Number(o.total_amount || 0))}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/collections')} className="bg-primary text-white text-xs py-2.5 rounded-lg">التحصيلات</button>
          <button onClick={() => navigate('/collections/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">تسجيل تحصيل</button>
          <button onClick={() => navigate('/orders')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">الطلبات</button>
          <button onClick={() => navigate('/returns')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">المرتجعات</button>
        </div>
      </div>
    </div>
  )
}
