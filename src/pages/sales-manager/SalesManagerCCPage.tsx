import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

interface ActiveSession {
  employee_id: string
  employee_name: string
  session_status: string
  started_at: string
  duration_minutes: number
  net_minutes: number
  break_minutes: number
  work_status: string
  order_count: number
  sales_value: number
  latitude: number | null
  longitude: number | null
  last_seen_at: string | null
  connection_status: string
}

interface NoStartEmployee {
  employee_id: string
  employee_name: string
}

interface EndedEmployee {
  employee_id: string
  employee_name: string
  ended_at: string
  duration_minutes: number
  visit_count: number
}

interface TeamOverview {
  member_count: number
  active_today: number
  customer_count: number
}

interface AttendanceData {
  active_sessions: ActiveSession[]
  no_start_employees: NoStartEmployee[]
  ended_employees: EndedEmployee[]
  active_count: number
  on_visit_count: number
  on_break_count: number
  no_start_count: number
  ended_count: number
}

interface OrdersData {
  today_orders: number
  today_sales: number
  month_orders: number
  month_sales: number
  pending_followup: number
  pending_collections: number
}

interface VisitsData {
  active_visits: number
  today_visits: number
  month_visits: number
}

interface CustomersData {
  total_customers: number
  new_customers_month: number
  inactive_customers: number
}

interface MemberPerf {
  employee_id: string
  employee_code: string
  employee_name: string
  customer_count: number
  month_orders: number
  month_sales: number
  today_orders: number
  today_visits: number
  month_visits: number
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  achievement_pct: number
}

interface TeamTargets {
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  sales_achievement: number
  visits_achievement: number
  orders_achievement: number
  new_customers_achievement: number
  sales_achievement_pct: number
  visits_achievement_pct: number
  orders_achievement_pct: number
  new_customers_achievement_pct: number
}

interface TeamPerformance {
  members: MemberPerf[]
  team_targets: TeamTargets
}

interface PersonalSummary {
  customer_count: number
  month_orders: number
  month_sales: number
  today_orders: number
  active_visits: number
  today_visits: number
  month_visits: number
  pending_collections: number
}

interface SalesManagerCC {
  team_overview: TeamOverview
  attendance: AttendanceData
  orders: OrdersData
  visits: VisitsData
  customers: CustomersData
  team_performance: TeamPerformance
  personal_summary: PersonalSummary
}

const POLLING_INTERVAL = 30000

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn')
const fmtPct = (n: number) => n.toFixed(1) + '%'
const pctColor = (pct: number) => pct >= 100 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-red-500'

export default function SalesManagerCCPage() {
  const nav = useNavigate()
  const [data, setData] = useState<SalesManagerCC | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('overview')

  const token = getToken()

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token?.trim() })
    if (error) { setLoading(false); return }
    if (result && typeof result === 'object' && !('error' in (result as Record<string, unknown>))) {
      setData(result as unknown as SalesManagerCC)
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData(); const id = setInterval(fetchData, POLLING_INTERVAL); return () => clearInterval(id) }, [fetchData])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const { team_overview: tov, attendance: att, orders: ord, visits: vis, customers: cust, team_performance: tp, personal_summary: ps } = data
  const tt = tp?.team_targets

  const sections = [
    { key: 'overview', label: 'نظرة عامة' },
    { key: 'attendance', label: 'الحضور' },
    { key: 'orders', label: 'الطلبات' },
    { key: 'visits', label: 'الزيارات' },
    { key: 'customers', label: 'العملاء' },
    { key: 'performance', label: 'الأداء' },
    { key: 'personal', label: 'بياناتي' },
    { key: 'actions', label: 'إجراءات' },
  ]

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <h1 className="text-lg font-bold text-text mb-2">مركز قيادة المبيعات</h1>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {sections.map(s => (
            <button key={s.key} onClick={() => setActiveSection(s.key)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                activeSection === s.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Team Overview */}
      <div className="grid grid-cols-3 gap-3">
        <Card label="أعضاء الفريق" value={fmt(tov?.member_count ?? 0)} icon="👥" onClick={() => nav('/employees')} />
        <Card label="نشط اليوم" value={fmt(tov?.active_today ?? 0)} icon="✅" onClick={() => setActiveSection('attendance')} />
        <Card label="العملاء" value={fmt(tov?.customer_count ?? 0)} icon="👤" onClick={() => setActiveSection('customers')} />
      </div>

      {/* 2. Attendance & Live Tracking */}
      {activeSection === 'attendance' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">الحضور والتتبع الحي</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <MiniStat label="نشط" value={fmt(att?.active_count ?? 0)} color="text-success" />
            <MiniStat label="زيارة" value={fmt(att?.on_visit_count ?? 0)} color="text-primary" />
            <MiniStat label="استراحة" value={fmt(att?.on_break_count ?? 0)} color="text-warning" />
            <MiniStat label="لم يبدأ" value={fmt(att?.no_start_count ?? 0)} color="text-red-500" />
            <MiniStat label="منتهي" value={fmt(att?.ended_count ?? 0)} color="text-text-secondary" />
          </div>
          {att?.active_sessions && att.active_sessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary">النشطون حالياً</p>
              {att.active_sessions.map(s => (
                <div key={s.employee_id} className="flex items-center gap-3 bg-surface rounded-lg px-3 py-2 border border-border/50">
                  <span className={`w-2 h-2 rounded-full ${
                    s.work_status === 'working' ? 'bg-success' : s.work_status === 'on_visit' ? 'bg-primary' : 'bg-warning'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text">{s.employee_name}</p>
                    <p className="text-[10px] text-text-secondary">
                      {s.net_minutes} دقيقة | طلبات: {s.order_count} | مبيعات: {formatCurrencyShort(s.sales_value)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    s.connection_status === 'connected' ? 'bg-green-100 text-success' : 
                    s.connection_status === 'delayed' ? 'bg-yellow-100 text-warning' : 'bg-red-100 text-red-500'
                  }`}>
                    {s.connection_status === 'connected' ? 'متصل' : s.connection_status === 'delayed' ? 'متأخر' : 'منقطع'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {att?.no_start_employees && att.no_start_employees.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">لم يبدأوا اليوم ({att.no_start_count})</p>
              <div className="flex flex-wrap gap-1">
                {att.no_start_employees.map(e => (
                  <span key={e.employee_id} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded">{e.employee_name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Orders Monitoring */}
      {activeSection === 'orders' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">مراقبة الطلبات</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card label="طلبات اليوم" value={fmt(ord?.today_orders ?? 0)} icon="📋" />
            <Card label="مبيعات اليوم" value={formatCurrencyShort(ord?.today_sales ?? 0)} icon="💰" />
            <Card label="طلبات الشهر" value={fmt(ord?.month_orders ?? 0)} icon="📊" />
            <Card label="مبيعات الشهر" value={formatCurrencyShort(ord?.month_sales ?? 0)} icon="📈" />
            <Card label="بانتظار الاعتماد" value={fmt(ord?.pending_followup ?? 0)} icon="⏳" />
            <Card label="تحصيلات معلقة" value={formatCurrencyShort(ord?.pending_collections ?? 0)} icon="💳" />
          </div>
          <div className="flex gap-2 mt-3">
            <ActionBtn label="كل الطلبات" onClick={() => nav('/orders')} />
            <ActionBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} />
            <ActionBtn label="التحصيلات" onClick={() => nav('/collections')} />
          </div>
        </div>
      )}

      {/* 4. Visits Monitoring */}
      {activeSection === 'visits' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">مراقبة الزيارات</h3>
          <div className="grid grid-cols-3 gap-3">
            <Card label="زيارات نشطة" value={fmt(vis?.active_visits ?? 0)} icon="📍" />
            <Card label="زيارات اليوم" value={fmt(vis?.today_visits ?? 0)} icon="📅" />
            <Card label="زيارات الشهر" value={fmt(vis?.month_visits ?? 0)} icon="📊" />
          </div>
          <div className="flex gap-2 mt-3">
            <ActionBtn label="كل الزيارات" onClick={() => nav('/visits')} />
            <ActionBtn label="زيارة جديدة" onClick={() => nav('/visits/new')} />
          </div>
        </div>
      )}

      {/* 5. Customer Growth */}
      {activeSection === 'customers' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">نمو العملاء</h3>
          <div className="grid grid-cols-3 gap-3">
            <Card label="إجمالي العملاء" value={fmt(cust?.total_customers ?? 0)} icon="👥" />
            <Card label="عملاء جدد (شهر)" value={fmt(cust?.new_customers_month ?? 0)} icon="🌟" />
            <Card label="عملاء غير نشطين" value={fmt(cust?.inactive_customers ?? 0)} icon="⚠️" />
          </div>
          <div className="flex gap-2 mt-3">
            <ActionBtn label="كل العملاء" onClick={() => nav('/customers')} />
            <ActionBtn label="عميل جديد" onClick={() => nav('/customers/new')} />
          </div>
        </div>
      )}

      {/* 6. Team Performance */}
      {activeSection === 'performance' && tp?.members && tp.members.length > 0 && (
        <>
          {tt && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h3 className="text-sm font-bold text-text mb-3">أهداف الفريق</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <TargetCard label="المبيعات" target={tt.sales_target} actual={tt.sales_achievement} pct={tt.sales_achievement_pct} />
                <TargetCard label="الزيارات" target={tt.visits_target} actual={tt.visits_achievement} pct={tt.visits_achievement_pct} />
                <TargetCard label="الطلبات" target={tt.orders_target} actual={tt.orders_achievement} pct={tt.orders_achievement_pct} />
                <TargetCard label="عملاء جدد" target={tt.new_customers_target} actual={tt.new_customers_achievement} pct={tt.new_customers_achievement_pct} />
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold text-text mb-3">أداء أعضاء الفريق</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right py-2 px-2 text-text-secondary font-semibold">الاسم</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">العملاء</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الطلبات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">المبيعات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الزيارات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الإنجاز</th>
                  </tr>
                </thead>
                <tbody>
                  {tp.members.map(m => (
                    <tr key={m.employee_id} className="border-b border-border/50 hover:bg-surface/50 cursor-pointer"
                      onClick={() => nav(`/employees/${m.employee_id}`)}>
                      <td className="py-2 px-2 font-semibold text-text">{m.employee_name}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.customer_count)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_orders)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{formatCurrencyShort(m.month_sales)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_visits)}</td>
                      <td className={`py-2 px-2 text-center font-bold ${pctColor(m.achievement_pct)}`}>
                        {m.sales_target > 0 ? fmtPct(m.achievement_pct) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 7. Personal Summary */}
      {activeSection === 'personal' && ps && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">ملخصي الشخصي</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="عملائي" value={fmt(ps.customer_count)} icon="👥" onClick={() => nav('/customers?my=1')} />
            <Card label="طلباتي (شهر)" value={fmt(ps.month_orders)} icon="📋" onClick={() => nav('/orders?my=1')} />
            <Card label="مبيعاتي (شهر)" value={formatCurrencyShort(ps.month_sales)} icon="💰" />
            <Card label="طلبات اليوم" value={fmt(ps.today_orders)} icon="📅" />
            <Card label="زياراتي (شهر)" value={fmt(ps.month_visits)} icon="📍" />
            <Card label="زيارات اليوم" value={fmt(ps.today_visits)} icon="📌" />
            <Card label="زيارات نشطة" value={fmt(ps.active_visits)} icon="🔴" onClick={() => nav('/visits?filter=active')} />
            <Card label="تحصيلات معلقة" value={formatCurrencyShort(ps.pending_collections)} icon="⏳" onClick={() => nav('/collections?filter=pending')} />
          </div>
        </div>
      )}

      {/* 8. Quick Actions */}
      {activeSection === 'actions' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">إجراءات سريعة</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickBtn label="كل العملاء" onClick={() => nav('/customers')} color="bg-primary text-white" />
            <QuickBtn label="كل الطلبات" onClick={() => nav('/orders')} color="bg-accent text-white" />
            <QuickBtn label="الزيارات" onClick={() => nav('/visits')} color="bg-surface text-text" />
            <QuickBtn label="التحصيلات" onClick={() => nav('/collections')} color="bg-surface text-text" />
            <QuickBtn label="الموظفون" onClick={() => nav('/employees')} color="bg-surface text-text" />
            <QuickBtn label="الهيكل البيعي" onClick={() => nav('/hierarchy')} color="bg-surface text-text" />
            <QuickBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} color="bg-accent text-white" />
            <QuickBtn label="أهداف الفريق" onClick={() => nav('/dashboard/employee-targets')} color="bg-primary text-white" />
            <QuickBtn label="تحليل الأداء" onClick={() => nav('/dashboard/performance')} color="bg-surface text-text" />
            <QuickBtn label="التقارير" onClick={() => nav('/reports')} color="bg-surface text-text" />
            <QuickBtn label="المراقبة الحية" onClick={() => nav('/attendance/operations')} color="bg-primary text-white" />
            <QuickBtn label="تسجيل الحضور" onClick={() => nav('/attendance/runtime')} color="bg-gradient-to-l from-blue-600 to-indigo-700 text-white" />
          </div>
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        يتم التحديث تلقائياً كل 30 ثانية
      </div>
    </div>
  )
}

function Card({ label, value, icon, sub, onClick }: { label: string; value: string; icon: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
      {sub && <p className="text-[10px] text-text-secondary mt-0.5">{sub}</p>}
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface rounded-lg p-2 text-center border border-border/50">
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-secondary">{label}</p>
    </div>
  )
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-semibold active:opacity-80 transition-opacity">
      {label}
    </button>
  )
}

function QuickBtn({ label, onClick, color }: { label: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick}
      className={`${color} text-xs py-2.5 rounded-lg font-semibold border border-border/50 active:opacity-80 transition-opacity`}>
      {label}
    </button>
  )
}

function TargetCard({ label, target, actual, pct }: { label: string; target: number; actual: number; pct: number }) {
  return (
    <div className="bg-surface rounded-xl p-3 border border-border/50">
      <p className="text-[10px] text-text-secondary mb-1">{label}</p>
      <p className="text-sm font-bold text-text">{formatCurrencyShort(target)}</p>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-red-400'}`}
            style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className={`text-[10px] font-bold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
      </div>
    </div>
  )
}
