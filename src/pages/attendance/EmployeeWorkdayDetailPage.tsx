import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ArrowRight, Clock, Coffee, MapPinned, Navigation } from 'lucide-react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker as LeafletMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime } from '../../utils/format'

const homeIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:20px">🏠</span>', iconSize: [20, 20], iconAnchor: [10, 10] })
const visitIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:18px">📍</span>', iconSize: [18, 18], iconAnchor: [9, 9] })

interface SessionData {
  id: string; date: string; started_at: string; ended_at: string | null
  status: string; duration_minutes: number; distance_meters: number | null
  visit_count: number; attendance_status: string | null; late_minutes: number
  early_departure_minutes: number; break_count: number; break_seconds: number
  break_minutes: number; net_work_minutes: number; order_count: number
  sales_amount: number; collection_amount: number; new_customer_count: number
  target_minutes: number; attendance_score: number; productivity_score: number; composite_score: number
}

interface HistoryResponse {
  sessions: SessionData[]; summary: { total_days: number; late_days: number; early_departure_days: number; ontime_days: number; schedule_type: string; required_daily_hours: number }
  productivity: { total_orders: number; total_sales: number; total_collections: number; total_net_minutes: number; total_target_minutes: number; overall_attendance_rate: number; avg_daily_sales: number }
}

interface TargetResponse {
  target_hours: number; current_net_seconds: number; current_net_hours: number; progress_pct: number; remaining_seconds: number; schedule_type: string
  last_7_days: { date: string; net_hours: number; target_hours: number; met_target: boolean }[]
}

interface RoutePoint { latitude: number; longitude: number; time: string; type: string }

interface VisitLocation {
  visit_id: string; customer_id: string; customer_name: string; latitude: number; longitude: number
  check_in_at: string; check_out_at: string | null; visit_result: string | null
}

interface LongStop {
  start_time: string; end_time: string; duration_minutes: number; latitude: number; longitude: number; type: string
}

interface DayMapData {
  session: { employee_id: string; date: string; start_time: string; end_time: string | null; attendance_status: string }
  route: RoutePoint[]; total_points: number; total_distance_meters: number; total_distance_km: number
  visit_locations: VisitLocation[]; long_stops: LongStop[]; long_stops_count: number; long_stops_total_minutes: number
}

interface TimelineEvent {
  time: string; type: string; title: string; description: string; latitude: string | null; longitude: string | null; metadata: Record<string, unknown>
}

interface WorkHoursLedgerEntry {
  start_time: string; end_time: string | null; activity_type: string
  duration_minutes: number; description: string | null
}

interface BreakInterval {
  start: string; end: string | null; duration_minutes: number
}

interface TimelineData {
  employee: { id: string; full_name: string; code: string; role_name: string; manager_name: string }
  session: { id: string; status: string; start_time: string; end_time: string | null; attendance_status: string }
  events: TimelineEvent[]
}

const EVENT_CFG: Record<string, { label: string; color: string; bg: string; dot: string; icon: string }> = {
  workday_start: { label: 'بداية يوم العمل', color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500', icon: '🚀' },
  workday_end: { label: 'نهاية يوم العمل', color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500', icon: '🏁' },
  break_start: { label: 'بداية استراحة', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500', icon: '☕' },
  break_end: { label: 'نهاية استراحة', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500', icon: '↩️' },
  visit_start: { label: 'بداية زيارة', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500', icon: '📍' },
  visit_end: { label: 'نهاية زيارة', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500', icon: '✅' },
  order_created: { label: 'طلب جديد', color: 'text-orange-600', bg: 'bg-orange-50', dot: 'bg-orange-500', icon: '📦' },
  collection_taken: { label: 'تحصيل', color: 'text-cyan-600', bg: 'bg-cyan-50', dot: 'bg-cyan-500', icon: '💰' },
  new_customer: { label: 'عميل جديد', color: 'text-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-500', icon: '👤' },
}

const fmtMin = (m?: number) => {
  if (m == null || isNaN(m)) return '--'
  const h = Math.floor(m / 60); const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

const fmtSec = (s?: number) => {
  if (s == null || isNaN(s)) return '--'
  return fmtMin(Math.round(s / 60))
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function getToken(): string | null {
  try {
    const t = localStorage.getItem('session_token')
    if (t && uuidRe.test(t.trim())) return t.trim()
    if (t) { console.error('[EmployeeWorkdayDetailPage] Invalid session_token (not a UUID), clearing'); localStorage.removeItem('session_token') }
    return null
  } catch { return null }
}

function MapFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => { if (points.length > 0) map.fitBounds(points) }, [points, map])
  return null
}

export default function EmployeeWorkdayDetailPage() {
  const { employeeId, date } = useParams<{ employeeId: string; date: string }>()
  const navigate = useNavigate()
  const token = getToken()
  const [loading, setLoading] = useState(true)
  const [employeeName, setEmployeeName] = useState('')
  const [session, setSession] = useState<SessionData | null>(null)
  const [target, setTarget] = useState<TargetResponse | null>(null)
  const [mapData, setMapData] = useState<DayMapData | null>(null)
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  const [workHoursLedger, setWorkHoursLedger] = useState<WorkHoursLedgerEntry[] | null>(null)
  const [historySessions, setHistorySessions] = useState<SessionData[]>([])
  const [historySummary, setHistorySummary] = useState<HistoryResponse['summary'] | null>(null)
  const [targetWeek, setTargetWeek] = useState<TargetResponse['last_7_days']>([])
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    map: true, timeline: true, tracking: false, stops: false, ledger: true, breakDetail: false, weekHistory: true,
  })

  const today = date ?? new Date().toISOString().slice(0, 10)

  const toggle = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))

  useEffect(() => {
    if (!token || !employeeId) return
    const fetchAll = async () => {
      const d = new Date(today); d.setDate(d.getDate() - 6)
      const fromDate = d.toISOString().slice(0, 10)
      let nameRes: any, historyRes: any, mapRes: any, timelineRes: any
      try {
        ;[nameRes, historyRes, mapRes, timelineRes] = await Promise.all([
          supabase.rpc('get_governed_employee', { p_token: token, p_employee_id: employeeId }),
          supabase.rpc('get_employee_workday_history', { p_token: token, p_employee_id: employeeId, p_from: fromDate, p_to: today }),
          supabase.rpc('get_employee_day_map', { p_token: token, p_employee_id: employeeId, p_date: today }),
          supabase.rpc('get_employee_day_timeline', { p_token: token, p_employee_id: employeeId, p_date: today }),
        ])
      } catch {}
      console.log('historyRes:', historyRes)
      console.log('historyRes.data:', historyRes?.data)
      console.log('mapRes.data:', mapRes?.data)
      console.log('timelineRes.data:', timelineRes?.data)
      if (nameRes?.data && typeof nameRes.data === 'object' && !('error' in (nameRes.data as Record<string, unknown>))) {
        setEmployeeName((nameRes.data as Record<string, unknown>).full_name as string || '')
      }
      if (historyRes?.data && typeof historyRes.data === 'object' && !('error' in (historyRes.data as Record<string, unknown>))) {
        const h = historyRes.data as HistoryResponse
        console.log('session being set:', h.sessions?.[0])
        if (h.sessions && h.sessions.length > 0) setSession(h.sessions[0])
        if (h.sessions) setHistorySessions(h.sessions)
        if (h.summary) setHistorySummary(h.summary)
      }
      try {
        const { data: tr } = await supabase.rpc('get_daily_target_vs_actual', {
          p_token: token, p_employee_id: employeeId, p_date: today,
        })
        if (tr && typeof tr === 'object' && !('error' in (tr as Record<string, unknown>))) {
          setTarget(tr as TargetResponse)
          if ((tr as TargetResponse).last_7_days) setTargetWeek((tr as TargetResponse).last_7_days)
        }
      } catch {}
      if (mapRes.data && !((mapRes.data as Record<string, unknown>).error)) {
        const map = mapRes.data as DayMapData
        if (map.route && map.route.length > 0) {
          const sample = map.route.slice(0, 20).map((p, i) => ({ i, lat: p.latitude, lng: p.longitude }))
          const hasNull = sample.some(p => p.lat == null || p.lng == null)
          console.log('[EmployeeWorkdayDetail] route points:', map.route.length)
          console.log('[EmployeeWorkdayDetail] first 20 route points:', sample)
          console.log('[EmployeeWorkdayDetail] has null lat/lng:', hasNull)
        }
        setMapData(map)
      }
      if (timelineRes.data && !((timelineRes.data as Record<string, unknown>).error)) setTimeline(timelineRes.data as TimelineData)

      const ledgerRes = await supabase.rpc('get_work_hours_ledger', {
        p_token: token, p_employee_id: employeeId, p_from: today, p_to: today,
      })
      if (ledgerRes.data && Array.isArray(ledgerRes.data)) setWorkHoursLedger(ledgerRes.data as WorkHoursLedgerEntry[])

      setLoading(false)
    }
    fetchAll()
  }, [token, employeeId, today])

  const routePoints: [number, number][] = mapData?.route
    ?.filter(p => p.latitude != null && p.longitude != null)
    .map(p => [p.latitude, p.longitude]) ?? []

  const firstPtTime = mapData?.route?.[0]?.time ? new Date(mapData.route[0].time) : null
  const lastPtTime = mapData?.route?.[mapData.route.length - 1]?.time ? new Date(mapData.route[mapData.route.length - 1].time) : null

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50" dir="rtl">
        <p className="text-gray-400">جاري تحميل تفاصيل يوم العمل...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-lg mx-auto p-3">

        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-200 rounded-xl">
            <ArrowRight className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-gray-800 text-base truncate">{employeeName || 'الموظف'}</h1>
              {session?.composite_score != null && <CompositeBadge score={session.composite_score} />}
            </div>
            <p className="text-[10px] text-gray-400">
              {today && new Date(today).toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => {
              const d = new Date(today); d.setDate(d.getDate() - 1)
              navigate(`/attendance/employee/${employeeId}/${d.toISOString().slice(0, 10)}`)
            }} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 text-xs font-bold">→</button>
            <button onClick={() => {
              const d = new Date(today); d.setDate(d.getDate() + 1)
              navigate(`/attendance/employee/${employeeId}/${d.toISOString().slice(0, 10)}`)
            }} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500 text-xs font-bold">←</button>
          </div>
        </div>

        {!session && !loading && (
          <div className="text-center py-10 text-gray-400">
            <Clock className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm">لا توجد بيانات لهذا اليوم</p>
          </div>
        )}

        {session && (
          <>
            {/* ===== KPI SUMMARY (compact) ===== */}
            <div className="bg-white rounded-xl shadow-sm p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-700">ملخص الإنتاج اليومي</h2>
                <Badge status={session.attendance_status} />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <KpiMini label="صافي العمل" value={fmtMin(session.net_work_minutes)} color="text-green-600" bg="bg-green-50" />
                <KpiMini label="الطلبات" value={String(session.order_count)} color="text-purple-600" bg="bg-purple-50" />
                <KpiMini label="المبيعات" value={session.sales_amount?.toLocaleString('ar-EG')} color="text-emerald-600" bg="bg-emerald-50" />
                <KpiMini label="التحصيل" value={session.collection_amount?.toLocaleString('ar-EG')} color="text-cyan-600" bg="bg-cyan-50" />
                <KpiMini label="عملاء جدد" value={String(session.new_customer_count)} color="text-rose-600" bg="bg-rose-50" />
                <KpiMini label="الزيارات" value={String(session.visit_count)} color="text-blue-600" bg="bg-blue-50" />
                <KpiMini label="المسافة" value={mapData ? `${mapData.total_distance_km} كم` : '--'} color="text-indigo-600" bg="bg-indigo-50" />
                <KpiMini label="الاستراحة" value={fmtMin(session.break_minutes)} color="text-amber-600" bg="bg-amber-50" />
              </div>
            </div>

            {/* ===== TARGET PROGRESS (compact) ===== */}
            {target && (
              <div className="bg-white rounded-xl shadow-sm p-3 mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <h2 className="text-xs font-bold text-gray-700">المستهدف مقابل الفعلي</h2>
                  <span className="text-xs font-bold" dir="ltr">{target.progress_pct}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                  <div className={`h-full rounded-full transition-all ${target.progress_pct >= 100 ? 'bg-green-500' : target.progress_pct >= 80 ? 'bg-blue-500' : target.progress_pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(target.progress_pct, 100)}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>{fmtSec(target.current_net_seconds)} / {fmtMin(target.target_hours * 60)}</span>
                  <span>المتبقي: {fmtSec(target.remaining_seconds)}</span>
                </div>
              </div>
            )}

            {/* ===== TARGET LAST 7 DAYS ===== */}
            {targetWeek.length > 0 && (
              <Section title="📊 المستهدف آخر 7 أيام" expandedKey="targetWeek" expanded={expandedSections.targetWeek} onToggle={() => toggle('targetWeek')}>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {targetWeek.map((d, i) => {
                    const pct = d.target_hours > 0 ? Math.round((d.net_hours / d.target_hours) * 100) : 0
                    return (
                      <div key={i} className="flex flex-col items-center shrink-0">
                        <span className="text-[9px] text-gray-400 mb-0.5">
                          {new Date(d.date).toLocaleDateString('ar-EG', { weekday: 'short' })}
                        </span>
                        <div className="w-10 h-14 bg-gray-50 rounded-lg relative overflow-hidden">
                          <div className={`absolute bottom-0 w-full rounded-t-sm transition-all ${d.met_target ? 'bg-green-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ height: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-[9px] font-bold mt-0.5">{d.net_hours.toFixed(1)}س</span>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* ===== WEEK HISTORY ===== */}
            {historySessions.length > 1 && (
              <Section title="📅 سجل الأيام (آخر 7 أيام)" expandedKey="weekHistory" expanded={expandedSections.weekHistory} onToggle={() => toggle('weekHistory')}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-right py-1 px-1 text-gray-500 font-bold">اليوم</th>
                        <th className="text-right py-1 px-1 text-gray-500 font-bold">التاريخ</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">صافي</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">طلبات</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">مبيعات</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">تحصيل</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">زيارات</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historySessions.sort((a, b) => b.date.localeCompare(a.date)).map((s, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                          onClick={() => navigate(`/attendance/employee/${employeeId}/${s.date}`)}>
                          <td className="py-1 px-1 text-gray-600">
                            {new Date(s.date).toLocaleDateString('ar-EG', { weekday: 'short' })}
                          </td>
                          <td className="py-1 px-1 text-gray-500">{s.date}</td>
                          <td className="py-1 px-1 text-center font-bold text-gray-800">{fmtMin(s.net_work_minutes)}</td>
                          <td className="py-1 px-1 text-center text-gray-700">{s.order_count}</td>
                          <td className="py-1 px-1 text-center text-gray-700">{s.sales_amount?.toLocaleString('ar-EG')}</td>
                          <td className="py-1 px-1 text-center text-gray-700">{s.collection_amount?.toLocaleString('ar-EG')}</td>
                          <td className="py-1 px-1 text-center text-gray-700">{s.visit_count}</td>
                          <td className="py-1 px-1 text-center"><BadgeSmall status={s.attendance_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historySummary && (
                  <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-400 flex-wrap">
                    <span>إجمالي الأيام: {historySummary.total_days}</span>
                    <span className="text-green-600">ملتزم: {historySummary.ontime_days}</span>
                    <span className="text-red-600">متأخر: {historySummary.late_days}</span>
                    <span className="text-amber-600">مبكر: {historySummary.early_departure_days}</span>
                  </div>
                )}
              </Section>
            )}

            {/* ===== 1. ROUTE MAP ===== */}
            <Section title="🗺️ خريطة المسار" expandedKey="map" expanded={expandedSections.map} onToggle={() => toggle('map')}>
              {routePoints.length > 0 ? (
                <>
                  {/* Stats bar */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className="bg-indigo-50 text-indigo-600 text-[10px] px-2 py-0.5 rounded-full font-bold">{mapData?.total_distance_km} كم</span>
                    <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full">{mapData?.total_points} نقطة</span>
                    <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full">
                      {firstPtTime ? formatTime(firstPtTime) : '--'} ← {lastPtTime ? formatTime(lastPtTime) : '--'}
                    </span>
                  </div>
                  <div className="rounded-xl overflow-hidden" style={{ height: 250 }}>
                    <MapContainer center={routePoints[0]} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                      <MapFitBounds points={routePoints} />
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <Polyline positions={routePoints} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7 }} />
                      {mapData?.route.filter(p => p.latitude != null && p.longitude != null).map((p, i, arr) => (
                        <CircleMarker key={i} center={[p.latitude, p.longitude]}
                          radius={i === 0 || i === arr.length - 1 ? 5 : 2}
                          pathOptions={{ color: i === 0 ? '#22c55e' : i === arr.length - 1 ? '#ef4444' : '#3b82f6', fillOpacity: 0.8 }}>
                          <Popup>{formatTime(p.time)}</Popup>
                        </CircleMarker>
                      ))}
                      {mapData?.visit_locations.filter(v => v.latitude).map((v) => (
                        <LeafletMarker key={v.visit_id} position={[v.latitude, v.longitude]} icon={visitIcon}>
                          <Popup>
                            <div className="text-xs"><p className="font-bold">{v.customer_name}</p><p>{v.check_in_at ? formatTime(v.check_in_at) : '--'}</p></div>
                          </Popup>
                        </LeafletMarker>
                      ))}
                    </MapContainer>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-gray-400"><MapPinned className="w-6 h-6 mx-auto mb-1" /><p className="text-xs">لا توجد نقاط تتبع</p></div>
              )}
            </Section>

            {/* ===== 2. TIMELINE ===== */}
            <Section title="⏳ الخط الزمني" expandedKey="timeline" expanded={expandedSections.timeline} onToggle={() => toggle('timeline')}>
              {(!timeline?.events || timeline.events.length === 0) ? (
                <div className="text-center py-6 text-gray-400"><p className="text-xs">لا توجد أحداث</p></div>
              ) : (
                <div className="space-y-1">
                  {timeline.events.map((ev, i) => {
                    const cfg = EVENT_CFG[ev.type] ?? { label: ev.type, color: 'text-gray-600', bg: 'bg-gray-50', dot: 'bg-gray-400', icon: '📌' }
                    return (
                      <div key={i} className="flex gap-2">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${cfg.dot}`} />
                          {i < (timeline?.events.length ?? 1) - 1 && <div className="w-0.5 flex-1 bg-gray-200" />}
                        </div>
                        <div className={`flex-1 ${cfg.bg} rounded-lg p-2`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold">{cfg.icon} {cfg.label}</span>
                            <span className="text-[9px] text-gray-400">{formatTime(ev.time)}</span>
                          </div>
                          {ev.description && <p className="text-[10px] text-gray-600 mt-0.5">{ev.description}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* ===== 3. TRACKING POINTS ===== */}
            <Section title="📡 نقاط التتبع" expandedKey="tracking" expanded={expandedSections.tracking} onToggle={() => toggle('tracking')}>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatBox label="إجمالي النقاط" value={String(mapData?.total_points ?? 0)} />
                <StatBox label="المسافة" value={mapData ? `${mapData.total_distance_km} كم` : '--'} />
                <StatBox label="أول نقطة" value={firstPtTime ? formatTime(firstPtTime) : '--'} />
                <StatBox label="آخر نقطة" value={lastPtTime ? formatTime(lastPtTime) : '--'} />
              </div>
              {mapData && mapData.route.length > 0 && (
                <button onClick={() => setExpandedSections(prev => ({ ...prev, trackingList: !prev.trackingList }))}
                  className="w-full text-xs text-blue-600 font-bold py-1.5 bg-blue-50 rounded-lg">
                  {expandedSections.trackingList ? 'إخفاء القائمة' : `عرض القائمة (${mapData.route.length})`}
                </button>
              )}
              {expandedSections.trackingList && mapData?.route.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] py-1 border-b border-gray-50 last:border-0">
                  <span className="text-gray-400">#{i + 1}</span>
                  <span className="text-gray-600">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</span>
                  <span className="text-gray-400">{formatTime(p.time)}</span>
                </div>
              ))}
            </Section>

            {/* ===== 4. LONG STOPS ===== */}
            <Section title="⏸️ التوقفات الطويلة" expandedKey="stops" expanded={expandedSections.stops} onToggle={() => toggle('stops')}>
              {(!mapData?.long_stops || mapData.long_stops.length === 0) ? (
                <div className="text-center py-4 text-gray-400"><p className="text-xs">لا توجد توقفات طويلة</p></div>
              ) : (
                <div className="space-y-1.5">
                  {mapData.long_stops.map((stop, i) => (
                    <div key={i} className="bg-amber-50 rounded-lg p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-700">⏸ توقف {fmtMin(stop.duration_minutes)}</span>
                        {stop.latitude && (
                          <a href={`https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600">
                            <Navigation className="w-3 h-3 inline" />
                          </a>
                        )}
                      </div>
                      <div className="text-[10px] text-amber-600 mt-0.5">
                        {formatTime(stop.start_time)} ← {formatTime(stop.end_time)}
                      </div>
                      {stop.latitude && (
                        <div className="text-[9px] text-amber-500 mt-0.5">{stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ===== 5. WORK HOURS LEDGER ===== */}
            <Section title="📋 سجل ساعات العمل" expandedKey="ledger" expanded={expandedSections.ledger} onToggle={() => toggle('ledger')}>
              {(!workHoursLedger || workHoursLedger.length === 0) ? (
                <div className="text-center py-4 text-gray-400"><p className="text-xs">لا توجد بيانات</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-right py-1 px-1 text-gray-500 font-bold">النشاط</th>
                        <th className="text-right py-1 px-1 text-gray-500 font-bold">البداية</th>
                        <th className="text-right py-1 px-1 text-gray-500 font-bold">النهاية</th>
                        <th className="text-center py-1 px-1 text-gray-500 font-bold">المدة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workHoursLedger
                        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                        .map((e, i) => {
                          const typeLabel: Record<string, string> = {
                            work: '🔵 عمل', break: '🟡 استراحة',
                            idle: '⚪ توقف', visit: '📍 زيارة',
                          }
                          return (
                            <tr key={i} className="border-b border-gray-50">
                              <td className="py-1 px-1 text-gray-700">{typeLabel[e.activity_type] || e.activity_type}</td>
                              <td className="py-1 px-1 text-gray-500">{formatTime(e.start_time)}</td>
                              <td className="py-1 px-1 text-gray-500">{e.end_time ? formatTime(e.end_time) : '--'}</td>
                              <td className="py-1 px-1 text-center font-bold text-gray-800">{fmtMin(e.duration_minutes)}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 font-bold text-gray-800">
                        <td colSpan={3} className="py-1.5 px-1 text-left">الإجمالي</td>
                        <td className="py-1.5 px-1 text-center">
                          {fmtMin(workHoursLedger.reduce((s, e) => s + e.duration_minutes, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Section>

            {/* ===== 6. BREAK HISTORY DETAILED ===== */}
            <Section title="☕ سجل الاستراحات (تفصيلي)" expandedKey="breakHistory" expanded={expandedSections.breakHistory} onToggle={() => toggle('breakHistory')}>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <StatBox label="عدد الاستراحات" value={String(session.break_count)} />
                <StatBox label="إجمالي وقت الاستراحة" value={fmtMin(session.break_minutes)} />
                <StatBox label="متوسط الاستراحة" value={session.break_count > 0 ? fmtMin(Math.round(session.break_minutes / session.break_count)) : '--'} />
              </div>
              {timeline?.events ? (
                <BreakHistoryTable events={timeline.events} />
              ) : (
                <div className="text-center py-4 text-gray-400"><p className="text-xs">لا توجد بيانات استراحات</p></div>
              )}
            </Section>
          </>
        )}
        <div className="h-4" />
      </div>
    </div>
  )
}

function Section({ title, children, expanded, onToggle }: { title: string; children: React.ReactNode; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white rounded-xl shadow-sm mb-3 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 text-xs font-bold text-gray-700">
        <span>{title}</span>
        <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {expanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

function KpiMini({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-lg p-1.5 text-center`}>
      <div className={`text-xs font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-500 leading-tight">{label}</div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2 text-center">
      <div className="text-xs font-bold text-gray-800">{value}</div>
      <div className="text-[9px] text-gray-500">{label}</div>
    </div>
  )
}

function BreakHistoryTable({ events }: { events: TimelineEvent[] }) {
  const breaks: BreakInterval[] = []
  let currentBreak: TimelineEvent | null = null

  const sorted = [...events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  for (const ev of sorted) {
    if (ev.type === 'break_start') {
      currentBreak = ev
    } else if (ev.type === 'break_end' && currentBreak) {
      const endTime = new Date(ev.time)
      const startTime = new Date(currentBreak.time)
      const durMin = (endTime.getTime() - startTime.getTime()) / 60000
      breaks.push({
        start: currentBreak.time,
        end: ev.time,
        duration_minutes: Math.round(durMin * 10) / 10,
      })
      currentBreak = null
    }
  }

  if (currentBreak) {
    breaks.push({
      start: currentBreak.time,
      end: '---',
      duration_minutes: (Date.now() - new Date(currentBreak.time).getTime()) / 60000,
    })
  }

  if (breaks.length === 0) {
    return <div className="text-center py-3 text-gray-400 text-xs">لا توجد استراحات في الخط الزمني</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-right py-1 px-1 text-gray-500 font-bold">#</th>
            <th className="text-right py-1 px-1 text-gray-500 font-bold">البداية</th>
            <th className="text-right py-1 px-1 text-gray-500 font-bold">النهاية</th>
            <th className="text-center py-1 px-1 text-gray-500 font-bold">المدة</th>
          </tr>
        </thead>
        <tbody>
          {breaks.map((b, i) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-1 px-1 text-gray-400">{i + 1}</td>
              <td className="py-1 px-1 text-gray-700">{formatTime(b.start)}</td>
              <td className="py-1 px-1 text-gray-700">{b.end !== '---' ? formatTime(b.end!) : <span className="text-amber-500">مستمرة</span>}</td>
              <td className="py-1 px-1 text-center font-bold text-gray-800">{fmtMin(b.duration_minutes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-300 font-bold text-gray-800">
            <td colSpan={3} className="py-1.5 px-1 text-left">الإجمالي</td>
            <td className="py-1.5 px-1 text-center">{fmtMin(breaks.reduce((s, b) => s + b.duration_minutes, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function CompositeBadge({ score }: { score: number }) {
  const color = score >= 85 ? 'bg-green-100 text-green-700' : score >= 70 ? 'bg-blue-100 text-blue-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${color}`}>{score}</span>
}

function BadgeSmall({ status }: { status: string | null }) {
  if (!status) return null
  const cfg: Record<string, { label: string; cls: string }> = {
    late: { label: 'متأخر', cls: 'bg-red-100 text-red-600' },
    early_departure: { label: 'مبكر', cls: 'bg-amber-100 text-amber-600' },
    late_and_early: { label: 'مختلط', cls: 'bg-red-100 text-red-600' },
    compliant: { label: 'ملتزم', cls: 'bg-green-100 text-green-600' },
  }
  const c = cfg[status]
  return c ? <span className={`text-[8px] px-1 py-0.5 rounded-full font-bold ${c.cls}`}>{c.label}</span> : null
}

function Badge({ status }: { status: string | null }) {
  if (!status) return null
  const cfg: Record<string, { label: string; cls: string }> = {
    late: { label: 'متأخر', cls: 'bg-red-100 text-red-600' },
    early_departure: { label: 'انصراف مبكر', cls: 'bg-amber-100 text-amber-600' },
    late_and_early: { label: 'متأخر ومنصرف مبكر', cls: 'bg-red-100 text-red-600' },
    compliant: { label: 'ملتزم', cls: 'bg-green-100 text-green-600' },
  }
  const c = cfg[status]
  return c ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.cls}`}>{c.label}</span> : null
}
