import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowUpDown, Clock, User } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { formatTime, formatDate } from '../../../utils/format'

type HistoryTabFilter = 'today' | 'yesterday' | 'last_7' | 'last_30' | 'custom'

interface SessionDetail {
  date: string
  start_time: string
  end_time: string | null
  net_minutes: number
  break_minutes: number
  break_count: number
  visit_count: number | null
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
  attendance_status: string | null
  late_minutes: number | null
  early_departure_minutes: number | null
  distance_meters: number
  tracking_points_count: number
}

interface EmployeeSummary {
  total_days: number
  total_net_minutes: number
  avg_net_minutes: number
  total_orders: number
  total_sales_value: number
  total_collection_count: number
  total_collection_amount: number
  total_new_customers: number
  total_visits: number
  total_distance_meters: number
  total_tracking_points: number
  late_count: number
  ontime_count: number
  early_departure_count: number
  sales_target: number | null
  visits_target: number | null
  orders_target: number | null
  collections_target: number | null
  new_customers_target: number | null
  sales_achievement_pct: number | null
  visits_achievement_pct: number | null
  orders_achievement_pct: number | null
  collections_achievement_pct: number | null
  new_customers_achievement_pct: number | null
}

interface HistoryEmployee {
  employee_id: string
  employee_name: string
  employee_code: string
  role_name: string | null
  summary: EmployeeSummary
  sessions: SessionDetail[]
}

interface HistoryTotals {
  total_employees: number
  total_days: number
  total_net_minutes: number
  total_orders: number
  total_sales: number
  total_collections: number
  total_collection_amount: number
  total_new_customers: number
  total_visits: number
}

interface HistoryPagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

type SortField = 'total_net_minutes' | 'total_sales_value' | 'total_orders' | 'total_visits' | 'total_collection_amount'

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'total_net_minutes', label: 'ساعات العمل' },
  { key: 'total_sales_value', label: 'المبيعات' },
  { key: 'total_orders', label: 'الطلبات' },
  { key: 'total_visits', label: 'الزيارات' },
  { key: 'total_collection_amount', label: 'التحصيلات' },
]

const TIME_FILTERS: { key: HistoryTabFilter; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'last_7', label: 'آخر 7 أيام' },
  { key: 'last_30', label: 'آخر 30 يوماً' },
  { key: 'custom', label: 'فترة مخصصة' },
]

function formatDuration(m?: number | null): string {
  if (m == null) return '--'
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function safeNum(v: unknown): number {
  return (typeof v === 'number' && !isNaN(v)) ? v : 0
}

function getDateRange(filter: HistoryTabFilter, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  switch (filter) {
    case 'today': return { from: today, to: today }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { from: y.toISOString().slice(0, 10), to: y.toISOString().slice(0, 10) }
    }
    case 'last_7': {
      const d = new Date(now)
      d.setDate(d.getDate() - 6)
      return { from: d.toISOString().slice(0, 10), to: today }
    }
    case 'last_30': {
      const d = new Date(now)
      d.setDate(d.getDate() - 29)
      return { from: d.toISOString().slice(0, 10), to: today }
    }
    case 'custom':
      return { from: customFrom || today, to: customTo || today }
    default: return { from: today, to: today }
  }
}

function AchievementBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[10px] text-gray-400">--</span>
  const color = pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-blue-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'
  return <span className={`text-[10px] font-bold ${color}`}>{pct.toFixed(0)}%</span>
}

function TargetRow({ label, actual, target, achievement, currency }: {
  label: string
  actual: number
  target: number | null
  achievement: number | null
  currency?: boolean
}) {
  const fmt = (v: number) => currency ? v.toLocaleString('en-EG') + ' ج.م' : v.toLocaleString('en-EG')
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-gray-700">{fmt(actual)}</span>
        <span className="text-[10px] text-gray-400">/ {target != null ? fmt(target) : '--'}</span>
        <AchievementBadge pct={achievement} />
      </div>
    </div>
  )
}

function AttendanceLabel({ status }: { status: string | null }) {
  if (!status) return <span className="text-[10px] text-gray-400">--</span>
  switch (status) {
    case 'ontime': return <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">ملتزم</span>
    case 'late': return <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">متأخر ({safeNum(status)})</span>
    case 'early_departure': return <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">انصراف مبكر</span>
    default: return <span className="text-[10px] text-gray-400">{status}</span>
  }
}

export default function HistoricalPerformancePanel() {
  const navigate = useNavigate()
  const [timeFilter, setTimeFilter] = useState<HistoryTabFilter>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('total_net_minutes')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [perPage] = useState(10)
  const [data, setData] = useState<{
    employees: HistoryEmployee[]
    totals: HistoryTotals
    pagination: HistoryPagination
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  const dateRange = useMemo(() => getDateRange(timeFilter, customFrom || undefined, customTo || undefined), [timeFilter, customFrom, customTo])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
    setPage(1)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('session_token')
      if (!token) return
      const { data: result, error } = await supabase.rpc('get_completed_workdays_history', {
        p_token: token,
        p_from: dateRange.from,
        p_to: dateRange.to,
        p_search: searchQuery || null,
        p_sort_by: sortField,
        p_sort_order: sortOrder,
        p_page: page,
        p_per_page: perPage,
      })
      if (error) throw error
      if (result && typeof result === 'object' && !('error' in (result as Record<string, unknown>))) {
        const r = result as Record<string, unknown>
        const employeesRaw = (r.employees || []) as Record<string, unknown>[]
        const employees = employeesRaw.map((emp: Record<string, unknown>) => ({
          employee_id: emp.employee_id as string,
          employee_name: emp.employee_name as string,
          employee_code: emp.employee_code as string,
          role_name: emp.role_name as string | null,
          summary: emp.summary as EmployeeSummary,
          sessions: (emp.sessions || []) as SessionDetail[],
        }))
        setData({
          employees,
          totals: r.totals as HistoryTotals,
          pagination: r.pagination as HistoryPagination,
        })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [dateRange.from, dateRange.to, searchQuery, sortField, sortOrder, page, perPage])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [timeFilter, searchQuery, sortField, sortOrder])

  const hideCarrot = (v: unknown): string => v != null ? String(v) : '--'

  return (
    <div>
      {/* Time filter */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto">
        {TIME_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTimeFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              timeFilter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Custom range */}
      {timeFilter === 'custom' && (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 flex-1"
          />
          <span className="text-xs text-gray-400">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 flex-1"
          />
        </div>
      )}

      {/* Search + sort bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="ابحث باسم موظف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl pr-8 pl-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-blue-300"
          />
        </div>

        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => toggleSort(opt.key)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
              sortField === opt.key
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            <ArrowUpDown className="w-3 h-3" />
            {opt.label}
            {sortField === opt.key && (
              <span className="text-[10px]">{sortOrder === 'desc' ? '▼' : '▲'}</span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-10">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-400">جاري تحميل الأداء التاريخي...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && data && data.employees.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <User className="w-12 h-12 mx-auto mb-3" />
          <p className="text-sm">لا توجد بيانات أداء تاريخية للفترة المحددة</p>
        </div>
      )}

      {/* Employee cards */}
      {!loading && data && data.employees.length > 0 && (
        <>
          {/* Grand totals */}
          {data.totals && (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-3">
              {[
                { label: 'الأيام', value: data.totals.total_days },
                { label: 'صافي ساعات', value: formatDuration(data.totals.total_net_minutes) },
                { label: 'الطلبات', value: data.totals.total_orders },
                { label: 'المبيعات', value: (data.totals.total_sales ?? 0).toLocaleString('en-EG') + ' ج.م' },
                { label: 'التحصيلات', value: (data.totals.total_collection_amount ?? 0).toLocaleString('en-EG') + ' ج.م' },
                { label: 'عملاء مسجلون', value: data.totals.total_new_customers },
                { label: 'الزيارات', value: data.totals.total_visits },
                { label: 'الموظفون', value: data.totals.total_employees },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-lg border border-gray-100 p-2 text-center">
                  <p className="text-[10px] text-gray-400">{item.label}</p>
                  <p className="text-xs font-bold text-gray-800 mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Employee cards */}
          <div className="space-y-3">
            {data.employees.map((emp) => (
              <div key={emp.employee_id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Header row */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedEmployee(expandedEmployee === emp.employee_id ? null : emp.employee_id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-gray-800">{emp.employee_name}</span>
                    {emp.role_name && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{emp.role_name}</span>
                    )}
                    <span className="text-[10px] text-gray-400 font-mono">{emp.employee_code}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-500">
                      {emp.summary.total_days} يوم · {formatDuration(emp.summary.total_net_minutes)}
                    </span>
                    {expandedEmployee === emp.employee_id ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {expandedEmployee === emp.employee_id && (
                  <div className="border-t border-gray-100">
                    {/* KPI grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-gray-100">
                      {[
                        { label: 'صافي ساعات', value: formatDuration(emp.summary.total_net_minutes), sub: `معدل ${formatDuration(emp.summary.avg_net_minutes)}` },
                        { label: 'أيام عمل', value: emp.summary.total_days, sub: null },
                        { label: 'الطلبات', value: emp.summary.total_orders, sub: null },
                        { label: 'المبيعات', value: (emp.summary.total_sales_value ?? 0).toLocaleString('en-EG') + ' ج.م', sub: null },
                        { label: 'التحصيلات', value: (emp.summary.total_collection_amount ?? 0).toLocaleString('en-EG') + ' ج.م', sub: emp.summary.total_collection_count + ' عملية' },
                        { label: 'عملاء مسجلون', value: emp.summary.total_new_customers, sub: null },
                        { label: 'الزيارات', value: emp.summary.total_visits, sub: null },
                        { label: 'مسافة', value: (emp.summary.total_distance_meters ?? 0) >= 1000 ? ((emp.summary.total_distance_meters ?? 0) / 1000).toFixed(1) + ' كم' : (emp.summary.total_distance_meters ?? 0) + ' م', sub: null },
                        { label: 'نقاط تتبع', value: emp.summary.total_tracking_points, sub: null },
                        { label: 'الالتزام', value: emp.summary.ontime_count + ' ملتزم', sub: emp.summary.late_count > 0 ? emp.summary.late_count + ' متأخر' : null },
                      ].map((item) => (
                        <div key={item.label} className="bg-white p-2">
                          <p className="text-[10px] text-gray-400">{item.label}</p>
                          <p className="text-xs font-bold text-gray-800 mt-0.5">{item.value}</p>
                          {item.sub && <p className="text-[9px] text-gray-400">{item.sub}</p>}
                        </div>
                      ))}
                    </div>

                    {/* Targets */}
                    <div className="p-3 bg-blue-50/30">
                      <p className="text-[10px] font-bold text-gray-500 mb-1">الأهداف وتحقيقها</p>
                      <TargetRow label="المبيعات" actual={emp.summary.total_sales_value} target={emp.summary.sales_target} achievement={emp.summary.sales_achievement_pct} currency />
                      <TargetRow label="الطلبات" actual={emp.summary.total_orders} target={emp.summary.orders_target} achievement={emp.summary.orders_achievement_pct} />
                      <TargetRow label="الزيارات" actual={emp.summary.total_visits} target={emp.summary.visits_target} achievement={emp.summary.visits_achievement_pct} />
                      <TargetRow label="التحصيلات" actual={emp.summary.total_collection_amount} target={emp.summary.collections_target} achievement={emp.summary.collections_achievement_pct} currency />
                      <TargetRow label="عملاء مسجلون" actual={emp.summary.total_new_customers} target={emp.summary.new_customers_target} achievement={emp.summary.new_customers_achievement_pct} />
                    </div>

                    {/* Sessions table */}
                    {emp.sessions.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500">
                              <th className="text-right px-2 py-1.5 font-medium">التاريخ</th>
                              <th className="text-right px-2 py-1.5 font-medium">البداية</th>
                              <th className="text-right px-2 py-1.5 font-medium">النهاية</th>
                              <th className="text-right px-2 py-1.5 font-medium">صافي</th>
                              <th className="text-right px-2 py-1.5 font-medium">استراحة</th>
                              <th className="text-right px-2 py-1.5 font-medium">زيارات</th>
                              <th className="text-right px-2 py-1.5 font-medium">طلبات</th>
                              <th className="text-right px-2 py-1.5 font-medium">مبيعات</th>
                              <th className="text-right px-2 py-1.5 font-medium">تحصيلات</th>
                              <th className="text-right px-2 py-1.5 font-medium">مسجل</th>
                              <th className="text-right px-2 py-1.5 font-medium">المسافة</th>
                              <th className="text-right px-2 py-1.5 font-medium">نقاط</th>
                              <th className="text-right px-2 py-1.5 font-medium">الحالة</th>
                              <th className="text-center px-2 py-1.5 font-medium"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {emp.sessions.map((s) => (
                              <tr key={s.date} className="border-t border-gray-50 hover:bg-gray-50">
                                <td className="px-2 py-1.5 text-gray-700">{formatDate(s.date)}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.start_time ? formatTime(s.start_time) : '--'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.end_time ? formatTime(s.end_time) : '--'}</td>
                                <td className="px-2 py-1.5 font-bold text-gray-700">{formatDuration(s.net_minutes)}</td>
                                <td className="px-2 py-1.5 text-gray-500">{formatDuration(s.break_minutes)}</td>
                                <td className="px-2 py-1.5 text-gray-700">{safeNum(s.visit_count)}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.order_count}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.sales_value.toLocaleString('en-EG')}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.collection_amount.toLocaleString('en-EG')}</td>
                                <td className="px-2 py-1.5 text-gray-700">{s.new_customer_count}</td>
                                <td className="px-2 py-1.5 text-gray-500">{s.distance_meters >= 1000 ? (s.distance_meters / 1000).toFixed(1) + ' كم' : s.distance_meters + ' م'}</td>
                                <td className="px-2 py-1.5 text-gray-500">{s.tracking_points_count}</td>
                                <td className="px-2 py-1.5">
                                  {s.attendance_status === 'late' ? (
                                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                      متأخر {s.late_minutes != null ? `(${s.late_minutes}د)` : ''}
                                    </span>
                                  ) : s.attendance_status === 'ontime' ? (
                                    <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">ملتزم</span>
                                  ) : s.attendance_status === 'early_departure' ? (
                                    <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                                      مبكر {s.early_departure_minutes != null ? `(${s.early_departure_minutes}د)` : ''}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-gray-400">--</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <button
                                    onClick={() => navigate(`/attendance/employee/${emp.employee_id}/${s.date}`)}
                                    className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 font-bold"
                                  >
                                    عرض
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {data.pagination && data.pagination.total_pages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg bg-white border border-gray-200 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
              {Array.from({ length: data.pagination.total_pages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === data.pagination.total_pages || Math.abs(p - page) <= 2)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400 text-xs">...</span>}
                    <button
                      onClick={() => setPage(p)}
                      className={`min-w-[28px] h-7 rounded-lg text-xs font-bold ${
                        page === p
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 border border-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                onClick={() => setPage((p) => Math.min(data.pagination.total_pages, p + 1))}
                disabled={page >= data.pagination.total_pages}
                className="p-1.5 rounded-lg bg-white border border-gray-200 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
