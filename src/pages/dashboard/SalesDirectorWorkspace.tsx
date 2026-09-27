import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'
import { OrderOwnershipInfo } from '../../components/orders/OrderOwnershipInfo'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function SalesDirectorWorkspace() {
  const navigate = useNavigate()
  const [pendingOrders, setPendingOrders] = useState<any[]>([])
  const [pendingTotal, setPendingTotal] = useState(0)
  const [approvedTotal, setApprovedTotal] = useState(0)
  const [todayVisits, setTodayVisits] = useState(0)
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString()
    // Orders are needed only as two counters plus at most 5 'submitted' rows, so
    // the status filters/counts run server-side instead of downloading every
    // order and filtering in the browser. The employees call is unchanged.
    Promise.all([
      supabase.rpc('get_unified_orders', { p_token: token, p_status: 'submitted', p_page: 1, p_per_page: 5 }),
      supabase.rpc('get_unified_orders', { p_token: token, p_status: 'submitted', p_count_only: true }),
      supabase.rpc('get_unified_orders', { p_token: token, p_status: 'approved', p_count_only: true }),
      supabase.rpc('get_governed_visits', { p_token: token, p_date_from: todayStart, p_date_to: todayEnd, p_count_only: true }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([ord, pendCnt, apprCnt, vis, emp]) => {
      if (ord.data) setPendingOrders(Array.isArray(ord.data) ? ord.data : [])
      const pc = pendCnt.data as any
      if (pc && typeof pc === 'object' && 'count' in pc) setPendingTotal(Number(pc.count) || 0)
      const ac = apprCnt.data as any
      if (ac && typeof ac === 'object' && 'count' in ac) setApprovedTotal(Number(ac.count) || 0)
      const vc = vis.data as any
      if (vc && typeof vc === 'object' && 'count' in vc) setTodayVisits(Number(vc.count))
      if (emp.data) setEmployees(emp.data)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pendingApproval = pendingOrders
  const pendingApprovalCount = pendingTotal
  const readyDispatchCount = approvedTotal
  const activeReps = employees.filter(e => e.is_active).length

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">مدير المبيعات</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/orders?filter=submitted')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pendingApprovalCount}</span></div>
          <span className="text-sm font-semibold text-text">بانتظار الاعتماد</span>
        </button>
        <button onClick={() => navigate('/orders?filter=approved')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{readyDispatchCount}</span></div>
          <span className="text-sm font-semibold text-text">جاهزة للتوصيل</span>
        </button>
        <button onClick={() => navigate('/visits?filter=today')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{todayVisits}</span></div>
          <span className="text-sm font-semibold text-text">زيارات اليوم</span>
        </button>
        <button onClick={() => navigate('/employees')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{activeReps}</span></div>
          <span className="text-sm font-semibold text-text">مندوبين نشطين</span>
        </button>
      </div>

      {pendingApprovalCount > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-text mb-3">بانتظار الاعتماد ({pendingApprovalCount})</h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {pendingApproval.slice(0, 5).map((o: any) => (
              <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="w-full text-xs py-1.5 border-b border-border last:border-0 text-right">
                <div className="flex justify-between items-center">
                  <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
                  <span className="text-text-secondary">{formatCurrencyShort(Number(o.total_amount || 0))}</span>
                </div>
                <div className="text-[10px] text-text-secondary mt-0.5">
                  {o.customer_name && <span>{o.customer_name}</span>}
                  {o.created_by_name && (
                    <span className="mr-2">
                      <OrderOwnershipInfo
                        creatorName={o.created_by_name}
                        creatorId={o.created_by_id}
                        ownerId={o.owner_id}
                        currentOwnerName={o.owner_name}
                        label="| منشئ:"
                        compact
                      />
                    </span>
                  )}
                </div>
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
