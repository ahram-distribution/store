import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { Search, TrendingUp, TrendingDown, Target, ShoppingCart, DollarSign, Users, MapPin, Clock, Medal, BarChart3, ChevronDown, ChevronUp, Star } from 'lucide-react'
import TimeRangeFilter, { type TimeRange, todayRange } from '../../components/TimeRangeFilter'
import { targetService } from '../../services/targets'

interface EmpSales { total_value: number; order_count: number; avg_order_value: number }
interface EmpOrders { total: number; completed: number; cancelled: number }
interface EmpCustomers { new_count: number; total_linked: number }
interface EmpVisits { total: number; successful: number; incomplete: number; success_rate: number }
interface EmpTargets { sales_target: number; sales_actual: number; achievement_pct: number; orders_target: number; orders_actual: number }

interface EffortEmployee {
  employee_id: string; name: string; code: string; role_name: string | null
  active_days: number; total_days_in_range: number
  last_activity: string | null; status: 'active' | 'idle'
  total_minutes: number; total_distance: number
  sales: EmpSales; orders: EmpOrders; customers: EmpCustomers
  visits: EmpVisits; targets: EmpTargets; performance_score: number
}

interface EffortSummary {
  total_employees: number; total_sales: number; total_orders: number; total_visits: number
  avg_performance_score: number
  top_performer: { employee_id: string; name: string; score: number } | null
  worst_performer: { employee_id: string; name: string; score: number } | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-EG')
const fmtPct = (n: number) => n.toFixed(1)

const safeVal = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && !isNaN(v) ? v : fallback

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-green-600 bg-green-50'
    : score >= 40 ? 'text-amber-600 bg-amber-50'
    : 'text-red-600 bg-red-50'
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{fmtPct(score)}%</span>
}

function StatCell({ label, value, color = 'text-gray-800' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center min-w-[70px]">
      <p className={`text-xs font-bold ${color}`}>{value}</p>
      <p className="text-[8px] text-gray-400">{label}</p>
    </div>
  )
}

function getTargetMonth(from: string, to: string): { month: number; year: number } | null {
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return { month: f.getMonth() + 1, year: f.getFullYear() }
  }
  return null
}

export default function SalesEffortPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<EffortEmployee[]>([])
  const [summary, setSummary] = useState<EffortSummary | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>(todayRange())
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [targetMonth, setTargetMonth] = useState<{ month: number; year: number } | null>(null)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const fetchData = useCallback(async () => {
    if (!token) return

    const tm = getTargetMonth(timeRange.from, timeRange.to)
    setTargetMonth(tm)

    const { data } = await supabase.rpc('get_sales_reps_effort', {
      p_token: token.trim(),
      p_from: timeRange.from,
      p_to: timeRange.to,
      p_search: search || null,
    })

    let perfResult = null
    if (tm) {
      perfResult = await targetService.getPerformance(tm.month, tm.year)
    }

    if (data && typeof data === 'object' && !('error' in (data as Record<string, unknown>))) {
      const d = data as { employees: EffortEmployee[]; summary: EffortSummary }

      if (perfResult?.data) {
        const perf = perfResult.data as any
        const perfMap = new Map<string, any>()
        for (const emp of (perf.employees || [])) {
          perfMap.set(emp.employee_id, emp)
        }

        const mergedEmployees = (d.employees || []).map((emp) => {
          const p = perfMap.get(emp.employee_id)
          if (p) {
            return {
              ...emp,
              targets: {
                sales_target: p.sales_target || 0,
                sales_actual: p.effective_sales ?? p.gross_sales ?? 0,
                achievement_pct: p.overall_achievement_score ?? 0,
                orders_target: p.orders_target || 0,
                orders_actual: p.effective_orders ?? p.gross_orders ?? 0,
              },
              performance_score: p.overall_achievement_score ?? 0,
            }
          }
          return { ...emp, targets: { ...emp.targets, achievement_pct: 0 }, performance_score: 0 }
        })

        const best = perf.best_employee
        const weakest = perf.weakest_employee
        setSummary({
          total_employees: d.summary?.total_employees ?? 0,
          total_sales: d.summary?.total_sales ?? 0,
          total_orders: d.summary?.total_orders ?? 0,
          total_visits: d.summary?.total_visits ?? 0,
          avg_performance_score: perf.company?.overall_achievement_pct ?? 0,
          top_performer: best ? { employee_id: best.employee_id, name: best.employee_name, score: best.overall_achievement_score } : null,
          worst_performer: weakest ? { employee_id: weakest.employee_id, name: weakest.employee_name, score: weakest.overall_achievement_score } : null,
        })
        setEmployees(mergedEmployees)
      } else {
        setEmployees(d.employees ?? [])
        setSummary(d.summary ?? null)
      }
    }
    setLoading(false)
  }, [token, timeRange.from, timeRange.to, search])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => employees, [employees])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
      <div className="text-center"><p className="text-gray-400 mb-2">جاري تحميل بيانات الأداء...</p><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 p-4" dir="rtl">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-800">مجهود المناديب</h1>
          </div>
          <button onClick={fetchData} className="text-[10px] text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-100">تحديث</button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4 space-y-3">
          <TimeRangeFilter value={timeRange} onChange={setTimeRange} />
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ابحث باسم المندوب أو الكود..."
              className="w-full pr-9 pl-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
        </div>

        {/* Multi-month warning */}
        {targetMonth === null && employees.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-center">
            <p className="text-xs text-amber-700 font-semibold">بيانات الأهداف والإنجاز متاحة فقط عند اختيار شهر واحد</p>
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-blue-700">{summary.total_employees}</p>
              <p className="text-[9px] text-blue-500">إجمالي المناديب</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-emerald-700">{fmt(summary.total_sales)} ج.م</p>
              <p className="text-[9px] text-emerald-500">إجمالي المبيعات</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-purple-700">{summary.total_orders}</p>
              <p className="text-[9px] text-purple-500">إجمالي الطلبات</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-amber-700">{summary.total_visits}</p>
              <p className="text-[9px] text-amber-500">إجمالي الزيارات</p>
            </div>
          </div>
        )}

        {/* Top / Worst — based on target data (single month only) */}
        {targetMonth !== null && summary && (summary.top_performer || summary.worst_performer) && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {summary.top_performer?.name && (
              <div className="bg-gradient-to-l from-yellow-50 to-amber-50 rounded-xl p-3 flex items-center gap-2">
                <Medal className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="text-[10px]">
                  <p className="font-bold text-gray-800">{summary.top_performer.name}</p>
                  <p className="text-amber-600">الأفضل: {fmtPct(summary.top_performer.score)}%</p>
                </div>
              </div>
            )}
            {summary.worst_performer?.name && (
              <div className="bg-gradient-to-l from-red-50 to-rose-50 rounded-xl p-3 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-red-500 shrink-0" />
                <div className="text-[10px]">
                  <p className="font-bold text-gray-800">{summary.worst_performer.name}</p>
                  <p className="text-red-600">الأضعف: {fmtPct(summary.worst_performer.score)}%</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Employee List */}
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400"><p className="text-sm">لا توجد بيانات للفترة المحددة</p></div>
        ) : (
          <div className="space-y-2">
            {filtered.map(emp => {
              const isExpanded = expanded.has(emp.employee_id)
              return (
                <div key={emp.employee_id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {/* Header Row */}
                  <div className="flex items-center gap-2 p-3 cursor-pointer hover:bg-gray-50/60 transition-colors"
                    onClick={() => toggleExpand(emp.employee_id)}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${emp.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-gray-800 text-sm truncate">{emp.name}</span>
                        {targetMonth !== null && <ScoreBadge score={emp.performance_score} />}
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-gray-400 mt-0.5">
                        <span>{emp.code}</span>
                        {emp.role_name && <><span>·</span><span>{emp.role_name}</span></>}
                        <span>·</span><span>{emp.active_days}/{emp.total_days_in_range} أيام</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-left">
                        <p className="text-xs font-bold text-emerald-600">{fmt(emp.sales.total_value)} ج.م</p>
                        <p className="text-[8px] text-gray-400">{emp.sales.order_count} طلبات</p>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-300" /> : <ChevronDown className="w-4 h-4 text-gray-300" />}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-3 py-3 space-y-3">
                      {/* Quick Stats Row */}
                      <div className="flex items-center justify-around bg-gray-50 rounded-lg p-2">
                        <StatCell label="أيام نشطة" value={`${emp.active_days}/${emp.total_days_in_range}`} color="text-blue-600" />
                        <StatCell label="المسافة" value={emp.total_distance > 1000 ? `${(emp.total_distance/1000).toFixed(1)}كم` : `${emp.total_distance}م`} color="text-cyan-600" />
                        <StatCell label="آخر نشاط" value={emp.last_activity ? new Date(emp.last_activity).toLocaleDateString('ar-EG') : '--'} color="text-gray-500" />
                        <StatCell label="الحالة" value={emp.status === 'active' ? 'نشط' : 'خامل'} color={emp.status === 'active' ? 'text-green-600' : 'text-gray-400'} />
                      </div>

                      {/* KPIs Grid */}
                      <div className={`grid grid-cols-2 gap-1.5 ${targetMonth !== null ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
                        {/* Sales */}
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-500 mx-auto mb-0.5" />
                          <p className="text-xs font-bold text-emerald-700">{fmt(emp.sales.total_value)}</p>
                          <p className="text-[8px] text-emerald-500">مبيعات</p>
                          <p className="text-[8px] text-gray-400">{emp.sales.order_count} طلب · متوسط {fmt(emp.sales.avg_order_value)}</p>
                        </div>
                        {/* Orders */}
                        <div className="bg-blue-50 rounded-lg p-2 text-center">
                          <ShoppingCart className="w-3.5 h-3.5 text-blue-500 mx-auto mb-0.5" />
                          <p className="text-xs font-bold text-blue-700">{emp.orders.completed}</p>
                          <p className="text-[8px] text-blue-500">مكتمل</p>
                          {emp.orders.cancelled > 0 && <p className="text-[8px] text-red-400">+{emp.orders.cancelled} ملغي</p>}
                        </div>
                        {/* Customers */}
                        <div className="bg-purple-50 rounded-lg p-2 text-center">
                          <Users className="w-3.5 h-3.5 text-purple-500 mx-auto mb-0.5" />
                          <p className="text-xs font-bold text-purple-700">{emp.customers.new_count}</p>
                          <p className="text-[8px] text-purple-500">جدد</p>
                          <p className="text-[8px] text-gray-400">إجمالي {emp.customers.total_linked}</p>
                        </div>
                        {/* Visits */}
                        <div className="bg-amber-50 rounded-lg p-2 text-center">
                          <MapPin className="w-3.5 h-3.5 text-amber-500 mx-auto mb-0.5" />
                          <p className="text-xs font-bold text-amber-700">{emp.visits.successful}/{emp.visits.total}</p>
                          <p className="text-[8px] text-amber-500">زيارات</p>
                          <p className="text-[8px] text-gray-400">نسبة {fmtPct(emp.visits.success_rate)}%</p>
                        </div>
                        {/* Target Achievement — from unified target system (single month only) */}
                        {targetMonth !== null && (
                          <div className={`rounded-lg p-2 text-center ${emp.targets.achievement_pct >= 80 ? 'bg-green-50' : emp.targets.achievement_pct >= 50 ? 'bg-amber-50' : 'bg-red-50'}`}>
                            <Target className="w-3.5 h-3.5 mx-auto mb-0.5" />
                            <p className={`text-xs font-bold ${emp.targets.achievement_pct >= 80 ? 'text-green-700' : emp.targets.achievement_pct >= 50 ? 'text-amber-700' : 'text-red-700'}`}>{fmtPct(emp.targets.achievement_pct)}%</p>
                            <p className="text-[8px] text-gray-500">تحقيق الهدف</p>
                            <p className="text-[8px] text-gray-400">{fmt(emp.targets.sales_actual)} / {fmt(emp.targets.sales_target)}</p>
                          </div>
                        )}
                      </div>

                      {/* Progress bar — only with target data */}
                      {targetMonth !== null && (
                        <>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${
                              emp.performance_score >= 70 ? 'bg-green-500' : emp.performance_score >= 40 ? 'bg-amber-500' : 'bg-red-500'
                            }`} style={{ width: `${Math.min(emp.performance_score, 100)}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[8px] text-gray-400">
                            <span>مؤشر الأداء: {fmtPct(emp.performance_score)}%</span>
                            <button onClick={() => navigate(`/attendance/employee/${emp.employee_id}/${timeRange.from}`)}
                              className="text-blue-600 font-bold">التفاصيل الكاملة ←</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
