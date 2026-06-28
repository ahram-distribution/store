import { useEffect, useState } from 'react'
import { targetService } from '../../services/targets'
import type { PerformanceData, HierarchyManager, HierarchyMember, HierarchyKpis, HierarchyTeamSummary } from './TargetRuntimePage'

type ViewLevel = 'company' | 'managers' | 'manager' | 'member'

type Props = {
  month?: number
  year?: number
  embedded?: boolean
}

export default function HierarchyTargetPage({ month: propMonth, year: propYear, embedded }: Props = {}) {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewLevel>('company')
  const [selectedManager, setSelectedManager] = useState<HierarchyManager | null>(null)
  const [selectedMember, setSelectedMember] = useState<HierarchyMember | null>(null)
  const [localMonth, setLocalMonth] = useState(new Date().getMonth() + 1)
  const [localYear, setLocalYear] = useState(new Date().getFullYear())
  const [error, setError] = useState<string | null>(null)

  const selMonth = propMonth ?? localMonth
  const selYear = propYear ?? localYear

  useEffect(() => {
    targetService.getPerformance(selMonth, selYear)
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message)
        else setData(d as PerformanceData)
      })
      .finally(() => setLoading(false))
  }, [selMonth, selYear])

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>
  if (error) return <div className="text-center py-12 text-red-500 text-sm">{error}</div>
  if (!data?.has_target) return <div className="text-center py-12 text-gray-500 text-sm">لا توجد أهداف لهذا الشهر</div>

  const hierarchy = data.hierarchy
  if (!hierarchy) return <div className="text-center py-12 text-gray-500 text-sm">لايوجد بيانات هيكلية</div>

  // ── Level 1: Company ──
  if (view === 'company') {
    const company = data.company!
    const pct = company.overall_achievement_pct

    return (
      <div className="p-4 max-w-6xl mx-auto space-y-6" dir="rtl">
        {!embedded && (
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">التسلسل الهرمي للأهداف</h1>
            <select value={selMonth} onChange={e => setLocalMonth(+e.target.value)} className="border rounded px-2 py-1 text-sm">
              {['يناير','فبراير','مارس','إبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'].map((n,i) => <option key={i} value={i+1}>{n}</option>)}
            </select>
            <select value={selYear} onChange={e => setLocalYear(+e.target.value)} className="border rounded px-2 py-1 text-sm">
              {[2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 border">
          <h2 className="text-lg font-bold text-gray-900 mb-4">الشركة</h2>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">الهدف:</span> <span className="font-medium">{company.sales_target.toLocaleString()}</span></div>
            <div><span className="text-gray-500">المنفذ:</span> <span className="font-medium">{company.sales_actual.toLocaleString()}</span></div>
            <div><span className="text-gray-500">نسبة الإنجاز:</span> <span className="font-medium">{pct.toFixed(2)}%</span></div>
            <div><span className="text-gray-500">عدد المديرين:</span> <span className="font-medium">{hierarchy.manager_count}</span></div>
          </div>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-3">
            <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>

        <button onClick={() => setView('managers')}
          className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right flex items-center justify-between">
          <span className="font-semibold text-gray-900">فرق المبيعات</span>
          <span className="text-blue-600">←</span>
        </button>
      </div>
    )
  }

  // ── Level 2: Managers list ──
  if (view === 'managers') {
    const managers = hierarchy.managers
    const unassigned = hierarchy.unassigned

    return (
      <div className="p-4 max-w-6xl mx-auto space-y-6" dir="rtl">
        <button onClick={() => setView('company')} className="text-blue-600 hover:text-blue-800 text-sm">&larr; العودة للشركة</button>

        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">مديري البيع</h3>
            <span className="text-sm text-gray-500">مرتبين حسب نسبة إنجاز الفريق</span>
          </div>
          {managers.length === 0 ? (
            <div className="p-6 text-center text-gray-500">لا يوجد مديري بيع</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-xs">
                  <th className="text-right px-4 py-2">الاسم</th>
                  <th className="text-right px-4 py-2">الهدف</th>
                  <th className="text-right px-4 py-2">المنفذ</th>
                  <th className="text-right px-4 py-2">نسبة الإنجاز</th>
                  <th className="text-right px-4 py-2">التقدم</th>
                  <th className="text-right px-4 py-2">عدد الفريق</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {managers.map(mgr => {
                  const ts = mgr.team_summary
                  const teamPct = ts.team_overall_pct
                  const teamTarget = ts.team_target?.sales || 0
                  const teamActual = ts.team_actual?.sales || 0
                  return (
                    <tr key={mgr.manager_id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedManager(mgr); setView('manager') }}>
                      <td className="px-4 py-3 font-medium">{mgr.manager_name}</td>
                      <td className="px-4 py-3">{teamTarget.toLocaleString()}</td>
                      <td className="px-4 py-3">{teamActual.toLocaleString()}</td>
                      <td className="px-4 py-3">{teamPct.toFixed(2)}%</td>
                      <td className="px-4 py-3 w-40">
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${Math.min(teamPct, 100)}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3">{ts.team_member_count}</td>
                      <td className="px-4 py-3 text-left">
                        <button className="text-blue-600 hover:text-blue-800 text-lg" title="عرض الفريق">←</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {unassigned.length > 0 && (
          <div className="text-sm text-gray-500">موظفون بدون مدير: {hierarchy.unassigned_count}</div>
        )}
      </div>
    )
  }

  // ── Level 3: Manager Team ──
  if (view === 'manager' && selectedManager) {
    const mgr = selectedManager
    const ts = mgr.team_summary

    return (
      <div className="p-4 max-w-6xl mx-auto space-y-6" dir="rtl">
        <button onClick={() => setView('company')} className="text-blue-600 hover:text-blue-800 text-sm">&larr; العودة للشركة</button>

        {/* Team summary */}
        <div className="bg-white rounded-lg shadow p-6 border">
          <h2 className="text-lg font-bold text-gray-900 mb-4">فريق {mgr.manager_name}</h2>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">هدف الفريق:</span> <span className="font-medium">{(ts.team_target?.sales || 0).toLocaleString()}</span></div>
            <div><span className="text-gray-500">منجز الفريق:</span> <span className="font-medium">{(ts.team_actual?.sales || 0).toLocaleString()}</span></div>
            <div><span className="text-gray-500">نسبة الإنجاز:</span> <span className="font-medium">{ts.team_overall_pct.toFixed(2)}%</span></div>
            <div><span className="text-gray-500">عدد الأفراد:</span> <span className="font-medium">{ts.team_member_count}</span></div>
          </div>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-3">
            <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${Math.min(ts.team_overall_pct, 100)}%` }} />
          </div>
        </div>

        {/* Manager's own KPIs */}
        <div className="bg-white rounded-lg shadow p-4 border">
          <h3 className="font-bold text-gray-900 mb-3">{mgr.manager_name} — مؤشرات الأداء</h3>
          <KpiCards kpis={mgr.own_kpis} score={mgr.own_overall_score} />
        </div>

        {/* Members table */}
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-3 border-b bg-gray-50 font-bold text-gray-900">أعضاء الفريق</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-gray-500 text-xs">
                <th className="text-right px-4 py-2">الاسم</th>
                <th className="text-right px-4 py-2">مدير</th>
                <th className="text-right px-4 py-2">الهدف</th>
                <th className="text-right px-4 py-2">المنفذ</th>
                <th className="text-right px-4 py-2">نسبة الإنجاز</th>
                <th className="text-right px-4 py-2">التقدم</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {mgr.members.map(m => (
                <tr key={m.employee_id} className={`border-b hover:bg-gray-50 cursor-pointer ${m.is_manager ? 'bg-blue-50' : ''}`}
                    onClick={() => { setSelectedMember(m); setView('member') }}>
                  <td className="px-4 py-3 font-medium">{m.employee_name}</td>
                  <td className="px-4 py-3">{m.is_manager ? '✅' : ''}</td>
                  <td className="px-4 py-3">{(m.kpis.sales.target || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">{(m.kpis.sales.actual || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">{m.overall_achievement_score?.toFixed(2) ?? '—'}%</td>
                  <td className="px-4 py-3 w-40">
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${Math.min(m.overall_achievement_score ?? 0, 100)}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button className="text-blue-600 hover:text-blue-800 text-lg" title="عرض التفاصيل">←</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Level 4: Member details ──
  if (view === 'member' && selectedMember) {
    const m = selectedMember

    return (
      <div className="p-4 max-w-6xl mx-auto space-y-6" dir="rtl">
        <button onClick={() => setView('manager')} className="text-blue-600 hover:text-blue-800 text-sm">&larr; العودة للفريق</button>

        <div className="bg-white rounded-lg shadow p-6 border">
          <h2 className="text-lg font-bold text-gray-900 mb-2">{m.employee_name}</h2>
          <p className="text-sm text-gray-500 mb-4">{m.is_manager ? 'مدير بيع' : 'مندوب مبيعات'} • النتيجة الإجمالية: {m.overall_achievement_score?.toFixed(2) ?? '—'}%</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCards kpis={m.kpis} score={m.overall_achievement_score} />
          </div>
        </div>
      </div>
    )
  }

  return null
}

function KpiCards({ kpis, score }: { kpis: HierarchyKpis; score: number | null }) {
  const kpiList = [
    { key: 'sales', label: 'المبيعات', color: 'bg-blue-500' },
    { key: 'orders', label: 'الطلبات', color: 'bg-green-500' },
    { key: 'visits', label: 'الزيارات', color: 'bg-yellow-500' },
    { key: 'new_customers', label: 'عملاء جدد', color: 'bg-purple-500' },
    { key: 'collections', label: 'التحصيل', color: 'bg-orange-500' },
    { key: 'attendance', label: 'الالتزام', color: 'bg-teal-500' },
  ] as const

  return (
    <>
      {kpiList.map(({ key, label, color }) => {
        const k = kpis[key as keyof HierarchyKpis]
        if (!k) return null
        const pct = k.pct
        const displayPct = pct !== null && pct !== undefined ? pct.toFixed(1) : '—'
        const barWidth = pct !== null && pct !== undefined ? Math.min(pct, 100) : 0

        return (
          <div key={key} className="bg-gray-50 rounded-lg p-4 border">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">{label}</span>
              <span className={`text-xs font-bold ${pct !== null ? 'text-gray-900' : 'text-gray-400'}`}>
                {displayPct}{pct !== null ? '%' : ''}
              </span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>الهدف: {k.target.toLocaleString()}</span>
              <span>المنفذ: {k.actual.toLocaleString()}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div className={`${color} h-2.5 rounded-full`} style={{ width: `${barWidth}%` }} />
            </div>
            {pct !== null && (pct >= 100 ? (
              <span className="text-xs text-green-600 font-medium">✓ تم تجاوز الهدف</span>
            ) : pct >= 75 ? (
              <span className="text-xs text-blue-600 font-medium">على المسار الصحيح</span>
            ) : pct >= 50 ? (
              <span className="text-xs text-yellow-600 font-medium">بحاجة دفع</span>
            ) : pct > 0 ? (
              <span className="text-xs text-red-600 font-medium">متأخر</span>
            ) : (
              <span className="text-xs text-gray-400">بدون إنجاز</span>
            ))}
          </div>
        )
      })}
    </>
  )
}
