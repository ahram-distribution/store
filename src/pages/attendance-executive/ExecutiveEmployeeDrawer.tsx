import { useEffect, useMemo, useState } from 'react'
import type { ExecDayDetail, ExecEmployeeRow, ExecTimeline, ExecTrackingPoint } from '../../types/executiveFollowup'
import { executiveService, exportExecutiveExcel, exportExecutivePdf } from '../../services/executiveFollowup'
import {
  ATTENDANCE_LABELS, CLOSE_REASON_LABELS, CONNECTION_LABELS,
  fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtNum, fmtTime,
} from './executiveFormat'
import { ExecutiveMap } from './ExecutiveMapView'
import { cairoDateComponents } from '../../lib/dateRange'

const TAB_LABELS = ['نظرة عامة', 'الخط الزمني', 'الموقع', 'الزيارات والطلبات']

function todayOrFrom(from: string, to: string): string {
  const [y, m, d] = cairoDateComponents(new Date())
  const t = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (from <= t && t <= to) return t
  return to
}

export function ExecutiveEmployeeDrawer({
  employee, from, to, liveMode, onClose,
}: {
  employee: ExecEmployeeRow
  from: string
  to: string
  liveMode: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState(0)
  const [date, setDate] = useState(() => todayOrFrom(from, to))
  const [detail, setDetail] = useState<ExecDayDetail | null>(null)
  const [timeline, setTimeline] = useState<ExecTimeline | null>(null)
  const [trackingPoints, setTrackingPoints] = useState<ExecTrackingPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    let dead = false
    Promise.all([
      executiveService.getDayDetail(employee.employee_id, date).catch((e) => { if (!dead) setErr((String(e?.message || e))); return null }),
      executiveService.getTimeline(employee.employee_id, date).catch(() => null),
      executiveService.getTrackingPoints(employee.employee_id, date).catch(() => null),
    ]).then(([d, tl, points]) => {
      if (dead) return
      setDetail(d)
      setTimeline(tl)
      setTrackingPoints(points?.points || [])
      setLoading(false)
    })
    return () => { dead = true }
  }, [employee.employee_id, date])

  const mapMarkers = useMemo(() => {
    const markers: Array<{ id: string; latitude: number; longitude: number; label: string; sub?: string; color?: string }> = []
    for (const point of trackingPoints) {
      markers.push({
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        label: point.event_name ? `${point.event_label}: ${point.event_name}` : point.event_label,
        sub: `${fmtDateTime(point.recorded_at)}${point.accuracy_meters != null ? ` - دقة ${fmtNum(point.accuracy_meters)} م` : ''}`,
        color: '#64748b',
      })
    }
    if (timeline?.events) {
      for (const ev of timeline.events) {
        if (ev.latitude != null && ev.longitude != null) {
          const color = ev.type === 'tracking' ? '#64748b' : ev.type.startsWith('visit') ? '#2563eb' : ev.type === 'order' ? '#059669' : ev.type === 'collection' ? '#7c3aed' : '#f59e0b'
          markers.push({ id: `${ev.type}-${ev.t}`, latitude: ev.latitude, longitude: ev.longitude, label: ev.label, sub: ev.t ? fmtDateTime(ev.t) : undefined, color })
        }
      }
    }
    if (!markers.length && detail?.day_location && detail.day_location.has_location && detail.day_location.latitude != null && detail.day_location.longitude != null) {
      markers.push({ id: 'day-loc', latitude: detail.day_location.latitude, longitude: detail.day_location.longitude, label: 'موقع اليوم', color: '#2563eb' })
    }
    return markers
  }, [timeline, detail, trackingPoints])

  const live = employee.live
  const per = employee.period

  const exportEmployee = (format: 'excel' | 'pdf') => {
    const args = {
      presetLabel: 'تقرير موظف',
      from,
      to,
      filters: [`الموظف: ${employee.name}`, `الفترة: ${from} إلى ${to}`],
      employees: [employee],
      policy: detail?.policy || null,
    }
    if (format === 'excel') exportExecutiveExcel(args)
    else exportExecutivePdf(args)
  }

  return (
    <div className="max-w-6xl mx-auto min-h-full bg-white" dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-l from-blue-900 to-indigo-800 px-5 py-4 sticky top-0 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center text-sm font-bold">{employee.name.trim().charAt(0)}</div>
                <div>
                  <div className="text-white font-bold text-sm">{employee.name}</div>
                  <div className="text-blue-100 text-[10px]">{employee.code || ''} — {employee.role_name || '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-blue-100">
                <span>{liveMode && live ? `الحالة: ${live.status || '—'}` : `أيام عمل: ${fmtNum(per.worked_days)}`}</span>
                <span>•</span>
                <span>{employee.work_location || '—'}</span>
                <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${employee.policy?.show_in_screen !== false ? 'bg-emerald-500/20 border-emerald-300 text-emerald-100' : 'bg-red-500/20 border-red-300 text-red-100'}`}>
                  {employee.policy?.show_in_screen !== false ? 'نطاق: مشمول' : 'نطاق: غير مشمول'}
                </span>
                <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${employee.policy?.schedule_type === 'flexible' ? 'bg-amber-500/20 border-amber-300 text-amber-100' : 'bg-violet-500/20 border-violet-300 text-violet-100'}`}>
                  {employee.policy?.schedule_type === 'flexible' ? 'ميداني' : 'مكتبي'}
                </span>
                {!employee.is_active && <span className="px-1.5 py-0.5 rounded-full bg-red-600/80 text-white">غير نشط</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => exportEmployee('excel')} className="text-[10px] font-bold text-white border border-white/30 rounded-md px-2 py-1 hover:bg-white/10">Excel</button>
              <button onClick={() => exportEmployee('pdf')} className="text-[10px] font-bold text-white border border-white/30 rounded-md px-2 py-1 hover:bg-white/10">PDF</button>
              <button onClick={onClose} className="text-[11px] font-bold text-white border border-white/30 rounded-md px-2.5 py-1 hover:bg-white/10">الرجوع للمتابعة</button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input
              type="date"
              value={date}
              min={from}
              max={to}
              onChange={(ev) => setDate(ev.target.value || date)}
              className="text-[11px] rounded-lg border border-white/30 bg-white/10 text-white px-2 py-1.5 [color-scheme:light]"
            />
            <span className="text-[10px] text-blue-100">الفترة: {from} — {to}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b border-border overflow-x-auto">
          {TAB_LABELS.map((label, i) => (
            <button key={label} onClick={() => setTab(i)}
              className={`whitespace-nowrap text-[11px] font-bold px-3 py-2 rounded-t-lg border-b-2 ${tab === i ? 'border-blue-700 text-blue-800 bg-blue-50/60' : 'border-transparent text-text-secondary hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3 mb-3">{err}</div>}
          {loading ? (
            <div className="text-center py-12 text-sm text-text-secondary">جاري تحميل بيانات اليوم ({fmtDate(date)})...</div>
          ) : (
            <>
              {tab === 0 && <OverviewTab employee={employee} detail={detail} liveMode={liveMode} />}
              {tab === 1 && <TimelineTab timeline={timeline} />}
              {tab === 2 && (
                <div>
                  <h4 className="text-xs font-bold text-text mb-2">خريطة مواقع اليوم ({fmtDate(date)})</h4>
                  {mapMarkers.length ? <ExecutiveMap markers={mapMarkers} height={400} /> : <div className="text-xs text-text-secondary bg-gray-50 border border-border rounded-xl p-6 text-center">لا توجد مواقع مسجلة لهذا اليوم.</div>}
                  <div className="mt-2 text-[10px] text-text-secondary">مصادر الموقع: نقاط التتبع (رمادي)، تسجيلات الزيارات (أزرق)، الطلبات (أخضر)، التحصيلات (بنفسجي).</div>
                  <TrackingPointsPanel points={trackingPoints} />
                </div>
              )}
              {tab === 3 && <ActivitiesTab detail={detail} />}
            </>
          )}
        </div>
    </div>
  )
}

function Card({ title, children, tone = 'gray' }: { title: string; children: React.ReactNode; tone?: string }) {
  const head: Record<string, string> = { gray: 'from-gray-600 to-gray-800', blue: 'from-blue-600 to-indigo-800', emerald: 'from-emerald-600 to-green-800', amber: 'from-amber-500 to-amber-700', red: 'from-red-500 to-rose-800' }
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden mb-3">
      <div className={`bg-gradient-to-l ${head[tone]} px-4 py-2`}>
        <h4 className="text-xs font-bold text-white">{title}</h4>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Stat({ label, value, tone = 'text-text' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-gray-50 border border-border rounded-xl px-3 py-2.5">
      <div className={`text-base font-extrabold ${tone}`}>{value}</div>
      <div className="text-[10px] text-text-secondary mt-0.5">{label}</div>
    </div>
  )
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  }
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${map[tone] || map.gray}`}>{children}</span>
}

function OverviewTab({ employee, detail, liveMode }: { employee: ExecEmployeeRow; detail: ExecDayDetail | null; liveMode: boolean }) {
  const live = employee.live
  const per = employee.period
  const s = detail?.session
  const cmp = detail?.comparison?.prev_day

  return (
    <div className="space-y-3">
      {detail?.permission_note && <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] rounded-xl p-3">{detail.permission_note}</div>}

      {liveMode && live && (
        <Card title="الحالة اللحظية" tone="emerald">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="الحالة" value={live.status || '—'} />
            <Stat label="حالة الاتصال" value={CONNECTION_LABELS[employee.connection_status] || employee.connection_status} />
            <Stat label="عدد ساعات العمل" value={live.net_minutes != null ? fmtMinutes(live.net_minutes) : '—'} />
            <Stat label="آخر نشاط" value={employee.last_activity_at ? fmtDateTime(employee.last_activity_at) : '—'} tone="text-text-secondary" />
            <Stat label="آخر موقع" value={live.last_location?.at ? fmtDateTime(live.last_location.at) : '—'} tone="text-text-secondary" />
          </div>
        </Card>
      )}

      <Card title="أداء الفترة" tone="blue">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="أيام عمل" value={fmtNum(per.worked_days)} />
          <Stat label="دقائق حضور (net)" value={fmtMinutes(per.present_minutes)} />
          <Stat label="استراحات / دقائق" value={`${fmtNum(per.break_count)} / ${fmtMinutes(per.break_minutes)}`} />
          <Stat label="أيام تأخير / دقائق" value={`${fmtNum(per.late_days)} / ${fmtNum(per.late_minutes_total)}`} tone="text-amber-600" />
          <Stat label="أيام مبكر / دقائق" value={`${fmtNum(per.early_days)} / ${fmtNum(per.early_minutes_total)}`} tone="text-amber-600" />
          <Stat label="أيام إغلاق تلقائي" value={fmtNum(per.auto_closed_days)} tone="text-red-600" />
          <Stat label="صافي المبيعات" value={fmtMoney(per.sales)} tone="text-blue-700" />
          <Stat label="الطلبات" value={fmtNum(per.orders)} />
          <Stat label="الزيارات" value={fmtNum(per.visits)} />
          <Stat label="التحصيلات / القيمة" value={`${fmtNum(per.collections)} / ${fmtMoney(per.collection_amount)}`} />
          <Stat label="عملاء جدد" value={fmtNum(per.new_customers)} />
          <Stat label="المسافة المقطوعة" value={per.distance_meters ? fmtNum(per.distance_meters / 1000) + ' كم' : '—'} />
        </div>
      </Card>

      <Card title="اليوم المحدد (توثيق السجل)" tone="blue">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="بداية يوم العمل" value={s?.start_time ? fmtTime(s.start_time) : '—'} />
          <Stat label="نهاية يوم العمل" value={s?.end_time ? fmtTime(s.end_time) : '—'} />
          <Stat label="المدة صافية" value={s?.net_minutes != null ? fmtMinutes(s.net_minutes) : '—'} />
          <Stat label="المدة الكلية" value={s?.elapsed_minutes != null ? fmtMinutes(s.elapsed_minutes) : '—'} />
          <Stat label="حالة الحضور" value={s ? ATTENDANCE_LABELS[s.attendance_status || ''] || s.attendance_status || '—' : '—'} />
          <Stat label="تأخير هذا اليوم" value={s?.late_minutes ? fmtMinutes(s.late_minutes) : '0'} tone="text-amber-600" />
          <Stat label="مبكر هذا اليوم" value={s?.early_departure_minutes ? fmtMinutes(s.early_departure_minutes) : '0'} tone="text-amber-600" />
          <Stat label="الزيارات" value={s?.visit_count != null ? fmtNum(s.visit_count) : '—'} />
          <Stat label="المسافة (اليوم)" value={s?.distance_meters ? fmtNum(s.distance_meters / 1000) + ' كم' : '—'} />
          <Stat label="آخر نبضة" value={s?.last_seen_at ? fmtTime(s.last_seen_at) : '—'} />
        </div>
        {detail?.auto_close && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-xl p-3">
            {detail.auto_close.reason_label} — المهلة المطبقة {fmtNum(detail.auto_close.policy_minutes)} دقيقة.
          </div>
        )}
      </Card>

      <Card title="مقارنة مع اليوم السابق" tone="emerald">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="سابق: حضور (net)" value={cmp?.net_minutes != null ? fmtMinutes(cmp.net_minutes) : '—'} />
          <Stat label="سابق: طلبات" value={fmtNum(cmp?.orders ?? 0)} />
          <Stat label="سابق: مبيعات" value={fmtMoney(cmp?.sales ?? 0)} />
          <Stat label="سابق: زيارات / تحصيلات" value={`${fmtNum(cmp?.visits ?? 0)} / ${fmtMoney(cmp?.collections ?? 0)}`} />
        </div>
        <div className="text-[10px] text-text-secondary mt-2">المقارنة للتاريخ {cmp?.date || '—'} (نفس تعريفات المؤشرات الموثقة).</div>
      </Card>
    </div>
  )
}

function TimelineTab({ timeline }: { timeline: ExecTimeline | null }) {
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [loadingAddress, setLoadingAddress] = useState<string | null>(null)
  if (!timeline) return <div className="text-xs text-text-secondary text-center py-10">لا يوجد خط زمني لهذا اليوم.</div>
  const TYPE_COLOR: Record<string, string> = {
    workday_start: '#2563eb', workday_end: '#64748b', break_start: '#7c3aed', break_end: '#7c3aed',
    visit_checkin: '#2563eb', visit_checkout: '#1d4ed8', order: '#059669', collection: '#7c3aed', customer: '#0284c7', tracking: '#cbd5e1',
  }

  const getAddress = async (id: string, latitude: number, longitude: number) => {
    if (addresses[id] || loadingAddress === id) return
    setLoadingAddress(id)
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
      const res = await fetch(url)
      const body = await res.json() as { display_name?: string }
      setAddresses((current) => ({ ...current, [id]: body.display_name || 'تعذر العثور على عنوان تفصيلي لهذه النقطة.' }))
    } catch {
      setAddresses((current) => ({ ...current, [id]: 'تعذر استخراج العنوان الآن.' }))
    } finally {
      setLoadingAddress(null)
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {[
          ['الأحداث', timeline.summary.event_count],
          ['نقاط تتبع', timeline.summary.tracking_count],
          ['زيارات', timeline.summary.visit_count],
          ['طلبات', timeline.summary.order_count],
          ['تحصيلات', timeline.summary.collection_count],
          ['دقائق خمول', timeline.summary.idle_minutes],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-gray-50 border border-border rounded-lg px-3 py-1.5">
            <span className="text-xs font-extrabold text-text">{fmtNum(v as number)}</span>
            <span className="text-[9px] text-text-secondary mr-1">{l}</span>
          </div>
        ))}
        {timeline.summary.truncated && <span className="text-[10px] text-amber-600 self-center">تم اقتطاع الأحداث (أكثر من 1000).</span>}
      </div>

      <div className="relative">
        {timeline.events.map((ev, i) => (
          <div key={`${ev.type}-${ev.t}-${i}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: TYPE_COLOR[ev.type] || '#94a3b8', marginTop: 4 }} />
              {i < timeline.events.length - 1 && <div className="w-px flex-1 bg-gray-200" />}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-text-secondary font-mono">{ev.t ? fmtTime(ev.t) : '—'}</span>
                <span className="text-[10px] font-bold text-text">{ev.label}</span>
                {ev.gap_minutes >= 10 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-bold">
                    خمول {fmtNum(ev.gap_minutes)} د
                  </span>
                )}
              </div>
              {ev.detail ? <div className="text-[10px] text-text-secondary">{ev.detail}</div> : null}
              {ev.has_location && ev.latitude != null && ev.longitude != null && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => void getAddress(`${ev.type}-${ev.t}-${i}`, ev.latitude!, ev.longitude!)} className="text-[9px] font-bold text-blue-700 border border-blue-200 bg-blue-50 rounded-md px-1.5 py-0.5">
                      {loadingAddress === `${ev.type}-${ev.t}-${i}` ? 'جارٍ استخراج العنوان...' : 'العنوان التفصيلي'}
                    </button>
                    <button onClick={() => window.open(`https://www.google.com/maps?q=${ev.latitude},${ev.longitude}`, '_blank', 'noopener,noreferrer')} className="text-[9px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-md px-1.5 py-0.5">الخريطة</button>
                  </div>
                  {addresses[`${ev.type}-${ev.t}-${i}`] && <div className="text-[10px] leading-5 text-text mt-1">{addresses[`${ev.type}-${ev.t}-${i}`]}</div>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrackingPointsPanel({ points }: { points: ExecTrackingPoint[] }) {
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)

  const getAddress = async (point: ExecTrackingPoint) => {
    if (addresses[point.id] || loading === point.id) return
    setLoading(point.id)
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${encodeURIComponent(point.latitude)}&lon=${encodeURIComponent(point.longitude)}`
      const res = await fetch(url)
      const body = await res.json() as { display_name?: string }
      setAddresses((current) => ({ ...current, [point.id]: body.display_name || 'تعذر العثور على عنوان تفصيلي لهذه النقطة.' }))
    } catch {
      setAddresses((current) => ({ ...current, [point.id]: 'تعذر استخراج العنوان الآن.' }))
    } finally {
      setLoading(null)
    }
  }

  if (!points.length) return null
  return (
    <Card title={`نقاط التتبع (${fmtNum(points.length)})`} tone="gray">
      <div className="text-[10px] text-text-secondary mb-2">كل نقطة تعرض وقت تسجيلها ومدى دقتها. العنوان يُستخرج فقط عند الطلب.</div>
      <div className="space-y-2 max-h-72 overflow-y-auto pl-1">
        {points.map((point) => (
          <div key={point.id} className="border border-border rounded-lg p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold text-text">
                  {fmtTime(point.recorded_at)} - {point.event_label}
                  {point.event_name && <span className="text-blue-700">: {point.event_name}</span>}
                  {point.is_last_seen && <span className="mr-1.5 text-[9px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-full px-1.5 py-0.5">آخر ظهور</span>}
                </div>
                <div className="text-[10px] text-text-secondary mt-0.5">
                  الدقة: {point.accuracy_meters != null ? `${fmtNum(point.accuracy_meters)} متر` : 'غير متاحة'}
                  {point.speed_mps != null ? ` - السرعة: ${fmtNum(point.speed_mps * 3.6)} كم/س` : ''}
                </div>
                {point.event_details && <div className="text-[10px] text-text-secondary mt-0.5">{point.event_details}</div>}
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => void getAddress(point)} className="text-[10px] font-bold text-blue-700 border border-blue-200 bg-blue-50 rounded-md px-2 py-1">{loading === point.id ? 'جارٍ الاستخراج...' : 'العنوان'}</button>
                <button onClick={() => window.open(`https://www.google.com/maps?q=${point.latitude},${point.longitude}`, '_blank', 'noopener,noreferrer')} className="text-[10px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-md px-2 py-1">فتح الخريطة</button>
              </div>
            </div>
            {addresses[point.id] && <div className="text-[10px] leading-5 text-text mt-2 border-t border-border pt-2">{addresses[point.id]}</div>}
          </div>
        ))}
      </div>
    </Card>
  )
}

function ActivitiesTab({ detail }: { detail: ExecDayDetail | null }) {
  if (!detail) return <div className="text-xs text-text-secondary text-center py-10">لا توجد بيانات.</div>
  const { visits, orders, collections, new_customers, breaks } = detail
  return (
    <div className="space-y-3">
      <Card title={`الزيارات (${visits.length})`} tone="blue">
        {visits.length === 0 ? <Empty /> : visits.map((v, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border last:border-0 py-2">
            <div><div className="text-[11px] font-bold text-text">{String(v.customer_name || v.code || '—')}</div><div className="text-[10px] text-text-secondary">{fmtDateTime(String(v.check_in_at || ''))}{v.check_out_at ? ` ← ${fmtTime(String(v.check_out_at))}` : ''}</div></div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{String(v.status || '—')}</span>
          </div>
        ))}
      </Card>

      <Card title={`الطلبات (${orders.length}) — ${fmtMoney((orders as any).reduce?.((a: number, o: any) => a + (o.total_amount || 0), 0) ?? 0)}`} tone="emerald">
        {orders.length === 0 ? <Empty /> : orders.map((o, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border last:border-0 py-2">
            <div><div className="text-[11px] font-bold text-text">{String(o.customer_name || o.code || '—')}</div><div className="text-[10px] text-text-secondary">{fmtDateTime(String(o.created_at || ''))}</div></div>
            <span className="text-[10px] font-bold text-blue-700">{fmtMoney(Number(o.total_amount) || 0)}</span>
          </div>
        ))}
      </Card>

      <Card title={`التحصيلات (${collections.length})`} tone="violet">
        {collections.length === 0 ? <Empty /> : collections.map((c, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border last:border-0 py-2">
            <div><div className="text-[11px] font-bold text-text">{String(c.customer_name || c.code || '—')}</div><div className="text-[10px] text-text-secondary">{fmtDateTime(String(c.created_at || ''))} — {String(c.method || '')}</div></div>
            <span className="text-[10px] font-bold text-violet-700">{fmtMoney(Number(c.amount) || 0)}</span>
          </div>
        ))}
      </Card>

      <Card title={`العملاء الجدد (${new_customers.length})`} tone="blue">
        {new_customers.length === 0 ? <Empty /> : new_customers.map((c, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border last:border-0 py-2">
            <div><div className="text-[11px] font-bold text-text">{String(c.name || c.code || '—')}</div><div className="text-[10px] text-text-secondary">{fmtDateTime(String(c.created_at || ''))}</div></div>
          </div>
        ))}
      </Card>

      <Card title={`الاستراحات (${breaks.length})`} tone="amber">
        {breaks.length === 0 ? <Empty /> : breaks.map((b, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border last:border-0 py-2">
            <div><div className="text-[11px] font-bold text-text">{b.break_reason || 'استراحة'}</div><div className="text-[10px] text-text-secondary">{b.break_start ? fmtTime(b.break_start) : '—'} ← {b.break_end ? fmtTime(b.break_end) : 'مفتوحة'}</div></div>
            <span className="text-[10px] font-bold text-amber-600">{b.duration_seconds != null ? fmtMinutes(b.duration_seconds / 60) : '—'}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

function AutoCloseTab({ detail, liveMode }: { detail: ExecDayDetail | null; liveMode: boolean }) {
  if (!detail) return <Empty />
  return (
    <div className="space-y-3">
      <Card title="سياسة الإغلاق التلقائي (المنشورة)" tone="blue">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="مهلة عدم النشاط" value={`${fmtNum(detail.policy.inactivity_timeout_minutes)} دقيقة`} />
          <Stat label="البداية الرسمية" value={detail.policy.official_start_time || '—'} />
          <Stat label="النهاية الرسمية" value={detail.policy.official_end_time || '—'} />
        </div>
        <div className="text-[10px] text-text-secondary mt-2">
          تُطبَّق على المطبِّقين (check_session_timeout / auto_close_stale_sessions). أي تغيير عبر إعدادات الشاشة يُسجَّل في سجل التدقيق (executive_policy_changes).
        </div>
      </Card>

      {detail.auto_close ? (
        <Card title="سجل اليوم المحدد" tone="red">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold">{detail.auto_close.reason_label}</span>
            <span className="text-[11px] text-text-secondary">السبب التقني: {detail.auto_close.reason}</span>
          </div>
          {detail.session?.last_seen_at ? (
            <div className="text-[10px] text-text-secondary mt-2">آخر نشاط مسجل: {fmtDateTime(detail.session.last_seen_at)}.</div>
          ) : null}
          <div className="text-[10px] text-text-secondary mt-1">
            ملاحظة: نبضات التطبيق (heartbeat) لا تعتبر نشاطاً مؤهلاً في حساب الخمول — المصادر المؤهلة هي نقاط التتبع والزيارات والطلبات والتحصيلات.
          </div>
        </Card>
      ) : (
        <Card title="سجل اليوم المحدد" tone="blue">
          <div className="text-xs text-text-secondary">لا يوجد إغلاق تلقائي لهذا اليوم{liveMode ? '' : ' في التاريخ المحدد'}. السجل يظهر هنا عند وجود reason من (auto_closed_inactivity / no_activity_timeout / day_rollover).</div>
        </Card>
      )}

      <Card title="حالة الاتصال (آخر 24 ساعة)" tone="blue">
        <div className="text-xs text-text">الحالة الآن: <span className="font-bold">{CONNECTION_LABELS[detail.connection_status || 'no_data'] || detail.connection_status || '—'}</span></div>
        <div className="text-[10px] text-text-secondary mt-1">
          آخر حدث: {detail.last_event?.has_event ? `${String(detail.last_event.type)} — ${fmtDateTime(detail.last_event.at)}` : 'لا أحداث خلال 24 ساعة'}.
          القاعدة: متصل (&gt;5 د) / متأخر (&gt;25 د) / مفقود / لا بيانات.
        </div>
      </Card>
    </div>
  )
}

function Empty() {
  return <div className="text-xs text-text-secondary py-4 text-center">لا توجد عناصر.</div>
}
