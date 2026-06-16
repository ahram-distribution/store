import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { targetService } from '../../services/targets'
import { supabase } from '../../lib/supabase'

interface EmpSummary {
  employee_id: string; employee_code: string; employee_name: string; role_type: string; has_team: boolean
  sales_actual: number; sales_target: number; sales_pct: number | null
  orders_actual: number; orders_target: number; orders_pct: number | null
  visits_actual: number; visits_target: number; visits_pct: number | null
  new_cust_actual: number; new_cust_target: number; new_cust_pct: number | null
  collections_actual: number; collections_target: number; collections_pct: number | null
}

interface DrillCustomer {
  customer_id: string; customer_name: string
  total_sales: number; total_orders: number; total_visits: number; is_new_customer: boolean
}

interface DrillOrder {
  order_id: string; order_code: string; total_amount: number; delivered_at: string; status: string
}

interface VisitItem {
  id: string; customer_name: string; visit_date: string; status: string
}

type KpiType = 'sales' | 'orders' | 'visits' | 'new_customers' | 'collections'

interface TeamBreakdown {
  kpiType: KpiType; label: string; unit: string
  personal_actual: number; personal_target: number
  team_actual: number; team_target: number
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const ALL_KPI_TYPES: KpiType[] = ['sales', 'orders', 'visits', 'new_customers', 'collections']

const KPI_META: Record<KpiType, { label: string; unit: string }> = {
  sales: { label: 'المبيعات', unit: 'جنيه' },
  orders: { label: 'الطلبات', unit: 'عدد' },
  visits: { label: 'الزيارات', unit: 'عدد' },
  new_customers: { label: 'العملاء الجدد', unit: 'عدد' },
  collections: { label: 'التحصيل', unit: 'جنيه' },
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function fmt(n: number): string { return n.toLocaleString('ar-EG-u-nu-latn') }
function fmtPct(n: number | null): string { return n != null ? n.toFixed(1) + '%' : 'غير متوفر' }
function pctColor(pct: number | null): string {
  if (pct == null) return 'text-text-secondary'
  if (pct >= 100) return 'text-success'
  if (pct >= 50) return 'text-warning'
  return 'text-red-500'
}

export default function EmployeeAnalysisPage() {
  const nav = useNavigate()
  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<EmpSummary[]>([])
  const [roleFilter, setRoleFilter] = useState('الكل')
  const [empSearch, setEmpSearch] = useState('')
  const [selectedEmpId, setSelectedEmpId] = useState('')

  // drill state
  const [view, setView] = useState<'list' | 'employee'>('list')
  const [activeEmp, setActiveEmp] = useState<EmpSummary | null>(null)

  // drill data
  const [customers, setCustomers] = useState<DrillCustomer[]>([])
  const [orders, setOrders] = useState<DrillOrder[]>([])
  const [visits, setVisits] = useState<VisitItem[]>([])
  const [customerOrders, setCustomerOrders] = useState<DrillOrder[]>([])
  const [activeCustomer, setActiveCustomer] = useState<DrillCustomer | null>(null)

  // team view
  const [teamBreakdowns, setTeamBreakdowns] = useState<TeamBreakdown[]>([])
  const [teamMembers, setTeamMembers] = useState<EmpSummary[]>([])
  const [teamStats, setTeamStats] = useState({ repCount: 0, customerCount: 0, totalOrders: 0 })

  const [loadingDrill, setLoadingDrill] = useState(false)

  const MONTH_LABEL = MONTHS[selMonth - 1] + ' ' + selYear

  async function loadEmployees(month: number, year: number) {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [empResult, salesKpi, ordersKpi, visitsKpi, newCustKpi, collectionsKpi] = await Promise.all([
      targetService.getAllActiveEmployees(),
      targetService.getKpiContributors('sales', month, year, token),
      targetService.getKpiContributors('orders', month, year, token),
      targetService.getKpiContributors('visits', month, year, token),
      targetService.getKpiContributors('new_customers', month, year, token),
      targetService.getKpiContributors('collections', month, year, token),
    ])
    const empList: any[] = !empResult.error ? (empResult.data || []) : []
    const buildMap = (data: any[]) => {
      const m: Record<string, { actual: number; target: number }> = {}
      for (const c of data || []) m[c.employee_id] = { actual: c.actual || 0, target: c.target || 0 }
      return m
    }
    const sMap = buildMap(!salesKpi.error ? (salesKpi.data as any[]) : [])
    const oMap = buildMap(!ordersKpi.error ? (ordersKpi.data as any[]) : [])
    const vMap = buildMap(!visitsKpi.error ? (visitsKpi.data as any[]) : [])
    const nMap = buildMap(!newCustKpi.error ? (newCustKpi.data as any[]) : [])
    const cMap = buildMap(!collectionsKpi.error ? (collectionsKpi.data as any[]) : [])
    const merged: EmpSummary[] = empList.map((emp: any) => {
      const s = sMap[emp.employee_id] || { actual: 0, target: 0 }
      const o = oMap[emp.employee_id] || { actual: 0, target: 0 }
      const v = vMap[emp.employee_id] || { actual: 0, target: 0 }
      const n = nMap[emp.employee_id] || { actual: 0, target: 0 }
      const c = cMap[emp.employee_id] || { actual: 0, target: 0 }
      return {
        employee_id: emp.employee_id, employee_code: emp.employee_code,
        employee_name: emp.employee_name, role_type: emp.role_type, has_team: emp.has_team,
        sales_actual: s.actual, sales_target: s.target, sales_pct: s.target > 0 ? (s.actual / s.target) * 100 : null,
        orders_actual: o.actual, orders_target: o.target, orders_pct: o.target > 0 ? (o.actual / o.target) * 100 : null,
        visits_actual: v.actual, visits_target: v.target, visits_pct: v.target > 0 ? (v.actual / v.target) * 100 : null,
        new_cust_actual: n.actual, new_cust_target: n.target, new_cust_pct: n.target > 0 ? (n.actual / n.target) * 100 : null,
        collections_actual: c.actual, collections_target: c.target, collections_pct: c.target > 0 ? (c.actual / c.target) * 100 : null,
      }
    })
    setEmployees(merged)
    setLoading(false)
  }

  useEffect(() => { setLoading(true); loadEmployees(selMonth, selYear) }, [selMonth, selYear])

  function goPrevMonth() {
    if (selMonth === 1) { setSelMonth(12); setSelYear(selYear - 1) }
    else setSelMonth(selMonth - 1)
  }
  function goNextMonth() {
    if (selMonth === 12) { setSelMonth(1); setSelYear(selYear + 1) }
    else setSelMonth(selMonth + 1)
  }

  const uniqueRoles = useMemo(() => {
    const roles = new Set(employees.map(e => e.role_type))
    return ['الكل', ...Array.from(roles)]
  }, [employees])

  const filteredEmps = useMemo(() => {
    let result = employees
    if (roleFilter !== 'الكل') result = result.filter(e => e.role_type === roleFilter)
    if (empSearch) {
      const t = empSearch.toLowerCase()
      result = result.filter(e => e.employee_name.toLowerCase().includes(t) || e.employee_code.toLowerCase().includes(t))
    }
    return result
  }, [employees, roleFilter, empSearch])

  function selectEmployee(emp: EmpSummary) {
    setActiveEmp(emp)
    setView('employee')
    setCustomers([]); setOrders([]); setVisits([])
    setCustomerOrders([]); setActiveCustomer(null)
    setTeamBreakdowns([]); setTeamMembers([])

    if (emp.has_team) loadTeamData(emp)
  }

  async function loadTeamData(emp: EmpSummary) {
    const token = getToken()
    if (!token) return
    setLoadingDrill(true)
    const results = await Promise.all(ALL_KPI_TYPES.map(kt =>
      targetService.getTeamMembersKpis(emp.employee_id, kt, selMonth, selYear, token)
        .then(({ data }) => ({ kpiType: kt, members: (data || []) as any[] }))
    ))
    const allBreakdowns: TeamBreakdown[] = []
    let memberCount = 0
    for (const r of results) {
      const members = r.members
      if (members.length > 0) memberCount = members.length
      const teamSumActual = members.reduce((s: number, m: any) => s + (m.actual || 0), 0)
      const teamSumTarget = members.reduce((s: number, m: any) => s + (m.target || 0), 0)
      const meta = KPI_META[r.kpiType]
      const personalActual = r.kpiType === 'sales' ? emp.sales_actual
        : r.kpiType === 'orders' ? emp.orders_actual
        : r.kpiType === 'visits' ? emp.visits_actual
        : r.kpiType === 'new_customers' ? emp.new_cust_actual
        : emp.collections_actual
      const personalTarget = r.kpiType === 'sales' ? emp.sales_target
        : r.kpiType === 'orders' ? emp.orders_target
        : r.kpiType === 'visits' ? emp.visits_target
        : r.kpiType === 'new_customers' ? emp.new_cust_target
        : emp.collections_target
      allBreakdowns.push({
        kpiType: r.kpiType, label: meta.label, unit: meta.unit,
        personal_actual: personalActual, personal_target: personalTarget,
        team_actual: teamSumActual, team_target: teamSumTarget,
      })
    }
    // Also load team stats
    const { data: emps } = await supabase
      .from('employees')
      .select('id, code, full_name, manager_id')
      .eq('manager_id', emp.employee_id)
      .eq('is_active', true)
    const repCount = (emps || []).length
    // Get customer count and order count for team
    const { count: custCount } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .in('owner_id', (emps || []).map((e: any) => e.identity_id).filter(Boolean))
      .eq('is_active', true)
    // Total orders for all team members' customers
    const teamIds = (emps || []).map((e: any) => e.id)
    let totalOrders = 0
    const kpiContribAll = results.find(r => r.kpiType === 'orders')
    if (kpiContribAll) {
      totalOrders = kpiContribAll.members.reduce((s: number, m: any) => s + (m.actual || 0), 0)
    }
    setTeamStats({ repCount, customerCount: custCount || 0, totalOrders })
    setTeamBreakdowns(allBreakdowns)
    setTeamMembers([])
    setLoadingDrill(false)
  }

  function openCustomers(kpiType: KpiType) {
    if (!activeEmp) return
    const token = getToken()
    if (!token) return
    setLoadingDrill(true)
    targetService.getRepCustomerKpis(activeEmp.employee_id, selMonth, selYear, token)
      .then(({ data, error }) => {
        if (!error && data) {
          let list = (data as DrillCustomer[]).filter(c => {
            if (kpiType === 'new_customers') return c.is_new_customer
            if (kpiType === 'visits') return c.total_visits > 0
            if (kpiType === 'collections') return c.total_sales > 0
            return c.total_sales > 0
          })
          if (kpiType === 'sales') list.sort((a, b) => b.total_sales - a.total_sales)
          setCustomers(list)
        }
        setLoadingDrill(false)
      })
  }

  function openOrders() {
    if (!activeEmp) return
    const token = getToken()
    if (!token) return
    setLoadingDrill(true)
    targetService.getRepCustomerKpis(activeEmp.employee_id, selMonth, selYear, token)
      .then(({ data, error }) => {
        if (!error && data) {
          const custList = data as DrillCustomer[]
          Promise.all(custList.map(c =>
            targetService.getCustomerDeliveredOrders(c.customer_id, selMonth, selYear, token)
              .then(({ data: ordData }) => ({ customerId: c.customer_id, orders: (ordData || []) as DrillOrder[] }))
          )).then(results => {
            const allOrders = results.flatMap(r => r.orders)
            allOrders.sort((a, b) => new Date(b.delivered_at).getTime() - new Date(a.delivered_at).getTime())
            setOrders(allOrders)
            setLoadingDrill(false)
          })
        } else setLoadingDrill(false)
      })
  }

  function openVisits() {
    if (!activeEmp) return
    const token = getToken()
    if (!token) return
    setLoadingDrill(true)
    supabase
      .from('visits')
      .select('id, customer_id, visit_date, status, customer:customer_id(company_name)')
      .eq('employee_id', activeEmp.employee_id)
      .gte('visit_date', new Date(selYear, selMonth - 1, 1).toISOString())
      .lt('visit_date', new Date(selYear, selMonth, 1).toISOString())
      .order('visit_date', { ascending: false } as any)
      .then(({ data: visitData, error }) => {
        if (!error && visitData && visitData.length > 0) {
          setVisits((visitData as any[]).map((v: any) => ({
            id: v.id,
            customer_name: v.customer?.company_name || 'غير متوفر',
            visit_date: v.visit_date,
            status: v.status,
          })))
        } else {
          // Fallback: show empty
          setVisits([])
        }
        setLoadingDrill(false)
      })
      .catch(() => { setVisits([]); setLoadingDrill(false) })
  }

  function openCustomerOrders(cust: DrillCustomer) {
    const token = getToken()
    if (!token) return
    setLoadingDrill(true)
    setActiveCustomer(cust)
    targetService.getCustomerDeliveredOrders(cust.customer_id, selMonth, selYear, token)
      .then(({ data, error }) => {
        if (!error && data) setCustomerOrders((data || []) as DrillOrder[])
        setLoadingDrill(false)
      })
  }

  function goToOrder(orderId: string) {
    nav(`/orders/${orderId}`)
  }

  function goToVisit(visitId: string) {
    nav(`/visits/${visitId}`)
  }

  function goToCustomer(customerId: string) {
    nav(`/customers/${customerId}`)
  }

  function goBackToList() {
    setView('list')
    setActiveEmp(null)
    setCustomers([]); setOrders([]); setVisits([])
    setCustomerOrders([]); setActiveCustomer(null)
    setTeamBreakdowns([])
  }

  function goBackFromCustomers() { setCustomers([]) }
  function goBackFromOrders() { setOrders([]) }
  function goBackFromVisits() { setVisits([]) }
  function goBackFromCustomerOrders() { setCustomerOrders([]); setActiveCustomer(null) }

  // Breadcrumb for current view
  function Breadcrumb() {
    const crumbs: { label: string; onClick?: () => void }[] = [{ label: 'تحليل الموظفين', onClick: goBackToList }]
    if (activeEmp) {
      crumbs.push({ label: activeEmp.employee_name })
      if (customers.length > 0) {
        const label = activeCustomer ? 'العملاء' : (orders.length > 0 ? 'الطلبات' : visits.length > 0 ? 'الزيارات' : 'العملاء')
        crumbs.push({ label, onClick: () => { setCustomers([]); setOrders([]); setVisits([]); setCustomerOrders([]) } })
        if (activeCustomer) {
          crumbs.push({ label: activeCustomer.customer_name, onClick: () => { setCustomerOrders([]); setActiveCustomer(null) } })
          if (customerOrders.length > 0) crumbs.push({ label: 'الطلبات' })
        }
      } else if (orders.length > 0) {
        crumbs.push({ label: 'الطلبات', onClick: goBackFromOrders })
      } else if (visits.length > 0) {
        crumbs.push({ label: 'الزيارات', onClick: goBackFromVisits })
      }
    }
    return (
      <div className="flex items-center gap-1 text-xs flex-wrap mb-3">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-text-secondary mx-0.5">{'>'}</span>}
            {c.onClick ? (
              <button onClick={c.onClick} className="text-primary font-semibold hover:underline cursor-pointer">{c.label}</button>
            ) : (
              <span className="text-text font-semibold">{c.label}</span>
            )}
          </span>
        ))}
      </div>
    )
  }

  // ---- Employee Card Component ----
  function EmployeeCard({ emp }: { emp: EmpSummary }) {
    return (
      <button onClick={() => selectEmployee(emp)}
        className="w-full bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <p className="text-[10px] text-text-secondary font-mono">{emp.employee_code}</p>
            <p className="text-sm font-bold text-text truncate">{emp.employee_name}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              emp.role_type === 'مدير مبيعات' ? 'bg-purple-100 text-purple-700'
              : emp.role_type === 'سوبر فايزر' ? 'bg-amber-100 text-amber-700'
              : 'bg-blue-100 text-blue-700'
            }`}>{emp.role_type}</span>
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <KpiBlock label="المبيعات" actual={emp.sales_actual} pct={emp.sales_pct} unit="جنيه" />
          <KpiBlock label="الطلبات" actual={emp.orders_actual} pct={emp.orders_pct} unit="عدد" />
          <KpiBlock label="الزيارات" actual={emp.visits_actual} pct={emp.visits_pct} unit="عدد" />
          <KpiBlock label="العملاء الجدد" actual={emp.new_cust_actual} pct={emp.new_cust_pct} unit="عدد" />
          <KpiBlock label="التحصيل" actual={emp.collections_actual} pct={emp.collections_pct} unit="جنيه" />
        </div>
      </button>
    )
  }

  function KpiBlock({ label, actual, pct, unit }: { label: string; actual: number; pct: number | null; unit: string }) {
    return (
      <div className="bg-surface rounded-lg p-2">
        <p className="text-[10px] font-semibold text-text-secondary mb-0.5">{label}</p>
        <p className="text-xs font-bold text-text ltr" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(actual)}</p>
        <p className={`text-[9px] font-semibold ${pctColor(pct)}`}>{fmtPct(pct)}</p>
      </div>
    )
  }

  // ---- KPI Detail Block (target/actual/remaining/pct) ----
  function KpiDetailBlock({ label, target, actual, pct, unit, onClick }: {
    label: string; target: number; actual: number; pct: number | null; unit: string; onClick?: () => void
  }) {
    const remaining = target - actual
    const Tag = onClick ? 'button' : 'div'
    return (
      <Tag onClick={onClick}
        className={`w-full bg-white rounded-xl border border-border p-3.5 text-right ${
          onClick ? 'active:bg-surface transition-colors cursor-pointer' : ''
        }`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-text">{label}</span>
          {onClick && <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>}
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">الهدف</span>
            <span className="text-text font-semibold ltr" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(target)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">المحقق</span>
            <span className="text-text font-semibold ltr" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(actual)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">المتبقي</span>
            <span className={`font-semibold ltr ${remaining > 0 ? 'text-red-500' : 'text-success'}`}
              style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{remaining > 0 ? fmt(remaining) : '0'}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-border/50">
            <span className="text-text-secondary">نسبة الإنجاز</span>
            <span className={`font-bold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
          </div>
        </div>
      </Tag>
    )
  }

  // ---- Customer Card ----
  function CustomerCard({ cust }: { cust: DrillCustomer }) {
    const totalContribution = customers.reduce((s, c) => s + c.total_sales, 0) || 1
    const sharePct = (cust.total_sales / totalContribution) * 100
    return (
      <button onClick={() => openCustomerOrders(cust)}
        className="w-full bg-white rounded-xl border border-border p-3.5 text-right active:bg-surface transition-colors cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-text truncate ml-2">{cust.customer_name}</span>
          <svg className="w-4 h-4 text-text-secondary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-text-secondary">المبيعات</p>
            <p className="text-text font-bold mt-0.5 ltr" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(cust.total_sales)}</p>
          </div>
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-text-secondary">الطلبات</p>
            <p className="text-text font-bold mt-0.5">{cust.total_orders}</p>
          </div>
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-text-secondary">المساهمة</p>
            <p className="text-primary font-bold mt-0.5">{sharePct.toFixed(1)}%</p>
          </div>
        </div>
        <div className="mt-2 w-full h-1.5 bg-surface rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(sharePct, 100)}%` }} />
        </div>
      </button>
    )
  }

  // ---- Order Card ----
  function OrderCard({ order }: { order: DrillOrder }) {
    return (
      <button onClick={() => goToOrder(order.order_id)}
        className="w-full flex items-center justify-between p-3.5 bg-white rounded-xl border border-border active:bg-surface transition-colors cursor-pointer">
        <div className="text-right min-w-0">
          <p className="text-xs font-bold text-text">{order.order_code}</p>
          <p className="text-[9px] text-text-secondary mt-0.5">{order.delivered_at ? new Date(order.delivered_at).toLocaleDateString('ar-EG-u-nu-latn') : 'غير متوفر'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-success ltr" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(order.total_amount)}</span>
          <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
    )
  }

  // ---- Visit Card ----
  function VisitCard({ visit }: { visit: VisitItem }) {
    return (
      <button onClick={() => goToVisit(visit.id)}
        className="w-full flex items-center justify-between p-3.5 bg-white rounded-xl border border-border active:bg-surface transition-colors cursor-pointer">
        <div className="text-right min-w-0">
          <p className="text-xs font-bold text-text truncate">{visit.customer_name}</p>
          <p className="text-[9px] text-text-secondary mt-0.5">{visit.visit_date ? new Date(visit.visit_date).toLocaleDateString('ar-EG-u-nu-latn') : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-success/10 text-success">{visit.status === 'completed' ? 'مكتملة' : visit.status}</span>
          <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
    )
  }

  // ---- Supervisor/Manager Team View ----
  function TeamView() {
    if (teamBreakdowns.length === 0) return null
    return (
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-text">أداء الفريق</span>
          <span className="text-[9px] text-text-secondary bg-surface px-2 py-0.5 rounded-full">
            {teamStats.repCount} مندوب
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[9px] text-text-secondary mb-3">
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-xs font-bold text-text">{teamStats.repCount}</p>
            <p>عدد المناديب</p>
          </div>
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-xs font-bold text-text">{fmt(teamStats.customerCount)}</p>
            <p>عدد العملاء</p>
          </div>
          <div className="bg-surface rounded-lg p-2 text-center">
            <p className="text-xs font-bold text-text">{teamStats.totalOrders}</p>
            <p>عدد الطلبات</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 text-[9px] text-text-secondary font-semibold text-center pb-1 border-b border-border">
          <div></div><div>شخصي</div><div>فريق</div><div>الإجمالي</div>
        </div>
        <div className="space-y-2">
          {teamBreakdowns.map(b => {
            const combinedPct = (b.personal_target + b.team_target) > 0
              ? ((b.personal_actual + b.team_actual) / (b.personal_target + b.team_target)) * 100 : 0
            const teamPct = b.team_target > 0 ? (b.team_actual / b.team_target) * 100 : 0
            const personalPct = b.personal_target > 0 ? (b.personal_actual / b.personal_target) * 100 : 0
            return (
              <div key={b.kpiType} className="grid grid-cols-4 gap-1 items-center py-1.5 border-b border-border/40 last:border-0">
                <span className="text-[10px] font-semibold text-text">{b.label}</span>
                <div className="text-center">
                  <span className={`text-[10px] font-semibold ${pctColor(personalPct)}`}>{fmtPct(personalPct)}</span>
                  {b.personal_target > 0 && <span className="text-[8px] text-text-secondary block">{fmt(b.personal_actual)}/{fmt(b.personal_target)}</span>}
                </div>
                <div className="text-center">
                  <span className={`text-[10px] font-semibold ${pctColor(teamPct)}`}>{fmtPct(teamPct)}</span>
                  {b.team_target > 0 && <span className="text-[8px] text-text-secondary block">{fmt(b.team_actual)}/{fmt(b.team_target)}</span>}
                </div>
                <div className="text-center">
                  <span className={`text-[10px] font-bold ${pctColor(combinedPct)}`}>{fmtPct(combinedPct)}</span>
                  {(b.personal_target + b.team_target) > 0 && (
                    <span className="text-[8px] text-text-secondary block">{fmt(b.personal_actual + b.team_actual)}/{fmt(b.personal_target + b.team_target)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-4 min-h-screen" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => nav('/dashboard')} className="text-primary text-sm font-semibold hover:underline shrink-0 cursor-pointer">{'← العودة'}</button>
        <h1 className="text-xl font-bold text-text flex-1">تحليل الموظفين</h1>
      </div>

      {/* Month + Filters */}
      <div className="flex items-center gap-2">
        <button onClick={goPrevMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0 cursor-pointer">{'‹ السابق'}</button>
        <select value={`${selMonth}-${selYear}`} onChange={e => { const [m, y] = e.target.value.split('-').map(Number); setSelMonth(m); setSelYear(y) }}
          className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-text bg-white cursor-pointer text-center">
          {(() => { const opts = []; for (let i = -6; i <= 6; i++) { const d = new Date(selYear, selMonth - 1 + i, 1); opts.push({ m: d.getMonth() + 1, y: d.getFullYear(), l: MONTHS[d.getMonth()] + ' ' + d.getFullYear() }) } return opts })()
            .map(opt => <option key={`${opt.m}-${opt.y}`} value={`${opt.m}-${opt.y}`}>{opt.l}</option>)}
        </select>
        <button onClick={goNextMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0 cursor-pointer">{'التالي ›'}</button>
      </div>

      {view === 'list' && (
        <>
          <div className="flex gap-2">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="flex-none border border-border rounded-lg px-2 py-2 text-xs text-text bg-white cursor-pointer">
              {uniqueRoles.map(r => <option key={r} value={r}>{r === 'الكل' ? 'جميع الأنواع' : r}</option>)}
            </select>
            <select value={selectedEmpId} onChange={e => {
              setSelectedEmpId(e.target.value)
              if (e.target.value) {
                const emp = employees.find(ee => ee.employee_id === e.target.value)
                if (emp) selectEmployee(emp)
              }
            }}
              className="flex-1 border border-border rounded-lg px-2 py-2 text-xs text-text bg-white cursor-pointer">
              <option value="">اختر موظف...</option>
              {employees.map(e => (
                <option key={e.employee_id} value={e.employee_id}>
                  {e.employee_code} — {e.employee_name}
                </option>
              ))}
            </select>
          </div>
          <input type="text" placeholder="بحث بالاسم أو الكود" value={empSearch}
            onChange={e => setEmpSearch(e.target.value)}
            className="w-full border border-border rounded-lg p-2.5 text-xs text-text text-right bg-white" />
          <div className="space-y-3">
            {filteredEmps.map(emp => <EmployeeCard key={emp.employee_id} emp={emp} />)}
            {filteredEmps.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-xs">لا يوجد موظفون مطابقون</p>
            )}
          </div>
        </>
      )}

      {view === 'employee' && activeEmp && (
        <>
          <Breadcrumb />

          {/* Employee Summary */}
          <div className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] text-text-secondary font-mono">{activeEmp.employee_code}</p>
                <p className="text-sm font-bold text-text">{activeEmp.employee_name}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                activeEmp.role_type === 'مدير مبيعات' ? 'bg-purple-100 text-purple-700'
                : activeEmp.role_type === 'سوبر فايزر' ? 'bg-amber-100 text-amber-700'
                : 'bg-blue-100 text-blue-700'
              }`}>{activeEmp.role_type}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <SummaryStat label="الهدف" value={fmt(activeEmp.sales_target || activeEmp.orders_target || activeEmp.visits_target || activeEmp.new_cust_target || activeEmp.collections_target)} />
              <SummaryStat label="المحقق" value={fmt(activeEmp.sales_actual + activeEmp.orders_actual + activeEmp.visits_actual + activeEmp.new_cust_actual + activeEmp.collections_actual)} color="text-success" />
              <SummaryStat label="الشهر" value={MONTH_LABEL} />
              <SummaryStat label="نوعه" value={activeEmp.role_type} />
            </div>
          </div>

          {/* Team View for supervisors/managers */}
          {activeEmp.has_team && <TeamView />}

          {/* Clickable KPI Blocks */}
          <p className="text-xs font-bold text-text">مؤشرات الأداء</p>
          <div className="space-y-3">
            <KpiDetailBlock label="المبيعات"
              target={activeEmp.sales_target} actual={activeEmp.sales_actual}
              pct={activeEmp.sales_pct} unit="جنيه"
              onClick={() => openCustomers('sales')} />
            <KpiDetailBlock label="الطلبات"
              target={activeEmp.orders_target} actual={activeEmp.orders_actual}
              pct={activeEmp.orders_pct} unit="عدد"
              onClick={() => openOrders()} />
            <KpiDetailBlock label="الزيارات"
              target={activeEmp.visits_target} actual={activeEmp.visits_actual}
              pct={activeEmp.visits_pct} unit="عدد"
              onClick={() => openVisits()} />
            <KpiDetailBlock label="العملاء الجدد"
              target={activeEmp.new_cust_target} actual={activeEmp.new_cust_actual}
              pct={activeEmp.new_cust_pct} unit="عدد"
              onClick={() => openCustomers('new_customers')} />
            <KpiDetailBlock label="التحصيل"
              target={activeEmp.collections_target} actual={activeEmp.collections_actual}
              pct={activeEmp.collections_pct} unit="جنيه"
              onClick={() => openCustomers('collections')} />
          </div>

          {/* Loading overlay for drill */}
          {loadingDrill && (
            <div className="text-center py-6 text-text-secondary text-xs">جاري التحميل...</div>
          )}

          {/* Customers Drill */}
          {customers.length > 0 && !loadingDrill && (
            <div>
              <p className="text-xs font-bold text-text mb-2">العملاء</p>
              <div className="space-y-2">
                {customers.map(c => <CustomerCard key={c.customer_id} cust={c} />)}
                {customers.length === 0 && <p className="text-center py-4 text-text-secondary text-xs">لا يوجد عملاء</p>}
              </div>
            </div>
          )}

          {/* Customer Orders Drill */}
          {customerOrders.length > 0 && !loadingDrill && activeCustomer && (
            <div>
              <p className="text-xs font-bold text-text mb-2">طلبات {activeCustomer.customer_name}</p>
              <div className="space-y-2">
                {customerOrders.map(o => <OrderCard key={o.order_id} order={o} />)}
                {customerOrders.length === 0 && <p className="text-center py-4 text-text-secondary text-xs">لا توجد طلبات</p>}
              </div>
            </div>
          )}

          {/* Orders Drill */}
          {orders.length > 0 && !loadingDrill && (
            <div>
              <p className="text-xs font-bold text-text mb-2">الطلبات</p>
              <div className="space-y-2">
                {orders.map(o => <OrderCard key={o.order_id} order={o} />)}
                {orders.length === 0 && <p className="text-center py-4 text-text-secondary text-xs">لا توجد طلبات</p>}
              </div>
            </div>
          )}

          {/* Visits Drill */}
          {visits.length > 0 && !loadingDrill && (
            <div>
              <p className="text-xs font-bold text-text mb-2">الزيارات</p>
              <div className="space-y-2">
                {visits.map(v => (
                  <VisitCard key={v.id} visit={v} />
                ))}
                {visits.length === 0 && <p className="text-center py-4 text-text-secondary text-xs">لا توجد زيارات</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface rounded-lg p-2.5">
      <p className="text-[9px] text-text-secondary">{label}</p>
      <p className={`text-xs font-bold mt-0.5 ${color || 'text-text'}`}>{value}</p>
    </div>
  )
}
