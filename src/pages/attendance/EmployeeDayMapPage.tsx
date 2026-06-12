import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ArrowRight, Clock, MapPinned, Navigation, RefreshCw } from 'lucide-react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker as LeafletMarker, useMap } from 'react-leaflet'
import L from 'leaflet'

const homeIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:20px">🏠</span>', iconSize: [20, 20], iconAnchor: [10, 10] })
const workIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:20px">✅</span>', iconSize: [20, 20], iconAnchor: [10, 10] })
const visitIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:18px">📍</span>', iconSize: [18, 18], iconAnchor: [9, 9] })
const breakIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:18px">☕</span>', iconSize: [18, 18], iconAnchor: [9, 9] })
const orderIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:16px">📦</span>', iconSize: [16, 16], iconAnchor: [8, 8] })
const collectionIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:16px">💰</span>', iconSize: [16, 16], iconAnchor: [8, 8] })
const customerIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:16px">👤</span>', iconSize: [16, 16], iconAnchor: [8, 8] })

interface EmployeeInfo {
  id: string; full_name: string; code: string
  role_name: string; region: string | null; avatar_url: string | null
  manager_name: string
}

interface SessionInfo {
  id: string; status: string; start_time: string; end_time: string | null
  attendance_status: string; late_minutes: number; early_departure_minutes: number
  duration_minutes: number; net_minutes: number; break_minutes: number
}

interface LastLocation {
  latitude: number; longitude: number; recorded_at: string
}

interface DaySummary {
  total_orders: number; total_sales: number
  total_collections: number; total_collections_amount: number
  new_customers: number; total_visits: number; completed_visits: number
}

interface EmployeeDetail {
  employee: EmployeeInfo
  session: SessionInfo | null
  last_location: LastLocation | null
  summary: DaySummary
}

interface RoutePoint {
  latitude: number; longitude: number; time: string; type: string
}

interface VisitLocation {
  visit_id: string; customer_id: string; customer_name: string
  latitude: number; longitude: number
  check_in_at: string; check_out_at: string | null; visit_result: string | null
}

interface LongStop {
  start_time: string; end_time: string; duration_minutes: number
  latitude: number; longitude: number; type: string
}

interface DayMapData {
  session: { employee_id: string; date: string; start_time: string; end_time: string | null; attendance_status: string }
  route: RoutePoint[]
  total_points: number
  total_distance_meters: number
  total_distance_km: number
  visit_locations: VisitLocation[]
  long_stops: LongStop[]
  long_stops_count: number
  long_stops_total_minutes: number
}

interface TimelineEvent {
  time: string; type: string; title: string; description: string
  latitude: string | null; longitude: string | null
  metadata: Record<string, unknown>
}

interface TimelineData {
  employee: EmployeeInfo
  session: { id: string; status: string; start_time: string; end_time: string | null; attendance_status: string }
  events: TimelineEvent[]
}

const formatDuration = (m?: number) => {
  if (m == null || isNaN(m)) return '--'
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  workday_start: { label: 'بداية يوم العمل', color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500' },
  workday_end: { label: 'نهاية يوم العمل', color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500' },
  break_start: { label: 'بداية استراحة', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  break_end: { label: 'نهاية استراحة', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  visit_start: { label: 'بداية زيارة', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  visit_end: { label: 'نهاية زيارة', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  order_created: { label: 'طلب جديد', color: 'text-orange-600', bg: 'bg-orange-50', dot: 'bg-orange-500' },
  collection_taken: { label: 'تحصيل', color: 'text-cyan-600', bg: 'bg-cyan-50', dot: 'bg-cyan-500' },
  new_customer: { label: 'عميل جديد', color: 'text-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-500' },
}

function MapFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 0) map.fitBounds(points)
  }, [points, map])
  return null
}

export default function EmployeeDayMapPage() {
  const { employeeId, date } = useParams<{ employeeId: string; date: string }>()
  const navigate = useNavigate()
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  const today = date ?? new Date().toISOString().slice(0, 10)

  const [detail, setDetail] = useState<EmployeeDetail | null>(null)
  const [mapData, setMapData] = useState<DayMapData | null>(null)
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'timeline' | 'stops' | 'summary'>('timeline')
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = useCallback(async (showRefreshing = false) => {
    if (!token || !employeeId) return
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)

    const [detailRes, mapRes, timelineRes] = await Promise.all([
      supabase.rpc('get_employee_detail', { p_token: token?.trim(), p_employee_id: employeeId, p_date: today }),
      supabase.rpc('get_employee_day_map', { p_token: token?.trim(), p_employee_id: employeeId, p_date: today }),
      supabase.rpc('get_employee_day_timeline', { p_token: token?.trim(), p_employee_id: employeeId, p_date: today }),
    ])

    if (detailRes.data && !((detailRes.data as Record<string, unknown>).error)) setDetail(detailRes.data as EmployeeDetail)
    if (mapRes.data && !((mapRes.data as Record<string, unknown>).error)) setMapData(mapRes.data as DayMapData)
    if (timelineRes.data && !((timelineRes.data as Record<string, unknown>).error)) setTimeline(timelineRes.data as TimelineData)

    setLoading(false)
    setRefreshing(false)
  }, [token, employeeId, today])

  useEffect(() => { fetchAll() }, [fetchAll])

  const validRoute = (mapData?.route ?? []).filter(p => p.latitude != null && p.longitude != null)
  const routePoints = validRoute.map(p => [p.latitude, p.longitude] as [number, number])

  const mapCenter = routePoints.length > 0 ? routePoints[0] : (mapData?.visit_locations?.[0] ? [mapData.visit_locations[0].latitude, mapData.visit_locations[0].longitude] as [number, number] : [30.0444, 31.2357] as [number, number])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <p className="text-gray-500">جاري تحميل بيانات اليوم...</p>
      </div>
    )
  }

  const emp = detail?.employee
  const sess = detail?.session
  const summary = detail?.summary

  const KPI_CARDS = summary ? [
    { label: 'الطلبات', value: summary.total_orders.toString(), color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'المبيعات', value: summary.total_sales?.toLocaleString('ar-EG') + ' ج.م', color: 'text-orange-700', bg: 'bg-orange-100' },
    { label: 'التحصيل', value: summary.total_collections.toString(), color: 'text-cyan-600', bg: 'bg-cyan-50' },
    { label: 'قيمة التحصيل', value: summary.total_collections_amount?.toLocaleString('ar-EG') + ' ج.م', color: 'text-cyan-700', bg: 'bg-cyan-100' },
    { label: 'عملاء جدد', value: summary.new_customers.toString(), color: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'الزيارات', value: summary.total_visits + '/' + summary.completed_visits, color: 'text-blue-600', bg: 'bg-blue-50' },
  ] : []

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-lg mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-200 rounded-xl">
            <ArrowRight className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1" />
          <button onClick={() => fetchAll(true)} disabled={refreshing} className="p-1 hover:bg-gray-200 rounded-xl">
            <RefreshCw className={`w-5 h-5 text-blue-600 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Employee Header */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
              {emp?.full_name?.charAt(0) ?? '?'}
            </div>
            <div className="flex-1">
              <h1 className="font-bold text-gray-800 text-lg">{emp?.full_name}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {emp?.code && <span>كود: {emp.code}</span>}
                {emp?.role_name && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{emp.role_name}</span>}
              </div>
              {emp?.manager_name && <p className="text-xs text-gray-400 mt-0.5">المدير: {emp.manager_name}</p>}
            </div>
          </div>

          {sess && (
            <div className="grid grid-cols-4 gap-1.5 mt-3 text-xs">
              <div className="bg-green-50 rounded-lg p-1.5 text-center">
                <p className="text-green-600 font-bold">{sess.status === 'active' ? 'نشط' : sess.status === 'completed' ? 'مكتمل' : sess.status || '--'}</p>
                <p className="text-[10px] text-gray-400">الحالة</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-1.5 text-center">
                <p className="text-blue-600 font-bold text-[10px]">{sess.start_time ? new Date(sess.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</p>
                <p className="text-[10px] text-gray-400">البداية</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-1.5 text-center">
                <p className="text-purple-600 font-bold">{formatDuration(sess.duration_minutes)}</p>
                <p className="text-[10px] text-gray-400">المدة</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-1.5 text-center">
                <p className="text-amber-600 font-bold">{formatDuration(sess.break_minutes)}</p>
                <p className="text-[10px] text-gray-400">استراحة</p>
              </div>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KPI_CARDS.slice(0, 3).map((kpi, i) => (
            <div key={i} className={`${kpi.bg} rounded-xl p-3 text-center`}>
              <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-[10px] text-gray-500">{kpi.label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KPI_CARDS.slice(3, 6).map((kpi, i) => (
            <div key={i} className={`${kpi.bg} rounded-xl p-3 text-center`}>
              <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-[10px] text-gray-500">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Distance + Points Badge */}
        {mapData && (
          <div className="flex gap-2 mb-3 text-xs">
            <span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg">{mapData.total_distance_km} كم</span>
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{mapData.total_points} نقطة تتبع</span>
            {mapData.long_stops_count > 0 && <span className="bg-amber-50 text-amber-600 px-2 py-1 rounded-lg">{mapData.long_stops_count} توقفات ({formatDuration(mapData.long_stops_total_minutes)})</span>}
          </div>
        )}

        {/* Map */}
        {(routePoints.length > 0 || (mapData?.visit_locations?.length ?? 0) > 0) && (
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm mb-4" style={{ height: 300 }}>
            <MapContainer
              center={mapCenter}
              zoom={13}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
            >
              <MapFitBounds points={routePoints} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Polyline positions={routePoints} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7 }} />

              {validRoute.map((p, i) => (
                <CircleMarker
                  key={i}
                  center={[p.latitude, p.longitude]}
                  radius={i === 0 || i === validRoute.length - 1 ? 5 : 2}
                  pathOptions={{ color: i === 0 ? '#22c55e' : i === validRoute.length - 1 ? '#ef4444' : '#3b82f6', fillOpacity: 0.8 }}
                >
                  <Popup>{p.time ? new Date(p.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}</Popup>
                </CircleMarker>
              ))}

              {mapData?.visit_locations.filter(v => v.latitude).map((v) => (
                <LeafletMarker key={v.visit_id} position={[v.latitude, v.longitude]} icon={visitIcon}>
                  <Popup>
                    <div className="text-xs">
                      <p className="font-bold">{v.customer_name}</p>
                      <p>{v.check_in_at ? new Date(v.check_in_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</p>
                      {v.visit_result && <p>{v.visit_result}</p>}
                    </div>
                  </Popup>
                </LeafletMarker>
              ))}
            </MapContainer>
          </div>
        )}

        {routePoints.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-8 mb-4 text-center text-gray-400">
            <MapPinned className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm">لا توجد نقاط تتبع لهذا اليوم</p>
          </div>
        )}

        {/* Last Location */}
        {detail?.last_location && (
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-4">
            <div className="flex items-center gap-2 text-xs">
              <Navigation className="w-3 h-3 text-gray-400" />
              <span className="text-gray-500">آخر موقع: {detail.last_location.latitude?.toFixed(4)}, {detail.last_location.longitude?.toFixed(4)}</span>
              <span className="text-gray-300">— {new Date(detail.last_location.recorded_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-3">
          {(['timeline', 'stops', 'summary'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {tab === 'timeline' ? 'الجدول الزمني' : tab === 'stops' ? 'التوقفات' : 'ملخص اليوم'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'timeline' && (
          <div className="space-y-1.5 mb-4">
            {timeline?.events.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <Clock className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">لا توجد أحداث لهذا اليوم</p>
              </div>
            )}
            {timeline?.events.map((ev, i) => {
              const cfg = EVENT_TYPE_CONFIG[ev.type] ?? { label: ev.type, color: 'text-gray-600', bg: 'bg-gray-50' }
              return (
                <div key={i} className="flex gap-2">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${cfg.dot || 'bg-gray-400'}`} />
                    {i < timeline.events.length - 1 && <div className="w-0.5 flex-1 bg-gray-200" />}
                  </div>
                  <div className={`flex-1 ${cfg.bg} rounded-xl p-2.5`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-[10px] text-gray-400">{new Date(ev.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {ev.description && <p className="text-xs text-gray-600 mt-0.5">{ev.description}</p>}
                    {ev.latitude && ev.longitude && (
                      <a
                        href={`https://www.google.com/maps?q=${ev.latitude},${ev.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 mt-0.5 inline-block"
                      >
                        فتح الموقع
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'stops' && (
          <div className="space-y-2 mb-4">
            {(!mapData?.long_stops || mapData.long_stops.length === 0) ? (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">لا توجد توقفات طويلة</p>
              </div>
            ) : (
              mapData.long_stops.map((stop, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-500">⏸</span>
                      <span className="font-bold text-gray-800 text-sm">توقف {formatDuration(stop.duration_minutes)}</span>
                    </div>
                    {stop.latitude && (
                      <a
                        href={`https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600"
                      >
                        <Navigation className="w-3 h-3 inline" />
                      </a>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {new Date(stop.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} → {new Date(stop.end_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
            <h3 className="font-bold text-gray-800 mb-3">ملخص يوم العمل</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">حالة اليوم</span>
                <span className="font-bold text-gray-800">{sess?.status === 'active' ? 'قيد العمل' : sess?.status === 'completed' ? 'تم الإنتهاء' : '--'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">وقت البدء</span>
                <span className="font-bold text-gray-800">{sess?.start_time ? new Date(sess.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">وقت الإنتهاء</span>
                <span className="font-bold text-gray-800">{sess?.end_time ? new Date(sess.end_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">إجمالي المدة</span>
                <span className="font-bold text-gray-800">{formatDuration(sess?.duration_minutes)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">وقت الاستراحات</span>
                <span className="font-bold text-amber-600">{formatDuration(sess?.break_minutes)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">صافي وقت العمل</span>
                <span className="font-bold text-green-600">{formatDuration(sess?.net_minutes)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">المسافة المقطوعة</span>
                <span className="font-bold text-indigo-600">{mapData?.total_distance_km ?? 0} كم</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">إجمالي الطلبات</span>
                <span className="font-bold text-orange-600">{summary?.total_orders ?? 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">إجمالي المبيعات</span>
                <span className="font-bold text-orange-700">{summary?.total_sales?.toLocaleString('ar-EG') ?? 0} ج.م</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">التحصيل</span>
                <span className="font-bold text-cyan-600">{summary?.total_collections_amount?.toLocaleString('ar-EG') ?? 0} ج.م</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">عدد الزيارات</span>
                <span className="font-bold text-blue-600">{summary?.total_visits ?? 0} (مكتملة: {summary?.completed_visits ?? 0})</span>
              </div>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  )
}
