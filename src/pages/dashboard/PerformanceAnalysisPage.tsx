import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { targetService } from '../../services/targets'

interface PerfEmployee {
  employee_id: string; employee_code: string; employee_name: string
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; collections_target: number
  gross_sales: number; visits_actual: number; gross_orders: number
  new_customers_actual: number; collections_actual: number
  return_deduction: number; full_returns: number
  effective_sales: number; effective_orders: number
  sales_achievement_pct: number; visits_achievement_pct: number; orders_achievement_pct: number
  new_customers_achievement_pct: number; collections_achievement_pct: number
  weights: { sales_weight_percent: number; collections_weight_percent: number; visits_weight_percent: number; new_customers_weight_percent: number; attendance_weight_percent: number; source: string }
  overall_achievement_score: number; is_locked: boolean
}

type KpiType = 'sales' | 'orders' | 'visits' | 'new_customers' | 'collections'

interface DrillContributor {
  employee_id: string; employee_code: string; employee_name: string
  role_type: string; has_team: boolean; actual: number; target: number; achievement_pct: number
}

interface DrillCustomer {
  customer_id: string; customer_name: string
  total_sales: number; total_orders: number; total_visits: number; is_new_customer: boolean
}

interface DrillOrder {
  order_id: string; order_code: string; total_amount: number; delivered_at: string; status: string
}

interface AllKpiBreakdown {
  kpiType: KpiType; label: string; unit: string
  personal_actual: number; personal_target: number
  team_actual: number; team_target: number
  total_actual: number; total_target: number
}

interface DrillState {
  level: 'company' | 'contributors' | 'team' | 'customers' | 'customer_orders'
  kpiType: KpiType
  employee?: { id: string; name: string; code: string; type: string }
  customer?: { id: string; name: string }
  data: DrillContributor[] | DrillCustomer[] | DrillOrder[] | null
  allKpiBreakdowns: AllKpiBreakdown[]
  teamMembers: DrillContributor[]
  employeeActuals?: Record<string, number>
  employeeTargets?: Record<string, number>
  loading: boolean
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const KPI_LEGEND: Record<KpiType, { label: string; unit: string; color: string }> = {
  sales: { label: 'المبيعات', unit: 'جنيه', color: 'bg-success' },
  orders: { label: 'الطلبات', unit: 'عدد', color: 'bg-primary' },
  visits: { label: 'الزيارات', unit: 'عدد', color: 'bg-accent' },
  new_customers: { label: 'العملاء الجدد', unit: 'عدد', color: 'bg-purple-500' },
  collections: { label: 'التحصيل', unit: 'جنيه', color: 'bg-amber-500' },
}

const ALL_KPI_TYPES: KpiType[] = ['sales', 'orders', 'visits', 'new_customers', 'collections']

type SortField = 'name' | 'actual' | 'target' | 'achievement'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

function pctColor(pct: number): string {
  if (pct >= 100) return 'text-success'
  if (pct >= 50) return 'text-warning'
  return 'text-red-500'
}

export default function PerformanceAnalysisPage() {
  const nav = useNavigate()
  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [employees, setEmployees] = useState<PerfEmployee[]>([])
  const [loading, setLoading] = useState(true)

  const [drill, setDrill] = useState<DrillState>({
    level: 'company', kpiType: 'sales', data: null, loading: false,
    allKpiBreakdowns: [], teamMembers: [],
  })

  const [sortField, setSortField] = useState<SortField>('achievement')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function loadPerformance(month: number, year: number) {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const { data, error } = await targetService.getPerformance(month, year, token)
    if (!error && data) {
      const p = data as any
      setEmployees(p.employees || [])
    } else setEmployees([])
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    resetDrill()
    loadPerformance(selMonth, selYear)
  }, [selMonth, selYear])

  function goPrevMonth() {
    if (selMonth === 1) { setSelMonth(12); setSelYear(selYear - 1) }
    else setSelMonth(selMonth - 1)
  }

  function goNextMonth() {
    if (selMonth === 12) { setSelMonth(1); setSelYear(selYear + 1) }
    else setSelMonth(selMonth + 1)
  }

  const monthOptions = []
  for (let i = -6; i <= 6; i++) {
    const d = new Date(selYear, selMonth - 1 + i, 1)
    monthOptions.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: MONTHS[d.getMonth()] + ' ' + d.getFullYear() })
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir(field === 'name' ? 'asc' : 'desc') }
  }

  const EMPLOYEE_EXCLUDE_CODES = ['SYS-OWNER', 'ADMIN-001']

  function drillToContributors(kpiType: KpiType) {
    const token = getToken()
    if (!token) return
    setDrill(s => ({ ...s, loading: true }))
    targetService.getKpiContributors(kpiType, selMonth, selYear, token)
      .then(({ data: result, error }) => {
        if (!error && result) {
          const filtered = (result as DrillContributor[]).filter(c =>
            !EMPLOYEE_EXCLUDE_CODES.includes(c.employee_code)
          )
          setDrill({ level: 'contributors', kpiType, data: filtered, loading: false, allKpiBreakdowns: [], teamMembers: [] })
        } else setDrill(s => ({ ...s, loading: false }))
      })
  }

  function drillToEmployee(emp: DrillContributor) {
    const token = getToken()
    if (!token) return
    if (emp.has_team) {
      setDrill(s => ({ ...s, loading: true }))
      Promise.all(ALL_KPI_TYPES.map(kt =>
        targetService.getTeamMembersKpis(emp.employee_id, kt, selMonth, selYear, token)
          .then(({ data }) => ({ kpiType: kt, members: (data || []) as DrillContributor[] }))
      )).then(results => {
        const allBreakdowns: AllKpiBreakdown[] = []
        const firstResult = results[0]?.members || []
        for (const r of results) {
          const members = r.members
          const teamSumActual = members.reduce((s, m) => s + m.actual, 0)
          const teamSumTarget = members.reduce((s, m) => s + m.target, 0)
          const legend = KPI_LEGEND[r.kpiType]
          allBreakdowns.push({
            kpiType: r.kpiType,
            label: legend.label,
            unit: legend.unit,
            personal_actual: 0,
            personal_target: 0,
            team_actual: teamSumActual,
            team_target: teamSumTarget,
            total_actual: emp.actual,
            total_target: emp.target,
          })
        }
        setDrill({
          level: 'team', kpiType: drill.kpiType,
          employee: { id: emp.employee_id, name: emp.employee_name, code: emp.employee_code, type: emp.role_type },
          data: firstResult.slice(0, 500),
          allKpiBreakdowns: allBreakdowns,
          teamMembers: firstResult,
          loading: false,
        })
      })
    } else {
      setDrill(s => ({ ...s, loading: true }))
      targetService.getRepCustomerKpis(emp.employee_id, selMonth, selYear, token)
        .then(({ data: result, error }) => {
          if (!error && result) {
            setDrill({
              level: 'customers', kpiType: drill.kpiType,
              employee: { id: emp.employee_id, name: emp.employee_name, code: emp.employee_code, type: emp.role_type },
              data: result as DrillCustomer[], loading: false,
              allKpiBreakdowns: [], teamMembers: [],
            })
          } else setDrill(s => ({ ...s, loading: false }))
        })
    }
  }

  function drillToTeamMember(member: DrillContributor) {
    if (!member.has_team) {
      drillToEmployee(member)
      return
    }
    const token = getToken()
    if (!token) return
    setDrill(s => ({ ...s, loading: true }))
    Promise.all(ALL_KPI_TYPES.map(kt =>
      targetService.getTeamMembersKpis(member.employee_id, kt, selMonth, selYear, token)
        .then(({ data }) => ({ kpiType: kt, members: (data || []) as DrillContributor[] }))
    )).then(results => {
      const allBreakdowns: AllKpiBreakdown[] = []
      const firstResult = results[0]?.members || []
      for (const r of results) {
        const members = r.members
        const teamSumActual = members.reduce((s, m) => s + m.actual, 0)
        const teamSumTarget = members.reduce((s, m) => s + m.target, 0)
        const legend = KPI_LEGEND[r.kpiType]
        allBreakdowns.push({
          kpiType: r.kpiType,
          label: legend.label,
          unit: legend.unit,
          personal_actual: 0,
          personal_target: 0,
          team_actual: teamSumActual,
          team_target: teamSumTarget,
          total_actual: member.actual,
          total_target: member.target,
        })
      }
      setDrill({
        level: 'team', kpiType: drill.kpiType,
        employee: { id: member.employee_id, name: member.employee_name, code: member.employee_code, type: '' },
        data: firstResult.slice(0, 500),
        allKpiBreakdowns: allBreakdowns,
        teamMembers: firstResult,
        loading: false,
      })
    })
  }

  function drillToCustomer(cust: DrillCustomer) {
    const token = getToken()
    if (!token) return
    setDrill(s => ({ ...s, loading: true }))
    targetService.getCustomerDeliveredOrders(cust.customer_id, selMonth, selYear, token)
      .then(({ data: result, error }) => {
        if (!error && result) {
          setDrill({
            level: 'customer_orders', kpiType: drill.kpiType,
            employee: drill.employee, customer: { id: cust.customer_id, name: cust.customer_name },
            data: result as DrillOrder[], loading: false,
            allKpiBreakdowns: [], teamMembers: [],
          })
        } else setDrill(s => ({ ...s, loading: false }))
      })
  }

  function goBackFromDrill() {
    const d = drill
    if (d.level === 'contributors') setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] })
    else if (d.level === 'team') {
      const token = getToken()
      if (!token) { setDrill(s => ({ ...s, loading: false, level: 'company' })); return }
      setDrill(s => ({ ...s, loading: true }))
      targetService.getKpiContributors(d.kpiType, selMonth, selYear, token)
        .then(({ data: result, error }) => {
          if (!error && result) {
            const filtered = (result as DrillContributor[]).filter(c => !EMPLOYEE_EXCLUDE_CODES.includes(c.employee_code))
            setDrill({ level: 'contributors', kpiType: d.kpiType, data: filtered, loading: false, allKpiBreakdowns: [], teamMembers: [] })
          } else setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] })
        })
    } else if (d.level === 'customers') {
      setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] })
    } else if (d.level === 'customer_orders') {
      const token = getToken()
      if (!token || !d.employee) { setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] }); return }
      setDrill(s => ({ ...s, loading: true }))
      targetService.getRepCustomerKpis(d.employee.id, selMonth, selYear, token)
        .then(({ data: result, error }) => {
          if (!error && result) {
            setDrill({
              level: 'customers', kpiType: d.kpiType,
              employee: d.employee, data: result as DrillCustomer[], loading: false,
              allKpiBreakdowns: [], teamMembers: [],
            })
          } else setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] })
        })
    }
  }

  function resetDrill() {
    setDrill({ level: 'company', kpiType: 'sales', data: null, loading: false, allKpiBreakdowns: [], teamMembers: [] })
  }

  const sortedContributors = drill.level === 'contributors' && drill.data
    ? [...(drill.data as DrillContributor[])].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        switch (sortField) {
          case 'name': return dir * a.employee_name.localeCompare(b.employee_name)
          case 'actual': return dir * (a.actual - b.actual)
          case 'target': return dir * (a.target - b.target)
          case 'achievement': return dir * (a.achievement_pct - b.achievement_pct)
          default: return 0
        }
      })
    : []

  const aggregatedKpis = employees.length > 0 ? ALL_KPI_TYPES.map(kt => {
    const totalTarget = employees.reduce((s, e) => s + (
      kt === 'sales' ? e.sales_target : kt === 'orders' ? e.orders_target :
      kt === 'visits' ? e.visits_target : kt === 'new_customers' ? e.new_customers_target :
      e.collections_target
    ), 0)
    const totalActual = employees.reduce((s, e) => s + (
      kt === 'sales' ? e.effective_sales : kt === 'orders' ? e.effective_orders :
      kt === 'visits' ? e.visits_actual : kt === 'new_customers' ? e.new_customers_actual :
      e.collections_actual
    ), 0)
    return { kpiType: kt, totalTarget, totalActual, pct: totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0 }
  }) : []

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <div className="flex items-center gap-2">
        <button onClick={() => nav('/dashboard')} className="text-primary text-sm font-semibold hover:underline shrink-0">{'← العودة'}</button>
        <h1 className="text-xl font-bold text-text flex-1">تحليل الأداء</h1>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={goPrevMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0">{'‹ السابق'}</button>
        <select value={`${selMonth}-${selYear}`} onChange={e => {
          const [m, y] = e.target.value.split('-').map(Number)
          setSelMonth(m); setSelYear(y)
        }}
          className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-text bg-white cursor-pointer text-center">
          {monthOptions.map(opt => (
            <option key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>{opt.label}</option>
          ))}
        </select>
        <button onClick={goNextMonth} className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text bg-white active:bg-surface shrink-0">{'التالي ›'}</button>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        {drill.level === 'company' ? (
          <>
            <h3 className="text-sm font-bold text-text mb-3">أداء الموظفين</h3>
            {aggregatedKpis.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-4">لا توجد أهداف للشهر المحدد.</p>
            ) : (
              <div className="space-y-4">
                {aggregatedKpis.map(agg => (
                  <ClickableKpiBlock
                    key={agg.kpiType}
                    label={KPI_LEGEND[agg.kpiType].label}
                    unit={KPI_LEGEND[agg.kpiType].unit}
                    actual={agg.totalActual}
                    target={agg.totalTarget}
                    pct={agg.pct}
                    color={KPI_LEGEND[agg.kpiType].color}
                    onClick={() => drillToContributors(agg.kpiType)} />
                ))}
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text">متوسط الإنجاز</span>
                    <span className={`text-lg font-bold ${pctColor(aggregatedKpis.reduce((s, a) => s + a.pct, 0) / aggregatedKpis.length)}`}>
                      {fmtPct(aggregatedKpis.reduce((s, a) => s + a.pct, 0) / aggregatedKpis.length)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : drill.loading ? (
          <p className="text-center py-8 text-text-secondary text-xs">جاري التحميل...</p>
        ) : (
          <>
            <div className="flex items-center gap-1 mb-3 text-xs flex-wrap">
              <button onClick={resetDrill} className="text-primary font-semibold hover:underline">أداء الموظفين</button>
              <span className="text-text-secondary mx-1">&gt;</span>
              <button onClick={goBackFromDrill} className="text-primary font-semibold hover:underline">{KPI_LEGEND[drill.kpiType].label}</button>
              {drill.employee && (<><span className="text-text-secondary mx-1">&gt;</span><span className="text-text font-semibold">{drill.employee.name}</span></>)}
              {drill.customer && (<><span className="text-text-secondary mx-1">&gt;</span><span className="text-text">{drill.customer.name}</span></>)}
            </div>

            {drill.level === 'team' && drill.allKpiBreakdowns.length > 0 && (
              <div>
                <div className="mb-4">
                  <div className="grid grid-cols-4 gap-1 mb-2 text-[9px] text-text-secondary font-semibold text-center">
                    <div></div>
                    <div>شخصي</div>
                    <div>فريق</div>
                    <div>الإجمالي</div>
                  </div>
                  <div className="space-y-2">
                    {drill.allKpiBreakdowns.map(b => (
                      <div key={b.kpiType} className="grid grid-cols-4 gap-1 items-center py-1.5 border-b border-border/50 last:border-0">
                        <span className="text-[11px] font-semibold text-text">{b.label}</span>
                        <div className="text-center">
                          <span className="text-[10px] font-semibold text-text" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(b.team_actual)}</span>
                          {b.team_target > 0 && <span className="text-[9px] text-text-secondary block">{fmt(b.team_target)}</span>}
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] font-semibold text-text" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(b.team_actual)}</span>
                          {b.team_target > 0 && <span className="text-[9px] text-text-secondary block">{fmt(b.team_target)}</span>}
                        </div>
                        <div className="text-center">
                          <span className={`text-[10px] font-bold ${pctColor(b.total_target > 0 ? (b.total_actual / b.total_target) * 100 : 0)}`}>
                            {fmt(b.total_actual)}
                          </span>
                          {b.total_target > 0 && <span className="text-[9px] text-text-secondary block">/ {fmt(b.total_target)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] font-semibold text-text mb-2">أعضاء الفريق</p>
                <DrillTable
                  headers={['الاسم', 'المحقق', 'الهدف', 'النسبة']}
                  rows={(drill.teamMembers || []).map(m => ({
                    key: m.employee_id,
cols: [m.employee_name, fmt(m.actual), m.target > 0 ? fmt(m.target) : 'غير متوفر', fmtPct(m.achievement_pct)],
                    onClick: () => drillToTeamMember(m)
                  }))}
                />
              </div>
            )}

            {drill.level === 'team' && drill.allKpiBreakdowns.length === 0 && drill.data && (
              <DrillTable
                headers={['الاسم', 'المحقق', 'الهدف', 'النسبة']}
                rows={(drill.data as DrillContributor[]).map(m => ({
                  key: m.employee_id,
                  cols: [m.employee_name, fmt(m.actual), m.target > 0 ? fmt(m.target) : 'غير متوفر', fmtPct(m.achievement_pct)],
                  onClick: () => drillToTeamMember(m)
                }))}
              />
            )}

            {drill.level === 'contributors' && (
              <div>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {(['achievement', 'actual', 'target', 'name'] as SortField[]).map(f => (
                    <button key={f} onClick={() => toggleSort(f)}
                      className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                        sortField === f
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-text-secondary border-border'
                      }`}>
                      {f === 'achievement' ? 'النسبة' : f === 'actual' ? 'المحقق' : f === 'target' ? 'الهدف' : 'الاسم'}
                      {sortField === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ))}
                </div>
                <DrillTable
                  headers={['الاسم', 'النوع', 'المحقق', 'الهدف', 'النسبة']}
                  rows={sortedContributors.map(c => ({
                    key: c.employee_id,
                    cols: [c.employee_name, c.role_type, fmt(c.actual), c.target > 0 ? fmt(c.target) : 'غير متوفر', fmtPct(c.achievement_pct)],
                    onClick: () => drillToEmployee(c)
                  }))}
                />
              </div>
            )}

            {drill.level === 'customers' && (
              <DrillTable
                headers={['العميل', 'المبيعات', 'الطلبات', 'الزيارات', 'عميل جديد']}
                rows={(drill.data as DrillCustomer[] || []).map(c => ({
                  key: c.customer_id,
                  cols: [c.customer_name, fmt(c.total_sales), String(c.total_orders), String(c.total_visits), c.is_new_customer ? '✓' : '—'],
                  onClick: () => drillToCustomer(c)
                }))}
              />
            )}

            {drill.level === 'customer_orders' && (
              <div>
                {(drill.data as DrillOrder[] || []).length === 0 ? (
                  <p className="text-center py-4 text-text-secondary text-xs">لا توجد طلبات مسلمة لهذا العميل في الشهر الحالي</p>
                ) : (
                  <div className="space-y-2">
                    {(drill.data as DrillOrder[]).map(o => (
                      <button key={o.order_id} onClick={() => nav(`/orders/${o.order_id}`)}
                        className="w-full flex items-center justify-between p-3 bg-surface rounded-lg active:bg-border transition-colors">
                        <div className="text-right">
                          <p className="text-xs font-semibold text-text">{o.order_code}</p>
                          <p className="text-[9px] text-text-secondary">{new Date(o.delivered_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>
                        </div>
                        <span className="text-xs font-bold text-success" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(o.total_amount)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ClickableKpiBlock({ label, unit, actual, target, pct, color, onClick }: {
  label: string; unit: string; actual: number; target: number; pct: number; color: string; onClick: () => void
}) {
  const barPct = Math.min(pct, 100)
  return (
    <button onClick={onClick} className="w-full text-right active:bg-surface rounded-lg p-2 transition-colors">
      <p className="text-xs font-bold text-text mb-1">{label}</p>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-lg font-bold text-text" style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{fmt(actual)}</span>
        <span className="text-text-secondary text-xs">/ {fmt(target)}</span>
        <span className={`text-sm font-bold mr-auto ${pctColor(pct)}`}>{fmtPct(pct)}</span>
      </div>
      <div className="w-full h-2 bg-surface rounded-full overflow-hidden mb-1">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${barPct}%` }} />
      </div>
      <span className="text-[9px] text-text-secondary">وحدة: {unit}</span>
    </button>
  )
}

function DrillTable({ headers, rows }: { headers: string[]; rows: { key: string; cols: string[]; onClick: () => void }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            {headers.map(h => <th key={h} className="text-right py-2 px-1 text-text-secondary font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} onClick={r.onClick} className="border-b border-border/50 active:bg-surface transition-colors cursor-pointer">
              {r.cols.map((c, i) => <td key={i} className="py-2 px-1 text-text whitespace-nowrap">{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} className="text-center py-4 text-text-secondary">لا توجد بيانات</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
