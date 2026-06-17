import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

interface CustomerPoint {
  id: string; code: string; name: string; responsible_name: string
  phone: string; governorate: string; city: string; formatted_address: string
  location_source: string | null
  latitude: number; longitude: number
  owner_code: string; owner_name: string; created_at: string
  total_orders: number; total_sales: number; last_order_at: string | null; last_visit_at: string | null
}

interface EmployeePoint {
  employee_id: string; name: string; code: string; role_name: string
  status: string; connection_status: string
  latitude: number; longitude: number; last_seen_at: string | null; accuracy_meters: number | null
  duration_minutes: number
  order_count: number; sales_value: number; visit_count: number; new_customer_count: number
}

interface Summary {
  total_customers: number; active_employees: number; covered_governorates: number
  visited_customers_today: number; today_orders: number; today_sales: number
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmtNum = (n?: number) => { if (n == null) return '0'; return n.toLocaleString('ar-EG') }
const fmtDate = (d?: string | null) => {
  if (!d) return '--'
  try { return new Date(d).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '--' }
}
const fmtTimeAgo = (d?: string | null) => {
  if (!d) return '--'
  const diff = Date.now() - new Date(d).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'الآن'
  if (min < 60) return `منذ ${min} د`
  const h = Math.floor(min / 60)
  return `منذ ${h} س ${min % 60} د`
}
const fmtDuration = (min?: number) => {
  if (min == null) return '--'
  const h = Math.floor(min / 60); const m = Math.round(min % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function customerIcon(source: string | null): L.DivIcon {
  const colors: Record<string, string> = { gps: '#22c55e', address_geocoded: '#eab308', manual: '#f97316' }
  const fill = source && colors[source] ? colors[source] : '#3b82f6'
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="width:16px;height:16px;background:${fill};border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  })
}

function employeeIcon(connection: string): L.DivIcon {
  const fill = connection === 'connected' ? '#22c55e' : connection === 'delayed' ? '#eab308' : '#ef4444'
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="position:relative;width:32px;height:32px">
      <div style="position:absolute;width:26px;height:26px;border-radius:50%;background:${fill};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);top:3px;left:3px"></div>
      <div style="position:absolute;width:10px;height:10px;border-radius:50%;background:white;border:1px solid #22c55e;bottom:0;right:2px;display:flex;align-items:center;justify-content:center">
        <div style="width:6px;height:6px;border-radius:50%;background:${fill}"></div>
      </div>
    </div>`,
    iconSize: [32, 32], iconAnchor: [16, 16],
  })
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) { map.setView([30.0444, 31.2357], 8); return }
    if (points.length === 1) { map.setView(points[0], 12); return }
    map.fitBounds(points, { padding: [40, 40] })
  }, [points, map])
  return null
}

const LAYERS = ['all', 'employees', 'customers'] as const
type Layer = typeof LAYERS[number]
const LAYER_LABELS: Record<Layer, string> = { all: 'الكل', employees: 'المناديب', customers: 'العملاء' }

export default function CoverageMapPage() {
  const [customers, setCustomers] = useState<CustomerPoint[]>([])
  const [employees, setEmployees] = useState<EmployeePoint[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [layer, setLayer] = useState<Layer>('all')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeePoint | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPoint | null>(null)
  const token = getToken()
  const navigate = useNavigate()

  const fetchData = useCallback(async (isInitial: boolean) => {
    if (!token) return
    const { data } = await supabase.rpc('get_coverage_map', { p_token: token })
    if (data && !data.error) {
      if (isInitial && data.customers) setCustomers(data.customers as CustomerPoint[])
      if (data.employees) setEmployees(data.employees as EmployeePoint[])
      if (data.summary) setSummary(data.summary as Summary)
    }
    setLastUpdate(new Date())
    if (isInitial) setLoading(false)
  }, [token])

  useEffect(() => { fetchData(true); const id = setInterval(() => fetchData(false), 60000); return () => clearInterval(id) }, [fetchData])

  const allPoints: [number, number][] = [
    ...(layer !== 'employees' ? customers.filter(c => c.latitude && c.longitude).map(c => [c.latitude, c.longitude] as [number, number]) : []),
    ...(layer !== 'customers' ? employees.filter(e => e.latitude && e.longitude).map(e => [e.latitude, e.longitude] as [number, number]) : []),
  ]

  if (loading) return (
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
        <p className="text-xs text-text-secondary">جاري تحميل خريطة الانتشار...</p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 flex flex-col z-0" dir="rtl">
      {/* Top Summary Bar */}
      <div className="bg-white border-b border-border px-3 py-2 flex items-center gap-3 overflow-x-auto shrink-0 z-10 shadow-sm">
        <button onClick={() => navigate(-1)} className="text-lg shrink-0 ml-1">→</button>
        <div className="flex gap-3 text-[10px] text-text-secondary shrink-0">
          <span className="whitespace-nowrap">📊 العملاء: <strong className="text-text">{fmtNum(summary?.total_customers)}</strong></span>
          <span className="whitespace-nowrap"><span style="color:#22c55e">🟢</span> <span style="color:#eab308">🟡</span> <span style="color:#f97316">🟠</span> <strong className="text-green-700">{fmtNum(summary?.active_employees)}</strong></span>
          <span className="whitespace-nowrap">🏙 المحافظات: <strong className="text-text">{fmtNum(summary?.covered_governorates)}</strong></span>
          <span className="whitespace-nowrap">👤 زيارات اليوم: <strong className="text-blue-700">{fmtNum(summary?.visited_customers_today)}</strong></span>
          <span className="whitespace-nowrap">📦 طلبات اليوم: <strong className="text-amber-700">{fmtNum(summary?.today_orders)}</strong></span>
          <span className="whitespace-nowrap">💰 مبيعات اليوم: <strong className="text-green-700">{fmtNum(summary?.today_sales)}</strong></span>
        </div>
        {lastUpdate && <span className="text-[8px] text-text-secondary shrink-0 mr-auto opacity-60">{fmtDate(lastUpdate.toISOString())}</span>}
      </div>

      {/* Layer Toggle */}
      <div className="absolute top-14 right-3 z-[1000] flex gap-1 bg-white rounded-lg shadow-md border border-border p-1">
        {LAYERS.map(l => (
          <button key={l} onClick={() => setLayer(l)}
            className={`px-3 py-1 text-[11px] rounded-md transition-colors ${layer === l ? 'bg-primary text-white font-semibold' : 'text-text-secondary hover:bg-surface'}`}>
            {LAYER_LABELS[l]}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer center={[30.0444, 31.2357]} zoom={8} className="h-full w-full" scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Customers */}
          {layer !== 'employees' && customers.filter(c => c.latitude && c.longitude).map(c => (
            <Marker key={`c-${c.id}`} position={[c.latitude, c.longitude]} icon={customerIcon(c.location_source)}>
              <Popup>
                <div className="text-right text-xs leading-relaxed min-w-[220px]" dir="rtl">
                  <div className="font-bold text-sm mb-1.5 border-b pb-1" style={{ color: c.location_source === 'gps' ? '#22c55e' : c.location_source === 'address_geocoded' ? '#eab308' : '#f97316' }}>
                    {c.name || c.responsible_name}
                  </div>
                  <div className="mb-1 text-[10px] font-semibold">{c.location_source === 'gps' ? '🟢 مصدر الموقع: GPS حقيقى' : c.location_source === 'address_geocoded' ? '🟡 مصدر الموقع: مستخرج من العنوان' : c.location_source === 'manual' ? '🟠 مصدر الموقع: مضاف يدوياً' : ''}</div>
                  {c.phone && <div className="mb-0.5"><span className="text-text-secondary">📞 </span>{c.phone}</div>}
                  {c.owner_name && <div className="mb-0.5"><span className="text-text-secondary">👤 </span>{c.owner_name} ({c.owner_code})</div>}
                  {c.governorate && <div className="mb-0.5"><span className="text-text-secondary">🌍 </span>{c.governorate}{c.city ? `، ${c.city}` : ''}</div>}
                  {c.formatted_address && <div className="mb-0.5 text-text-secondary text-[10px] truncate max-w-[200px]">{c.formatted_address}</div>}
                  <div className="border-t my-1 pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    <span>📦 {fmtNum(c.total_orders)} طلب</span>
                    <span>💰 {fmtNum(c.total_sales)} ج</span>
                    <span>🕐 آخر طلب: {fmtDate(c.last_order_at)}</span>
                    <span>👤 آخر زيارة: {fmtDate(c.last_visit_at)}</span>
                  </div>
                  <div className="text-[9px] text-text-secondary mt-1">🆔 {c.code} · {fmtDate(c.created_at)}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Employees */}
          {layer !== 'customers' && employees.filter(e => e.latitude && e.longitude).map(e => (
            <Marker key={`e-${e.employee_id}`} position={[e.latitude, e.longitude]} icon={employeeIcon(e.connection_status)}>
              <Popup>
                <div className="text-right text-xs leading-relaxed min-w-[230px]" dir="rtl">
                  <div className="font-bold text-sm text-green-700 mb-1 border-b pb-1">{e.name}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-1">
                    <span>🆔 {e.code}</span>
                    <span>🏢 {e.role_name}</span>
                    <span>⏱ {fmtDuration(e.duration_minutes)}</span>
                    <span className={`font-semibold ${
                      e.connection_status === 'connected' ? 'text-green-600' :
                      e.connection_status === 'delayed' ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {e.connection_status === 'connected' ? '🟢 متصل' :
                       e.connection_status === 'delayed' ? '🟡 متأخر' : '🔴 منقطع'}
                    </span>
                  </div>
                  <div className="border-t pt-1">
                    <div className="font-semibold text-text mb-0.5">اليوم</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                      <span>📦 {e.order_count} طلب</span>
                      <span>💰 {fmtNum(e.sales_value)} ج</span>
                      <span>👤 {e.visit_count} زيارة</span>
                      <span>🆕 {e.new_customer_count} عميل جديد</span>
                    </div>
                  </div>
                  <div className="text-[9px] text-text-secondary mt-1 flex justify-between">
                    <span>{fmtTimeAgo(e.last_seen_at)}</span>
                    <span>{e.accuracy_meters ? `🎯 ${e.accuracy_meters}m` : ''}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          <FitBounds points={allPoints} />
        </MapContainer>
      </div>
    </div>
  )
}
