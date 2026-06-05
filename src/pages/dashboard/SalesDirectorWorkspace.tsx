import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function SalesDirectorWorkspace() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<any[]>([])
  const [visits, setVisits] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_orders', { p_token: token }),
      supabase.rpc('get_governed_visits', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([ord, vis, emp]) => {
      if (ord.data) setOrders(Array.isArray(ord.data) ? ord.data : [])
      if (vis.data) setVisits(Array.isArray(vis.data) ? vis.data : [])
      if (emp.data) setEmployees(emp.data)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pendingApproval = orders.filter((o: any) => o.status === 'submitted')
  const readyDispatch = orders.filter((o: any) => o.status === 'approved')
  const todayVisits = visits.filter((v: any) => v.check_in_at && new Date(v.check_in_at).toDateString() === new Date().toDateString())
  const activeReps = employees.filter(e => e.is_active).length

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مدير المبيعات</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders?filter=submitted')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pendingApproval.length}</span></div>
          <span className="text-sm font-semibold text-text">بانتظار الاعتماد</span>
        </button>
        <button onClick={() => navigate('/orders?filter=approved')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{readyDispatch.length}</span></div>
          <span className="text-sm font-semibold text-text">جاهزة للتوصيل</span>
        </button>
        <button onClick={() => navigate('/visits?filter=today')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayVisits.length}</span></div>
          <span className="text-sm font-semibold text-text">زيارات اليوم</span>
        </button>
        <button onClick={() => navigate('/employees')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{activeReps}</span></div>
          <span className="text-sm font-semibold text-text">مندوبين نشطين</span>
        </button>
      </div>

      {pendingApproval.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">بانتظار الاعتماد ({pendingApproval.length})</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {pendingApproval.slice(0, 5).map((o: any) => (
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
          <button onClick={() => navigate('/orders/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">طلب جديد</button>
          <button onClick={() => navigate('/customers')} className="bg-primary text-white text-xs py-2.5 rounded-lg">العملاء</button>
        </div>
      </div>
    </div>
  )
}
