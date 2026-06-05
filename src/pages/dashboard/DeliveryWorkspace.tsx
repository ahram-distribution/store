import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function DeliveryWorkspace() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_deliveries', { p_token: token }).then(({ data }) => {
      if (data) setOrders(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pendingDlv = orders.filter((o: any) => o.status === 'ready' || o.status === 'ready_for_delivery')
  const inTransit = orders.filter((o: any) => o.status === 'in_transit' || o.status === 'out_for_delivery')
  const delivered = orders.filter((o: any) => o.status === 'delivered')
  const todayDlv = orders.filter((o: any) => o.updated_at && new Date(o.updated_at).toDateString() === new Date().toDateString())

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-indigo-700 to-indigo-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">توصيل</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders?filter=ready')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pendingDlv.length}</span></div>
          <span className="text-sm font-semibold text-text">بانتظار التوصيل</span>
        </button>
        <button onClick={() => navigate('/orders?filter=in_transit')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{inTransit.length}</span></div>
          <span className="text-sm font-semibold text-text">قيد التوصيل</span>
        </button>
        <button onClick={() => navigate('/orders?filter=delivered')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{delivered.length}</span></div>
          <span className="text-sm font-semibold text-text">تم التوصيل</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayDlv.length}</span></div>
          <span className="text-sm font-semibold text-text">توصيلات اليوم</span>
        </div>
      </div>

      {pendingDlv.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">بانتظار التوصيل ({pendingDlv.length})</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {pendingDlv.slice(0, 5).map((o: any) => (
              <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
                <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
                <span className="text-text-secondary">{o.customer_name || '—'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/orders?filter=ready')} className="bg-primary text-white text-xs py-2.5 rounded-lg">توصيل جديد</button>
          <button onClick={() => navigate('/delivery/route')} className="bg-primary text-white text-xs py-2.5 rounded-lg">مسار التوصيل</button>
        </div>
      </div>
    </div>
  )
}
