import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { getEffectiveRole, type EffectiveRole } from '../utils/hierarchyFilter'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'أ'
  return fmt(n)
}

function pct(v: number | null | undefined): string {
  if (v == null || v === 0) return '0%'
  return v + '%'
}

function KpiBar({ achieved, target, compact }: { achieved: number; target: number; compact?: boolean }) {
  const p = target > 0 ? Math.min(Math.round((achieved / target) * 100), 100) : 0
  const color = p >= 100 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : 'bg-red-400'
  if (compact) return <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: p + '%' }}></div></div>
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: p + '%' }}></div></div>
      <span className="text-[10px] font-semibold text-gray-500 w-8 text-left">{p}%</span>
    </div>
  )
}

type ViewLevel = 'company' | 'team' | 'rep'

export function TeamAchievement() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role: EffectiveRole = getEffectiveRole(user)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const [viewLevel, setViewLevel] = useState<ViewLevel>('company')
  const [viewMgrId, setViewMgrId] = useState<string | null>(null)
  const [viewMgrName, setViewMgrName] = useState('')
  const [viewRepId, setViewRepId] = useState<string | null>(null)
  const [viewRepName, setViewRepName] = useState('')

  const [members, setMembers] = useState<any[]>([])
  const [repData, setRepData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function getTitle(): string {
    if (role === 'rep' || viewLevel === 'rep') return `إنجاز ${viewRepName || user?.full_name || ''}`
    if (viewLevel === 'team') return `إنجاز فريق ${viewMgrName}`
    return 'إنجاز الشركة'
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) { setLoading(false); return }

    setLoading(true)
    setError('')

    if (role === 'rep') {
      supabase.rpc('get_runtime_achievement', { p_employee_id: eid, p_month: month, p_year: year })
        .then(({ data, error: err }) => { if (err) { console.error(err); setError(err.message) } else setRepData(data); setMembers([]) })
        .finally(() => setLoading(false))
    } else if (role === 'executive' && viewLevel === 'company') {
      supabase.rpc('get_runtime_team', { p_manager_employee_id: null, p_month: month, p_year: year })
        .then(({ data, error: err }) => { if (err) { console.error(err); setError(err.message) }
          const d = (data as any[]) || []
          setMembers(d)
          setRepData(null)
        }).finally(() => setLoading(false))
    } else if ((role === 'executive' && viewLevel === 'team') || (role === 'manager')) {
      const mgrId = viewMgrId || eid
      supabase.rpc('get_runtime_team', { p_manager_employee_id: mgrId, p_month: month, p_year: year })
        .then(({ data, error: err }) => { if (err) { console.error(err); setError(err.message) } else setMembers((data as any[]) || []); setRepData(null) })
        .finally(() => setLoading(false))
    } else if (viewLevel === 'rep') {
      supabase.rpc('get_runtime_achievement', { p_employee_id: viewRepId || eid, p_month: month, p_year: year })
        .then(({ data, error: err }) => { if (err) { console.error(err); setError(err.message) } else setRepData(data); setMembers([]) })
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

      let sales_achieved = 0, sales_target = 0
      let orders_achieved = 0, orders_target = 0
      let visits_achieved = 0, visits_target = 0
      let customers_achieved = 0, customers_target = 0

      teamMembers.forEach((m: any) => {
        sales_achieved += m.sales?.achieved || 0; sales_target += m.sales?.target || 0
        orders_achieved += m.orders?.achieved || 0; orders_target += m.orders?.target || 0
        visits_achieved += m.visits?.achieved || 0; visits_target += m.visits?.target || 0
        customers_achieved += m.activated_customers?.achieved || 0; customers_target += m.activated_customers?.target || 0
      })

      rows.push({
        manager_id: mgrId,
        manager_name: mgr.name,
        manager_code: mgr.code,
        team_size: teamMembers.length,
        sales_achieved, sales_target, orders_achieved, orders_target,
        visits_achieved, visits_target, customers_achieved, customers_target,
      })
    }
    return rows.sort((a, b) => b.sales_achieved - a.sales_achieved)
  }, [viewLevel, role, members])

  function drillToManager(mgrId: string, mgrName: string) {
    setViewMgrId(mgrId); setViewMgrName(mgrName); setViewLevel('team'); setViewRepId(null); setViewRepName('')
  }

  function drillToRep(empId: string, empName: string) {
    setViewRepId(empId); setViewRepName(empName); setViewLevel('rep')
  }

  function goBack() {
    if (viewLevel === 'rep') { setViewLevel('team'); setViewRepId(null); setViewRepName('') }
    else if (viewLevel === 'team' && role === 'executive') { setViewLevel('company'); setViewMgrId(null); setViewMgrName('') }
    else nav(-1)
  }

  const d = repData as any

  function renderAchievementRow(item: any) {
    return (
      <button key={item.employee_id} onClick={() => drillToRep(item.employee_id, item.full_name)}
        className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
        <div className="flex items-center justify-between">
          <div><span className="font-semibold text-gray-800">{item.full_name}</span><span className="text-xs text-gray-400 mr-2">{item.code}</span></div>
          <span className="text-xs text-emerald-600">عرض التفاصيل ←</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-2">
          {([
            { label: 'المبيعات', a: item.sales?.achieved, t: item.sales?.target },
            { label: 'الطلبات', a: item.orders?.achieved, t: item.orders?.target },
            { label: 'الزيارات', a: item.visits?.achieved, t: item.visits?.target },
            { label: 'العملاء', a: item.activated_customers?.achieved, t: item.activated_customers?.target },
          ] as const).map((kpi) => (
            <div key={kpi.label} className="text-center">
              <div className="text-sm font-bold text-gray-700">{kpi.t ? pct(Math.round((kpi.a / kpi.t) * 100)) : '—'}</div>
              <div className="text-[9px] text-gray-400">{kpi.label}</div>
              <div className="text-[9px] text-gray-400">{fmtMoney(kpi.a)} / {fmtMoney(kpi.t)}</div>
              <KpiBar achieved={kpi.a} target={kpi.t} compact />
            </div>
          ))}
        </div>
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-sm text-emerald-600 font-semibold hover:underline">→ رجوع</button>
          <h1 className="text-xl font-bold text-gray-800">{getTitle()}</h1>
        </div>

        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {MONTHS.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {loading && <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>}
        {error && <div className="text-center py-4 text-red-500 text-sm">{error}</div>}

        {!loading && (role === 'rep' || viewLevel === 'rep') && d && (
          <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
            {([
              { label: 'المبيعات', key: 'sales', icon: '💰', money: true },
              { label: 'الطلبات', key: 'orders', icon: '📋' },
              { label: 'الزيارات', key: 'visits', icon: '📍' },
              { label: 'العملاء', key: 'activated_customers', icon: '👤' },
            ] as const).map((item) => {
              const kpi: any = d[item.key]
              if (!kpi) return null
              return (
                <div key={item.key} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <div className="text-2xl font-bold text-gray-800 tracking-tight">
                    {item.money ? fmtMoney(kpi.achieved) : fmt(kpi.achieved)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{item.label}</div>
                  {kpi.target > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>الهدف: {item.money ? fmtMoney(kpi.target) : fmt(kpi.target)}</span>
                        <span>المتبقي: {item.money ? fmtMoney(kpi.remaining) : fmt(kpi.remaining)}</span>
                      </div>
                      <KpiBar achieved={kpi.achieved} target={kpi.target} />
                    </div>
                  )}
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
                      <span className="text-xs text-emerald-600">عرض الفريق ←</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2">
                      {([
                        { label: 'المبيعات', a: mgr.sales_achieved, t: mgr.sales_target },
                        { label: 'الطلبات', a: mgr.orders_achieved, t: mgr.orders_target },
                        { label: 'الزيارات', a: mgr.visits_achieved, t: mgr.visits_target },
                        { label: 'العملاء', a: mgr.customers_achieved, t: mgr.customers_target },
                      ] as const).map((kpi) => (
                        <div key={kpi.label} className="text-center">
                          <div className="text-sm font-bold text-gray-700">{kpi.t > 0 ? pct(Math.round((kpi.a / kpi.t) * 100)) : '—'}</div>
                          <div className="text-[9px] text-gray-400">{kpi.label}</div>
                          <div className="text-[9px] text-gray-400">{fmtMoney(kpi.a)} / {fmtMoney(kpi.t)}</div>
                        </div>
                      ))}
                    </div>
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
              {members.length > 0 ? members.map(renderAchievementRow) : (
                <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات للفريق في هذا الشهر</div>
              )}
            </div>
          </>
        )}

        {!loading && d && (
          <div className="text-center text-[10px] text-gray-400">
            المصدر: Runtime V2 | {MONTHS[month - 1]} {year}
          </div>
        )}
      </div>
    </div>
  )
}
