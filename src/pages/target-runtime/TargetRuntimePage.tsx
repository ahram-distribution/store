import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { targetService } from '../../services/targets'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'


interface EmployeePerfRow {
  employee_id: string
  employee_code: string
  employee_name: string
  manager_id: string | null
  manager_name: string | null
  identity_id: string | null
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  gross_sales: number
  visits_actual: number
  gross_orders: number
  new_customers_actual: number
  effective_sales: number
  effective_orders: number
  return_deduction: number
  full_returns: number
  sales_achievement_pct: number | null
  visits_achievement_pct: number | null
  orders_achievement_pct: number | null
  new_customers_achievement_pct: number | null
  overall_achievement_score: number | null
  has_target: boolean
  has_activity: boolean
  sales_weight_percent: number
  visits_weight_percent: number
  orders_weight_percent: number
  new_customers_weight_percent: number
}

interface CompanyInfo {
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  sales_actual: number
  visits_actual: number
  orders_actual: number
  new_customers_actual: number
  sales_weight_percent: number
  visits_weight_percent: number
  orders_weight_percent: number
  new_customers_weight_percent: number
  sales_achievement_pct: number
  visits_achievement_pct: number
  orders_achievement_pct: number
  new_customers_achievement_pct: number
  overall_achievement_pct: number
  is_locked: boolean
}

interface PerformanceData {
  has_target: boolean
  company: CompanyInfo | null
  employees: EmployeePerfRow[]
  best_employee: EmployeePerfRow | null
  weakest_employee: EmployeePerfRow | null
}

type StatusType = 'on_track' | 'needs_push' | 'needs_help' | 'critical' | 'no_target'

interface ManagerGroup {
  manager_id: string | null
  manager_name: string
  members: EmployeePerfRow[]
}

const MONTHS_SA = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const STATUS_CONFIG: Record<StatusType, { label: string; bg: string; text: string; dot: string }> = {
  on_track: { label: 'على المسار', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  needs_push: { label: 'بحاجة دفع', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  needs_help: { label: 'بحاجة مساعدة', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  critical: { label: 'متأخر', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  no_target: { label: 'بدون هدف', bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-300' },
}

function computeStatus(emp: EmployeePerfRow): StatusType {
  if (!emp.has_target) return 'no_target'

  const now = new Date()
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const progress = dayOfMonth / daysInMonth

  const score = emp.overall_achievement_score ?? 0

  if (score >= progress * 100 * 1.2) return 'on_track'
  if (score >= progress * 100 * 0.5) return 'needs_push'
  if (emp.has_activity) return 'needs_help'
  return 'critical'
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toLocaleString('ar-EG-u-nu-latn')
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toFixed(1) + '%'
}

function fmtShort(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return fmt(n)
}

function StatusBadge({ status }: { status: StatusType }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function ActivityCell({ emp }: { emp: EmployeePerfRow }) {
  if (!emp.has_activity) {
    return <span className="text-gray-400 text-xs">غير نشط</span>
  }
  const parts: string[] = []
  if (emp.visits_actual > 0) parts.push(`${fmt(emp.visits_actual)} زيارة`)
  if (emp.gross_orders > 0) parts.push(`${fmt(emp.gross_orders)} طلب`)
  if (emp.effective_sales > 0) parts.push(`${fmtShort(emp.effective_sales)} مبيعات`)
  if (emp.new_customers_actual > 0) parts.push(`${fmt(emp.new_customers_actual)} عميل جديد`)
  return (
    <span className="text-[11px] text-gray-600 leading-tight block">
      {parts.join(' · ') || 'نشط'}
    </span>
  )
}

function TargetCell({ target, actual }: { target: number; actual: number }) {
  if (target === 0) {
    if (actual === 0) return <span className="text-gray-300 text-xs">\u2014</span>
    return <span className="text-sm text-gray-900">{fmtShort(actual)}</span>
  }
  const pct = actual > 0 ? Math.round((actual / target) * 100) : 0
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-900">{fmtShort(actual)} <span className="text-gray-400">/ {fmtShort(target)}</span></span>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-400'}`}
            style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className={`text-[10px] font-medium ${pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

function EmployeeRow({ emp, isManager }: { emp: EmployeePerfRow; isManager?: boolean }) {
  const status = computeStatus(emp)
  return (
    <tr className={`border-b border-gray-50 ${isManager ? 'bg-blue-50/40' : ''}`}>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col">
          <span className={`text-sm font-medium text-gray-900 ${isManager ? 'text-blue-800' : ''}`}>
            {emp.employee_name}
          </span>
          <span className="text-[10px] text-gray-400">{emp.employee_code}</span>
        </div>
      </td>
      <td className="py-2.5 px-2">
        <ActivityCell emp={emp} />
      </td>
      <td className="py-2.5 px-2 min-w-[140px]">
        <TargetCell target={emp.sales_target} actual={emp.effective_sales} />
      </td>
      <td className="py-2.5 px-2 min-w-[120px]">
        <TargetCell target={emp.orders_target} actual={emp.effective_orders} />
      </td>
      <td className="py-2.5 px-2 min-w-[120px]">
        <TargetCell target={emp.visits_target} actual={emp.visits_actual} />
      </td>
      <td className="py-2.5 px-2 min-w-[120px]">
        <TargetCell target={emp.new_customers_target} actual={emp.new_customers_actual} />
      </td>
      <td className="py-2.5 px-2 text-center">
        <span className={`text-sm font-bold ${(emp.overall_achievement_score ?? 0) >= 80 ? 'text-green-600' : (emp.overall_achievement_score ?? 0) >= 50 ? 'text-yellow-600' : 'text-gray-500'}`}>
          {fmtPct(emp.overall_achievement_score)}
        </span>
      </td>
      <td className="py-2.5 pl-3">
        <StatusBadge status={status} />
      </td>
    </tr>
  )
}

function ManagerSection({ group, allEmployees }: { group: ManagerGroup; allEmployees: EmployeePerfRow[] }) {
  const [expanded, setExpanded] = useState(false)
  const teamMembers = useMemo(() =>
    group.members
      .filter(e => e.employee_id !== group.manager_id)
      .sort((a, b) => {
        const order = ['critical', 'needs_help', 'needs_push', 'on_track', 'no_target']
        return order.indexOf(computeStatus(a)) - order.indexOf(computeStatus(b))
      }),
  [group])

  const teamTarget = useMemo(() => ({
    sales: teamMembers.reduce((s, e) => s + e.sales_target, 0),
    orders: teamMembers.reduce((s, e) => s + e.orders_target, 0),
    visits: teamMembers.reduce((s, e) => s + e.visits_target, 0),
    newCustomers: teamMembers.reduce((s, e) => s + e.new_customers_target, 0),
    salesActual: teamMembers.reduce((s, e) => s + e.effective_sales, 0),
    ordersActual: teamMembers.reduce((s, e) => s + e.effective_orders, 0),
    visitsActual: teamMembers.reduce((s, e) => s + e.visits_actual, 0),
    newCustomersActual: teamMembers.reduce((s, e) => s + e.new_customers_actual, 0),
  }), [teamMembers])

  const teamScores = teamMembers
    .filter(e => e.has_target && e.overall_achievement_score != null)
    .map(e => e.overall_achievement_score!)
  const avgScore = teamScores.length > 0
    ? teamScores.reduce((a, b) => a + b, 0) / teamScores.length
    : null

  const statuses = teamMembers.map(computeStatus)
  const countOnTrack = statuses.filter(s => s === 'on_track').length
  const countNeedsPush = statuses.filter(s => s === 'needs_push').length
  const countNeedsHelp = statuses.filter(s => s === 'needs_help' || s === 'critical').length
  const countNoTarget = statuses.filter(s => s === 'no_target').length

  const hasNoTeam = teamMembers.length === 0

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-4 py-3 text-right transition-colors hover:bg-gray-50/80 ${expanded ? 'border-b border-gray-200' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-sm transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <div className="flex flex-col items-start">
            <span className="font-semibold text-sm text-gray-900">{group.manager_name}</span>
            {hasNoTeam ? (
              <span className="text-xs text-amber-600 mt-0.5">لا يوجد فريق تابع حالياً</span>
            ) : (
              <span className="text-xs text-gray-500 mt-0.5">{teamMembers.length} عضو</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-[11px]">
            {countOnTrack > 0 && <span className="text-green-600">🟢 {countOnTrack}</span>}
            {countNeedsPush > 0 && <span className="text-yellow-600">🟡 {countNeedsPush}</span>}
            {countNeedsHelp > 0 && <span className="text-orange-600">🔴 {countNeedsHelp}</span>}
            {countNoTarget > 0 && <span className="text-gray-400">⚪ {countNoTarget}</span>}
          </div>
          <div className="text-left min-w-[60px]">
            <div className="text-sm font-bold text-gray-800">{avgScore != null ? avgScore.toFixed(1) + '%' : '\u2014'}</div>
            <div className="text-[10px] text-gray-400">متوسط الفريق</div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="py-2 pr-4 text-[11px] font-medium text-gray-500">الموظف</th>
                <th className="py-2 px-2 text-[11px] font-medium text-gray-500">آخر نشاط</th>
                <th className="py-2 px-2 min-w-[140px]">
                  <div className="text-[11px] font-medium text-gray-500">المبيعات</div>
                  <div className="text-[9px] text-gray-400 font-normal leading-tight">الفعلية / المستهدفة</div>
                </th>
                <th className="py-2 px-2 min-w-[120px]">
                  <div className="text-[11px] font-medium text-gray-500">الطلبات</div>
                  <div className="text-[9px] text-gray-400 font-normal leading-tight">الفعلية / المستهدفة</div>
                </th>
                <th className="py-2 px-2 min-w-[120px]">
                  <div className="text-[11px] font-medium text-gray-500">الزيارات</div>
                  <div className="text-[9px] text-gray-400 font-normal leading-tight">الفعلية / المستهدفة</div>
                </th>
                <th className="py-2 px-2 min-w-[120px]">
                  <div className="text-[11px] font-medium text-gray-500">عملاء جدد</div>
                  <div className="text-[9px] text-gray-400 font-normal leading-tight">الفعلية / المستهدفة</div>
                </th>
                <th className="py-2 px-2 text-center">
                  <div className="text-[11px] font-medium text-gray-500">الإنجاز</div>
                  <div className="text-[9px] text-gray-400 font-normal leading-tight">%</div>
                </th>
                <th className="py-2 pl-4 text-[11px] font-medium text-gray-500">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {[...group.members].sort((a, b) => {
                const order = ['critical', 'needs_help', 'needs_push', 'on_track', 'no_target']
                return order.indexOf(computeStatus(a)) - order.indexOf(computeStatus(b))
              }).map(emp => (
                <EmployeeRow key={emp.employee_id} emp={emp} />
              ))}
            </tbody>
            {teamMembers.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/40">
                  <td className="py-2.5 pr-4 text-xs font-semibold text-gray-700">إجمالي الفريق</td>
                  <td className="py-2.5 px-2" />
                  <td className="py-2.5 px-2 text-xs text-gray-600">{fmtShort(teamTarget.salesActual)} / {fmtShort(teamTarget.sales)}</td>
                  <td className="py-2.5 px-2 text-xs text-gray-600">{fmt(teamTarget.ordersActual)} / {fmt(teamTarget.orders)}</td>
                  <td className="py-2.5 px-2 text-xs text-gray-600">{fmt(teamTarget.visitsActual)} / {fmt(teamTarget.visits)}</td>
                  <td className="py-2.5 px-2 text-xs text-gray-600">{fmt(teamTarget.newCustomersActual)} / {fmt(teamTarget.newCustomers)}</td>
                  <td className="py-2.5 px-2 text-center text-xs font-semibold">{avgScore != null ? avgScore.toFixed(1) + '%' : '\u2014'}</td>
                  <td className="py-2.5 pl-4" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

function Top5Worst5({ employees }: { employees: EmployeePerfRow[] }) {
  const scored = employees.filter(e => e.has_target && e.overall_achievement_score != null)
  const sorted = [...scored].sort((a, b) => (b.overall_achievement_score ?? 0) - (a.overall_achievement_score ?? 0))
  const top5 = sorted.slice(0, 5)
  const worst5 = sorted.slice(-5).reverse()

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="border border-green-200 rounded-lg bg-green-50/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🏆</span>
          <span className="text-sm font-semibold text-green-800">أفضل 5</span>
        </div>
        <div className="space-y-1.5">
          {top5.length === 0 ? (
            <span className="text-xs text-gray-400">لا يوجد موظفون بأهداف</span>
          ) : top5.map((emp, i) => (
            <div key={emp.employee_id} className="flex items-center justify-between text-xs">
              <span className="text-gray-700">{i + 1}. {emp.employee_name}</span>
              <span className="font-semibold text-green-600">{fmtPct(emp.overall_achievement_score)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-red-200 rounded-lg bg-red-50/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">⚠️</span>
          <span className="text-sm font-semibold text-red-800">أسوأ 5</span>
        </div>
        <div className="space-y-1.5">
          {worst5.length === 0 ? (
            <span className="text-xs text-gray-400">لا يوجد موظفون بأهداف</span>
          ) : worst5.map((emp, i) => (
            <div key={emp.employee_id} className="flex items-center justify-between text-xs">
              <span className="text-gray-700">{i + 1}. {emp.employee_name}</span>
              <span className="font-semibold text-red-500">{fmtPct(emp.overall_achievement_score)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryBar({ employees }: { employees: EmployeePerfRow[] }) {
  const statuses = employees.map(computeStatus)
  const onTrack = statuses.filter(s => s === 'on_track').length
  const needsPush = statuses.filter(s => s === 'needs_push').length
  const needsHelp = statuses.filter(s => s === 'needs_help' || s === 'critical').length
  const noTarget = statuses.filter(s => s === 'no_target').length

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="font-medium text-gray-700">حالة الفريق:</span>
      {onTrack > 0 && <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">🟢 على المسار {onTrack}</span>}
      {needsPush > 0 && <span className="px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">🟡 بحاجة دفع {needsPush}</span>}
      {needsHelp > 0 && <span className="px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">🔴 بحاجة مساعدة {needsHelp}</span>}
      {noTarget > 0 && <span className="px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200">⚪ بدون هدف {noTarget}</span>}
    </div>
  )
}

function CompanyOverview({ company }: { company: CompanyInfo | null }) {
  if (!company) return null
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-800">أداء الشركة</span>
        <span className="text-lg font-bold text-gray-900">{fmtPct(company.overall_achievement_pct)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'المبيعات', pct: company.sales_achievement_pct, actual: company.sales_actual, target: company.sales_target },
          { label: 'الطلبات', pct: company.orders_achievement_pct, actual: company.orders_actual, target: company.orders_target },
          { label: 'الزيارات', pct: company.visits_achievement_pct, actual: company.visits_actual, target: company.visits_target },
          { label: 'عملاء جدد', pct: company.new_customers_achievement_pct, actual: company.new_customers_actual, target: company.new_customers_target },
        ].map(k => (
          <div key={k.label} className="text-center">
            <div className="text-[11px] text-gray-500">{k.label}</div>
            <div className="text-sm font-semibold mt-0.5">{fmtPct(k.pct)}</div>
            <div className="text-[10px] text-gray-400">{fmtShort(k.actual)} / {fmtShort(k.target)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ActiveEmpRow {
  employee_id: string
  employee_code: string
  employee_name: string
  role_type: string
  has_team: boolean
  employee_manager_id: string | null
}

export default function TargetRuntimePage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [data, setData] = useState<PerformanceData | null>(null)
  const [activeEmps, setActiveEmps] = useState<ActiveEmpRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const currentRole = user?.roles?.map(normalizeEmployeeRole)[0]
  const isUpperMgmt = currentRole === 'الإدارة العليا'
  const isSalesMgr = currentRole === 'مدير بيع'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      targetService.getPerformance(selMonth, selYear),
      targetService.getAllActiveEmployees(),
    ]).then(([perf, active]) => {
      if (cancelled) return
      if (perf.error) { setError(perf.error.message); setLoading(false); return }
      setData(perf.data as PerformanceData)
      if (active.data) setActiveEmps(active.data as ActiveEmpRow[])
    }).catch(err => {
      if (!cancelled) { setError(err.message); setLoading(false) }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [selMonth, selYear])

  // Build emp_id -> manager_id mapping from active employees
  const mgrMap = useMemo(() => {
    const map = new Map<string, { manager_id: string | null; manager_name: string }>()
    for (const emp of activeEmps) {
      const mgrId = emp.employee_manager_id
      const mgrName = mgrId ? (activeEmps.find(e => e.employee_id === mgrId)?.employee_name || '') : ''
      map.set(emp.employee_id, { manager_id: mgrId, manager_name: mgrName })
    }
    return map
  }, [activeEmps])

  const employeeGroups = useMemo(() => {
    if (!data?.employees) return []
    const groups = new Map<string, EmployeePerfRow[]>()
    const unnamed = new Map<string, string>()

    for (const emp of data.employees) {
      const mgrInfo = mgrMap.get(emp.employee_id)
      const mgrId = mgrInfo?.manager_id || 'no_manager'
      if (!groups.has(mgrId)) groups.set(mgrId, [])
      groups.get(mgrId)!.push(emp)
      if (mgrInfo?.manager_name) unnamed.set(mgrId, mgrInfo.manager_name)
    }

    const mgrNames = new Map<string, string>()
    for (const emp of activeEmps) {
      mgrNames.set(emp.employee_id, emp.employee_name)
    }

    return Array.from(groups.entries())
      .map(([mgrId, members]) => {
        const name = mgrId !== 'no_manager'
          ? (mgrNames.get(mgrId) || unnamed.get(mgrId) || '')
          : ''
        return {
          manager_id: mgrId === 'no_manager' ? null : mgrId,
          manager_name: name,
          members,
        }
      })
      .filter(g => g.manager_name)
      .sort((a, b) => a.manager_name.localeCompare(b.manager_name))
  }, [data, activeEmps, mgrMap])

  const filteredGroups = useMemo(() => {
    if (isUpperMgmt) return employeeGroups
    if (isSalesMgr && user?.employee_id) {
      return employeeGroups.filter(g => g.manager_id === user.employee_id)
    }
    return employeeGroups.filter(g => g.manager_id === user?.employee_id)
  }, [employeeGroups, isUpperMgmt, isSalesMgr, user?.employee_id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500 text-sm">{error}</div>
    )
  }

  const employees = data?.employees ?? []

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => nav(-1)} className="text-gray-500 text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-gray-900">التارجت</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const d = new Date(selYear, selMonth - 2); setSelMonth(d.getMonth() + 1); setSelYear(d.getFullYear()) }}
            className="text-gray-400 hover:text-gray-600 text-sm px-1"
          >&lt;</button>
          <span className="text-sm font-medium text-gray-700 min-w-[100px] text-center">
            {MONTHS_SA[selMonth - 1]} {selYear}
          </span>
          <button
            onClick={() => { const d = new Date(selYear, selMonth); setSelMonth(d.getMonth() + 1); setSelYear(d.getFullYear()) }}
            className="text-gray-400 hover:text-gray-600 text-sm px-1"
          >&gt;</button>
        </div>
      </div>

      {/* Company Overview - Upper Management only */}
      {isUpperMgmt && data?.company && <CompanyOverview company={data.company} />}

      {/* Top 5 / Worst 5 - Upper Management only */}
      {isUpperMgmt && employees.length > 0 && (
        <Top5Worst5 employees={employees} />
      )}

      {/* Summary */}
      {filteredGroups.length > 0 && <SummaryBar employees={filteredGroups.flatMap(g => g.members)} />}

      {/* Manager Groups */}
      {filteredGroups.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {isSalesMgr ? 'لا يوجد فريق تابع حالياً' : 'لا يوجد موظفون لعرضهم'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(group => (
            <ManagerSection
              key={group.manager_id ?? 'no_manager'}
              group={group}
              allEmployees={employees}
            />
          ))}
        </div>
      )}
    </div>
  )
}
