import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toLocaleString('ar-EG-u-nu-latn')
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '0'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

export function TeamAchievement() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [team, setTeam] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [drillDown, setDrillDown] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<any>(null)

  useEffect(() => {
    setLoading(true)
    supabase
      .rpc('get_runtime_team', {
        p_manager_employee_id: null,
        p_month: month,
        p_year: year,
      })
      .then(({ data: d, error }) => {
        if (error) console.error(error)
        else setTeam((d as any[]) || [])
      })
      .finally(() => setLoading(false))
  }, [month, year])

  function viewRep(empId: string, name: string) {
    setDrillDown(name)
    setLoading(true)
    supabase
      .rpc('get_runtime_achievement', {
        p_employee_id: empId,
        p_month: month,
        p_year: year,
      })
      .then(({ data: d, error }) => {
        if (error) console.error(error)
        else setDrillData(d)
      })
      .finally(() => setLoading(false))
  }

  const months = [
    { n: 1, label: 'يناير' }, { n: 2, label: 'فبراير' }, { n: 3, label: 'مارس' },
    { n: 4, label: 'أبريل' }, { n: 5, label: 'مايو' }, { n: 6, label: 'يونيو' },
    { n: 7, label: 'يوليو' }, { n: 8, label: 'أغسطس' }, { n: 9, label: 'سبتمبر' },
    { n: 10, label: 'أكتوبر' }, { n: 11, label: 'نوفمبر' }, { n: 12, label: 'ديسمبر' },
  ]

  const totalSales = team.reduce((s: number, m: any) => s + (m.sales || 0), 0)
  const totalOrders = team.reduce((s: number, m: any) => s + (m.orders || 0), 0)
  const totalVisits = team.reduce((s: number, m: any) => s + (m.visits || 0), 0)
  const totalCustomers = team.reduce((s: number, m: any) => s + (m.activated_customers || 0), 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => nav(-1)} className="text-sm text-sky-600 font-semibold hover:underline">
            → رجوع
          </button>
          <h1 className="text-xl font-bold text-gray-800">
            {drillDown ? `تفاصيل ${drillDown}` : 'إنجاز الفريق'}
          </h1>
        </div>

        {/* Month selector */}
        <div className="flex gap-2 flex-wrap">
          <select
            value={month}
            onChange={(e) => { setMonth(Number(e.target.value)); setDrillDown(null) }}
            className="border border-gray-200 rounded-xl px-4 py-2 text-sm bg-white"
          >
            {months.map((m) => (
              <option key={m.n} value={m.n}>{m.label}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setDrillDown(null) }}
            className="border border-gray-200 rounded-xl px-4 py-2 text-sm bg-white"
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {drillDown && (
            <button
              onClick={() => setDrillDown(null)}
              className="text-sm text-sky-600 hover:underline px-3"
            >
              ← عودة للفريق
            </button>
          )}
        </div>

        {loading && <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>}

        {!loading && !drillDown && (
          <>
            {/* Team summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmtMoney(totalSales)}</div>
                <div className="text-[10px] text-gray-400">إجمالي المبيعات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(totalOrders)}</div>
                <div className="text-[10px] text-gray-400">الطلبات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(totalVisits)}</div>
                <div className="text-[10px] text-gray-400">الزيارات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(totalCustomers)}</div>
                <div className="text-[10px] text-gray-400">العملاء</div>
              </div>
            </div>

            {/* Team member list */}
            <div className="space-y-2">
              {team
                .filter((m: any) => m.sales > 0 || m.orders > 0 || m.visits > 0 || m.activated_customers > 0)
                .map((member: any) => (
                  <button
                    key={member.employee_id}
                    onClick={() => viewRep(member.employee_id, member.full_name)}
                    className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-800">{member.full_name}</span>
                        <span className="text-xs text-gray-400 mr-2">{member.code}</span>
                      </div>
                      <span className="text-xs text-sky-600">عرض التفاصيل ←</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmtMoney(member.sales)}</span>
                        <div className="text-[9px] text-gray-400">مبيعات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(member.orders)}</span>
                        <div className="text-[9px] text-gray-400">طلبات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(member.visits)}</span>
                        <div className="text-[9px] text-gray-400">زيارات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(member.activated_customers)}</span>
                        <div className="text-[9px] text-gray-400">عملاء</div>
                      </div>
                    </div>
                  </button>
                ))}
              {team.filter((m: any) => m.sales > 0 || m.orders > 0 || m.visits > 0 || m.activated_customers > 0).length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات للفريق في هذا الشهر</div>
              )}
            </div>
          </>
        )}

        {/* Drill-down: individual rep achievement */}
        {!loading && drillDown && drillData && (
          <div className="space-y-4">
            {[
              { title: 'المبيعات المسلمة', icon: '💰', d: drillData.sales, money: true },
              { title: 'الطلبات المسلمة', icon: '📦', d: drillData.orders },
              { title: 'الزيارات المكتملة', icon: '📍', d: drillData.visits },
              { title: 'العملاء المحققون', icon: '👤', d: drillData.activated_customers },
            ].map((kpi) => {
              const pct = kpi.d?.percentage ?? 0
              return (
                <div key={kpi.title} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span>{kpi.icon}</span>
                      <span className="font-semibold text-gray-700 text-sm">{kpi.title}</span>
                    </div>
                    <span className={`text-sm font-bold ${
                      pct >= 80 ? 'text-emerald-600' : pct >= 40 ? 'text-amber-600' : 'text-rose-600'
                    }`}>{pct}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                    <div className={`h-2 rounded-full ${
                      pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-rose-400'
                    }`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><span className="font-bold text-gray-800">{kpi.money ? fmtMoney(kpi.d?.achieved) : fmt(kpi.d?.achieved)}</span><br /><span className="text-gray-400">منجز</span></div>
                    <div><span className="font-bold text-gray-800">{kpi.money ? fmtMoney(kpi.d?.target) : fmt(kpi.d?.target)}</span><br /><span className="text-gray-400">هدف</span></div>
                    <div><span className="font-bold text-gray-800">{kpi.money ? fmtMoney(kpi.d?.remaining) : fmt(kpi.d?.remaining)}</span><br /><span className="text-gray-400">متبقي</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Source note */}
        <div className="text-center text-[10px] text-gray-400">
          المصدر: Runtime V2 | {month}/{year}
        </div>
      </div>
    </div>
  )
}
