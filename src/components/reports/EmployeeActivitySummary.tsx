import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { KpiDrillDownModal } from '../KpiDrillDownModal'
import TrackingExplorerModal from '../TrackingExplorerModal'
import type { ActivityViewModel, DayDetailData, DayTimelineEvent, ReportPreset } from '../../types/reports'
import { computeDateRange, cairoDateComponents, toCairoDate } from '../../lib/dateRange'

function fmtTime(t?: string): string {
  if (!t) return '\u2014'
  try { return new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return t.length >= 5 ? t.slice(0, 5) : t }
}

function fmtDate(d?: string): string {
  if (!d) return ''
  try {
    const dt = new Date(d)
    const [y, m, day] = cairoDateComponents(dt)
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    return `${day} ${months[m - 1]} ${y}`
  }
  catch { return d }
}

function fmtShortDate(d?: string): string {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }) }
  catch { return d }
}

function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null) return '\u2014'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtNum(n: number | string | null | undefined): string {
  if (n == null) return '0'
  return Math.round(Number(n)).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 })
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null) return '0'
  return Math.round(Number(n)).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 })
}

function fmtDist(meters: number): string {
  if (!meters) return '0'
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${Math.round(meters)} م`
}

const timelineEventIcon: Record<string, string> = {
  start_work: '\u{1F7E2}', visit_start: '\u{1F4CD}', visit_end: '\u2705', visit: '\u{1F4CD}',
  order: '\u{1F4E6}', customer: '\u{1F464}', break_start: '\u2615', break_end: '\u2615',
  break: '\u2615', end_work: '\u{1F534}', location: '\u{1F4CD}', photo: '\u{1F4F8}',
}
const timelineEventLabel: Record<string, string> = {
  start_work: 'بدأ يوم العمل', visit_start: 'بداية زيارة', visit_end: 'نهاية زيارة',
  visit: 'زيارة', order: 'إنشاء طلب', customer: 'إضافة عميل جديد',
  break_start: 'بداية استراحة', break_end: 'نهاية استراحة',
  break: 'استراحة', end_work: 'إنهاء يوم العمل', location: 'تسجيل موقع', photo: 'صورة',
}

interface Props {
  viewModel: ActivityViewModel
  onBack: () => void
  onPeriodChange?: (preset: ReportPreset, customFrom?: string, customTo?: string) => void
  roleLabel?: string
}

export function EmployeeActivitySummary({ viewModel, onBack, onPeriodChange, roleLabel }: Props) {
  const nav = useNavigate()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayData, setDayData] = useState<DayDetailData | null>(null)
  const [dayDataLoading, setDayDataLoading] = useState(false)
  const [dd, setDd] = useState<{ open: boolean; kpiType: string; title: string; records: any[]; loading: boolean; recordType: string }>({
    open: false, kpiType: '', title: '', records: [], loading: false, recordType: '',
  })
  const [selectedEvent, setSelectedEvent] = useState<DayTimelineEvent | null>(null)
  const [showTracking, setShowTracking] = useState(false)

  const [filterPreset, setFilterPreset] = useState<ReportPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const { employee, dateFrom, dateTo, kpi, dailyRows, detailData, loadDayData, exportPdf, exportExcel } = viewModel

  useEffect(() => {
    if (!selectedDate) { setDayData(null); return }
    let cancelled = false
    setDayDataLoading(true)
    loadDayData(selectedDate).then((data) => {
      if (!cancelled) { setDayData(data); setDayDataLoading(false) }
    })
    return () => { cancelled = true }
  }, [selectedDate, loadDayData])

  const handleKpiClick = useCallback((kpiType: string) => {
    const recordTypeMap: Record<string, string> = { visits: 'visits', orders: 'orders', customers: 'customers', sales: 'orders' }
    const titleMap: Record<string, string> = { visits: 'الزيارات', orders: 'الطلبات', customers: 'العملاء الجدد', sales: 'المبيعات' }
    const recordType = recordTypeMap[kpiType] || kpiType
    const records = kpiType === 'sales' || kpiType === 'orders'
      ? detailData.orders
      : kpiType === 'visits'
        ? detailData.visits
        : detailData.customers
    setDd({ open: true, kpiType, title: titleMap[kpiType] || kpiType, records, loading: false, recordType })
  }, [detailData])

  const selectedDaySession = useMemo(() => {
    if (!selectedDate) return null
    const s = dailyRows.find((r) => r.date === selectedDate)
    if (!s) return null
    return {
      date: s.date, start_time: s.start_time, end_time: s.end_time,
      net_minutes: s.net_minutes, distance_meters: s.distance_meters, visit_count: s.visits,
    }
  }, [selectedDate, dailyRows])

  const selectedDayOrders = useMemo(() => {
    if (!selectedDate) return []
    return detailData.orders.filter((o: any) => toCairoDate(o.submitted_at) === selectedDate)
  }, [selectedDate, detailData.orders])

  const selectedDayCustomers = useMemo(() => {
    if (!selectedDate) return []
    return detailData.customers.filter((c: any) => toCairoDate(c.created_at) === selectedDate)
  }, [selectedDate, detailData.customers])

  const selectedDaySales = useMemo(
    () => selectedDayOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
    [selectedDayOrders],
  )

  const timeline = dayData?.timeline ?? null
  const mapData = dayData?.mapData ?? null

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-text-secondary text-lg">&larr;</button>
        <div>
          <h1 className="text-xl font-bold text-text">{roleLabel || 'نشاط الموظف'}</h1>
          <div className="text-sm font-semibold text-text-secondary mt-0.5">{employee.full_name}</div>
          <div className="text-[11px] text-text-secondary/70 mt-0.5">{fmtDate(dateFrom)} - {fmtDate(dateTo)}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border/60 p-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-secondary font-semibold">الفترة:</span>
        {(['today', 'yesterday', 'week', 'month', 'prev_month', 'custom'] as ReportPreset[]).map((p) => {
          const labels: Record<ReportPreset, string> = {
            today: 'اليوم', yesterday: 'أمس', week: 'الأسبوع الحالي',
            month: 'الشهر الحالي', prev_month: 'الشهر السابق', custom: 'فترة مخصصة',
          }
          return (
            <button key={p}
              onClick={() => {
                setFilterPreset(p)
                if (p !== 'custom') {
                  onPeriodChange?.(p)
                }
              }}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                filterPreset === p
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-text-secondary border-border hover:border-primary/50'
              }`}>
              {labels[p]}
            </button>
          )
        })}
        {filterPreset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="text-[11px] border border-border rounded-lg px-2 py-1 text-text" />
            <span className="text-[11px] text-text-secondary">-</span>
            <input type="date" value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="text-[11px] border border-border rounded-lg px-2 py-1 text-text" />
            <button onClick={() => { if (customFrom && customTo) onPeriodChange?.('custom', customFrom, customTo) }}
              className="text-[11px] px-2 py-1 rounded-lg bg-primary text-white font-semibold">
              تطبيق
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button onClick={() => handleKpiClick('sales')}
          className="rounded-2xl p-4 bg-gradient-to-br from-emerald-50 to-green-100/60 border border-emerald-200/40 shadow-sm text-center cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md">
          <div className="text-xl font-bold text-success">{fmtMoney(kpi.sales)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">إجمالى المبيعات</div>
        </button>
        <button onClick={() => handleKpiClick('orders')}
          className="rounded-2xl p-4 bg-gradient-to-br from-blue-50 to-indigo-100/60 border border-blue-200/40 shadow-sm text-center cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md">
          <div className="text-xl font-bold text-primary">{fmtNum(kpi.orders)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">إجمالى الطلبات</div>
        </button>
        <button onClick={() => handleKpiClick('visits')}
          className="rounded-2xl p-4 bg-gradient-to-br from-amber-50 to-yellow-100/60 border border-amber-200/40 shadow-sm text-center cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md">
          <div className="text-xl font-bold text-warning">{fmtNum(kpi.visits)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">إجمالى الزيارات</div>
        </button>
        <button onClick={() => handleKpiClick('customers')}
          className="rounded-2xl p-4 bg-gradient-to-br from-violet-50 to-purple-100/60 border border-violet-200/40 shadow-sm text-center cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md">
          <div className="text-xl font-bold text-accent">{fmtNum(kpi.customers)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">عملاء جدد</div>
        </button>
        <div className="rounded-2xl p-4 bg-white border border-border/60 shadow-sm text-center">
          <div className="text-xl font-bold text-success">{fmtHours(kpi.netMinutes)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">ساعات العمل</div>
        </div>
        <div className="rounded-2xl p-4 bg-white border border-border/60 shadow-sm text-center">
          <div className="text-xl font-bold text-warning">{fmtDist(kpi.distanceMeters)}</div>
          <div className="text-[11px] text-text-secondary mt-1 font-medium">المسافة</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={exportExcel}
          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">Excel</button>
        <button onClick={exportPdf}
          className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold">PDF</button>
      </div>

      {dailyRows.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <div className="bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border/40 bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
                  <th className="px-3 py-3 text-right font-semibold text-text-secondary whitespace-nowrap">التاريخ</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">البداية</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">النهاية</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">ساعات</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">زيارات</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">طلبات</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">المبيعات</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">عملاء جدد</th>
                  <th className="px-3 py-3 text-center font-semibold text-text-secondary whitespace-nowrap">المسافة</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r, idx) => (
                  <tr key={r.date}
                    onClick={() => setSelectedDate(r.date)}
                    className={`border-b border-border/20 cursor-pointer transition-colors hover:bg-primary/5 ${
                      selectedDate === r.date ? 'bg-primary/10' :
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface/20'
                    }`}
                  >
                    <td className="px-3 py-3 font-semibold text-text whitespace-nowrap">{fmtShortDate(r.date)}</td>
                    <td className="px-3 py-3 text-center whitespace-nowrap text-text-secondary">{r.start_time ? fmtTime(r.start_time) : '\u2014'}</td>
                    <td className="px-3 py-3 text-center whitespace-nowrap text-text-secondary">{r.end_time ? fmtTime(r.end_time) : '\u2014'}</td>
                    <td className="px-3 py-3 text-center font-bold whitespace-nowrap">
                      {fmtHours(r.net_minutes)}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">{fmtNum(r.visits)}</td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">{fmtNum(r.orders)}</td>
                    <td className="px-3 py-3 text-center text-success font-bold whitespace-nowrap">{fmtMoney(r.sales)}</td>
                    <td className="px-3 py-3 text-center text-accent font-bold whitespace-nowrap">{fmtNum(r.new_customers)}</td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">{fmtDist(r.distance_meters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedDate && dayDataLoading && (
        <div className="text-center py-4 text-text-secondary text-sm">جاري تحميل تفاصيل اليوم...</div>
      )}

      {selectedDate && !dayDataLoading && (
        <div className="bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border/30 flex items-center justify-between">
            <h3 className="text-sm font-bold text-text">تفاصيل {fmtDate(selectedDate)}</h3>
          </div>

          {selectedDaySession && (
            <div className="px-5 pt-3 pb-2 grid grid-cols-2 gap-3 text-xs text-text-secondary">
              <div>بداية: <span className="font-semibold text-primary">{fmtTime(selectedDaySession.start_time)}</span></div>
              <div>النهاية: <span className="font-semibold text-accent">{selectedDaySession.end_time ? fmtTime(selectedDaySession.end_time) : '\u2014'}</span></div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-4">
            <div className="rounded-xl p-3 bg-gradient-to-br from-emerald-50 to-green-100/60 border border-emerald-200/40 shadow-sm text-center">
              <div className="text-sm font-bold text-success">{fmtMoney(selectedDaySales)}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">المبيعات</div>
            </div>
            <div className="rounded-xl p-3 bg-gradient-to-br from-blue-50 to-indigo-100/60 border border-blue-200/40 shadow-sm text-center">
              <div className="text-sm font-bold text-primary">{selectedDayOrders.length}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">الطلبات</div>
            </div>
            <div className="rounded-xl p-3 bg-gradient-to-br from-violet-50 to-purple-100/60 border border-violet-200/40 shadow-sm text-center">
              <div className="text-sm font-bold text-accent">{selectedDayCustomers.length}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">عملاء جدد</div>
            </div>
            <div className="rounded-xl p-3 bg-gradient-to-br from-amber-50 to-yellow-100/60 border border-amber-200/40 shadow-sm text-center">
              <div className="text-sm font-bold text-warning">{selectedDaySession?.visit_count || 0}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">الزيارات</div>
            </div>
            <div className="rounded-xl p-3 bg-white border border-border/60 shadow-sm text-center">
              <div className="text-sm font-bold text-success">{selectedDaySession ? fmtHours(selectedDaySession.net_minutes) : '\u2014'}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">ساعات العمل</div>
            </div>
            <div className="rounded-xl p-3 bg-white border border-border/60 shadow-sm text-center">
              <div className="text-sm font-bold text-warning">{selectedDaySession ? fmtDist(selectedDaySession.distance_meters) : '\u2014'}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-medium">المسافة</div>
            </div>
          </div>

          {!selectedDaySession && !selectedDayOrders.length && !selectedDayCustomers.length && (
            <div className="text-center py-8 text-xs text-text-secondary">لم يتم تسجيل نشاط فى هذا اليوم</div>
          )}

          {selectedDaySession?.distance_meters ? (
            <div className="px-5 pb-3">
              <button onClick={() => setShowTracking(true)}
                className="w-full bg-primary/5 border border-primary/20 rounded-xl py-2.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors">
                عرض المسار على الخريطة
              </button>
            </div>
          ) : null}

          {timeline && timeline.events.length > 0 && (
            <div className="px-5 pb-5">
              <h4 className="text-xs font-bold text-text mb-3">تسلسل النشاط</h4>
              <div className="space-y-1">
                {timeline.events.map((ev, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedEvent(ev)}
                    className="w-full flex gap-3 pr-3 pb-2.5 pt-1.5 text-right hover:bg-surface/60 rounded-xl transition-colors group"
                  >
                    <div className="text-base mt-0.5 shrink-0">{timelineEventIcon[ev.type] || '\u{1F4CC}'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-text-secondary font-mono">{fmtTime(ev.time)}</span>
                        <span className="text-[11px] text-primary font-semibold">{timelineEventLabel[ev.type] || ev.type}</span>
                      </div>
                      <div className="text-[13px] text-text font-semibold leading-tight mt-0.5 text-right">{ev.title}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <KpiDrillDownModal
        open={dd.open}
        title={dd.title}
        recordType={dd.recordType}
        records={dd.records}
        loading={dd.loading}
        onClose={() => setDd((prev) => ({ ...prev, open: false }))}
        onRecordClick={(entityType, entityId) => {
          setDd((prev) => ({ ...prev, open: false }))
          const routes: Record<string, string> = {
            order: '/orders/', customer: '/customers/', visit: '/visits/',
          }
          const path = routes[entityType]
          if (path && entityId) nav(`${path}${entityId}`)
        }}
      />

      {selectedEvent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white rounded-xl border border-border shadow-xl w-full max-w-sm mx-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 pb-3">
              <h2 className="text-sm font-bold">تفاصيل الحدث</h2>
              <button onClick={() => setSelectedEvent(null)} className="text-text-secondary text-lg">&times;</button>
            </div>
            <div className="px-4 pb-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{timelineEventIcon[selectedEvent.type] || '\u{1F4CC}'}</span>
                <span className="text-xs font-bold text-primary">{timelineEventLabel[selectedEvent.type] || selectedEvent.type}</span>
              </div>
              <div className="bg-surface rounded-lg p-2.5 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">الوقت</span>
                  <span className="font-semibold">{fmtTime(selectedEvent.time)}</span>
                </div>
                {selectedEvent.title && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">العنوان</span>
                    <span className="font-semibold text-left">{selectedEvent.title}</span>
                  </div>
                )}
                {selectedEvent.description && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">الوصف</span>
                    <span className="font-semibold text-left">{selectedEvent.description}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showTracking && selectedDate && (
        <TrackingExplorerModal
          open={showTracking}
          onClose={() => setShowTracking(false)}
          employeeName={employee.full_name}
          employeeCode={employee.code}
          date={selectedDate}
          sessionStart={timeline?.session?.start_time}
          sessionEnd={timeline?.session?.end_time}
          timeline={timeline ?? undefined}
          mapData={mapData}
        />
      )}
    </div>
  )
}
