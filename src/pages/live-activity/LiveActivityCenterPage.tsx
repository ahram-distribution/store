import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatCurrencyShort } from '../../utils/format'

interface KpiData {
  today_orders: number; today_sales: number
  today_collections: number; today_collections_amount: number
  today_visits: number; today_new_customers: number
  active_employees: number; active_visits: number
  served_customers: number
  hourly_orders: number; hourly_sales: number
}

interface LiveEmployee {
  employee_id: string; name: string; status: string
  latitude: number | null; longitude: number | null
  last_seen_at: string | null; connection_status: string
  order_count: number; sales_value: number; visit_count: number
}

interface ActivityEvent {
  time: string; type: string; actor: string; summary: string
  ref_type: string; ref_id: string
}

interface Anomaly {
  type: string; severity: string; employee_id: string
  employee_name: string; detail: string
}

interface CustomerPoint {
  id: string; code: string; name: string
  latitude: number; longitude: number; location_source: string | null
}

const POLL_INTERVAL = 30000
const SEVERITY_COLORS: Record<string, string> = { high: 'text-red-600', medium: 'text-amber-600', low: 'text-yellow-600' }
const SEVERITY_BG: Record<string, string> = { high: 'bg-red-50 border-red-200', medium: 'bg-amber-50 border-amber-200', low: 'bg-yellow-50 border-yellow-200' }

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function EmployeeIcon({ status }: { status: string }) {
  const color = status === 'working' ? '#22c55e' : status === 'on_visit' ? '#3b82f6' : status === 'on_break' ? '#f59e0b' : '#6b7280'
  return <div className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: color }} />
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0'
  return new Intl.NumberFormat('en-US').format(n)
}

export default function LiveActivityCenterPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [employees, setEmployees] = useState<LiveEmployee[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [customers, setCustomers] = useState<CustomerPoint[]>([])
  const [lastUpdate, setLastUpdate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return }
    const { data, error: err } = await supabase.rpc('get_live_activity_center', { p_token: token.trim() })
    if (err) { setError(err.message); setLoading(false); return }
    if (!data || typeof data !== 'object' || (data as Record<string, unknown>).error) {
      setLoading(false); return
    }
    const d = data as Record<string, unknown>
    if (d.kpis) setKpis(d.kpis as KpiData)
    if (d.employees) setEmployees(d.employees as LiveEmployee[])
    if (d.activity) setActivity((d.activity as ActivityEvent[]).slice(0, 30))
    if (d.anomalies) setAnomalies(d.anomalies as Anomaly[])
    setLastUpdate(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    setLoading(false)
    setError(null)
  }, [token])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_coverage_map', { p_token: token.trim() }).then(({ data }) => {
      if (data && typeof data === 'object' && !(data as Record<string, unknown>).error) {
        const d = data as Record<string, unknown>
        if (d.customers) setCustomers(d.customers as CustomerPoint[])
      }
    })
  }, [token])

  function handleActivityClick(ev: ActivityEvent) {
    switch (ev.ref_type) {
      case 'order': navigate(`/orders/${ev.ref_id}`); break
      case 'visit': navigate(`/visits/${ev.ref_id}`); break
      case 'customer': navigate(`/customers/${ev.ref_id}`); break
      case 'collection': navigate('/collections'); break
    }
  }

  const kpiItems = kpis ? [
    { icon: '📦', label: 'طلبات اليوم', value: fmtNum(kpis.today_orders), hourly: `+${kpis.hourly_orders} آخر ساعة`, color: 'text-primary' },
    { icon: '💰', label: 'مبيعات اليوم', value: formatCurrencyShort(kpis.today_sales), hourly: `+${formatCurrencyShort(kpis.hourly_sales)}`, color: 'text-success' },
    { icon: '💵', label: 'تحصيلات اليوم', value: fmtNum(kpis.today_collections), hourly: `${formatCurrencyShort(kpis.today_collections_amount)}`, color: 'text-accent' },
    { icon: '📍', label: 'زيارات اليوم', value: fmtNum(kpis.today_visits), hourly: '', color: 'text-primary' },
    { icon: '👥', label: 'تمت خدمتهم', value: fmtNum(kpis.served_customers), hourly: '', color: 'text-text' },
    { icon: '🆕', label: 'عملاء جدد', value: fmtNum(kpis.today_new_customers), hourly: '', color: 'text-success' },
    { icon: '👨‍💼', label: 'نشطون الآن', value: fmtNum(kpis.active_employees), hourly: '', color: 'text-primary' },
    { icon: '📍', label: 'زيارات نشطة', value: fmtNum(kpis.active_visits), hourly: '', color: 'text-amber-600' },
  ] : []

  if (loading) {
    return <div className="p-4 flex items-center justify-center min-h-[60vh] text-text-secondary text-sm">جاري تحميل مركز النشاط اللحظي...</div>
  }

  if (error) {
    return <div className="p-4 flex items-center justify-center min-h-[60vh] text-danger text-sm">خطأ في تحميل البيانات: {error}</div>
  }

  return (
    <div className="p-3 space-y-3 max-w-lg mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <h1 className="text-base font-bold text-text">مركز النشاط اللحظي</h1>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-secondary">
          <span>{lastUpdate && `آخر تحديث: ${lastUpdate}`}</span>
          <button type="button" onClick={fetchData} className="text-primary hover:text-primary-dark transition-colors">⟳</button>
        </div>
      </div>

      {/* KPI Bar — 2 rows of 4 */}
      {kpis && (
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="grid grid-cols-4 gap-2">
            {kpiItems.map((k) => (
              <div key={k.label} className="text-center min-w-0">
                <div className="text-xs mb-0.5">{k.icon}</div>
                <div className={`text-sm font-bold ${k.color} truncate`}>{k.value}</div>
                <div className="text-[8px] text-text-secondary leading-tight truncate" title={k.label}>{k.label}</div>
                {k.hourly && <div className="text-[7px] text-text-secondary opacity-70 truncate">{k.hourly}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies + Activity Feed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Anomaly Panel */}
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">⚠️</span>
            <h2 className="text-xs font-semibold text-text">تنبيهات</h2>
            {anomalies.length > 0 && (
              <span className="bg-danger text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">{anomalies.length}</span>
            )}
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {anomalies.length === 0 ? (
              <p className="text-[11px] text-text-secondary text-center py-4">لا توجد تنبيهات</p>
            ) : (
              anomalies.map((a, i) => (
                <div key={i} className={`text-[10px] rounded-lg border p-2 ${SEVERITY_BG[a.severity] || 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text truncate">{a.employee_name}</span>
                    <span className={`shrink-0 font-bold ${SEVERITY_COLORS[a.severity] || 'text-gray-600'}`}>
                      {a.severity === 'high' ? 'عالي' : a.severity === 'medium' ? 'متوسط' : 'منخفض'}
                    </span>
                  </div>
                  <div className="text-text-secondary truncate">{a.detail}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">📋</span>
            <h2 className="text-xs font-semibold text-text">النشاط الأخير</h2>
          </div>
          <div className="space-y-1 max-h-[260px] overflow-y-auto">
            {activity.length === 0 ? (
              <p className="text-[11px] text-text-secondary text-center py-4">لا توجد أحداث حديثة</p>
            ) : (
              activity.map((ev, i) => (
                <button key={i} type="button" onClick={() => handleActivityClick(ev)}
                  className="w-full text-right rounded-lg px-2 py-1.5 hover:bg-surface transition-colors active:bg-surface/80 block">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-text-secondary shrink-0">
                      {new Date(ev.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-text font-medium truncate">{ev.actor}</span>
                  </div>
                  <div className="text-[10px] text-text-secondary truncate pr-7">{ev.summary}</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Mini Map */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-1.5 p-2 pb-0">
          <span className="text-sm">🗺️</span>
          <h2 className="text-xs font-semibold text-text">الخريطة الحية</h2>
          <div className="flex gap-2 mr-auto text-[8px] text-text-secondary">
            <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-500" /> نشط</span>
            <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> زيارة</span>
            <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> استراحة</span>
          </div>
        </div>
        <div className="h-52">
          <MapContainer center={[30.05, 31.25]} zoom={7} scrollWheelZoom={true} className="h-full w-full" ref={mapRef}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {employees.filter(e => e.latitude && e.longitude).length === 0 && customers.length === 0 && (
              <EmptyMapPlaceholder />
            )}
            {employees.filter(e => e.latitude && e.longitude).map((e) => (
              <Marker key={e.employee_id} position={[e.latitude!, e.longitude!]}
                icon={L.divIcon({ className: '', html: `<div style="width:12px;height:12px;border-radius:50%;background:${e.status === 'working' ? '#22c55e' : e.status === 'on_visit' ? '#3b82f6' : e.status === 'on_break' ? '#f59e0b' : '#6b7280'};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)" />` })}>
                <Popup>
                  <div className="text-[11px] leading-relaxed" dir="rtl">
                    <div className="font-bold">{e.name}</div>
                    <div>الحالة: {e.status === 'working' ? 'يعمل' : e.status === 'on_visit' ? 'في زيارة' : e.status === 'on_break' ? 'استراحة' : e.status}</div>
                    <div>طلبات اليوم: {e.order_count} | مبيعات: {formatCurrencyShort(e.sales_value)}</div>
                    <div>زيارات: {e.visit_count}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
            {customers.filter(c => c.latitude && c.longitude).map((c) => {
              const isGps = c.location_source === 'gps'
              const isGeocoded = c.location_source === 'address_geocoded'
              const color = isGps ? '#22c55e' : isGeocoded ? '#eab308' : '#f97316'
              return (
                <Marker key={`c-${c.id}`} position={[c.latitude, c.longitude]}
                  icon={L.divIcon({ className: '', iconSize: [8, 8], html: `<div style="width:8px;height:8px;border-radius:50%;background:${color};border:1px solid white;opacity:0.6" />` })}>
                  <Popup>
                    <div className="text-[10px] leading-relaxed" dir="rtl">
                      <div className="font-bold">{c.name}</div>
                      <div>المصدر: {isGps ? 'GPS حقيقى' : isGeocoded ? 'مستخرج من العنوان' : 'مضاف يدوياً'}</div>
                    </div>
                  </Popup>
                </Marker>
              )
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

function EmptyMapPlaceholder() {
  const map = useMap()
  useEffect(() => { map.setView([30.05, 31.25], 7) }, [map])
  return null
}
