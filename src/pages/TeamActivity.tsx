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

export function TeamActivity() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role: EffectiveRole = getEffectiveRole(user)

  const [period, setPeriod] = useState<Period>('day')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [scope, setScope] = useState<ScopeStack[]>([{ type: 'company', id: undefined, name: '' }])
  const [members, setMembers] = useState<any[]>([])
  const [repData, setRepData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const currentScope = scope[scope.length - 1]

  function getTitle(): string {
    if (role === 'rep') return 'نشاطي'
    if (role === 'manager' && currentScope.type === 'rep') return `نشاط ${currentScope.name}`
    if (role === 'manager') return 'نشاط الفريق'
    if (currentScope.type === 'rep') return `نشاط ${currentScope.name}`
    if (currentScope.type === 'manager') return `نشاط فريق ${currentScope.name}`
    return 'نشاط الشركة'
  }

  function isRepView(): boolean {
    return role === 'rep' || currentScope.type === 'rep'
  }

  useEffect(() => {
    const eid = user?.employee_id
    if (!eid) return

    setLoading(true)
    const { from, to } = getRange(period, customFrom, customTo)

    if (isRepView()) {
      const empId = currentScope.id || eid
      supabase
        .rpc('get_runtime_activity', { p_employee_id: empId, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => {
          if (error) console.error(error)
          else setRepData(data)
          setMembers([])
        })
        .finally(() => setLoading(false))
    } else {
      const mgrId = currentScope.type === 'manager' ? currentScope.id : null
      supabase
        .rpc('get_runtime_team_activity', { p_manager_employee_id: mgrId ?? null, p_date_from: from, p_date_to: to })
        .then(({ data, error }) => {
          if (error) console.error(error)
          else setMembers((data as any[]) || [])
          setRepData(null)
        })
        .finally(() => setLoading(false))
    }
  }, [period, customFrom, customTo, user?.employee_id, currentScope.type, currentScope.id])

  function drillToMember(m: any) {
    setScope([...scope, { type: 'rep', id: m.employee_id, name: m.full_name }])
  }

  function goBack() {
    if (scope.length > 1) setScope(scope.slice(0, -1))
    else nav(-1)
  }

  function drillToManager(mgrId: string, mgrName: string) {
    setScope([...scope, { type: 'manager', id: mgrId, name: mgrName }])
  }

  function sumMembers(field: string): number {
    return members.reduce((s: number, m: any) => s + (m[field] || 0), 0)
  }

  const d = repData as any

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-sm text-indigo-600 font-semibold hover:underline">→ رجوع</button>
          <h1 className="text-xl font-bold text-gray-800">{getTitle()}</h1>
        </div>

        <p className="text-sm text-gray-500">
          {user?.full_name || ''} — {role === 'rep' ? 'نشاطك' : 'نشاط الفريق'} خلال الفترة
        </p>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                period === p.key ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
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

        {!loading && isRepView() && d && (
          <>
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
              {[
                { label: 'المبيعات المنشأة', value: d.created_sales, icon: '💰', isCurrency: true },
                { label: 'الطلبات المنشأة', value: d.created_orders, icon: '📋' },
                { label: 'الزيارات المكتملة', value: d.completed_visits, icon: '📍' },
                { label: 'العملاء المسجلون', value: d.registered_customers, icon: '👤' },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <div className="text-3xl font-bold text-gray-800 tracking-tight">{item.isCurrency ? fmtMoney(item.value) : fmt(item.value)}</div>
                  <div className="text-sm text-gray-500 mt-1">{item.label}</div>
                </div>
              ))}
            </div>

            {d.excluded_events && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 max-w-2xl mx-auto">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-600 text-lg">⚠️</span>
                  <span className="font-semibold text-amber-800 text-sm">أحداث مستبعدة</span>
                </div>
                <div className="text-xs text-amber-700 space-y-1">
                  {Object.values(d.excluded_events as Record<string, number>).every((v) => v === 0)
                    ? <span className="text-green-700">لا توجد أحداث مستبعدة ✅</span>
                    : Object.entries(d.excluded_events).filter(([_, v]) => (v as number) > 0).map(([key, val]) => (
                        <div key={key} className="flex justify-between">
                          <span>{key}</span>
                          <span className="font-bold">{fmt(val as number)}</span>
                        </div>
                      ))}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !isRepView() && (
          <>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'المبيعات المنشأة', value: sumMembers('sales'), money: true },
                { label: 'الطلبات المنشأة', value: sumMembers('orders') },
                { label: 'الزيارات المكتملة', value: sumMembers('completed_visits') },
                { label: 'العملاء المسجلون', value: sumMembers('registered_customers') },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center shadow-sm">
                  <div className="text-lg font-bold text-gray-800">{item.money ? fmtMoney(item.value) : fmt(item.value)}</div>
                  <div className="text-[10px] text-gray-400">{item.label}</div>
                </div>
              ))}
            </div>

            {role === 'executive' && currentScope.type === 'company' && (
              <div className="text-xs text-gray-400 text-center">
                اختر مدير بيع لعرض فريقه
              </div>
            )}

            <div className="space-y-2">
              {members.filter((m: any) => m.sales > 0 || m.orders > 0 || m.completed_visits > 0 || m.registered_customers > 0)
                .map((m: any) => (
                  <button
                    key={m.employee_id}
                    onClick={() => drillToMember(m)}
                    className="w-full bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all text-right"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-800">{m.full_name}</span>
                        <span className="text-xs text-gray-400 mr-2">{m.code}</span>
                      </div>
                      <span className="text-xs text-indigo-600">عرض التفاصيل ←</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmtMoney(m.sales)}</span>
                        <div className="text-[9px] text-gray-400">مبيعات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(m.orders)}</span>
                        <div className="text-[9px] text-gray-400">طلبات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(m.completed_visits)}</span>
                        <div className="text-[9px] text-gray-400">زيارات</div>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-700">{fmt(m.registered_customers)}</span>
                        <div className="text-[9px] text-gray-400">عملاء</div>
                      </div>
                    </div>
                  </button>
                ))}
              {members.filter((m: any) => m.sales > 0 || m.orders > 0 || m.completed_visits > 0 || m.registered_customers > 0).length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات في هذه الفترة</div>
              )}
            </div>

            {role === 'executive' && currentScope.type === 'company' && members.length > 0 && (
              <div className="border-t border-gray-100 pt-4 mt-2">
                <div className="flex items-center justify-between px-2 mb-2">
                  <span className="text-xs font-semibold text-gray-500">مديري البيع</span>
                </div>
                {[...new Set(members.map((m: any) => ({ manager_id: m.employee_id })))]
                  .filter((_, i) => i < 5)
                  .map((mgr: any, i: number) => (
                    <div key={i} className="text-xs text-gray-400 py-1">
                      ملاحظة: هذه الشاشة تعرض كل الموظفين. للتصفية حسب مدير البيع، استخدم الإصدار القادم.
                    </div>
                  ))}
              </div>
            )}
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
