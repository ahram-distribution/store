import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort } from '../../utils/format'

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
  monthlyOrderTotal: number
  monthlyOrderCount: number
  monthlyVisitCount: number
  lastOrderDate: string | null
  lastOrderValue: number
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
      supabase.rpc('get_unified_orders', { p_token: token }),
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

  const monthlyOrdersCount = useMemo(() => orders.filter((o) => o.created_at >= MONTH_START).length, [orders])
  const monthlyVisitsCount = useMemo(() => visits.filter((v) => v.created_at >= MONTH_START).length, [visits])
  const monthlyNewCustomersCount = useMemo(() => customers.filter((c) => c.created_at >= MONTH_START).length, [customers])

  const todayVisitsTotal = useMemo(() => visits.filter((v) => isToday(v.created_at)).length, [visits])
  const todayVisitsDone = useMemo(() => visits.filter((v) => isToday(v.created_at) && v.status !== 'active').length, [visits])

  const opportunities = useMemo<Opportunity[]>(() => {
    const result: Opportunity[] = []
    const customerLastOrder = new Map<string, { date: string; value: number }>()
    const customerLastVisit = new Map<string, string>()
    const customerOrders = new Map<string, { total: number; count: number }>()
    const customerVisits = new Map<string, number>()
    for (const o of orders) {
      const cid = o.customer_id
      const existing = customerLastOrder.get(cid)
      if (!existing || o.created_at > existing.date) customerLastOrder.set(cid, { date: o.created_at, value: Number(o.total_amount || 0) })
      if (o.created_at >= MONTH_START) {
        const prev = customerOrders.get(cid) || { total: 0, count: 0 }
        prev.total += Number(o.total_amount || 0)
        prev.count++
        customerOrders.set(cid, prev)
      }
    }
    for (const v of visits) {
      const cid = v.customer_id || v.customerId
      const existing = customerLastVisit.get(cid)
      if (!existing || v.created_at > existing) customerLastVisit.set(cid, v.created_at)
      if (v.created_at >= MONTH_START) {
        customerVisits.set(cid, (customerVisits.get(cid) || 0) + 1)
      }
    }
    const now = Date.now()
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (const c of customers) {
      const cid = c.id
      const lastOrd = customerLastOrder.get(cid)
      const lastVisit = customerLastVisit.get(cid)
      const created = c.created_at
      const ord = customerOrders.get(cid) || { total: 0, count: 0 }
      const vis = customerVisits.get(cid) || 0
      if (created && (now - new Date(created).getTime()) < SEVEN_DAYS) {
        result.push({ type: 'new_customer', customerName: c.company_name || c.companyName, customerId: cid, detail: 'عميل جديد', monthlyOrderTotal: ord.total, monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd?.date || null, lastOrderValue: lastOrd?.value || 0 })
        continue
      }
      if (lastOrd && (now - new Date(lastOrd.date).getTime()) > THIRTY_DAYS) {
        result.push({ type: 'no_order', customerName: c.company_name || c.companyName, customerId: cid, detail: 'لم يطلب منذ 30 يوماً', monthlyOrderTotal: ord.total, monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd.date, lastOrderValue: lastOrd.value })
        continue
      }
      if (!lastVisit || (now - new Date(lastVisit).getTime()) > SEVEN_DAYS) {
        result.push({ type: 'needs_followup', customerName: c.company_name || c.companyName, customerId: cid, detail: 'يحتاج متابعة', monthlyOrderTotal: ord.total, monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd?.date || null, lastOrderValue: lastOrd?.value || 0 })
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
    { label: 'مبيعات الشهر', value: formatCurrencyShort(monthlySales), color: 'bg-primary', sub: '' },
    { label: 'متابعة عملاء', value: dashboard?.inactive_customers ?? 0, color: 'bg-accent', sub: 'عميل يحتاج متابعة' },
    { label: 'زيارات اليوم', value: `${todayVisitsDone} / ${todayVisitsTotal}`, color: 'bg-success', sub: 'تم / إجمالي' },
  ]

  return (
    <div className="space-y-5 pb-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-5 -mx-4 px-4 flex items-start justify-between" dir="rtl">
        <div className="text-right">
          <p className="text-sm opacity-90">{greeting}</p>
          <h1 className="text-xl font-bold mt-1">{user?.full_name || 'المندوب'}</h1>
        </div>
        <div className="text-left text-[11px] opacity-90 leading-relaxed">
          <div>المبيعات 50% {formatCurrencyShort(monthlySales)}</div>
          <div>الطلبات 20% {monthlyOrdersCount}</div>
          <div>الزيارات 15% {monthlyVisitsCount}</div>
          <div>عملاء جدد 15% {monthlyNewCustomersCount}</div>
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-text mb-3">مؤشرات اليوم</h2>
        <div className="grid grid-cols-3 gap-2">
          {indicators.map((item) => (
            <div key={item.label} className={`${item.color} rounded-xl p-[9px] text-center text-white min-h-[76px] flex flex-col items-center justify-center`}>
              <div className="text-[15px] font-bold leading-tight">{typeof item.value === 'number' ? item.value : item.value}</div>
              <div className="text-[11px] opacity-90 mt-1 leading-tight">{item.label}</div>
              {item.sub && <div className="text-[10px] opacity-70 mt-1 leading-tight">{item.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      <button onClick={() => navigate('/attendance/runtime')}
        className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 rounded-xl p-4 text-center text-white active:opacity-80 transition-opacity shadow-sm mb-3">
        <div className="text-base font-bold">تسجيل الحضور</div>
        <div className="text-xs opacity-80 mt-1">بدء / إنهاء يوم العمل</div>
      </button>

      <div>
        <h2 className="text-[15px] font-semibold text-text mb-3">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/visits/screen')}
            className="bg-primary rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">ابدأ زيارة</div>
            <div className="text-[11px] opacity-80 mt-1">تسجيل زيارة جديدة</div>
          </button>
          <button onClick={() => navigate('/orders/new')}
            className="bg-accent rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">طلب سريع</div>
            <div className="text-[11px] opacity-80 mt-1">إنشاء طلب جديد</div>
          </button>
          <button onClick={() => navigate('/visits')}
            className="bg-indigo-600 rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">زياراتى</div>
            <div className="text-[11px] opacity-80 mt-1">جميع زياراتى</div>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-primary-dark rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">عميل جديد</div>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-primary/80 rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">عملائي</div>
            <div className="text-[11px] opacity-80 mt-1">قائمة العملاء</div>
          </button>
          <button onClick={() => navigate('/orders')}
            className="bg-success/80 rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">فواتيري</div>
            <div className="text-[11px] opacity-80 mt-1">فواتير وطلبات</div>
          </button>
          <button onClick={() => navigate('/analytics/customers/intelligence')}
            className="bg-indigo-600 rounded-xl p-[13px] text-center text-white active:opacity-80 transition-opacity">
            <div className="text-[15px] font-bold">تحليلات</div>
            <div className="text-[11px] opacity-80 mt-1">تحليلات العملاء</div>
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-text mb-3">فرص البيع اليوم</h2>
        {opportunities.length > 0 ? (
          <div className="space-y-2">
            {opportunities.map((opp, idx) => (
              <button key={opp.customerId + opp.type} onClick={() => navigate(`/customers/${opp.customerId}`)}
                className={`w-full rounded-xl p-4 text-white active:opacity-80 transition-opacity ${
                  [
                    'bg-gradient-to-r from-blue-600 to-blue-800',
                    'bg-gradient-to-r from-emerald-600 to-emerald-800',
                    'bg-gradient-to-r from-violet-600 to-violet-800',
                    'bg-gradient-to-r from-rose-600 to-rose-800',
                    'bg-gradient-to-r from-cyan-600 to-cyan-800',
                  ][idx % 5]
                }`}>
                <div className="flex items-start justify-between">
                  <div className="text-right min-w-0 flex-1">
                    <div className="text-base font-bold">{opp.customerName}</div>
                    <div className="text-[11px] opacity-80 mt-1">{opp.detail}</div>
                    {opp.lastOrderDate && (
                      <div className="text-[10px] opacity-60 mt-1.5">آخر طلب: {new Date(opp.lastOrderDate).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })} — {formatCurrencyShort(opp.lastOrderValue)}</div>
                    )}
                  </div>
                  <div className="text-left text-[11px] opacity-90 leading-relaxed shrink-0 mr-4">
                    <div>المبيعات {formatCurrencyShort(opp.monthlyOrderTotal)}</div>
                    <div>الطلبات {opp.monthlyOrderCount}</div>
                    <div>الزيارات {opp.monthlyVisitCount}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-gradient-to-r from-primary to-primary-dark rounded-xl p-6 text-center text-white">
            <p className="text-sm font-semibold">لا توجد فرص متاحة حالياً</p>
            <p className="text-[11px] opacity-80 mt-1">يمكنك متابعة العملاء من قائمة العملاء</p>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-text mb-3">آخر النشاط</h2>
        <div className="space-y-2">
          <button onClick={() => lastOrder && navigate(`/orders/${lastOrder.id}`)}
            className="w-full bg-gradient-to-r from-primary to-primary-dark rounded-xl p-[13px] text-right text-white cursor-pointer active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-default" dir="rtl" disabled={!lastOrder}>
            <div className="text-[11px] opacity-80">آخر طلب</div>
            {lastOrder ? (
              <div className="flex items-start justify-between mt-1">
                <div className="text-right">
                  <div className="text-[15px] font-bold">{customers.find((c) => c.id === lastOrder.customer_id)?.company_name || lastOrder.customer_name || 'عميل'}</div>
                  <div className="text-[11px] opacity-80 mt-1">طلب #{lastOrder.order_number || lastOrder.id?.slice(0, 8)}</div>
                </div>
                <div className="text-left text-[11px] opacity-90 leading-relaxed">
                  <div>{formatCurrencyShort(Number(lastOrder.total_amount || 0))}</div>
                  <div>{new Date(lastOrder.created_at).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            ) : (
              <div className="text-[15px] opacity-80 mt-1">لا توجد طلبات</div>
            )}
          </button>
          <div className="bg-gradient-to-r from-accent to-orange-700 rounded-xl p-[13px] text-center text-white">
            <div className="text-[11px] opacity-80">آخر زيارة</div>
            {lastVisit ? (
              <div className="text-[15px] font-bold mt-1">
                {lastVisit.visit_result ? `${lastVisit.visit_result}` : 'نشطة'}
              </div>
            ) : (
              <div className="text-[15px] opacity-80 mt-1">لا توجد زيارات</div>
            )}
          </div>
          <button onClick={() => lastCustomer && navigate(`/customers/${lastCustomer.id}`)}
            className="w-full bg-gradient-to-r from-success to-green-700 rounded-xl p-[13px] text-center text-white cursor-pointer active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-default" disabled={!lastCustomer}>
            <div className="text-[11px] opacity-80">آخر عميل جديد</div>
            {lastCustomer ? (
              <div className="text-[15px] font-bold mt-1">{lastCustomer.company_name || lastCustomer.companyName || 'عميل'}</div>
            ) : (
              <div className="text-[15px] opacity-80 mt-1">لا يوجد</div>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
