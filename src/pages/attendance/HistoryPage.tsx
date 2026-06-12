import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { History, Clock, Coffee, TrendingUp, TrendingDown, Target, DollarSign, ShoppingCart, Users, MapPin, Activity } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import TimeRangeFilter, { type TimeRange, last30Range } from '../../components/TimeRangeFilter'

interface SessionDetail {
  id: string
  date: string
  start_time: string
  end_time?: string
  status: string
  duration_minutes: number
  break_minutes: number
  net_minutes: number
  break_count: number
  visit_count: number
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
  distance_meters: number
  tracking_points_count: number
  attendance_status?: string
  late_minutes?: number
  early_departure_minutes?: number
}

interface HistorySummary {
  total_days: number
  total_duration_minutes: number
  total_break_minutes: number
  total_net_minutes: number
  avg_net_minutes: number
  max_net_day: number
  min_net_day: number
  total_sales_value: number
  total_orders: number
  total_visits: number
  total_collections: number
  total_collections_amount: number
  total_new_customers: number
  total_distance_meters: number
  total_tracking_points: number
  late_days: number
  early_departure_days: number
  ontime_days: number
  absent_days: number
}

function fmt(minutes: number): string {
  if (!minutes || isNaN(minutes)) return '--:--'
  const h = Math.floor(Math.abs(minutes))
  const m = Math.round(Math.abs(minutes) % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function fmtCurrency(v: number): string {
  return (v ?? 0).toLocaleString('ar-EG')
}

function fmtDate(d: string): string {
  if (!d) return '--'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
}

const labels: Record<string, string> = {
  hours: 'ساعات العمل',
  orders: 'الطلبات',
  sales: 'المبيعات',
  collections: 'التحصيلات',
  new_customers: 'عملاء جدد',
}

const statusBadge = (status?: string) => {
  switch (status) {
    case 'late': return <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">متأخر</span>
    case 'early_departure': return <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">انصراف مبكر</span>
    case 'late_and_early': return <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">متأخر ومنصرف مبكر</span>
    case 'compliant': return <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">ملتزم</span>
    case 'absent': return <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">غائب</span>
    default: return null
  }
}

export default function HistoryPage() {
  const [searchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const urlEmployeeId = searchParams.get('employee')
  const initialEmployeeId = urlEmployeeId ?? user?.employee_id ?? ''
  const [employeeId, setEmployeeId] = useState(initialEmployeeId)
  const [employeeName, setEmployeeName] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [employeeRole, setEmployeeRole] = useState('')
  const [employeeWorkLocation, setEmployeeWorkLocation] = useState('')
  const [employeeScheduleType, setEmployeeScheduleType] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; full_name: string; code: string }[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [sessions, setSessions] = useState<SessionDetail[]>([])
  const [summary, setSummary] = useState<HistorySummary | null>(null)
  const [targets, setTargets] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>(last30Range())
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const tokenRaw = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  const token = tokenRaw && uuidRe.test(tokenRaw.trim()) ? tokenRaw.trim() : null

  const fetchEmployeeInfo = useCallback(async (empId: string) => {
    if (!token || !empId) return
    try {
      const { data } = await supabase.rpc('get_governed_employee', {
        p_token: token,
        p_employee_id: empId,
      })
      if (data && typeof data === 'object' && !('error' in (data as Record<string, unknown>))) {
        setEmployeeName((data as Record<string, unknown>).full_name as string || '')
        setEmployeeCode((data as Record<string, unknown>).code as string || '')
      }
      const { data: policy } = await supabase.rpc('get_employee_work_policy', {
        p_token: token,
        p_employee_id: empId,
      })
      if (policy && typeof policy === 'object') {
        const p = policy as Record<string, unknown>
        const locMap: Record<string, string> = { field: 'ميداني', office: 'مكتبي' }
        const schedMap: Record<string, string> = { fixed_shift: 'دوام ثابت', flexible: 'دوام مرن', hourly: 'بالساعة' }
        setEmployeeWorkLocation(locMap[p.work_location as string] || (p.work_location as string) || '')
        setEmployeeScheduleType(schedMap[p.schedule_type as string] || (p.schedule_type as string) || '')
      }
    } catch (e) {
      console.error('[HistoryPage] fetchEmployeeInfo error:', e)
    }
  }, [token])

  const fetchHistory = useCallback(async () => {
    if (!token || !employeeId) return
    setLoading(true)
    const { data } = await supabase.rpc('get_employee_workday_history', {
      p_token: token,
      p_employee_id: employeeId,
      p_from: timeRange.from,
      p_to: timeRange.to,
    })
    if (data && !data.error) {
      setSessions((data as { sessions: SessionDetail[] }).sessions ?? [])
      setSummary((data as { summary: HistorySummary }).summary ?? null)
    } else {
      setSessions([])
      setSummary(null)
    }
    try {
      const { data: t, error: te } = await supabase.rpc('get_daily_target_vs_actual', {
        p_token: token,
        p_employee_id: employeeId,
        p_date: null,
      })
      if (t && typeof t === 'object' && !('error' in (t as Record<string, unknown>))) {
        setTargets(t as Record<string, unknown>)
      } else if (te) {
        console.error('[HistoryPage] get_daily_target_vs_actual error:', JSON.stringify(te))
      }
    } catch (e) {
      console.error('[HistoryPage] get_daily_target_vs_actual exception:', e)
    }
    setLoading(false)
  }, [token, employeeId, timeRange.from, timeRange.to])

  useEffect(() => {
    if (employeeId) {
      fetchHistory()
      fetchEmployeeInfo(employeeId)
    }
  }, [employeeId, fetchHistory, fetchEmployeeInfo])

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q)
    if (!token || q.length < 2) { setSearchResults([]); setShowSearch(false); return }
    try {
      const { data } = await supabase.rpc('get_governed_employees', {
        p_token: token,
      })
      const employees = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : [])
      const lower = q.toLowerCase()
      const filtered = (employees as Array<Record<string, unknown>>).filter((e) =>
        ((e.full_name as string) || '').toLowerCase().includes(lower) ||
        ((e.code as string) || '').toLowerCase().includes(lower)
      ).slice(0, 10).map((e) => ({ id: e.id, full_name: e.full_name, code: e.code }))
      setSearchResults(filtered)
      setShowSearch(true)
    } catch (e) {
      console.error('[HistoryPage] handleSearch error:', e)
    }
  }, [token])

  const selectEmployee = (id: string, name: string) => {
    setEmployeeId(id)
    setEmployeeName(name)
    setSearchQuery('')
    setShowSearch(false)
    setSearchResults([])
  }

  const bestDay = sessions.length > 0
    ? sessions.reduce((best, s) => (s.net_minutes > (best?.net_minutes ?? 0) ? s : best), sessions[0])
    : null

  const worstDay = sessions.length > 0
    ? sessions.reduce((worst, s) => (s.net_minutes < (worst?.net_minutes ?? Infinity) ? s : worst), sessions[0])
    : null

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <History className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">سجل حضور الموظف</h1>
        </div>

        <div className="space-y-3 mb-5">
          <TimeRangeFilter value={timeRange} onChange={setTimeRange} />

          <div className="relative">
            <label className="block text-xs text-gray-500 mb-1">بحث عن موظف</label>
            <input
              type="text"
              value={searchQuery || employeeName}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearch(true)}
              placeholder="ابحث بالاسم أو الكود"
              className="w-full p-3 border border-gray-200 rounded-xl"
            />
            {showSearch && searchResults.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-lg">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectEmployee(r.id, r.full_name)}
                    className="w-full text-right p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    <span className="font-bold text-gray-800">{r.full_name}</span>
                    <span className="text-xs text-gray-400 mr-2">{r.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {employeeName && (
            <div className="bg-white rounded-xl p-3 border border-gray-200">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-bold text-gray-800">{employeeName}</span>
                  {employeeCode && <span className="text-xs text-gray-400 mr-2">({employeeCode})</span>}
                </div>
              </div>
              <div className="flex gap-3 text-xs text-gray-500 mt-1">
                {employeeRole && <span>{employeeRole}</span>}
                {employeeWorkLocation && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{employeeWorkLocation}</span>}
                {employeeScheduleType && <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded">{employeeScheduleType}</span>}
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-10">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : !employeeId ? (
          <div className="text-center py-10 text-gray-400">
            <Users className="w-12 h-12 mx-auto mb-3" />
            اختر موظفاً لعرض سجل الحضور
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <History className="w-12 h-12 mx-auto mb-3" />
            لا توجد سجلات للفترة المحددة
          </div>
        ) : (
          <>
            {summary && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 mb-5">
                <h2 className="font-bold text-gray-700 mb-3">ملخص الفترة</h2>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <Card label="ساعات" value={fmt(summary.total_duration_minutes)} color="text-blue-600" />
                  <Card label="صافي" value={fmt(summary.total_net_minutes)} color="text-green-600" />
                  <Card label="استراحة" value={fmt(summary.total_break_minutes)} color="text-amber-600" />
                  <Card label="أيام" value={String(summary.total_days)} color="text-purple-600" />
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Card label="طلبات" value={String(summary.total_orders)} color="text-orange-600" />
                  <Card label="مبيعات" value={fmtCurrency(summary.total_sales_value)} color="text-orange-700" />
                  <Card label="تحصيل" value={fmtCurrency(summary.total_collections_amount)} color="text-cyan-600" />
                  <Card label="عملاء" value={String(summary.total_new_customers)} color="text-green-700" />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <Card label="متوسط يومي" value={fmt(summary.avg_net_minutes)} color="text-indigo-600" />
                  <Card label="مسافة" value={`${(summary.total_distance_meters / 1000).toFixed(1)} كم`} color="text-gray-600" />
                </div>
              </div>
            )}

            {bestDay && worstDay && (
              <div className="grid grid-cols-2 gap-2 mb-5">
                <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-bold text-green-700">أفضل يوم</span>
                  </div>
                  <p className="text-sm font-bold text-green-800">{fmtDate(bestDay.date)}</p>
                  <p className="text-xs text-green-600">صافي: {fmt(bestDay.net_minutes)}</p>
                  <p className="text-xs text-green-600">مبيعات: {fmtCurrency(bestDay.sales_value)}</p>
                  <p className="text-xs text-green-600">طلبات: {bestDay.order_count}</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-bold text-red-700">أسوأ يوم</span>
                  </div>
                  <p className="text-sm font-bold text-red-800">{fmtDate(worstDay.date)}</p>
                  <p className="text-xs text-red-600">صافي: {fmt(worstDay.net_minutes)}</p>
                  <p className="text-xs text-red-600">مبيعات: {fmtCurrency(worstDay.sales_value)}</p>
                  <p className="text-xs text-red-600">طلبات: {worstDay.order_count}</p>
                </div>
              </div>
            )}

            {targets && (
              <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100">
                <h2 className="font-bold text-gray-700 mb-3">
                  <Target className="w-4 h-4 inline ml-1 text-blue-600" />
                  الأداء مقابل الهدف
                </h2>
                <div className="space-y-2">
                  {['hours', 'orders', 'sales', 'collections', 'new_customers'].map((k) => {
                    const target = (targets as any)[`${k}_target`]
                    const actual = (targets as any)[`${k}_actual`]
                    if (target == null || actual == null) return null
                    const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
                    const gap = Math.max(0, target - actual)
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">{labels[k as keyof typeof labels]}</span>
                          <span className="text-gray-800 font-bold">{pct}%</span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                          <span>المنفذ: {typeof actual === 'number' ? fmtCurrency(actual) : actual}</span>
                          <span>المتبقي: {typeof gap === 'number' ? fmtCurrency(gap) : gap}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {sessions.length >= 3 && (
              <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100">
                <h2 className="font-bold text-gray-700 mb-3">
                  <Activity className="w-4 h-4 inline ml-1 text-indigo-600" />
                  اتجاه الإنتاجية
                </h2>
                <div className="space-y-1">
                  {sessions.slice(0, 14).reverse().map((s) => {
                    const barPct = summary?.max_net_day ? Math.min(100, Math.round((s.net_minutes / Math.max(summary.max_net_day, 1)) * 100)) : 0
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-500 w-10 text-left">{fmtDate(s.date)}</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barPct > 70 ? 'bg-green-400' : barPct > 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="text-gray-600 w-12 text-left">{fmt(s.net_minutes)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-2">
                  <span>الأقدم</span>
                  <span>الأحدث</span>
                </div>
              </div>
            )}

            <h2 className="font-bold text-gray-700 mb-3">دفتر ساعات العمل</h2>
            <div className="overflow-x-auto mb-5">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <Th>التاريخ</Th>
                    <Th>البداية</Th>
                    <Th>النهاية</Th>
                    <Th>المدة</Th>
                    <Th>استراحة</Th>
                    <Th>صافي</Th>
                    <Th>طلبات</Th>
                    <Th>مبيعات</Th>
                    <Th>تحصيل</Th>
                    <Th>عملاء</Th>
                    <Th>مسافة</Th>
                    <Th>نقاط</Th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <Td>{fmtDate(s.date)}</Td>
                      <Td>{s.start_time ? new Date(s.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</Td>
                      <Td>{s.end_time ? new Date(s.end_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</Td>
                      <Td>{fmt(s.duration_minutes)}</Td>
                      <Td>{fmt(s.break_minutes)}</Td>
                      <Td className="text-green-600 font-bold">{fmt(s.net_minutes)}</Td>
                      <Td>{s.order_count}</Td>
                      <Td>{fmtCurrency(s.sales_value)}</Td>
                      <Td>{fmtCurrency(s.collection_amount)}</Td>
                      <Td>{s.new_customer_count}</Td>
                      <Td>{(s.distance_meters / 1000).toFixed(1)}</Td>
                      <Td>{s.tracking_points_count}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="font-bold text-gray-700 mb-3">إنتاجية اليوم</h2>
            <div className="space-y-2 mb-6">
              {sessions.map((s) => (
                <div key={`prod-${s.id}`} className="bg-white rounded-xl p-3 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-800">{fmtDate(s.date)}</span>
                    {statusBadge(s.attendance_status)}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-orange-50 rounded-lg p-2 text-center">
                      <ShoppingCart className="w-3 h-3 inline ml-1 text-orange-600" />
                      <span className="text-orange-600 font-bold">{s.order_count}</span>
                      <span className="text-orange-500 block">طلبات</span>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2 text-center">
                      <DollarSign className="w-3 h-3 inline ml-1 text-orange-700" />
                      <span className="text-orange-700 font-bold">{fmtCurrency(s.sales_value)}</span>
                      <span className="text-orange-500 block">مبيعات</span>
                    </div>
                    <div className="bg-cyan-50 rounded-lg p-2 text-center">
                      <DollarSign className="w-3 h-3 inline ml-1 text-cyan-600" />
                      <span className="text-cyan-600 font-bold">{fmtCurrency(s.collection_amount)}</span>
                      <span className="text-cyan-500 block">تحصيلات</span>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2 text-center">
                      <Users className="w-3 h-3 inline ml-1 text-green-600" />
                      <span className="text-green-600 font-bold">{s.new_customer_count}</span>
                      <span className="text-green-500 block">عملاء جدد</span>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs mt-2 text-gray-400">
                    <span><MapPin className="w-3 h-3 inline ml-1" />{(s.distance_meters / 1000).toFixed(1)} كم</span>
                    <span><Activity className="w-3 h-3 inline ml-1" />{s.tracking_points_count} نقطة</span>
                    <span><Target className="w-3 h-3 inline ml-1" />{s.visit_count} زيارة</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white/60 rounded-xl p-2 text-center">
      <p className={`font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1.5 text-right whitespace-nowrap">{children}</th>
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 whitespace-nowrap ${className || ''}`}>{children}</td>
}
