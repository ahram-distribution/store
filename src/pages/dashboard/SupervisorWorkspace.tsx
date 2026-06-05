import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function SupervisorWorkspace() {
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_dashboard_management', { p_token: token }),
      supabase.rpc('get_governed_orders', { p_token: token }),
    ]).then(([mgmt, ord]) => {
      setData(mgmt.data)
      if (ord.data) setOrders(Array.isArray(ord.data) ? ord.data.filter((o: any) => o.status === 'submitted').slice(0, 5) : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-indigo-700 to-indigo-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مشرف</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_orders ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">الطلبات</span>
        </button>
        <button onClick={() => navigate('/orders/approval-queue')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.pending_orders ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">بانتظار الاعتماد</span>
        </button>
        <button onClick={() => navigate('/customers')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_customers ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">العملاء</span>
        </button>
        <button onClick={() => navigate('/visits')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.active_visits ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">زيارات نشطة</span>
        </button>
      </div>

      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">بانتظار الاعتماد ({orders.length})</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {orders.map((o: any) => (
              <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
                <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
                <span className="text-text-secondary">{Number(o.total_amount || 0).toLocaleString('ar-EG')} ج</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/orders/approval-queue')} className="bg-accent text-white text-xs py-2.5 rounded-lg">اعتماد الطلبات</button>
          <button onClick={() => navigate('/orders')} className="bg-primary text-white text-xs py-2.5 rounded-lg">كل الطلبات</button>
          <button onClick={() => navigate('/customers')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">العملاء</button>
          <button onClick={() => navigate('/collections')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">التحصيلات</button>
        </div>
      </div>
    </div>
  )
}
