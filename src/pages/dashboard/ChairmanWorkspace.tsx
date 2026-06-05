import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function ChairmanWorkspace() {
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
      if (ord.data) setOrders(Array.isArray(ord.data) ? ord.data.slice(0, 10) : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const totalSales = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0)
  const thisMonth = orders.filter(o => o.created_at && new Date(o.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const monthSales = thisMonth.reduce((s, o) => s + Number(o.total_amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مجلس الإدارة</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_orders ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي الطلبات</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{totalSales.toLocaleString('ar-EG')}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي المبيعات</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{monthSales.toLocaleString('ar-EG')}</span></div>
          <span className="text-sm font-semibold text-text">مبيعات الشهر</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{data?.total_customers ?? 0}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي العملاء</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders?filter=pending')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center mb-2"><span className="text-white text-sm font-bold">{data?.pending_orders ?? 0}</span></div>
          <span className="text-xs font-semibold text-text">بانتظار الاعتماد</span>
        </button>
        <button onClick={() => navigate('/collections')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-9 h-9 rounded-lg bg-warning flex items-center justify-center mb-2"><span className="text-white text-sm font-bold">{data?.pending_collections ?? 0}</span></div>
          <span className="text-xs font-semibold text-text">تحصيلات معلقة</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">آخر الطلبات</h3>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {orders.slice(0, 5).map((o: any) => (
            <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border last:border-0 text-right">
              <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
              <span className="text-text-secondary">{Number(o.total_amount || 0).toLocaleString('ar-EG')} ج</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
