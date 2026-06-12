import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { BarChart3, Download, TrendingUp, TrendingDown, Users, Clock, Target, DollarSign, ShoppingCart, MapPin, Activity, Award } from 'lucide-react'
import toast from 'react-hot-toast'
import TimeRangeFilter, { type TimeRange, thisMonthRange } from '../../components/TimeRangeFilter'

interface ReportSummary {
  total_sessions: number
  total_net_hours: number
  total_visits: number
  total_orders: number
  total_sales_value: number
  total_collections: number
  total_collections_amount: number
  total_new_customers: number
  late_days: number
  early_departure_days: number
  ontime_days: number
}

interface ReportEntry {
  employee_id: string
  name: string
  code: string
  sessions: number
  net_hours: number
  total_visits: number
  total_orders: number
  total_sales_value: number
  total_collections: number
  total_collections_amount: number
  new_customers: number
  late_days: number
  early_departure_days: number
  ontime_days: number
  distance_meters?: number
  tracking_points?: number
}

interface ReportResponse {
  summary: ReportSummary
  employees: ReportEntry[]
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

const labels: Record<string, string> = {
  hours: 'ساعات العمل',
  orders: 'الطلبات',
  sales: 'المبيعات',
  collections: 'التحصيلات',
  new_customers: 'عملاء جدد',
}

type SortField = keyof ReportEntry
type SortDir = 'asc' | 'desc'

export default function ReportsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(thisMonthRange())
  const [report, setReport] = useState<ReportEntry[]>([])
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [analysis, setAnalysis] = useState<ReportEntry[]>([])
  const [targets, setTargets] = useState<Record<string, unknown> | null>(null)
  const [prevSummary, setPrevSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState<SortField>('net_hours')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const fetchReport = useCallback(async () => {
    if (!token) return
    if (!uuidRe.test(token.trim())) {
      console.error('[ReportsPage] Invalid session_token (not a UUID), clearing')
      localStorage.removeItem('session_token')
      return
    }
    setLoading(true)
    const results = await Promise.allSettled([
      supabase.rpc('get_workday_report', { p_token: token?.trim(), p_from: timeRange.from, p_to: timeRange.to, p_employee_ids: null }),
      supabase.rpc('get_attendance_analysis', { p_token: token?.trim(), p_from: timeRange.from, p_to: timeRange.to, p_employee_ids: null }),
    ])
    if (results[0].status === 'fulfilled' && results[0].value.data) {
      const d = results[0].value.data as ReportResponse
      setReport(d.employees ?? [])
      setSummary(d.summary ?? null)
    } else if (results[0].status === 'fulfilled' && results[0].value.error) {
      console.error('[ReportsPage] get_workday_report error:', JSON.stringify(results[0].value.error))
    }
    if (results[1].status === 'fulfilled' && results[1].value.data) {
      setAnalysis((results[1].value.data as { employees: ReportEntry[] }).employees ?? [])
    }
    try {
      const { data: t } = await supabase.rpc('get_daily_target_vs_actual', {
        p_token: token?.trim(),
        p_employee_id: null,
        p_date: null,
      })
      if (t && typeof t === 'object' && !('error' in (t as Record<string, unknown>))) {
        setTargets(t as Record<string, unknown>)
      }
    } catch (e) {
      console.error('[ReportsPage] get_daily_target_vs_actual error:', e)
    }

    const rangeDays = Math.round((new Date(timeRange.to).getTime() - new Date(timeRange.from).getTime()) / 86400000)
    if (rangeDays > 0) {
      const prevTo = new Date(timeRange.from)
      prevTo.setDate(prevTo.getDate() - 1)
      const prevFrom = new Date(prevTo)
      prevFrom.setDate(prevFrom.getDate() - rangeDays)
      const pf = prevFrom.toISOString().slice(0, 10)
      const pt = prevTo.toISOString().slice(0, 10)
      try {
        const { data: prev } = await supabase.rpc('get_workday_report', {
          p_token: token?.trim(), p_from: pf, p_to: pt, p_employee_ids: null,
        })
        if (prev) setPrevSummary((prev as ReportResponse).summary ?? null)
      } catch (e) {
        console.error('[ReportsPage] prev period error:', e)
      }
    }
    setLoading(false)
  }, [token, timeRange.from, timeRange.to])

  useEffect(() => { fetchReport() }, [fetchReport])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sorted = [...report].sort((a, b) => {
    const aVal = a[sortField] ?? 0
    const bVal = b[sortField] ?? 0
    return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
  })

  const best = sorted.length > 0 ? sorted[0] : null
  const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null

  const totalDistance = report.reduce((s, r) => s + (r.distance_meters ?? 0), 0)
  const avgDistance = report.length > 0 ? totalDistance / report.length : 0
  const bestDistance = report.length > 0 ? report.reduce((b, r) => ((r.distance_meters ?? 0) > (b.distance_meters ?? 0) ? r : b), report[0]) : null
  const totalPoints = report.reduce((s, r) => s + (r.tracking_points ?? 0), 0)
  const avgPoints = report.length > 0 ? totalPoints / report.length : 0
  const bestPoints = report.length > 0 ? report.reduce((b, r) => ((r.tracking_points ?? 0) > (b.tracking_points ?? 0) ? r : b), report[0]) : null

  const exportCsv = () => {
    const rows = sorted.map(r =>
      `${r.name},${r.sessions},${fmt(Math.round(r.net_hours * 60))},${r.total_visits},${r.total_orders},${r.total_sales_value},${r.total_collections},${r.total_collections_amount},${r.new_customers},${r.late_days},${r.early_departure_days},${r.ontime_days}`
    )
    const csv = 'الموظف,الأيام,صافي ساعات,الزيارات,الطلبات,قيمة المبيعات,التحصيل,قيمة التحصيل,عملاء جدد,تأخير,انصراف مبكر,مواظبة\n' + rows.join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `تقرير_الحضور_${timeRange.from}_${timeRange.to}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('تم تصدير التقرير')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-800">التقارير التشغيلية</h1>
          </div>
          <button
            onClick={exportCsv}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
            title="تصدير CSV"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>

        <TimeRangeFilter value={timeRange} onChange={setTimeRange} />

        {loading ? (
          <div className="text-center py-10">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : report.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <BarChart3 className="w-12 h-12 mx-auto mb-3" />
            لا توجد بيانات للفترة المحددة
          </div>
        ) : (
          <>
            {summary && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 mb-5">
                <h2 className="font-bold text-gray-700 mb-3">ملخص تنفيذي</h2>
                <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                  <ExecutiveCard label="أيام عمل" value={String(summary.total_sessions)} color="text-blue-600" />
                  <ExecutiveCard label="صافي ساعات" value={fmt(Math.round(summary.total_net_hours * 60))} color="text-green-600" />
                  <ExecutiveCard label="زيارات" value={String(summary.total_visits)} color="text-purple-600" />
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <ExecutiveCard label="طلبات" value={String(summary.total_orders)} color="text-orange-600" />
                  <ExecutiveCard label="مبيعات" value={fmtCurrency(summary.total_sales_value)} color="text-orange-700" />
                  <ExecutiveCard label="تحصيل" value={fmtCurrency(summary.total_collections_amount)} color="text-cyan-600" />
                  <ExecutiveCard label="عملاء جدد" value={String(summary.total_new_customers)} color="text-green-700" />
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-700 mb-3">تحليل الحضور</h2>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-green-50 rounded-lg p-2 text-center">
                  <p className="text-green-600 font-bold text-lg">{summary?.ontime_days ?? 0}</p>
                  <p className="text-[10px] text-green-500">في الموعد</p>
                </div>
                <div className="bg-red-50 rounded-lg p-2 text-center">
                  <p className="text-red-600 font-bold text-lg">{summary?.late_days ?? 0}</p>
                  <p className="text-[10px] text-red-500">متأخر</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-2 text-center">
                  <p className="text-amber-600 font-bold text-lg">{summary?.early_departure_days ?? 0}</p>
                  <p className="text-[10px] text-amber-500">انصراف مبكر</p>
                </div>
                <div className="bg-gray-100 rounded-lg p-2 text-center">
                  <p className="text-gray-600 font-bold text-lg">{summary ? Math.max(0, (summary.total_sessions || 0) - (summary.ontime_days || 0) - (summary.late_days || 0) - (summary.early_departure_days || 0)) : 0}</p>
                  <p className="text-[10px] text-gray-500">أخرى</p>
                </div>
              </div>
            </div>

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

            {prevSummary && summary && (
              <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100">
                <h2 className="font-bold text-gray-700 mb-3">
                  <Activity className="w-4 h-4 inline ml-1 text-indigo-600" />
                  مقارنة بالفترة السابقة
                </h2>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <CompareCard label="أيام عمل" current={summary.total_sessions} previous={prevSummary.total_sessions} />
                  <CompareCard label="صافي ساعات" current={Math.round(summary.total_net_hours * 60)} previous={Math.round(prevSummary.total_net_hours * 60)} />
                  <CompareCard label="طلبات" current={summary.total_orders} previous={prevSummary.total_orders} />
                  <CompareCard label="مبيعات" current={summary.total_sales_value} previous={prevSummary.total_sales_value} />
                  <CompareCard label="تحصيلات" current={summary.total_collections_amount} previous={prevSummary.total_collections_amount} />
                  <CompareCard label="عملاء جدد" current={summary.total_new_customers} previous={prevSummary.total_new_customers} />
                </div>
              </div>
            )}

            {best && worst && (
              <div className="grid grid-cols-2 gap-2 mb-5">
                <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                  <div className="flex items-center gap-1 mb-1">
                    <Award className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-bold text-green-700">أفضل أداء</span>
                  </div>
                  <p className="text-sm font-bold text-green-800">{best.name}</p>
                  <p className="text-xs text-green-600">صافي: {fmt(Math.round(best.net_hours * 60))}</p>
                  <p className="text-xs text-green-600">مبيعات: {fmtCurrency(best.total_sales_value)}</p>
                  <p className="text-xs text-green-600">طلبات: {best.total_orders}</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 border border-red-200">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-bold text-red-700">أقل أداء</span>
                  </div>
                  <p className="text-sm font-bold text-red-800">{worst.name}</p>
                  <p className="text-xs text-red-600">صافي: {fmt(Math.round(worst.net_hours * 60))}</p>
                  <p className="text-xs text-red-600">مبيعات: {fmtCurrency(worst.total_sales_value)}</p>
                  <p className="text-xs text-red-600">طلبات: {worst.total_orders}</p>
                </div>
              </div>
            )}

            {totalDistance > 0 && (
              <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100">
                <h2 className="font-bold text-gray-700 mb-3">
                  <MapPin className="w-4 h-4 inline ml-1 text-gray-500" />
                  تحليل المسافات والتتبع
                </h2>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <ExecutiveCard label="إجمالي المسافة" value={`${(totalDistance / 1000).toFixed(0)} كم`} color="text-blue-600" />
                  <ExecutiveCard label="متوسط المسافة" value={`${(avgDistance / 1000).toFixed(1)} كم`} color="text-indigo-600" />
                  <ExecutiveCard label="إجمالي النقاط" value={String(totalPoints)} color="text-purple-600" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <ExecutiveCard label="متوسط النقاط" value={avgPoints.toFixed(0)} color="text-gray-600" />
                  <ExecutiveCard label={`أعلى مسافة`} value={bestDistance ? `${(bestDistance.distance_meters! / 1000).toFixed(0)} كم` : '--'} color="text-green-600" />
                </div>
              </div>
            )}

            <h2 className="font-bold text-gray-700 mb-3">تصنيف الإنتاجية</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto mb-5">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <ThSort label="الموظف" field="name" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="ساعات" field="net_hours" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="طلبات" field="total_orders" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="مبيعات" field="total_sales_value" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="تحصيل" field="total_collections_amount" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="عملاء" field="new_customers" current={sortField} dir={sortDir} onClick={handleSort} />
                    <ThSort label="زيارات" field="total_visits" current={sortField} dir={sortDir} onClick={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.employee_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <Td className="font-bold text-gray-800">{r.name}</Td>
                      <Td>{fmt(Math.round(r.net_hours * 60))}</Td>
                      <Td>{r.total_orders}</Td>
                      <Td>{fmtCurrency(r.total_sales_value)}</Td>
                      <Td>{fmtCurrency(r.total_collections_amount)}</Td>
                      <Td>{r.new_customers}</Td>
                      <Td>{r.total_visits}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="font-bold text-gray-700 mb-3">تحليل الالتزام</h2>
            <div className="space-y-2">
              {analysis.map((a) => (
                <div key={a.employee_id} className="bg-white rounded-xl p-3 shadow-sm">
                  <span className="font-bold text-gray-800">{a.name || a.employee_name}</span>
                  <div className="grid grid-cols-3 text-xs mt-1 gap-2">
                    <div className="bg-red-50 rounded-lg p-1 text-center">
                      <span className="text-red-600 font-bold">{a.late_days ?? 0}</span>
                      <span className="text-red-500 block">تأخير</span>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-1 text-center">
                      <span className="text-amber-600 font-bold">{a.early_departure_days ?? 0}</span>
                      <span className="text-amber-500 block">انصراف مبكر</span>
                    </div>
                    <div className="bg-green-50 rounded-lg p-1 text-center">
                      <span className="text-green-600 font-bold">{a.ontime_days ?? 0}</span>
                      <span className="text-green-500 block">في الموعد</span>
                    </div>
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

function ExecutiveCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white/60 rounded-xl p-2 text-center">
      <p className={`font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}

function ThSort({ label, field, current, dir, onClick }: {
  label: string; field: SortField; current: SortField; dir: SortDir; onClick: (f: SortField) => void
}) {
  const active = current === field
  return (
    <th
      className="px-2 py-1.5 text-right whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none"
      onClick={() => onClick(field)}
    >
      {label} {active ? (dir === 'desc' ? '▼' : '▲') : '▽'}
    </th>
  )
}

function CompareCard({ label, current, previous }: { label: string; current: number; previous: number }) {
  const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0
  const up = pct >= 0
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <p className="text-gray-500 mb-1">{label}</p>
      <p className="font-bold text-gray-800">{current}</p>
      <div className="flex items-center gap-1 mt-0.5">
        {pct !== 0 && (up
          ? <TrendingUp className="w-3 h-3 text-green-600" />
          : <TrendingDown className="w-3 h-3 text-red-600" />
        )}
        <span className={`text-xs ${up ? 'text-green-600' : 'text-red-600'}`}>
          {pct > 0 ? '+' : ''}{pct}%
        </span>
      </div>
    </div>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 whitespace-nowrap ${className || ''}`}>{children}</td>
}
