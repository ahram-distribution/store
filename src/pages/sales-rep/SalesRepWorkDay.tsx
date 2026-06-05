import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface DashboardData {
  today_orders: number
  pending_followup: number
  inactive_customers: number
  today_visits: number
  today_collections: number
}

interface Opportunity {
  type: 'no_order' | 'new_customer' | 'needs_followup'
  customerName: string
  customerId: string
  detail: string
}

const MONTH_START = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
const TODAY_START = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  return iso >= TODAY_START
}

export function SalesRepWorkDay() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [visits, setVisits] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_dashboard_sales', { p_token: token }),
      supabase.rpc('get_governed_orders', { p_token: token }),
      supabase.rpc('get_governed_visits', { p_token: token }),
      supabase.rpc('get_governed_customers', { p_token: token }),
    ]).then(([dashRes, ordersRes, visitsRes, custRes]) => {
      if (dashRes.data) setDashboard(dashRes.data as DashboardData)
      if (ordersRes.data) setOrders(ordersRes.data as any[])
      if (visitsRes.data) setVisits(visitsRes.data as any[])
      if (custRes.data) setCustomers(custRes.data as any[])
      setLoading(false)
    })
  }, [])

  const monthlySales = useMemo(() => {
    return orders
      .filter((o) => o.created_at >= MONTH_START)
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
  }, [orders])

  const todayVisitsTotal = useMemo(() => visits.filter((v) => isToday(v.created_at)).length, [visits])
  const todayVisitsDone = useMemo(() => visits.filter((v) => isToday(v.created_at) && v.status !== 'active').length, [visits])

  const opportunities = useMemo<Opportunity[]>(() => {
    const result: Opportunity[] = []
    const customerLastOrder = new Map<string, string>()
    const customerLastVisit = new Map<string, string>()
    for (const o of orders) {
      const existing = customerLastOrder.get(o.customer_id)
      if (!existing || o.created_at > existing) customerLastOrder.set(o.customer_id, o.created_at)
    }
    for (const v of visits) {
      const existing = customerLastVisit.get(v.customer_id)
      if (!existing || v.created_at > existing) customerLastVisit.set(v.customer_id, v.created_at)
    }
    const now = Date.now()
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (const c of customers) {
      const lastOrder = customerLastOrder.get(c.id)
      const lastVisit = customerLastVisit.get(c.id)
      const created = c.created_at
      if (created && (now - new Date(created).getTime()) < SEVEN_DAYS) {
        result.push({ type: 'new_customer', customerName: c.company_name || c.companyName, customerId: c.id, detail: 'عميل جديد' })
        continue
      }
      if (lastOrder && (now - new Date(lastOrder).getTime()) > THIRTY_DAYS) {
        result.push({ type: 'no_order', customerName: c.company_name || c.companyName, customerId: c.id, detail: 'لم يطلب منذ 30 يوماً' })
        continue
      }
      if (!lastVisit || (now - new Date(lastVisit).getTime()) > SEVEN_DAYS) {
        result.push({ type: 'needs_followup', customerName: c.company_name || c.companyName, customerId: c.id, detail: 'يحتاج متابعة' })
      }
    }
    return result.slice(0, 5)
  }, [customers, orders, visits])

  const lastOrder = useMemo(() => {
    const sorted = [...orders].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return sorted[0] || null
  }, [orders])

  const lastVisit = useMemo(() => {
    const sorted = [...visits].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return sorted[0] || null
  }, [visits])

  const lastCustomer = useMemo(() => {
    const sorted = [...customers].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return sorted[0] || null
  }, [customers])

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'صباح الخير'
    return 'مساء الخير'
  })()

  const indicators = [
    { label: 'مبيعات الشهر', value: monthlySales.toLocaleString() + ' ج', color: 'bg-primary', sub: '' },
    { label: 'متابعة عملاء', value: dashboard?.inactive_customers ?? 0, color: 'bg-accent', sub: 'عميل يحتاج متابعة' },
    { label: 'زيارات اليوم', value: `${todayVisitsDone} / ${todayVisitsTotal}`, color: 'bg-success', sub: 'تم / إجمالي' },
  ]

  return (
    <div className="space-y-5 pb-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-5 -mx-4 px-4">
        <p className="text-sm opacity-90">{greeting}</p>
        <h1 className="text-xl font-bold mt-1">{user?.full_name || 'المندوب'}</h1>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text mb-3">مؤشرات اليوم</h2>
        <div className="grid grid-cols-3 gap-2">
          {indicators.map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-border p-3 text-center">
              <div className={`w-8 h-8 rounded-xl ${item.color} flex items-center justify-center mx-auto mb-1.5`}>
                <span className="text-white text-sm font-bold">{typeof item.value === 'number' ? item.value : item.value}</span>
              </div>
              <span className="text-[11px] font-semibold text-text block">{item.label}</span>
              {item.sub && <span className="text-[9px] text-text-secondary block mt-0.5">{item.sub}</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/visits/screen')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">V</span>
            </div>
            <p className="text-sm font-semibold text-text">ابدأ زيارة</p>
            <p className="text-[10px] text-text-secondary mt-0.5">تسجيل زيارة جديدة</p>
          </button>
          <button onClick={() => navigate('/orders/new')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">N</span>
            </div>
            <p className="text-sm font-semibold text-text">طلب سريع</p>
            <p className="text-[10px] text-text-secondary mt-0.5">إنشاء طلب جديد</p>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">S</span>
            </div>
            <p className="text-sm font-semibold text-text">ابحث عن عميل</p>
            <p className="text-[10px] text-text-secondary mt-0.5">قائمة العملاء</p>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors opacity-60">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">+</span>
            </div>
            <p className="text-sm font-semibold text-text">عميل جديد</p>
            <p className="text-[10px] text-text-secondary mt-0.5">قريباً</p>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">C</span>
            </div>
            <p className="text-sm font-semibold text-text">عملائي</p>
            <p className="text-[10px] text-text-secondary mt-0.5">قائمة العملاء</p>
          </button>
          <button onClick={() => navigate('/orders')}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <span className="text-primary text-sm font-bold">O</span>
            </div>
            <p className="text-sm font-semibold text-text">فواتيري</p>
            <p className="text-[10px] text-text-secondary mt-0.5">فواتير وطلبات</p>
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text mb-3">فرص البيع اليوم</h2>
        {opportunities.length > 0 ? (
          <div className="space-y-2">
            {opportunities.map((opp) => (
              <button key={opp.customerId + opp.type} onClick={() => navigate(`/customers/${opp.customerId}`)}
                className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">{opp.customerName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    opp.type === 'new_customer' ? 'bg-success/10 text-success' :
                    opp.type === 'no_order' ? 'bg-warning/10 text-warning' :
                    'bg-accent/10 text-accent'
                  }`}>{opp.detail}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-border p-6 text-center">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <span className="text-primary text-sm font-bold">!</span>
            </div>
            <p className="text-sm text-text-secondary">لا توجد فرص متاحة حالياً</p>
            <p className="text-[11px] text-text-secondary mt-1">يمكنك متابعة العملاء من قائمة العملاء</p>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text mb-3">آخر النشاط</h2>
        <div className="space-y-2">
          <button onClick={() => lastOrder && navigate(`/orders/${lastOrder.id}`)}
            className="w-full bg-white rounded-xl border border-border p-3 text-right cursor-pointer active:bg-surface transition-colors disabled:opacity-100 disabled:cursor-default" disabled={!lastOrder}>
            <span className="text-[10px] text-text-secondary">آخر طلب</span>
            {lastOrder ? (
              <p className="text-sm font-semibold text-text mt-0.5">
                طلب #{lastOrder.order_number || lastOrder.id?.slice(0, 8)} — {Number(lastOrder.total_amount || 0).toLocaleString()} ج
              </p>
            ) : (
              <p className="text-sm text-text-secondary mt-0.5">لا توجد طلبات</p>
            )}
          </button>
          <div className="bg-white rounded-xl border border-border p-3">
            <span className="text-[10px] text-text-secondary">آخر زيارة</span>
            {lastVisit ? (
              <p className="text-sm font-semibold text-text mt-0.5">
                زيارة {lastVisit.visit_result ? `— ${lastVisit.visit_result}` : '(نشطة)'}
              </p>
            ) : (
              <p className="text-sm text-text-secondary mt-0.5">لا توجد زيارات</p>
            )}
          </div>
          <button onClick={() => lastCustomer && navigate(`/customers/${lastCustomer.id}`)}
            className="w-full bg-white rounded-xl border border-border p-3 text-right cursor-pointer active:bg-surface transition-colors disabled:opacity-100 disabled:cursor-default" disabled={!lastCustomer}>
            <span className="text-[10px] text-text-secondary">آخر عميل جديد</span>
            {lastCustomer ? (
              <p className="text-sm font-semibold text-text mt-0.5">{lastCustomer.company_name || lastCustomer.companyName || 'عميل'}</p>
            ) : (
              <p className="text-sm text-text-secondary mt-0.5">لا يوجد</p>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
