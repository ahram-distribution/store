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
  monthlyOrderTotal: number
  monthlyOrderCount: number
  monthlyVisitCount: number
  lastOrderDate: string | null
  lastOrderValue: number
}

interface EmployeePerf {
  employee_id: string
  sales_target: number
  orders_target: number
  visits_target: number
  new_customers_target: number
  sales_actual: number
  effective_orders: number
  visits_actual: number
  new_customers_actual: number
}

const MONTH_START = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
const TODAY_START = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  return iso >= TODAY_START
}

function isDelivered(o: any): boolean {
  return o.status === 'delivered' && !!o.delivered_at
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toLocaleString('ar-EG-u-nu-latn')
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return fmt(n)
}

function ProgressBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  const color = clamped >= 80 ? 'bg-green-500' : clamped >= 40 ? 'bg-amber-400' : 'bg-red-400'
  const h = size === 'sm' ? 'h-1.5' : 'h-2.5'
  return (
    <div className={`w-full ${h} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`${h} ${color} rounded-full transition-all`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function SalesRepWorkDay() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [visits, setVisits] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [employeePerf, setEmployeePerf] = useState<EmployeePerf | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_dashboard_sales', { p_token: token }),
      supabase.rpc('get_unified_orders', { p_token: token }),
      supabase.rpc('get_governed_visits', { p_token: token }),
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_target_performance', {
        p_token: token,
        p_month: new Date().getMonth() + 1,
        p_year: new Date().getFullYear(),
      }),
    ]).then(([dashRes, ordersRes, visitsRes, custRes, perfRes]) => {
      if (dashRes.data) setDashboard(dashRes.data as DashboardData)
      if (ordersRes.data) setOrders(ordersRes.data as any[])
      if (visitsRes.data) setVisits(visitsRes.data as any[])
      if (custRes.data) setCustomers(custRes.data as any[])
      if (perfRes.data) {
        const d = perfRes.data as any
        const emps: EmployeePerf[] = d.employees || []
        if (emps.length > 0) setEmployeePerf(emps[0])
      }
      setLoading(false)
    })
  }, [])

  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  // Source of Truth: delivered orders only
  const deliveredOrders = useMemo(() => orders.filter(isDelivered), [orders])
  const monthDelivered = useMemo(() => deliveredOrders.filter((o) => o.delivered_at >= MONTH_START), [deliveredOrders])
  const todayDelivered = useMemo(() => deliveredOrders.filter((o) => isToday(o.delivered_at)), [deliveredOrders])

  // Today's KPIs (rounded totals)
  const todaySales = useMemo(() => Math.round(todayDelivered.reduce((s, o) => s + Number(o.total_amount || 0), 0)), [todayDelivered])
  const todayOrders = useMemo(() => todayDelivered.length, [todayDelivered])
  const todayVisitsDone = useMemo(() => visits.filter((v) => isToday(v.created_at) && v.status !== 'active').length, [visits])
  const todayNewCustomers = useMemo(() => customers.filter((c) => isToday(c.created_at)).length, [customers])

  // Monthly totals from local data
  const monthlySales = useMemo(() => Math.round(monthDelivered.reduce((s, o) => s + Number(o.total_amount || 0), 0)), [monthDelivered])
  const monthlyOrders = useMemo(() => monthDelivered.length, [monthDelivered])
  const monthlyVisits = useMemo(() => visits.filter((v) => v.created_at >= MONTH_START).length, [visits])
  const monthlyNewCustomers = useMemo(() => customers.filter((c) => c.created_at >= MONTH_START).length, [customers])

  // Daily proportional targets
  const dailyTarget = useMemo(() => ({
    sales: Math.round((employeePerf?.sales_target || 0) / daysInMonth),
    orders: Math.round((employeePerf?.orders_target || 0) / daysInMonth),
    visits: Math.round((employeePerf?.visits_target || 0) / daysInMonth),
  }), [employeePerf, daysInMonth])

  const oppColors: Record<string, { from: string; to: string; label: string }> = {
    needs_followup: { from: 'from-emerald-500', to: 'to-emerald-700', label: 'متابعة مطلوبة' },
    no_order: { from: 'from-red-500', to: 'to-red-700', label: 'متأخر عن الطلب' },
    new_customer: { from: 'from-cyan-500', to: 'to-cyan-700', label: 'فرصة ساخنة' },
  }

  // Opportunities with color coding
  const opportunities = useMemo<Opportunity[]>(() => {
    const result: Opportunity[] = []
    const customerLastOrder = new Map<string, { date: string; value: number }>()
    const customerLastVisit = new Map<string, string>()
    const customerOrders = new Map<string, { total: number; count: number }>()
    const customerVisits = new Map<string, number>()
    for (const o of deliveredOrders) {
      const cid = o.customer_id
      const existing = customerLastOrder.get(cid)
      if (!existing || o.delivered_at > existing.date) customerLastOrder.set(cid, { date: o.delivered_at, value: Number(o.total_amount || 0) })
      if (o.delivered_at >= MONTH_START) {
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
    const nowMs = Date.now()
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (const c of customers) {
      const cid = c.id
      const lastOrd = customerLastOrder.get(cid)
      const lastVisit = customerLastVisit.get(cid)
      const created = c.created_at
      const ord = customerOrders.get(cid) || { total: 0, count: 0 }
      const vis = customerVisits.get(cid) || 0
      if (created && (nowMs - new Date(created).getTime()) < SEVEN_DAYS) {
        result.push({ type: 'new_customer', customerName: c.company_name || c.companyName, customerId: cid, detail: 'عميل جديد', monthlyOrderTotal: Math.round(ord.total), monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd?.date || null, lastOrderValue: Math.round(lastOrd?.value || 0) })
        continue
      }
      if (lastOrd && (nowMs - new Date(lastOrd.date).getTime()) > THIRTY_DAYS) {
        result.push({ type: 'no_order', customerName: c.company_name || c.companyName, customerId: cid, detail: 'لم يطلب منذ 30 يوماً', monthlyOrderTotal: Math.round(ord.total), monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd.date, lastOrderValue: Math.round(lastOrd.value) })
        continue
      }
      if (!lastVisit || (nowMs - new Date(lastVisit).getTime()) > SEVEN_DAYS) {
        result.push({ type: 'needs_followup', customerName: c.company_name || c.companyName, customerId: cid, detail: 'يحتاج متابعة', monthlyOrderTotal: Math.round(ord.total), monthlyOrderCount: ord.count, monthlyVisitCount: vis, lastOrderDate: lastOrd?.date || null, lastOrderValue: Math.round(lastOrd?.value || 0) })
      }
    }
    return result.slice(0, 5)
  }, [customers, deliveredOrders, visits])

  // Last activity
  const lastOrder = useMemo(() => {
    const sorted = [...deliveredOrders].sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || ''))
    return sorted[0] || null
  }, [deliveredOrders])

  const lastVisitObj = useMemo(() => {
    const sorted = [...visits].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return sorted[0] || null
  }, [visits])

  const lastCustomerObj = useMemo(() => {
    const sorted = [...customers].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return sorted[0] || null
  }, [customers])

  const lastActivity = useMemo(() => {
    const activities: { type: string; label: string; date: string; id: string; route: string; detail: string; amount?: number; code?: string }[] = []
    if (lastOrder) activities.push({ type: 'order', label: 'آخر طلب', date: lastOrder.delivered_at || lastOrder.created_at, id: lastOrder.id, route: `/orders/${lastOrder.id}`, detail: customers.find((c) => c.id === lastOrder.customer_id)?.company_name || lastOrder.customer_name || 'عميل', amount: Math.round(Number(lastOrder.total_amount || 0)), code: lastOrder.order_number })
    if (lastVisitObj) activities.push({ type: 'visit', label: 'آخر زيارة', date: lastVisitObj.created_at, id: lastVisitObj.id, route: '', detail: lastVisitObj.visit_result || 'نشطة' })
    if (lastCustomerObj) activities.push({ type: 'customer', label: 'آخر عميل', date: lastCustomerObj.created_at, id: lastCustomerObj.id, route: `/customers/${lastCustomerObj.id}`, detail: lastCustomerObj.company_name || lastCustomerObj.companyName || 'عميل' })
    activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    return activities[0] || null
  }, [lastOrder, lastVisitObj, lastCustomerObj, customers])

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  const greeting = now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير'
  const role = user?.roles?.[0] || 'مندوب مبيعات'
  const dateStr = now.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const headerIndicators = [
    { label: 'المبيعات', value: fmtShort(todaySales) },
    { label: 'الطلبات', value: fmt(todayOrders) },
    { label: 'الزيارات', value: fmt(todayVisitsDone) },
    { label: 'عملاء مسجلون اليوم', value: fmt(todayNewCustomers) },
  ]

  const monthlyIndicators = [
    { label: 'المبيعات', actual: monthlySales, target: employeePerf?.sales_target || 0 },
    { label: 'الطلبات', actual: monthlyOrders, target: employeePerf?.orders_target || 0 },
    { label: 'الزيارات', actual: monthlyVisits, target: employeePerf?.visits_target || 0 },
    { label: 'عملاء مسجلون هذا الشهر', actual: monthlyNewCustomers, target: employeePerf?.new_customers_target || 0 },
  ]

  const kpiCards = [
    { label: 'مبيعات اليوم', actual: todaySales, target: dailyTarget.sales, unit: 'جنيه' },
    { label: 'طلبات جديدة', actual: todayOrders, target: dailyTarget.orders, unit: 'عدد' },
    { label: 'زيارات اليوم', actual: todayVisitsDone, target: dailyTarget.visits, unit: 'عدد' },
  ]

  return (
    <div className="space-y-4 pb-4">
      {/* ── HEADER ── */}
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-5 -mx-4 px-4" dir="rtl">
        <div className="flex items-start justify-between">
          <div className="text-right">
            <p className="text-sm opacity-90">{greeting}</p>
            <h1 className="text-lg font-bold mt-0.5">{user?.full_name || 'المندوب'}</h1>
            <p className="text-[11px] opacity-70 mt-0.5">{role}</p>
            <p className="text-[11px] opacity-60 mt-0.5">{dateStr}</p>
          </div>
          <button className="text-xl opacity-80 mt-1">🔔</button>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4">
          {headerIndicators.map((item) => (
            <div key={item.label} className="text-center bg-white/10 rounded-xl py-2">
              <div className="text-lg font-bold">{item.value}</div>
              <div className="text-[10px] opacity-75 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MONTHLY TARGET ── */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-gray-800">التارجت الشهري</h2>
          <button onClick={() => navigate('/target-runtime')} className="text-[11px] text-primary underline">التفاصيل</button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {monthlyIndicators.map((m) => {
            const pct = m.target > 0 ? Math.round((m.actual / m.target) * 100) : 0
            return (
              <div key={m.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-gray-500">{m.label}</span>
                  <span className="text-[10px] font-semibold" style={{ color: pct >= 80 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626' }}>{pct}%</span>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-900">{fmtShort(Math.round(m.actual))}</span>
                  <span className="text-[10px] text-gray-400">/{fmtShort(Math.round(m.target))}</span>
                </div>
                <ProgressBar pct={pct} size="sm" />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── TODAY INDICATORS ── */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-800 mb-2">مؤشرات اليوم</h2>
        <div className="grid grid-cols-3 gap-2">
          {kpiCards.map((kpi) => {
            const pct = kpi.target > 0 ? Math.round((kpi.actual / kpi.target) * 100) : 0
            return (
              <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                <div className="text-[11px] text-gray-500 font-medium">{kpi.label}</div>
                <div className="mt-1">
                  <span className="text-sm font-bold text-gray-900">{fmtShort(kpi.actual)}</span>
                  <span className="text-[10px] text-gray-400 mr-1">/ {fmtShort(kpi.target)}</span>
                </div>
                <div className={`text-xs font-semibold mt-1 ${pct >= 80 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</div>
                <div className="mt-1.5">
                  <ProgressBar pct={pct} size="sm" />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── ATTENDANCE ── */}
      <button onClick={() => navigate('/attendance/runtime')}
        className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity shadow-sm">
        <div className="text-base font-bold">تسجيل الحضور</div>
        <div className="text-xs opacity-80 mt-0.5">بدء / إنهاء يوم العمل</div>
      </button>

      {/* ── QUICK ACTIONS ── */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-800 mb-2">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/orders/new')}
            className="bg-primary rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">أمر جديد</div>
            <div className="text-[10px] opacity-80 mt-0.5">إنشاء طلب جديد</div>
          </button>
          <button onClick={() => navigate('/visits/screen')}
            className="bg-accent rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">بدء زيارة</div>
            <div className="text-[10px] opacity-80 mt-0.5">تسجيل زيارة جديدة</div>
          </button>
          <button onClick={() => navigate('/customers')}
            className="bg-primary-dark rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">عملاء</div>
            <div className="text-[10px] opacity-80 mt-0.5">قائمة العملاء</div>
          </button>
          <button onClick={() => navigate('/collections')}
            className="bg-emerald-600 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">تحصيلات</div>
            <div className="text-[10px] opacity-80 mt-0.5">المدفوعات والتحصيل</div>
          </button>
          <button onClick={() => navigate('/orders')}
            className="bg-indigo-600 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">فواتيري</div>
            <div className="text-[10px] opacity-80 mt-0.5">فواتير وطلبات</div>
          </button>
          <button onClick={() => navigate('/visits')}
            className="bg-success/80 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">زياراتي</div>
            <div className="text-[10px] opacity-80 mt-0.5">جميع الزيارات</div>
          </button>
          <button onClick={() => navigate('/analytics/customers/intelligence')}
            className="bg-cyan-600 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">تحليلات</div>
            <div className="text-[10px] opacity-80 mt-0.5">تحليلات العملاء</div>
          </button>
          <button onClick={() => navigate('/target-runtime')}
            className="bg-amber-600 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
            <div className="text-sm font-bold">الأهداف</div>
            <div className="text-[10px] opacity-80 mt-0.5">التارجت والأداء</div>
          </button>
        </div>
      </div>

      {/* ── SALES OPPORTUNITIES ── */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-800 mb-2">فرص البيع اليوم</h2>
        {opportunities.length > 0 ? (
          <div className="space-y-2">
            {opportunities.map((opp) => {
              const colors = oppColors[opp.type] || oppColors.needs_followup
              return (
                <button key={opp.customerId + opp.type} onClick={() => navigate(`/customers/${opp.customerId}`)}
                  className={`w-full rounded-xl py-3.5 px-4 text-white active:opacity-80 transition-opacity bg-gradient-to-r ${colors.from} ${colors.to}`}>
                  <div className="flex items-start justify-between">
                    <div className="text-right min-w-0 flex-1">
                      <div className="text-sm font-bold">{opp.customerName}</div>
                      <div className="text-[10px] opacity-80 mt-0.5">{opp.detail}</div>
                      {opp.lastOrderDate && (
                        <div className="text-[10px] opacity-60 mt-1">آخر طلب: {new Date(opp.lastOrderDate).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })} — {fmtShort(Math.round(opp.lastOrderValue))}</div>
                      )}
                    </div>
                    <div className="text-left text-[10px] opacity-90 leading-relaxed shrink-0 mr-3">
                      <div>المبيعات {fmtShort(Math.round(opp.monthlyOrderTotal))}</div>
                      <div>الطلبات {opp.monthlyOrderCount}</div>
                      <div>الزيارات {opp.monthlyVisitCount}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="bg-gradient-to-r from-primary to-primary-dark rounded-xl py-5 text-center text-white">
            <p className="text-sm font-semibold">لا توجد فرص متاحة حالياً</p>
            <p className="text-[11px] opacity-80 mt-1">يمكنك متابعة العملاء من قائمة العملاء</p>
          </div>
        )}
      </div>

      {/* ── LAST ACTIVITY ── */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-800 mb-2">آخر النشاط</h2>
        {lastActivity ? (
          <button
            onClick={() => lastActivity.route && navigate(lastActivity.route)}
            disabled={!lastActivity.route}
            className="w-full bg-gradient-to-r from-primary to-primary-dark rounded-xl py-3.5 px-4 text-right text-white cursor-pointer active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-default"
            dir="rtl">
            <div className="text-[10px] opacity-70">{lastActivity.label}</div>
            <div className="flex items-start justify-between mt-1">
              <div className="text-right">
                <div className="text-sm font-bold">{lastActivity.detail}</div>
                {lastActivity.code && <div className="text-[10px] opacity-70 mt-0.5">#{lastActivity.code}</div>}
              </div>
              <div className="text-left text-[10px] opacity-80 leading-relaxed">
                {lastActivity.amount != null && <div>{fmtShort(lastActivity.amount)}</div>}
                <div>{new Date(lastActivity.date).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          </button>
        ) : (
          <div className="bg-gradient-to-r from-primary to-primary-dark rounded-xl py-5 text-center text-white">
            <p className="text-sm font-semibold">لا توجد أنشطة حديثة</p>
          </div>
        )}
      </div>

      {/* ── LAST VISIT FOLLOW-UP ── */}
      {lastVisitObj && (
        <button onClick={() => navigate(`/visits`)}
          className="w-full bg-gradient-to-r from-accent to-orange-700 rounded-xl py-3 text-center text-white active:opacity-80 transition-opacity">
          <div className="text-sm font-bold">متابعة آخر زيارة</div>
          <div className="text-[10px] opacity-80 mt-0.5">{lastVisitObj.visit_result || 'عرض تفاصيل الزيارة'}</div>
        </button>
      )}
    </div>
  )
}
