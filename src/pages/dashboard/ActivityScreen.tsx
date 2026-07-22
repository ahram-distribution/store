import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { getEffectiveRole, type EffectiveRole } from '../../utils/hierarchyFilter'
import { monthRange as bizMonthRange } from '../../lib/dateRange'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '0'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface EmployeeRow {
  employee_id: string
  full_name: string
  code: string
  is_manager?: boolean
  sales: number
  orders: number
  completed_visits: number
  registered_customers: number
}

type ViewLevel = 'company' | 'managers' | 'team' | 'rep'

const KPI_LABELS = [
  { key: 'sales', label: 'المبيعات', money: true },
  { key: 'orders', label: 'الطلبات', money: false },
  { key: 'completed_visits', label: 'الزيارات', money: false },
  { key: 'registered_customers', label: 'العملاء', money: false },
] as const

type Props = {
  month?: number
  year?: number
  embedded?: boolean
}

async function fetchGovernedEmployees(tok: string): Promise<any[]> {
  const { data } = await supabase.rpc('get_governed_employees', { p_token: tok })
  return Array.isArray(data) ? data : []
}

async function fetchBatchActivitySummaries(tok: string, employeeIds: string[], from: string, to: string): Promise<Map<string, EmployeeRow>> {
  const { data: batchData } = await supabase.rpc('get_employee_activity_summary_batch', {
    p_token: tok, p_employee_ids: employeeIds, p_from: from, p_to: to,
  })
  const map = new Map<string, EmployeeRow>()
  if (batchData && Array.isArray(batchData)) {
    for (const row of batchData) {
      const eid = row.employee_id as string
      map.set(eid, {
        employee_id: eid,
        full_name: '',
        code: '',
        sales: Number(row.sales) || 0,
        orders: Number(row.orders) || 0,
        completed_visits: Number(row.visits) || 0,
        registered_customers: Number(row.customers) || 0,
      })
    }
  }
  return map
}

export default function ActivityScreen({ month: propMonth, year: propYear, embedded }: Props = {}) {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role: EffectiveRole = getEffectiveRole(user)

  const now = new Date()
  const [localMonth, setLocalMonth] = useState(now.getMonth() + 1)
  const [localYear, setLocalYear] = useState(now.getFullYear())

  const month = propMonth ?? localMonth
  const year = propYear ?? localYear

  const [viewLevel, setViewLevel] = useState<ViewLevel>('company')
  const [viewMgrId, setViewMgrId] = useState<string | null>(null)
  const [viewMgrName, setViewMgrName] = useState('')
  const [viewRepId, setViewRepId] = useState<string | null>(null)
  const [viewRepName, setViewRepName] = useState('')

  const [members, setMembers] = useState<EmployeeRow[]>([])
  const [repData, setRepData] = useState<EmployeeRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { from, to } = bizMonthRange(month, year)

  function getTitle(): string {
    if (role === 'rep' || viewLevel === 'rep') return `نشاط ${viewRepName || user?.full_name || ''}`
    if (viewLevel === 'team') return `نشاط فريق ${viewMgrName}`
    if (viewLevel === 'managers') return 'فرق المبيعات'
    return 'نشاط الشركة'
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) { setLoading(false); return }
    const tok = getToken()
    if (!tok) { setLoading(false); return }

    setLoading(true)
    setError('')

    let cancelled = false

    async function load() {
      try {
        if (role === 'rep') {
          const { data: d } = await supabase.rpc('get_employee_detail_data', {
            p_token: tok, p_employee_id: eid, p_from: from, p_to: to,
          })
          if (!cancelled) {
            if (d) {
              const detail = d as any
              const orders = Array.isArray(detail.orders) ? detail.orders : []
              const visits = Array.isArray(detail.visits) ? detail.visits : []
              const customers = Array.isArray(detail.customers) ? detail.customers : []
              setRepData({
                employee_id: eid,
                full_name: user?.full_name || '',
                code: user?.code || '',
                sales: orders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
                orders: orders.length,
                completed_visits: visits.length,
                registered_customers: customers.length,
              })
            }
            setMembers([])
          }
        } else if (role === 'executive' && (viewLevel === 'company' || viewLevel === 'managers')) {
          const governed = await fetchGovernedEmployees(tok)
          if (cancelled) return
          const ids = governed.map((e: any) => e.id as string)
          const summaryMap = ids.length > 0 ? await fetchBatchActivitySummaries(tok, ids, from, to) : new Map()
          if (cancelled) return
          const results: EmployeeRow[] = ids.map((id: string) => {
            const existing = summaryMap.get(id)
            const emp = governed.find((e: any) => e.id === id)
            return {
              employee_id: id,
              full_name: emp?.full_name || existing?.full_name || '',
              code: emp?.code || existing?.code || '',
              sales: existing?.sales || 0,
              orders: existing?.orders || 0,
              completed_visits: existing?.completed_visits || 0,
              registered_customers: existing?.registered_customers || 0,
            }
          })
          if (!cancelled) { setMembers(results); setRepData(null) }
        } else if ((role === 'executive' && viewLevel === 'team') || role === 'manager') {
          const governed = await fetchGovernedEmployees(tok)
          if (cancelled) return
          const teamMembers = governed.filter((e: any) => e.manager_id === (viewMgrId || eid))
          const teamIds = teamMembers.map((e: any) => e.id as string)
          if (eid && !teamIds.includes(eid)) teamIds.push(eid)
          const summaryMap = teamIds.length > 0 ? await fetchBatchActivitySummaries(tok, teamIds, from, to) : new Map()
          if (cancelled) return
          const results: EmployeeRow[] = teamIds.map((id: string) => {
            const existing = summaryMap.get(id)
            const emp = governed.find((e: any) => e.id === id)
            const isMgr = id === eid
            return {
              employee_id: id,
              full_name: isMgr ? (viewMgrName || user?.full_name || '') : (emp?.full_name || existing?.full_name || ''),
              code: emp?.code || existing?.code || '',
              is_manager: isMgr,
              sales: existing?.sales || 0,
              orders: existing?.orders || 0,
              completed_visits: existing?.completed_visits || 0,
              registered_customers: existing?.registered_customers || 0,
            }
          })
          if (!cancelled) { setMembers(results); setRepData(null) }
        } else if (viewLevel === 'rep') {
          const { data: d } = await supabase.rpc('get_employee_detail_data', {
            p_token: tok, p_employee_id: viewRepId || eid, p_from: from, p_to: to,
          })
          if (!cancelled) {
            if (d) {
              const detail = d as any
              const orders = Array.isArray(detail.orders) ? detail.orders : []
              const visits = Array.isArray(detail.visits) ? detail.visits : []
              const customers = Array.isArray(detail.customers) ? detail.customers : []
              setRepData({
                employee_id: viewRepId || eid,
                full_name: viewRepName || '',
                code: detail.employee_code || '',
                sales: orders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
                orders: orders.length,
                completed_visits: visits.length,
                registered_customers: customers.length,
              })
            }
            setMembers([])
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'خطأ غير معروف')
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [month, year, user?.employee_id, viewLevel, viewMgrId, viewRepId])

  const companyTotals = useMemo(() => {
    if (viewLevel !== 'company') return null
    let sales = 0, orders = 0, completed_visits = 0, registered_customers = 0
    members.forEach((m) => {
      sales += m.sales || 0
      orders += m.orders || 0
      completed_visits += m.completed_visits || 0
      registered_customers += m.registered_customers || 0
    })
    return { sales, orders, completed_visits, registered_customers }
  }, [viewLevel, members])

  const managerRows = useMemo(() => {
    if ((viewLevel !== 'company' && viewLevel !== 'managers') || role !== 'executive') return []
    const mgrMap = new Map<string, { name: string; code: string }>()
    members.forEach((m) => {
      if (m.is_manager) mgrMap.set(m.employee_id, { name: m.full_name, code: m.code })
    })

    const rows: any[] = []
    for (const [mgrId, mgr] of mgrMap) {
      const teamMembers = members.filter((m) => !m.is_manager)
      if (teamMembers.length === 0) continue

      let sales = 0, orders = 0, completed_visits = 0, registered_customers = 0
      teamMembers.forEach((m) => {
        sales += m.sales || 0
        orders += m.orders || 0
        completed_visits += m.completed_visits || 0
        registered_customers += m.registered_customers || 0
      })

      rows.push({
        manager_id: mgrId,
        manager_name: mgr.name,
        manager_code: mgr.code,
        team_size: teamMembers.length,
        sales, orders, completed_visits, registered_customers,
      })
    }
    return rows.sort((a, b) => b.sales - a.sales)
  }, [viewLevel, role, members])

  function drillToManagers() {
    setViewLevel('managers')
    setViewMgrId(null)
    setViewMgrName('')
    setViewRepId(null)
    setViewRepName('')
  }

  function drillToManager(mgrId: string, mgrName: string) {
    setViewMgrId(mgrId)
    setViewMgrName(mgrName)
    setViewLevel('team')
    setViewRepId(null)
    setViewRepName('')
  }

  function drillToRep(empId: string, empName: string) {
    setViewRepId(empId)
    setViewRepName(empName)
    setViewLevel('rep')
  }

  function goBack() {
    if (viewLevel === 'rep') {
      setViewLevel('team')
      setViewRepId(null)
      setViewRepName('')
    } else if (viewLevel === 'team' && role === 'executive') {
      setViewLevel('managers')
      setViewMgrId(null)
      setViewMgrName('')
    } else if (viewLevel === 'managers') {
      setViewLevel('company')
    } else {
      nav(-1)
    }
  }

  function KpiValue({ value, money }: { value: number | null | undefined; money: boolean }) {
    return <span className="text-sm font-bold text-gray-700">{money ? fmtMoney(value) : fmt(value)}</span>
  }

  function KpiGrid({ data }: { data: Record<string, any> }) {
    return (
      <div className="grid grid-cols-4 gap-2 mt-2">
        {KPI_LABELS.map((kpi) => (
          <div key={kpi.key} className="text-center">
            <KpiValue value={data[kpi.key]} money={kpi.money} />
            <div className="text-[9px] text-gray-400">{kpi.label}</div>
          </div>
        ))}
      </div>
    )
  }

  const body = (
    <>
      <div className="flex items-center gap-3">
        {viewLevel !== 'company' && (
          <button onClick={goBack} className="text-sm text-indigo-600 font-semibold hover:underline">→ رجوع</button>
        )}
        <h1 className="text-xl font-bold text-gray-800">{getTitle()}</h1>
      </div>

      {!embedded && (
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setLocalMonth(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {MONTHS.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
          </select>
          <select value={year} onChange={(e) => setLocalYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      {loading && <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>}
      {error && <div className="text-center py-4 text-red-500 text-sm">{error}</div>}

      {!loading && (role === 'rep' || viewLevel === 'rep') && repData && (
        <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
          {KPI_LABELS.map((item) => {
            const val = repData[item.key === 'orders' ? 'orders' : item.key === 'sales' ? 'sales' : item.key]
            return (
              <div key={item.key} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="text-2xl font-bold text-gray-800 tracking-tight">
                  {item.money ? fmtMoney(val) : fmt(val)}
                </div>
                <div className="text-sm text-gray-500 mt-1">{item.label}</div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && role === 'executive' && viewLevel === 'company' && companyTotals && (
        <div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm mb-4">
            <h2 className="text-base font-bold text-gray-800 mb-3">نشاط الشركة</h2>
            <div className="grid grid-cols-4 gap-3">
              {KPI_LABELS.map((item) => (
                <div key={item.key} className="text-center">
                  <div className="text-lg font-bold text-gray-800">
                    {item.money ? fmtMoney(companyTotals[item.key]) : fmt(companyTotals[item.key])}
                  </div>
                  <div className="text-[10px] text-gray-400">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={drillToManagers}
            className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right flex items-center justify-between">
            <span className="font-semibold text-gray-800">فرق المبيعات</span>
            <span className="text-xs text-indigo-600">عرض ←</span>
          </button>
        </div>
      )}

      {!loading && role === 'executive' && viewLevel === 'managers' && (
        <>
          {managerRows.length > 0 && (
            <div className="space-y-3">
              {managerRows.map((mgr) => (
                <button key={mgr.manager_id} onClick={() => drillToManager(mgr.manager_id, mgr.manager_name)}
                  className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-bold text-gray-800">{mgr.manager_name}</span>
                      <span className="text-xs text-gray-400 mr-2">{mgr.manager_code}</span>
                      <span className="text-[10px] text-gray-400 mr-2">({mgr.team_size} مندوب)</span>
                    </div>
                    <span className="text-xs text-indigo-600">عرض الفريق ←</span>
                  </div>
                  <KpiGrid data={mgr} />
                </button>
              ))}
            </div>
          )}
          {managerRows.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">لا يوجد مدراء بيع في هذا الشهر</div>
          )}
        </>
      )}

      {!loading && viewLevel === 'team' && (
        <>
          <p className="text-xs text-gray-500">فريق {viewMgrName} — {members.length} عضو</p>
          <div className="space-y-2">
            {members.length > 0 ? members.map((m) => (
              <button key={m.employee_id} onClick={() => drillToRep(m.employee_id, m.full_name)}
                className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
                <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-800">{m.full_name}</span>
                      <span className="text-xs text-gray-400 mr-2">{m.code}</span>
                      {m.is_manager && (
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full mr-2">مدير</span>
                      )}
                    </div>
                  <span className="text-xs text-indigo-600">عرض التفاصيل ←</span>
                </div>
                <KpiGrid data={m} />
              </button>
            )) : (
              <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات للفريق في هذا الشهر</div>
            )}
          </div>
        </>
      )}

      {!loading && repData && (
        <div className="text-center text-[10px] text-gray-400">
          {MONTHS[month - 1]} {year}
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="p-4 space-y-5">{body}</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">{body}</div>
    </div>
  )
}
