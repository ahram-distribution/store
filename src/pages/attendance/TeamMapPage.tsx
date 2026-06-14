import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { MapPinned, User, Clock, Eye, Filter, Layers } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime } from '../../utils/format'
import { LocationDisplay } from '../../components/shared/LocationDisplay'

interface TeamCounters {
  active: number; on_break: number; on_visit: number; not_started: number
  connection_lost: number; zero_visits_today: number; zero_orders_today: number; inactive_over_2h: number
}

interface TeamMember {
  employee_id: string; name: string; role_name: string; status: string
  connection_status: string; latitude: number; longitude: number; last_seen_at?: string
  duration_minutes: number; order_count: number; sales_value: number
  collection_count: number; collection_amount: number; new_customer_count: number; visit_count: number
}

const STATUS_COLORS: Record<string, string> = {
  working: '#22c55e', on_visit: '#3b82f6', on_break: '#f59e0b', not_started: '#9ca3af',
}
const STATUS_LABELS: Record<string, string> = {
  working: 'يعمل', on_visit: 'زيارة', on_break: 'استراحة', not_started: 'لم يبدأ',
}
const STATUS_BG: Record<string, string> = {
  working: 'bg-green-500', on_visit: 'bg-blue-500', on_break: 'bg-amber-500', not_started: 'bg-gray-400',
}

const CONN_COLORS: Record<string, string> = {
  connected: '#22c55e', delayed: '#eab308', lost: '#ef4444',
}
const CONN_LABELS: Record<string, string> = {
  connected: 'متصل', delayed: 'متأخر', lost: 'منقطع',
}

function statusIcon(member: TeamMember): L.DivIcon {
  const color = STATUS_COLORS[member.status] ?? '#9ca3af'
  const connColor = CONN_COLORS[member.connection_status] ?? '#9ca3af'
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="position:relative;width:28px;height:28px">
      <div style="position:absolute;width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);top:3px;left:3px"></div>
      <div style="position:absolute;width:8px;height:8px;border-radius:50%;background:${connColor};border:1px solid white;bottom:2px;right:0"></div>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

const MAP_ZOOM = 12

function FitAllMarkers({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) { map.setView([30.0444, 31.2357], MAP_ZOOM); return }
    if (points.length === 1) { map.setView(points[0], MAP_ZOOM); return }
    map.fitBounds(points, { padding: [40, 40] })
  }, [points, map])
  return null
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function getToken(): string | null {
  try {
    const t = localStorage.getItem('session_token')
    if (t && uuidRe.test(t.trim())) return t.trim()
    if (t) { console.error('[TeamMapPage] Invalid session_token, clearing'); localStorage.removeItem('session_token') }
    return null
  } catch { return null }
}

const fmtMin = (m?: number) => {
  if (m == null || isNaN(m)) return '--'
  const h = Math.floor(m / 60); const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

export default function TeamMapPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [counters, setCounters] = useState<TeamCounters | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  const token = getToken()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_team_map', { p_token: token?.trim() }).then(({ data }) => {
      if (data) {
        const d = data as { counters: TeamCounters; employees: TeamMember[] }
        setCounters(d.counters ?? null)
        setMembers(d.employees ?? [])
      }
      setLastUpdate(new Date())
      setLoading(false)
    })
  }, [token])

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return members
    if (filterStatus === 'connection_lost') return members.filter(m => m.connection_status === 'lost')
    return members.filter(m => m.status === filterStatus)
  }, [members, filterStatus])

  const mapPoints: [number, number][] = useMemo(
    () => filtered.filter(m => m.latitude && m.longitude).map(m => [m.latitude, m.longitude]),
    [filtered]
  )

  const statusCounts = useMemo(() => {
    const all = members.length
    const working = members.filter(m => m.status === 'working').length
    const onVisit = members.filter(m => m.status === 'on_visit').length
    const onBreak = members.filter(m => m.status === 'on_break').length
    const notStarted = members.filter(m => m.status === 'not_started').length
    const connLost = members.filter(m => m.connection_status === 'lost').length
    return { all, working, onVisit, onBreak, notStarted, connLost }
  }, [members])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50" dir="rtl">
        <p className="text-gray-400">جاري تحميل خريطة الفريق...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-lg mx-auto p-3">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPinned className="w-6 h-6 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-800">خريطة الفريق</h1>
          </div>
          {lastUpdate && (
            <span className="text-[9px] text-gray-400">
               آخر تحديث: {formatTime(lastUpdate)}
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
          <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          {[
            { key: 'all', label: `الكل (${statusCounts.all})`, cls: 'bg-gray-100 text-gray-600' },
            { key: 'working', label: `يعمل (${statusCounts.working})`, cls: 'bg-green-50 text-green-600' },
            { key: 'on_visit', label: `زيارة (${statusCounts.onVisit})`, cls: 'bg-blue-50 text-blue-600' },
            { key: 'on_break', label: `استراحة (${statusCounts.onBreak})`, cls: 'bg-amber-50 text-amber-600' },
            { key: 'not_started', label: `لم يبدأ (${statusCounts.notStarted})`, cls: 'bg-gray-100 text-gray-500' },
            { key: 'connection_lost', label: `منقطع (${statusCounts.connLost})`, cls: 'bg-red-50 text-red-600' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterStatus(f.key)}
              className={`text-[10px] px-2.5 py-1 rounded-full font-bold whitespace-nowrap shrink-0 transition-all ${filterStatus === f.key ? f.cls + ' ring-2 ring-offset-1' : 'bg-gray-50 text-gray-400'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Counters */}
        {counters && (
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            <CounterBox label="نشط" value={counters.active} color="text-green-600" bg="bg-green-50" />
            <CounterBox label="زيارة" value={counters.on_visit} color="text-blue-600" bg="bg-blue-50" />
            <CounterBox label="استراحة" value={counters.on_break} color="text-amber-600" bg="bg-amber-50" />
            <CounterBox label="انقطاع" value={counters.connection_lost} color="text-red-600" bg="bg-red-50" />
            <CounterBox label="لم يبدأ" value={counters.not_started} color="text-gray-500" bg="bg-gray-100" />
            <CounterBox label="بلا زيارات" value={counters.zero_visits_today} color="text-purple-600" bg="bg-purple-50" />
            <CounterBox label="بلا طلبات" value={counters.zero_orders_today} color="text-orange-600" bg="bg-orange-50" />
            <CounterBox label="خامل 2س" value={counters.inactive_over_2h} color="text-rose-600" bg="bg-rose-50" />
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setViewMode('map')}
            className={`flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-full font-bold ${viewMode === 'map' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            <MapPinned className="w-3 h-3" /> الخريطة
          </button>
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-full font-bold ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            <Layers className="w-3 h-3" /> القائمة
          </button>
        </div>

        {/* Map View */}
        {viewMode === 'map' && (
          <div className="relative mb-3">
            <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 380 }}>
              {mapPoints.length > 0 ? (
                <MapContainer center={mapPoints[0]} zoom={MAP_ZOOM} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                  <FitAllMarkers points={mapPoints} />
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {filtered.filter(m => m.latitude && m.longitude).map(m => (
                    <Marker key={m.employee_id} position={[m.latitude, m.longitude]} icon={statusIcon(m)}>
                      <Popup>
                        <div className="text-xs" style={{ minWidth: 150 }}>
                          <p className="font-bold text-sm mb-1">{m.name}</p>
                          <p className="text-gray-500 mb-1">
                            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_BG[m.status] ?? 'bg-gray-400'} ml-1`} />
                            {STATUS_LABELS[m.status] ?? m.status}
                            {' — '}
                            <span className={m.connection_status === 'connected' ? 'text-green-600' : m.connection_status === 'delayed' ? 'text-amber-600' : 'text-red-600'}>
                              {CONN_LABELS[m.connection_status] ?? m.connection_status}
                            </span>
                          </p>
                          <div className="border-t border-gray-100 pt-1 space-y-0.5">
                            <div className="flex justify-between"><span className="text-gray-400">مدة اليوم:</span><span className="font-bold">{fmtMin(m.duration_minutes)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">الزيارات:</span><span className="font-bold">{m.visit_count ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">الطلبات:</span><span className="font-bold">{m.order_count ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">المبيعات:</span><span className="font-bold">{m.sales_value?.toLocaleString('ar-EG')} ج.م</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">التحصيلات:</span><span className="font-bold">{m.collection_count ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-gray-400">عملاء جدد:</span><span className="font-bold">{m.new_customer_count ?? 0}</span></div>
                          </div>
                          {m.last_seen_at && (
                             <p className="text-[9px] text-gray-400 mt-1">آخر ظهور: {formatTime(m.last_seen_at)}</p>
                          )}
                          <div className="flex items-center gap-1 mt-2 border-t border-gray-100 pt-2">
                            <LocationDisplay lat={m.latitude} lng={m.longitude} size="sm" />
                            <button onClick={() => navigate(`/attendance/employee/${m.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
                              className="flex items-center gap-1 text-[9px] text-purple-600 bg-purple-50 px-2 py-1 rounded">
                              <Eye className="w-2.5 h-2.5" /> التفاصيل
                            </button>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center"><MapPinned className="w-8 h-8 mx-auto mb-2" /><p className="text-xs">لا توجد بيانات موقع</p></div>
                </div>
              )}
            </div>
            {/* Legend overlay */}
            <div className="absolute top-2 left-2 z-[1000] bg-white/90 backdrop-blur rounded-lg p-2 shadow text-[10px] space-y-1">
              <span className="font-bold text-gray-600 block mb-1">دليل الحالات</span>
              <LegendItem color="bg-green-500" label="يعمل" />
              <LegendItem color="bg-blue-500" label="في زيارة" />
              <LegendItem color="bg-amber-500" label="استراحة" />
              <LegendItem color="bg-gray-400" label="لم يبدأ" />
              <div className="border-t border-gray-200 pt-1 mt-1">
                <LegendItem color="bg-green-500" label="متصل" />
                <LegendItem color="bg-yellow-500" label="متأخر" />
                <LegendItem color="bg-red-500" label="منقطع" />
              </div>
            </div>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="space-y-2 mb-3">
            {filtered.length === 0 ? (
              <div className="text-center py-6 text-gray-400"><p className="text-xs">لا يوجد موظفون بهذا الفلتر</p></div>
            ) : (
              filtered.map(m => (
                <div key={m.employee_id}
                  className="bg-white rounded-xl shadow-sm p-3 cursor-pointer active:scale-95 transition-all hover:shadow-md"
                  onClick={() => navigate(`/attendance/employee/${m.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${STATUS_BG[m.status] ?? 'bg-gray-400'}`} />
                      <span className="font-bold text-gray-800 text-sm">{m.name}</span>
                      {m.role_name && <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{m.role_name}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${m.connection_status === 'connected' ? 'bg-green-50 text-green-600' : m.connection_status === 'delayed' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                        {CONN_LABELS[m.connection_status] ?? m.connection_status}
                      </span>
                    </div>
                    <LocationDisplay lat={m.latitude} lng={m.longitude} />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1">
                    <Clock className="w-3 h-3" /> {fmtMin(m.duration_minutes)}
                    {m.last_seen_at && <span>— آخر ظهور: {formatTime(m.last_seen_at)}</span>}
                  </div>
                  <div className="flex gap-1 mt-1.5 text-[9px] flex-wrap">
                    <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{STATUS_LABELS[m.status] ?? m.status}</span>
                    <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">طلبات {m.order_count ?? 0}</span>
                    <span className="text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">مبيعات {m.sales_value?.toLocaleString('ar-EG')} ج.م</span>
                    <span className="text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded">تحصيل {m.collection_count ?? 0}</span>
                    <span className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">جدد {m.new_customer_count ?? 0}</span>
                    <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">زيارات {m.visit_count ?? 0}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CounterBox({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-2 text-center`}>
      <p className={`text-base font-bold ${color}`}>{value}</p>
      <p className="text-[9px] text-gray-500">{label}</p>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-gray-500">{label}</span>
    </div>
  )
}
