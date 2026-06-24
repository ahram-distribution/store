import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { getEffectiveRole, type EffectiveRole } from '../utils/hierarchyFilter'

type Period = 'day' | 'yesterday' | 'week' | 'month' | 'custom'

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  if (Number.isInteger(n)) return n.toLocaleString('ar-EG-u-nu-latn')
  return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '0'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function getRange(p: Period, cf: string, ct: string): { from: string; to: string } {
  const now = new Date()
  switch (p) {
    case 'day':
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString() }
    case 'yesterday': {
      const yes = new Date(now); yes.setDate(yes.getDate() - 1); yes.setHours(0, 0, 0, 0)
      const end = new Date(now); end.setDate(end.getDate()); end.setHours(0, 0, 0, 0)
      return { from: yes.toISOString(), to: end.toISOString() }
    }
    case 'week': {
      const start = new Date(now); start.setDate(start.getDate() - start.getDay() + 1); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setDate(end.getDate() + 7)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() }
    case 'custom':
      return { from: cf || '1970-01-01T00:00:00Z', to: ct || now.toISOString() }
  }
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'اليوم' }, { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'الأسبوع' }, { key: 'month', label: 'الشهر' }, { key: 'custom', label: 'فترة مخصصة' },
]

type ViewLevel = 'company' | 'team' | 'rep'

export function TeamActivity() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role: EffectiveRole = getEffectiveRole(user)

  const [period, setPeriod] = useState<Period>('day')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [viewLevel, setViewLevel] = useState<ViewLevel>('company')
  const [viewMgrId, setViewMgrId] = useState<string | null>(null)
  const [viewMgrName, setViewMgrName] = useState('')
  const [viewRepId, setViewRepId] = useState<string | null>(null)
  const [viewRepName, setViewRepName] = useState('')

  const [members, setMembers] = useState<any[]>([])
  const [repData, setRepData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const { from, to } = getRange(period, customFrom, customTo)

  function resetViews() {
    setViewLevel('company')
    setViewMgrId(null)
    setViewMgrName('')
    setViewRepId(null)
    setViewRepName('')
  }

  function getTitle(): string {
    if (role === 'rep' || viewLevel === 'rep') return `نشاط ${viewRepName || user?.full_name || ''}`
    if (viewLevel === 'team') return `نشاط فريق ${viewMgrName}`
    return 'نشاط الشركة'
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) { setLoading(false); return }

    setLoading(true)

    if (role === 'rep') {
      supabase.rpc('get_runtime_activity', { p_employee_id: eid, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => { if (error) console.error(error); else setRepData(data); setMembers([]) })
        .finally(() => setLoading(false))
    } else if (role === 'executive' && viewLevel === 'company') {
      supabase.rpc('get_runtime_team_activity', { p_manager_employee_id: null, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => { if (error) console.error(error); else setMembers((data as any[]) || []); setRepData(null) })
        .finally(() => setLoading(false))
    } else if ((role === 'executive' && viewLevel === 'team') || (role === 'manager')) {
      const mgrId = viewMgrId || eid
      supabase.rpc('get_runtime_team_activity', { p_manager_employee_id: mgrId, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => { if (error) console.error(error); else setMembers((data as any[]) || []); setRepData(null) })
        .finally(() => setLoading(false))
    } else if (viewLevel === 'rep') {
      supabase.rpc('get_runtime_activity', { p_employee_id: viewRepId || eid, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => { if (error) console.error(error); else setRepData(data); setMembers([]) })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [period, customFrom, customTo, user?.employee_id, viewLevel, viewMgrId, viewRepId])

  const managerRows = useMemo(() => {
    if (viewLevel !== 'company' || role !== 'executive') return []
    const mgrMap = new Map<string, { name: string; code: string }>()
    members.forEach((m: any) => {
      if (m.manager_id) mgrMap.set(m.manager_id, { name: m.manager_name || m.full_name, code: m.manager_code || '' })
    })

    const rows: any[] = []
    for (const [mgrId, mgr] of mgrMap) {
      const teamMembers = members.filter((m: any) => m.manager_id === mgrId)
      let sales = 0, orders = 0, visits = 0, customers = 0
      teamMembers.forEach((m: any) => {
        sales += m.sales || 0; orders += m.orders || 0
        visits += m.completed_visits || 0; customers += m.registered_customers || 0
      })
      rows.push({
        manager_id: mgrId, manager_name: mgr.name, manager_code: mgr.code,
        sales, orders, completed_visits: visits,
        registered_customers: customers, team_size: teamMembers.length,
      })
    }
    return rows.sort((a, b) => b.sales - a.sales)
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

  function renderSummaryCards(items: { label: string; value: number; money?: boolean }[]) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {items.map((item) => (
          <div key={item.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
            <div className="text-lg font-bold text-gray-800">{item.money ? fmtMoney(item.value) : fmt(item.value)}</div>
            <div className="text-[10px] text-gray-400">{item.label}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-sm text-indigo-600 font-semibold hover:underline">→ رجوع</button>
          <h1 className="text-xl font-bold text-gray-800">{getTitle()}</h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => { resetViews(); setPeriod(p.key) }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${period === p.key ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex gap-3 items-center">
            <div><label className="text-xs text-gray-500">من</label><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm" /></div>
            <div><label className="text-xs text-gray-500">إلى</label><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm" /></div>
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>}

        {!loading && (role === 'rep' || viewLevel === 'rep') && d && (
          <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              { label: 'المبيعات المنشأة', value: d.created_sales, icon: '💰', money: true },
              { label: 'الطلبات المنشأة', value: d.created_orders, icon: '📋' },
              { label: 'الزيارات المكتملة', value: d.completed_visits, icon: '📍' },
              { label: 'العملاء المسجلون', value: d.registered_customers, icon: '👤' },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-3xl font-bold text-gray-800 tracking-tight">
                  {item.money ? fmtMoney(item.value) : fmt(item.value)}
                </div>
                <div className="text-sm text-gray-500 mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && role === 'executive' && viewLevel === 'company' && (
          <>
            {managerRows.length > 0 && (
              <>
                {renderSummaryCards([
                  { label: 'إجمالي مبيعات الفرق', value: managerRows.reduce((s, r) => s + r.sales, 0), money: true },
                  { label: 'إجمالي الطلبات', value: managerRows.reduce((s, r) => s + r.orders, 0) },
                  { label: 'إجمالي الزيارات', value: managerRows.reduce((s, r) => s + r.completed_visits, 0) },
                  { label: 'إجمالي العملاء', value: managerRows.reduce((s, r) => s + r.registered_customers, 0) },
                ])}

                <div className="space-y-2">
                  {managerRows.map((mgr) => (
                    <button key={mgr.manager_id} onClick={() => drillToManager(mgr.manager_id, mgr.manager_name)}
                      className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-semibold text-gray-800">{mgr.manager_name}</span>
                          <span className="text-xs text-gray-400 mr-2">{mgr.manager_code}</span>
                          <span className="text-[10px] text-gray-400 mr-2">({mgr.team_size} مندوب)</span>
                        </div>
                        <span className="text-xs text-indigo-600">عرض الفريق ←</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                        <div><span className="text-sm font-bold text-gray-700">{fmtMoney(mgr.sales)}</span><div className="text-[9px] text-gray-400">مبيعات</div></div>
                        <div><span className="text-sm font-bold text-gray-700">{fmt(mgr.orders)}</span><div className="text-[9px] text-gray-400">طلبات</div></div>
                        <div><span className="text-sm font-bold text-gray-700">{fmt(mgr.completed_visits)}</span><div className="text-[9px] text-gray-400">زيارات</div></div>
                        <div><span className="text-sm font-bold text-gray-700">{fmt(mgr.registered_customers)}</span><div className="text-[9px] text-gray-400">عملاء</div></div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {managerRows.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">لا يوجد مدراء بيع في هذه الفترة</div>
            )}
          </>
        )}

        {!loading && viewLevel === 'team' && (
          <>
            <p className="text-xs text-gray-500">فريق {viewMgrName} — {members.length} مندوب</p>

            {renderSummaryCards([
              { label: 'مبيعات الفريق', value: members.reduce((s, m) => s + (m.sales || 0), 0), money: true },
              { label: 'الطلبات', value: members.reduce((s, m) => s + (m.orders || 0), 0) },
              { label: 'الزيارات', value: members.reduce((s, m) => s + (m.completed_visits || 0), 0) },
              { label: 'العملاء', value: members.reduce((s, m) => s + (m.registered_customers || 0), 0) },
            ])}

            <div className="space-y-2">
              {members.filter((m: any) => (m.sales || 0) + (m.orders || 0) + (m.completed_visits || 0) + (m.registered_customers || 0) > 0)
                .map((m: any) => (
                  <button key={m.employee_id} onClick={() => drillToRep(m.employee_id, m.full_name)}
                    className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right">
                    <div className="flex items-center justify-between">
                      <div><span className="font-semibold text-gray-800">{m.full_name}</span><span className="text-xs text-gray-400 mr-2">{m.code}</span></div>
                      <span className="text-xs text-indigo-600">عرض التفاصيل ←</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                      <div><span className="text-sm font-bold text-gray-700">{fmtMoney(m.sales)}</span><div className="text-[9px] text-gray-400">مبيعات</div></div>
                      <div><span className="text-sm font-bold text-gray-700">{fmt(m.orders)}</span><div className="text-[9px] text-gray-400">طلبات</div></div>
                      <div><span className="text-sm font-bold text-gray-700">{fmt(m.completed_visits)}</span><div className="text-[9px] text-gray-400">زيارات</div></div>
                      <div><span className="text-sm font-bold text-gray-700">{fmt(m.registered_customers)}</span><div className="text-[9px] text-gray-400">عملاء</div></div>
                    </div>
                  </button>
                ))}
              {members.filter((m: any) => (m.sales || 0) > 0).length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات للفريق في هذه الفترة</div>
              )}
            </div>
          </>
        )}

        {!loading && d && (
          <div className="text-center text-[10px] text-gray-400">
            المصدر: Runtime V2 | {d.meta?.date_from?.slice(0, 10)} → {d.meta?.date_to?.slice(0, 10)}
          </div>
        )}
      </div>
    </div>
  )
}
