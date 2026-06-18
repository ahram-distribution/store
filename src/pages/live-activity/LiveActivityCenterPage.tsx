import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatCurrencyShort } from '../../utils/format'
import { NowPanel } from './NowPanel'
import { LiveTimeline } from './LiveTimeline'
import { AlertPanel } from './AlertPanel'
import { OrdersDrill, VisitsDrill, CustomersDrill, CollectionsDrill, EmployeesDrill } from './DrillDrawers'

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

interface NowPanelData {
  employees_in_visit: number; employees_working: number
  employees_on_break: number; orders_in_progress: number
  collection_in_progress: number
}

interface OrderDrill {
  id: string; order_number: string; customer_name: string
  employee_name: string; total_amount: number; status: string; created_at: string
}

interface VisitDrill {
  id: string; customer_name: string; employee_name: string
  check_in_at: string; check_out_at: string | null; status: string
}

interface CustomerDrill {
  id: string; code: string; company_name: string
  employee_name: string; registered_at?: string; created_at: string
}

interface CollectionDrill {
  id: string; amount: number; employee_name: string; created_at: string
}

const POLL_INTERVAL = 30000

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type MapLayer = 'all' | 'employees' | 'customers'

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0'
  return new Intl.NumberFormat('en-US').format(n)
}

export default function LiveActivityCenterPage() {
  const token = getToken()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [employees, setEmployees] = useState<LiveEmployee[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [customers, setCustomers] = useState<CustomerPoint[]>([])
  const [lastUpdate, setLastUpdate] = useState('')
  const [nowPanel, setNowPanel] = useState<NowPanelData | null>(null)
  const [todayOrders, setTodayOrders] = useState<OrderDrill[]>([])
  const [todayVisits, setTodayVisits] = useState<VisitDrill[]>([])
  const [todayCustomers, setTodayCustomers] = useState<CustomerDrill[]>([])
  const [todayCollections, setTodayCollections] = useState<CollectionDrill[]>([])
  const [mapLayer, setMapLayer] = useState<MapLayer>('all')
  const mapRef = useRef<L.Map | null>(null)

  const [drawer, setDrawer] = useState<string | null>(null)

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
    if (d.activity) setActivity((d.activity as ActivityEvent[]).slice(0, 50))
    if (d.anomalies) setAnomalies(d.anomalies as Anomaly[])
    if (d.now_panel) setNowPanel(d.now_panel as NowPanelData)
    if (d.today_orders) setTodayOrders(d.today_orders as OrderDrill[])
    if (d.today_visits) setTodayVisits(d.today_visits as VisitDrill[])
    if (d.today_customers) setTodayCustomers(d.today_customers as CustomerDrill[])
    if (d.today_collections) setTodayCollections(d.today_collections as CollectionDrill[])
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

  function handleNowItemClick(key: string) {
    switch (key) {
      case 'visits':
      case 'employees_working':
      case 'employees_break':
        setDrawer('employees'); break
      case 'orders':
        setDrawer('orders'); break
      case 'collections':
        setDrawer('collections'); break
    }
  }

  const kpiItems = kpis ? [
    { key: 'orders', icon: '📦', label: 'طلبات اليوم', value: fmtNum(kpis.today_orders), subtext: `+${kpis.hourly_orders} آخر ساعة`, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    { key: 'sales', icon: '💰', label: 'مبيعات اليوم', value: formatCurrencyShort(kpis.today_sales), subtext: `+${formatCurrencyShort(kpis.hourly_sales)}`, color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    { key: 'collections', icon: '💵', label: 'تحصيلات', value: fmtNum(kpis.today_collections), subtext: formatCurrencyShort(kpis.today_collections_amount), color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    { key: 'visits', icon: '📍', label: 'زيارات', value: fmtNum(kpis.today_visits), subtext: `${kpis.active_visits} نشطة`, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    { key: 'customers', icon: '👤', label: 'عملاء جدد', value: fmtNum(kpis.today_new_customers), subtext: `${kpis.served_customers} تمت خدمتهم`, color: 'text-cyan-600', bg: 'bg-cyan-50 border-cyan-200' },
    { key: 'employees', icon: '👨‍💼', label: 'نشطون الآن', value: fmtNum(kpis.active_employees), subtext: `${kpis.active_visits} في زيارة`, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  ] : []

  if (loading) {
    return <div className="p-4 flex items-center justify-center min-h-[60vh] text-text-secondary text-sm">جاري تحميل مركز النشاط اللحظي...</div>
  }

  if (error) {
    return <div className="p-4 flex items-center justify-center min-h-[60vh] text-danger text-sm">خطأ في تحميل البيانات: {error}</div>
  }

  return (
    <div className="p-3 space-y-3 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <h1 className="text-base font-bold text-text">مركز القيادة التنفيذي</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="hidden sm:inline">{lastUpdate && `آخر تحديث: ${lastUpdate}`}</span>
          <button type="button" onClick={fetchData} className="text-primary hover:text-primary-dark transition-colors text-sm">⟳</button>
        </div>
      </div>

      {/* Row 1: Now Panel (يحدث الآن) — clickable items */}
      <NowPanel data={nowPanel} onItemClick={handleNowItemClick} />

      {/* Row 2: KPI Cards — clickable, drill-down */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {kpiItems.map((k) => (
          <button key={k.key} type="button" onClick={() => setDrawer(k.key)}
            className={`text-center rounded-xl border ${k.bg} ${k.border} p-3 hover:shadow-sm active:scale-[0.97] transition-all min-w-0`}>
            <div className="text-lg mb-0.5">{k.icon}</div>
            <div className={`text-sm font-bold ${k.color} truncate`}>{k.value}</div>
            <div className="text-xs text-text-secondary leading-tight truncate">{k.label}</div>
            {k.subtext && <div className="text-[10px] text-text-secondary opacity-70 truncate">{k.subtext}</div>}
          </button>
        ))}
      </div>

      {/* Row 3: Map — Large, with layer control */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between p-2 pb-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🗺️</span>
            <h2 className="text-xs font-semibold text-text">الخريطة الحية</h2>
          </div>
          <div className="flex gap-1">
            {(['all', 'employees', 'customers'] as MapLayer[]).map((layer) => (
              <button key={layer} type="button" onClick={() => setMapLayer(layer)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  mapLayer === layer
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-text-secondary border-border hover:bg-surface'
                }`}>
                {layer === 'all' ? 'الكل' : layer === 'employees' ? 'الموظفون' : 'العملاء'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[45vh] min-h-[280px] w-full">
          <MapContainer center={[30.05, 31.25]} zoom={7} scrollWheelZoom={true} className="h-full w-full" ref={mapRef}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {employees.length === 0 && customers.length === 0 && <EmptyMapPlaceholder />}

            {(mapLayer === 'all' || mapLayer === 'employees') && (
              employees.filter(e => e.latitude && e.longitude).map((e) => {
                const ec = e.status === 'working' ? '#22c55e' : e.status === 'on_visit' ? '#3b82f6' : e.status === 'on_break' ? '#f59e0b' : '#6b7280'
                return (
                  <Marker key={e.employee_id} position={[e.latitude!, e.longitude!]}
                    icon={L.divIcon({ className: '', html: `<div style="width:14px;height:14px;border-radius:50%;background:${ec};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)" />` })}>
                    <Popup>
                      <div className="text-xs leading-relaxed" dir="rtl">
                        <div className="font-bold">{e.name}</div>
                        <div className={e.connection_status === 'active' ? 'text-green-600' : 'text-red-600'}>
                          {e.connection_status === 'active' ? '🟢 متصل' : '🔴 منقطع'}
                        </div>
                        <div>طلبات: {e.order_count} | مبيعات: {formatCurrencyShort(e.sales_value)}</div>
                        <div>زيارات: {e.visit_count}</div>
                      </div>
                    </Popup>
                  </Marker>
                )
              })
            )}

            {(mapLayer === 'all' || mapLayer === 'customers') && (
              customers.filter(c => c.latitude && c.longitude).map((c) => {
                const isGps = c.location_source === 'gps'
                const isGeocoded = c.location_source === 'address_geocoded'
                const color = isGps ? '#22c55e' : isGeocoded ? '#eab308' : '#f97316'
                return (
                  <Marker key={`c-${c.id}`} position={[c.latitude, c.longitude]}
                    icon={L.divIcon({ className: '', iconSize: [8, 8], html: `<div style="width:8px;height:8px;border-radius:50%;background:${color};border:1px solid white;opacity:0.7" />` })}>
                    <Popup>
                      <div className="text-xs leading-relaxed" dir="rtl">
                        <div className="font-bold">{c.name}</div>
                        <div className="text-text-secondary">
                          {isGps ? '🟢 GPS حقيقى' : isGeocoded ? '🟡 مستخرج من العنوان' : '🟠 مضاف يدوياً'}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )
              })
            )}
          </MapContainer>
        </div>
      </div>

      {/* Row 4: Alerts + Timeline side by side */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-2">
          <AlertPanel anomalies={anomalies} />
        </div>
        <div className="md:col-span-3">
          <LiveTimeline events={activity} />
        </div>
      </div>

      <div className="text-center text-xs text-text-secondary md:hidden">{lastUpdate && `آخر تحديث: ${lastUpdate}`}</div>

      {/* Drawers — fixed overlay above everything (z-40) */}
      <OrdersDrill open={drawer === 'orders'} onClose={() => setDrawer(null)} orders={todayOrders} />
      <VisitsDrill open={drawer === 'visits'} onClose={() => setDrawer(null)} visits={todayVisits} />
      <OrdersDrill open={drawer === 'sales'} onClose={() => setDrawer(null)} orders={todayOrders} titleOverride="تفاصيل مبيعات اليوم" />
      <CustomersDrill open={drawer === 'customers'} onClose={() => setDrawer(null)} customers={todayCustomers} />
      <CollectionsDrill open={drawer === 'collections'} onClose={() => setDrawer(null)} collections={todayCollections} />
      <EmployeesDrill open={drawer === 'employees'} onClose={() => setDrawer(null)} employees={employees.map(e => ({
        ...e, id: e.employee_id, name: e.name, employee_code: '',
      }))} />
    </div>
  )
}

function EmptyMapPlaceholder() {
  const map = useMap()
  useEffect(() => { map.setView([30.05, 31.25], 7) }, [map])
  return null
}
