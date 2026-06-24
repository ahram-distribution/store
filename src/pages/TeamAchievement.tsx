import { useState, useEffect } from 'react'
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
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'أ'
  return fmt(n)
}

function getRange(p: Period, cf: string, ct: string): { from: string; to: string } {
  const now = new Date()
  switch (p) {
    case 'day':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
      }
    case 'yesterday': {
      const yes = new Date(now)
      yes.setDate(yes.getDate() - 1)
      yes.setHours(0, 0, 0, 0)
      const end = new Date(now)
      end.setDate(end.getDate())
      end.setHours(0, 0, 0, 0)
      return { from: yes.toISOString(), to: end.toISOString() }
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - start.getDay() + 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      return { from: start.toISOString(), to: end.toISOString() }
    }
    case 'month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      }
    case 'custom':
      return { from: cf || '1970-01-01T00:00:00Z', to: ct || now.toISOString() }
  }
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'الأسبوع' },
  { key: 'month', label: 'الشهر' },
  { key: 'custom', label: 'فترة مخصصة' },
]

interface ScopeStack {
  type: 'company' | 'manager' | 'rep'
  id?: string
  name: string
}

function KpiBar({ pct }: { pct: number }) {
  const safePct = Math.min(Math.max(pct || 0, 0), 100)
  const color = safePct >= 80 ? 'bg-emerald-500' : safePct >= 40 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${safePct}%` }} />
    </div>
  )
}

export function TeamAchievement() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role: EffectiveRole = getEffectiveRole(user)

  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [scope, setScope] = useState<ScopeStack[]>([{ type: 'company', id: undefined, name: '' }])
  const [members, setMembers] = useState<any[]>([])
  const [repData, setRepData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const currentScope = scope[scope.length - 1]

  function getTitle(): string {
    if (role === 'rep') return 'إنجازي'
    if (role === 'manager' && currentScope.type === 'rep') return `إنجاز ${currentScope.name}`
    if (role === 'manager') return 'إنجاز الفريق'
    if (currentScope.type === 'rep') return `إنجاز ${currentScope.name}`
    if (currentScope.type === 'manager') return `إنجاز فريق ${currentScope.name}`
    return 'إنجاز الشركة'
  }

  function isRepView(): boolean {
    return role === 'rep' || currentScope.type === 'rep'
  }

  function getMonthYear(): { month: number; year: number } {
    const now = new Date()
    return { month: now.getMonth() + 1, year: now.getFullYear() }
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) return

    setLoading(true)
    const { from, to } = getRange(period, customFrom, customTo)
    const { month, year } = getMonthYear()

    if (isRepView()) {
      const empId = currentScope.id || eid
      supabase
        .rpc('get_runtime_achievement', {
          p_employee_id: empId,
          p_month: month,
          p_year: year,
          p_date_from: from,
          p_date_to: to,
        })
        .then(({ data, error }) => {
          if (error) console.error(error)
          else setRepData(data)
          setMembers([])
        })
        .finally(() => setLoading(false))
    } else {
      const mgrId = currentScope.type === 'manager' ? currentScope.id : null
      supabase
        .rpc('get_runtime_team', {
          p_manager_employee_id: mgrId ?? null,
          p_month: month,
          p_year: year,
          p_date_from: from,
          p_date_to: to,
        })
        .then(({ data, error }) => {
          if (error) console.error(error)
          else setMembers((data as any[]) || [])
          setRepData(null)
        })
        .finally(() => setLoading(false))
    }
  }, [period, customFrom, customTo, user?.employee_id, currentScope.type, currentScope.id])

  function drillToRep(empId: string, name: string) {
    setScope([...scope, { type: 'rep', id: empId, name }])
  }

  function drillToManager(mgrId: string, mgrName: string) {
    setScope([...scope, { type: 'manager', id: mgrId, name: mgrName }])
  }

  function goBack() {
    if (scope.length > 1) setScope(scope.slice(0, -1))
    else nav(-1)
  }

  // ---- Rep-level data ----
  const d = repData as any
  const repKpis = d
    ? [
        { key: 'sales', label: 'المبيعات المسلمة', icon: '💰', money: true, data: d.sales },
        { key: 'orders', label: 'الطلبات المسلمة', icon: '📦', data: d.orders },
        { key: 'visits', label: 'الزيارات المكتملة', icon: '📍', data: d.visits },
        { key: 'activated_customers', label: 'العملاء أول طلب', icon: '👤', data: d.activated_customers },
      ]
    : []

  // ---- Team-level summary ----
  function sumKPI(field: string): number {
    return members.reduce((s: number, m: any) => s + ((m[field]?.achieved || m[field]) ?? 0), 0)
  }

  function avgPct(m: any, kpi: string): number {
    return m[kpi]?.percentage ?? 0
  }

  // ---- Reconciliation from rep data ----
  const repExcluded = d?.excluded_events
  const allZero = repExcluded && Object.values(repExcluded as Record<string, number>).every((v) => v === 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-sm text-sky-600 font-semibold hover:underline">→ رجوع</button>
          <h1 className="text-xl font-bold text-gray-800">{getTitle()}</h1>
        </div>

        <p className="text-sm text-gray-500">
          {user?.full_name || ''} — {role === 'rep' ? 'إنجازك' : 'إنجاز الفريق'} خلال الفترة
        </p>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                period === p.key ? 'bg-sky-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex gap-3 items-center">
            <div>
              <label className="text-xs text-gray-500">من</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500">إلى</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="block border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>}

        {/* ========== REP VIEW ========== */}
        {!loading && isRepView() && d && (
          <>
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
              {repKpis.map((kpi) => (
                <div key={kpi.key} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                  <div className="text-2xl mb-2">{kpi.icon}</div>
                  <div className="text-3xl font-bold text-gray-800 tracking-tight">
                    {kpi.money ? fmtMoney(kpi.data?.achieved) : fmt(kpi.data?.achieved)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{kpi.label}</div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm max-w-2xl mx-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">الأهداف</h3>
              <div className="space-y-3">
                {repKpis.map((kpi) => {
                  const a = kpi.data?.achieved ?? 0
                  const t = kpi.data?.target ?? 0
                  const r = kpi.data?.remaining ?? 0
                  const p = kpi.data?.percentage ?? 0
                  return (
                    <div key={kpi.key} className="flex items-center justify-between text-xs">
                      <div className="w-16 font-medium text-gray-600">{kpi.label}</div>
                      <div className="flex-1 mx-3">
                        <KpiBar pct={p} />
                      </div>
                      <div className="text-left whitespace-nowrap text-gray-800 font-semibold w-16">
                        {fmt(p)}%
                      </div>
                      <div className="text-left whitespace-nowrap text-gray-800 w-20">
                        {kpi.money ? fmtMoney(a) : fmt(a)} / {kpi.money ? fmtMoney(t) : fmt(t)}
                      </div>
                      <div className="text-left whitespace-nowrap text-amber-600 w-14">
                        متبقي: {kpi.money ? fmtMoney(r) : fmt(r)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Reconciliation card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm max-w-2xl mx-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">التسوية</h3>
              {repExcluded && (
                <div className="text-xs">
                  <div className="grid grid-cols-5 gap-2 font-semibold text-gray-500 mb-2 pb-2 border-b border-gray-100">
                    <span>المقياس</span>
                    <span>المنجز</span>
                    <span>مستبعد</span>
                    <span>الإجمالي</span>
                    <span>الحالة</span>
                  </div>
                  {repKpis.map((kpi) => {
                    const achieved = kpi.data?.achieved ?? 0
                    const excludedKey: Record<string, string> = { orders: 'order_delivered', visits: 'completed_visits' }
                    const excluded = repExcluded[excludedKey[kpi.key] ?? '_'] ?? 0
                    const total = kpi.money
                      ? (Number(achieved) + Number(excluded))
                      : (Number(achieved) + Number(excluded))
                    return (
                      <div key={kpi.key} className="grid grid-cols-5 gap-2 py-1.5 border-b border-gray-50">
                        <span className="text-gray-600">{kpi.label}</span>
                        <span className="font-semibold">{kpi.money ? fmtMoney(achieved) : fmt(achieved)}</span>
                        <span className={`font-semibold ${excluded > 0 ? 'text-amber-600' : 'text-gray-500'}`}>{fmt(excluded)}</span>
                        <span className="font-semibold">{kpi.money ? fmtMoney(total) : fmt(total)}</span>
                        <span className={`font-semibold ${excluded === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {excluded === 0 ? '✅' : '⚠️'}
                        </span>
                      </div>
                    )
                  })}
                  {allZero && <div className="text-emerald-600 text-center mt-2">لا توجد أحداث مستبعدة ✅</div>}
                </div>
              )}
            </div>
          </>
        )}

        {/* ========== TEAM VIEW ========== */}
        {!loading && !isRepView() && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmtMoney(sumKPI('sales'))}</div>
                <div className="text-[10px] text-gray-400">إجمالي المبيعات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(sumKPI('orders'))}</div>
                <div className="text-[10px] text-gray-400">الطلبات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(sumKPI('visits'))}</div>
                <div className="text-[10px] text-gray-400">الزيارات</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-gray-800">{fmt(sumKPI('activated_customers'))}</div>
                <div className="text-[10px] text-gray-400">العملاء</div>
              </div>
            </div>

            <div className="space-y-3">
              {members.filter((m: any) => (m.sales?.achieved ?? 0) > 0 || (m.orders?.achieved ?? 0) > 0 || (m.visits?.achieved ?? 0) > 0 || (m.activated_customers?.achieved ?? 0) > 0)
                .map((m: any) => {
                  const kpis = [
                    { key: 'sales', label: 'المبيعات', money: true, d: m.sales },
                    { key: 'orders', label: 'الطلبات', d: m.orders },
                    { key: 'visits', label: 'الزيارات', d: m.visits },
                    { key: 'activated_customers', label: 'العملاء', d: m.activated_customers },
                  ]
                  return (
                    <button
                      key={m.employee_id}
                      onClick={() => drillToRep(m.employee_id, m.full_name)}
                      className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-semibold text-gray-800">{m.full_name}</span>
                          <span className="text-xs text-gray-400 mr-2">{m.code}</span>
                        </div>
                        <span className="text-xs text-sky-600">عرض التفاصيل ←</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {kpis.map((kpi) => {
                          const a = kpi.d?.achieved ?? 0
                          const t = kpi.d?.target ?? 0
                          const r = kpi.d?.remaining ?? 0
                          const p = kpi.d?.percentage ?? 0
                          const safePct = Math.min(Math.max(p || 0), 100)
                          const color = safePct >= 80 ? 'bg-emerald-500' : safePct >= 40 ? 'bg-amber-400' : 'bg-rose-400'
                          return (
                            <div key={kpi.key} className="text-center">
                              <div className="text-sm font-bold text-gray-800">
                                {kpi.money ? fmtMoney(a) : fmt(a)}
                              </div>
                              <div className="text-[9px] text-gray-400">{kpi.label}</div>
                              <div className="text-[9px] text-gray-500">هدف: {kpi.money ? fmtMoney(t) : fmt(t)}</div>
                              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
                                <div className={`h-1 rounded-full ${color}`} style={{ width: `${safePct}%` }} />
                              </div>
                              <div className="text-[9px] mt-0.5" style={{ color: safePct >= 80 ? '#059669' : safePct >= 40 ? '#d97706' : '#e11d48' }}>
                                {fmt(p)}%
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}
              {members.filter((m: any) => (m.sales?.achieved ?? 0) > 0 || (m.orders?.achieved ?? 0) > 0 || (m.visits?.achieved ?? 0) > 0 || (m.activated_customers?.achieved ?? 0) > 0).length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات في هذه الفترة</div>
              )}
            </div>
          </>
        )}

        {!loading && d && (
          <div className="text-center text-[10px] text-gray-400">
            المصدر: Runtime V2 — {d.meta?.date_from?.slice(0, 10)} → {d.meta?.date_to?.slice(0, 10)}
          </div>
        )}
      </div>
    </div>
  )
}
