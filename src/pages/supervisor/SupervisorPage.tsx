import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort, toEnglishDigits } from '../../utils/format'
import toast from 'react-hot-toast'

interface MemberPerf {
  employee_id: string; employee_code: string; employee_name: string
  customer_count: number; month_orders: number; month_sales: number
  today_orders: number; today_visits: number; month_visits: number
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; achievement_pct: number
}

interface TeamTargets {
  sales_target: number; visits_target: number; orders_target: number; new_customers_target: number
  sales_achievement: number; visits_achievement: number; orders_achievement: number; new_customers_achievement: number
  sales_achievement_pct: number; visits_achievement_pct: number; orders_achievement_pct: number; new_customers_achievement_pct: number
}

interface PersonalSummary {
  customer_count: number; month_orders: number; month_sales: number
  today_orders: number; active_visits: number; today_visits: number
  month_visits: number; pending_collections: number
}

interface TeamSummary {
  member_count: number; customer_count: number; active_visits: number
  today_visits: number; month_visits: number; today_orders: number
  today_sales: number; month_orders: number; month_sales: number
  pending_collections: number; new_customers_month: number
}

interface DashboardData {
  team_summary: TeamSummary; members: MemberPerf[]
  team_targets: TeamTargets; personal_summary: PersonalSummary
}

interface Customer {
  id: string; company_name: string; owner_id: string; owner_name?: string
}

interface Employee {
  id: string; code: string; full_name: string
}

interface Visit {
  id: string; code: string; customer_name: string; employee_name: string
  status: string; created_at: string
}

interface OrderRec {
  id: string; order_number: string; customer_name: string; total_amount: number
  status: string; created_at: string; owner_name: string
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn')
const fmtPct = (n: number) => n.toFixed(1) + '%'
const pctColor = (pct: number) => pct >= 100 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-red-500'

export function SupervisorPage() {
  const nav = useNavigate()
  const user = useAuthStore(s => s.user)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [activeVisits, setActiveVisits] = useState<Visit[]>([])
  const [pendingOrders, setPendingOrders] = useState<OrderRec[]>([])
  const [teamCustomers, setTeamCustomers] = useState<Customer[]>([])
  const [delayedCustomers, setDelayedCustomers] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'personal' | 'team'>('personal')

  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    Promise.all([
      supabase.rpc('get_supervisor_dashboard', { p_token: token, p_month: month, p_year: year }),
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_visits', { p_token: token, p_status: 'active' }),
      supabase.rpc('get_governed_orders', { p_token: token, p_status: 'submitted' }),
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_customer_analytics_list', { p_token: token }),
    ]).then(([dash, emps, visits, orders, custs, delayed]) => {
      if (dash.data && !dash.data.error) setData(dash.data as DashboardData)
      if (emps.data && !emps.data.error) setEmployees((emps.data as any[]) || [])
      if (visits.data && !visits.data.error) setActiveVisits((visits.data as any[]) || [])
      if (orders.data && !orders.data.error) setPendingOrders((orders.data as any[]) || [])
      if (custs.data && !custs.data.error) setTeamCustomers((custs.data as any[]) || [])
      if (delayed.data && !delayed.data.error) setDelayedCustomers((delayed.data as any[]) || [])
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-text-secondary text-sm">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  const me = user
  const supervisorId = me?.employee_id
  const teamMembers = data?.members || []
  const supervisorEmployee = employees.find((e: any) => e.id === supervisorId)
  const userName = me?.full_name || supervisorEmployee?.full_name || ''

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-5xl mx-auto p-3 space-y-4">

        <div className="bg-gradient-to-br from-indigo-700 to-indigo-900 text-white rounded-xl p-5">
          <p className="text-sm opacity-90">مركز القيادة</p>
          <h2 className="text-xl font-bold mt-1">{userName || 'السوبر فايزر'}</h2>
        </div>

        <div className="flex gap-2 bg-white rounded-xl border border-border p-1">
          <button onClick={() => setActiveTab('personal')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'personal' ? 'bg-primary text-white' : 'text-text-secondary'}`}>
            مساحة عملي الشخصية
          </button>
          <button onClick={() => setActiveTab('team')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'team' ? 'bg-primary text-white' : 'text-text-secondary'}`}>
            مساحة الفريق
          </button>
        </div>

        {activeTab === 'personal' ? (
          <PersonalWorkspace data={data} nav={nav} userName={userName} />
        ) : (
          <TeamWorkspace
            data={data}
            employees={employees}
            teamMembers={teamMembers}
            activeVisits={activeVisits}
            pendingOrders={pendingOrders}
            teamCustomers={teamCustomers}
            delayedCustomers={delayedCustomers}
            nav={nav}
            supervisorId={supervisorId}
            setShowAddCustomer={setShowAddCustomer}
            setShowAddMember={setShowAddMember}
          />
        )}
      </div>

      {showAddCustomer && (
        <AddCustomerModal
          supervisorId={supervisorId}
          employees={employees}
          teamMembers={teamMembers}
          onClose={() => setShowAddCustomer(false)}
          onDone={() => { setShowAddCustomer(false); window.location.reload() }}
        />
      )}

      {showAddMember && (
        <AddMemberModal
          onClose={() => setShowAddMember(false)}
          onDone={() => { setShowAddMember(false); window.location.reload() }}
        />
      )}
    </div>
  )
}

function PersonalWorkspace({ data, nav, userName }: { data: DashboardData | null; nav: any; userName: string }) {
  const ps = data?.personal_summary
  if (!ps) return <div className="text-center py-8 text-text-secondary text-sm">لا توجد بيانات</div>

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">مؤشرات أدائي الشخصي</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="عملائي" value={fmt(ps.customer_count)} icon="👤" onClick={() => nav('/customers')} />
          <Card label="طلباتي هذا الشهر" value={fmt(ps.month_orders)} icon="📋" sub={ps.today_orders > 0 ? `اليوم: ${fmt(ps.today_orders)}` : undefined} onClick={() => nav('/orders')} />
          <Card label="مبيعاتي هذا الشهر" value={formatCurrencyShort(ps.month_sales)} icon="💰" onClick={() => nav('/orders')} />
          <Card label="زياراتي هذا الشهر" value={fmt(ps.month_visits)} icon="🚗" sub={`نشطة: ${fmt(ps.active_visits)}`} onClick={() => nav('/visits')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <QuickBtn label="كل العملاء" onClick={() => nav('/customers')} color="bg-primary" />
          <QuickBtn label="كل الطلبات" onClick={() => nav('/orders')} color="bg-accent" />
          <QuickBtn label="الزيارات" onClick={() => nav('/visits')} color="bg-success" />
          <QuickBtn label="التحصيلات" onClick={() => nav('/collections')} color="bg-surface text-text" />
        </div>
      </div>

      <button onClick={() => nav('/attendance/runtime')}
        className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 text-white rounded-xl py-3.5 text-sm font-bold active:opacity-80 transition-opacity shadow-sm border-0">
        تسجيل الحضور
      </button>
    </div>
  )
}

function TeamWorkspace({
  data, employees, teamMembers, activeVisits, pendingOrders, teamCustomers, delayedCustomers,
  nav, supervisorId, setShowAddCustomer, setShowAddMember
}: {
  data: DashboardData | null; employees: any[]; teamMembers: MemberPerf[]
  activeVisits: Visit[]; pendingOrders: OrderRec[]; teamCustomers: Customer[]
  delayedCustomers: any[]; nav: any; supervisorId?: string
  setShowAddCustomer: (v: boolean) => void; setShowAddMember: (v: boolean) => void
}) {
  const ts = data?.team_summary
  const tt = data?.team_targets

  return (
    <div className="space-y-4">

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">ملخص الفريق</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="الأعضاء" value={fmt(ts?.member_count || 0)} icon="👥" onClick={() => nav('/employees')} />
          <Card label="عملاء الفريق" value={fmt(ts?.customer_count || 0)} icon="🏢" sub={`هذا الشهر: ${fmt(ts?.new_customers_month || 0)}`} onClick={() => nav('/customers')} />
          <Card label="طلبات هذا الشهر" value={fmt(ts?.month_orders || 0)} icon="📋" sub={`اليوم: ${fmt(ts?.today_orders || 0)}`} onClick={() => nav('/orders')} />
          <Card label="مبيعات الشهر" value={formatCurrencyShort(ts?.month_sales || 0)} icon="💰" onClick={() => nav('/orders')} />
          <Card label="زيارات نشطة" value={fmt(ts?.active_visits || 0)} icon="🚗" sub={`اليوم: ${fmt(ts?.today_visits || 0)}`} onClick={() => nav('/visits')} />
          <Card label="تحصيلات معلقة" value={fmt(ts?.pending_collections || 0)} icon="📊" onClick={() => nav('/collections')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-text">هيكل الفريق</h3>
          <button onClick={() => setShowAddMember(true)}
            className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-semibold">
            + إضافة مندوب
          </button>
        </div>
        <div className="space-y-2">
          {supervisorId && (
            <div className="flex items-center gap-3 bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-100">
              <span className="w-8 h-8 rounded-full bg-indigo-700 text-white flex items-center justify-center text-xs font-bold">SF</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text">{teamMembers.find(m => m.employee_id === supervisorId)?.employee_name || 'أنا'}</p>
                <p className="text-[10px] text-text-secondary">سوبر فايزر</p>
              </div>
            </div>
          )}
          {teamMembers
            .filter(m => m.employee_id !== supervisorId)
            .map(m => (
              <div key={m.employee_id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-border">
                <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">M</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text">{m.employee_name}</p>
                  <p className="text-[10px] text-text-secondary">{m.employee_code}</p>
                </div>
                <div className="flex gap-3 text-[10px] text-text-secondary">
                  <span title="العملاء">{fmt(m.customer_count)} عميل</span>
                  <span title="الطلبات">{fmt(m.month_orders)} طلب</span>
                  <span title="الزيارات">{fmt(m.month_visits)} زيارة</span>
                  <span title="المبيعات">{formatCurrencyShort(m.month_sales)}</span>
                </div>
              </div>
            ))}
          {teamMembers.filter(m => m.employee_id !== supervisorId).length === 0 && (
            <p className="text-xs text-text-secondary text-center py-4">لا يوجد مندوبين في فريقك</p>
          )}
        </div>
      </div>

      {teamMembers.length > 0 && (
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
                {teamMembers.map(m => (
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
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">الزيارات النشطة</h3>
          {activeVisits.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {activeVisits.slice(0, 10).map((v: any) => (
                <button key={v.id} onClick={() => nav(`/visits/${v.id}`)}
                  className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border/50 last:border-0 text-right">
                  <span className="text-text font-semibold">{v.customer_name || v.id?.slice(0, 8)}</span>
                  <span className="text-text-secondary">{v.employee_name || ''}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary text-center py-4">لا توجد زيارات نشطة</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">طلبات بانتظار الاعتماد</h3>
          {pendingOrders.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {pendingOrders.slice(0, 10).map((o: any) => (
                <button key={o.id} onClick={() => nav(`/orders/${o.id}`)}
                  className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border/50 last:border-0 text-right">
                  <span className="text-text font-semibold">{o.order_number || o.id?.slice(0, 8)}</span>
                  <span className="text-text-secondary">{formatCurrencyShort(Number(o.total_amount || 0))}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary text-center py-4">لا توجد طلبات بانتظار الاعتماد</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">العملاء المتأخرون</h3>
        {delayedCustomers.length > 0 ? (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(delayedCustomers as any[]).slice(0, 10).map((c: any) => (
              <button key={c.customer_id} onClick={() => nav(`/customers/${c.customer_id}`)}
                className="w-full flex justify-between items-center text-xs py-1.5 border-b border-border/50 last:border-0 text-right">
                <span className="text-text font-semibold">{c.customer_name || c.company_name}</span>
                <span className="text-text-secondary">
                  {c.days_since_last_visit ? `آخر زيارة: ${c.days_since_last_visit} يوم` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-secondary text-center py-4">لا يوجد عملاء متأخرون</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <QuickBtn label="+ عميل لمندوب" onClick={() => setShowAddCustomer(true)} color="bg-primary" />
          <QuickBtn label="+ مندوب جديد" onClick={() => setShowAddMember(true)} color="bg-accent" />
          <QuickBtn label="كل العملاء" onClick={() => nav('/customers')} color="bg-surface text-text" />
          <QuickBtn label="كل الطلبات" onClick={() => nav('/orders')} color="bg-surface text-text" />
          <QuickBtn label="الزيارات" onClick={() => nav('/visits')} color="bg-surface text-text" />
          <QuickBtn label="التحصيلات" onClick={() => nav('/collections')} color="bg-surface text-text" />
          <QuickBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} color="bg-accent" />
          <QuickBtn label="أهداف الفريق" onClick={() => nav('/dashboard/employee-targets')} color="bg-primary" />
        </div>
      </div>

      <button onClick={() => nav('/attendance/runtime')}
        className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 text-white rounded-xl py-3.5 text-sm font-bold active:opacity-80 transition-opacity shadow-sm border-0">
        تسجيل الحضور
      </button>
    </div>
  )
}

function Card({ label, value, icon, sub, onClick }: { label: string; value: string; icon: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-surface rounded-xl p-3 text-right active:bg-gray-100 transition-colors border border-border/50 w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
      {sub && <p className="text-[10px] text-text-secondary mt-0.5">{sub}</p>}
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
      <p className="text-[9px] text-text-secondary mt-1">الإنجاز: {formatCurrencyShort(actual)}</p>
    </div>
  )
}

const BUSINESS_TYPES = [
  { value: 'wholesaler', label: 'تاجر جملة' },
  { value: 'distributor', label: 'موزع' },
  { value: 'cosmetics_store', label: 'متجر مستحضرات تجميل' },
  { value: 'supermarket', label: 'سوبر ماركت' },
  { value: 'hypermarket', label: 'هايبر ماركت' },
  { value: 'perfume_store', label: 'متجر عطور' },
  { value: 'pharmacy', label: 'صيدلية' },
  { value: 'other', label: 'أخرى' },
]

function AddCustomerModal({ supervisorId, employees, teamMembers, onClose, onDone }: {
  supervisorId?: string; employees: Employee[]; teamMembers: MemberPerf[]
  onClose: () => void; onDone: () => void
}) {
  const [companyName, setCompanyName] = useState('')
  const [phone, setPhone] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ownerId, setOwnerId] = useState(supervisorId || '')
  const [saving, setSaving] = useState(false)

  const teamMemberOpts = teamMembers.filter(m => m.employee_id !== supervisorId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }
    if (!companyName.trim()) { toast.error('يرجى إدخال اسم النشاط التجاري'); return }
    if (!phone.trim()) { toast.error('يرجى إدخال رقم الهاتف'); return }
    if (!/^01[0-9]{9}$/.test(phone.trim())) { toast.error('رقم الهاتف غير صالح'); return }
    if (!password) { toast.error('يرجى إدخال كلمة المرور'); return }
    if (!/^\d{6}$/.test(password)) { toast.error('كلمة المرور يجب أن تكون 6 أرقام'); return }
    if (password !== confirmPassword) { toast.error('كلمة المرور غير متطابقة'); return }

    setSaving(true)
    const { data, error } = await supabase.rpc('governed_create_customer', {
      p_token: token,
      p_company_name: companyName.trim(),
      p_phone: phone.trim(),
      p_contact_name: responsibleName.trim() || null,
      p_contact_phone: phone.trim() || null,
      p_responsible_name: responsibleName.trim() || null,
      p_business_type: businessType || null,
      p_password: password,
    })
    if (error || (data as any)?.error) {
      toast.error('فشل إنشاء العميل')
      setSaving(false)
      return
    }
    const customerId = (data as any)?.id
    if (ownerId && ownerId !== supervisorId && customerId) {
      await supabase.rpc('governed_change_customer_ownership', {
        p_token: token,
        p_customer_id: customerId,
        p_new_owner_id: ownerId,
      })
    }
    setSaving(false)
    toast.success('تم إنشاء العميل بنجاح')
    onDone()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white rounded-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">إضافة عميل جديد</h2>
          <button onClick={onClose} className="text-text-secondary text-lg">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <Field label="اسم النشاط التجاري *" value={companyName} onChange={setCompanyName} />
          <Field label="رقم الهاتف *" value={phone} onChange={(v) => setPhone(toEnglishDigits(v))} type="tel" maxLength={11} />
          <Field label="اسم المسؤول" value={responsibleName} onChange={setResponsibleName} />
          <div>
            <label className="block text-xs font-semibold text-text mb-1">نوع النشاط</label>
            <select value={businessType} onChange={e => setBusinessType(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text">
              <option value="">-- اختر --</option>
              {BUSINESS_TYPES.map(bt => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
          </div>
          <Field label="كلمة المرور *" value={password} onChange={(v) => setPassword(toEnglishDigits(v))} type="password" maxLength={6} />
          <Field label="تأكيد كلمة المرور *" value={confirmPassword} onChange={(v) => setConfirmPassword(toEnglishDigits(v))} type="password" maxLength={6} />

          <div>
            <label className="block text-xs font-semibold text-text mb-1">المالك</label>
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text">
              <option value={supervisorId || ''}>أنا (السوبر فايزر)</option>
              {teamMemberOpts.map(m => (
                <option key={m.employee_id} value={m.employee_id}>{m.employee_name}</option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-primary text-white text-sm py-3 rounded-lg font-semibold disabled:opacity-40">
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </form>
      </div>
    </ModalOverlay>
  )
}

function AddMemberModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }
    if (!fullName.trim()) { toast.error('يرجى إدخال الاسم'); return }
    if (!phone.trim()) { toast.error('يرجى إدخال رقم الهاتف'); return }
    if (!password) { toast.error('يرجى إدخال كلمة المرور'); return }

    setSaving(true)
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: token,
      p_full_name: fullName.trim(),
      p_phone: phone.trim(),
      p_password: password,
    })
    setSaving(false)
    if (error) { toast.error('فشل إضافة المندوب: ' + error.message); return }
    if ((data as any)?.error) { toast.error((data as any).error); return }
    toast.success('تمت إضافة المندوب بنجاح')
    onDone()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">إضافة مندوب جديد</h2>
          <button onClick={onClose} className="text-text-secondary text-lg">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <Field label="الاسم الكامل *" value={fullName} onChange={setFullName} />
          <Field label="رقم الهاتف *" value={phone} onChange={(v) => setPhone(toEnglishDigits(v))} type="tel" />
          <Field label="كلمة المرور *" value={password} onChange={(v) => setPassword(toEnglishDigits(v))} type="password" />
          <p className="text-[10px] text-text-secondary">سيتم تعيين المدير المسؤول تلقائياً</p>
          <button type="submit" disabled={saving}
            className="w-full bg-primary text-white text-sm py-3 rounded-lg font-semibold disabled:opacity-40">
            {saving ? 'جاري الحفظ...' : 'إضافة'}
          </button>
        </form>
      </div>
    </ModalOverlay>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, type, maxLength, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; maxLength?: number; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text mb-1">{label}</label>
      <input type={type || 'text'} dir={type === 'tel' || type === 'password' ? 'ltr' : 'rtl'}
        placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
    </div>
  )
}
