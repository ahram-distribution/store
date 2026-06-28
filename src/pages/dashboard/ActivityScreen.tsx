import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { getEffectiveRole, type EffectiveRole } from '../../utils/hierarchyFilter'

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

function monthRange(month: number, year: number) {
  return {
    from: new Date(year, month - 1, 1).toISOString(),
    to: new Date(year, month, 1).toISOString(),
  }
}

type ViewLevel = 'company' | 'team' | 'rep'

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

  const [members, setMembers] = useState<any[]>([])
  const [repData, setRepData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { from, to } = monthRange(month, year)

  function getTitle(): string {
    if (role === 'rep' || viewLevel === 'rep') return `نشاط ${viewRepName || user?.full_name || ''}`
    if (viewLevel === 'team') return `نشاط فريق ${viewMgrName}`
    return 'نشاط الشركة'
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) { setLoading(false); return }

    setLoading(true)
    setError('')

    if (role === 'rep') {
      supabase.rpc('get_runtime_activity', { p_employee_id: eid, p_date_from: from, p_date_to: to })
        .then(({ data, error: err }) => {
          if (err) { console.error(err); setError(err.message) } else setRepData(data)
          setMembers([])
        })
        .finally(() => setLoading(false))
    } else if (role === 'executive' && viewLevel === 'company') {
      supabase.rpc('get_runtime_team_activity', { p_manager_employee_id: null, p_date_from: from, p_date_to: to })
        .then(({ data, error: err }) => {
          if (err) { console.error(err); setError(err.message) }
          else setMembers((data as any[]) || [])
          setRepData(null)
        })
        .finally(() => setLoading(false))
    } else if ((role === 'executive' && viewLevel === 'team') || role === 'manager') {
      const mgrId = viewMgrId || eid
      supabase.rpc('get_runtime_team_activity', { p_manager_employee_id: mgrId, p_date_from: from, p_date_to: to })
        .then(({ data, error: err }) => {
          if (err) { console.error(err); setError(err.message) }
          else setMembers((data as any[]) || [])
          setRepData(null)
        })
        .finally(() => setLoading(false))
    } else if (viewLevel === 'rep') {
      supabase.rpc('get_runtime_activity', { p_employee_id: viewRepId || eid, p_date_from: from, p_date_to: to })
        .then(({ data, error: err }) => {
          if (err) { console.error(err); setError(err.message) } else setRepData(data)
          setMembers([])
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [month, year, user?.employee_id, viewLevel, viewMgrId, viewRepId])

  const managerRows = useMemo(() => {
    if (viewLevel !== 'company' || role !== 'executive') return []
    const mgrMap = new Map<string, { name: string; code: string }>()
    members.forEach((m: any) => {
      if (m.manager_id) mgrMap.set(m.manager_id, { name: m.manager_name || m.full_name, code: m.manager_code || '' })
    })

    const rows: any[] = []
    for (const [mgrId, mgr] of mgrMap) {
      const teamMembers = members.filter((m: any) => m.manager_id === mgrId)
      if (teamMembers.length === 0) continue

      let sales = 0, orders = 0, completed_visits = 0, registered_customers = 0
      teamMembers.forEach((m: any) => {
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
      setViewLevel('company')
      setViewMgrId(null)
      setViewMgrName('')
    } else {
      nav(-1)
    }
  }

  const d = repData as any

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
        <button onClick={goBack} className="text-sm text-indigo-600 font-semibold hover:underline">→ رجوع</button>
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

      {!loading && (role === 'rep' || viewLevel === 'rep') && d && (
        <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
          {KPI_LABELS.map((item) => {
            const val = d[item.key === 'orders' ? 'created_orders' : item.key === 'sales' ? 'created_sales' : item.key]
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

      {!loading && role === 'executive' && viewLevel === 'company' && (
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
          <p className="text-xs text-gray-500">فريق {viewMgrName} — {members.length} مندوب</p>
          <div className="space-y-2">
            {members.length > 0 ? members.map((m: any) => (
              <button key={m.employee_id} onClick={() => drillToRep(m.employee_id, m.full_name)}
                className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-gray-800">{m.full_name}</span>
                    <span className="text-xs text-gray-400 mr-2">{m.code}</span>
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

      {!loading && d && (
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
