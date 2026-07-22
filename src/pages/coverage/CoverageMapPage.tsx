import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, Circle, Polygon, useMap } from 'react-leaflet'
import L from 'leaflet'
import PresenceLabel from '../../components/shared/PresenceLabel'
import { LocationRepository } from '../../domain/location'
import type { CoverageCustomer, CoverageEmployee, CoverageSummary } from '../../domain/location'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmtNum = (n?: number) => { if (n == null) return '0'; return n.toLocaleString('ar-EG') }
const fmtPct = (n?: number) => { if (n == null) return '0%'; return `${Math.round(n)}%` }

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
  const h = Math.floor(min / 60); const rest = min % 60
  return `منذ ${h} س ${rest} د`
}

const CUST_COLOR = '#0ea5e9'
const CUST_GRADIENT = ['#38bdf8', '#0284c7']
const CUST_APPROX_COLOR = '#94a3b8'
const CUST_APPROX_GRADIENT = ['#cbd5e1', '#94a3b8']
const EMP_ONLINE = '#22c55e'
const EMP_GRADIENT = ['#4ade80', '#16a34a']
const EMP_OFFLINE = '#94a3b8'
const EMP_OFFLINE_GRADIENT = ['#cbd5e1', '#94a3b8']
const EMP_DELAYED = '#eab308'
const EMP_DELAYED_GRADIENT = ['#facc15', '#ca8a04']
const EMP_LOST = '#ef4444'
const EMP_LOST_GRADIENT = ['#f87171', '#dc2626']
const COV_EXCELLENT = '#22c55e'
const COV_MEDIUM = '#eab308'
const COV_WEAK = '#ef4444'
const COV_NONE = '#94a3b8'

const CUST_STORE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
const EMP_PERSON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'

function customerIcon(approximate: boolean): L.DivIcon {
  const grad = approximate ? CUST_APPROX_GRADIENT : CUST_GRADIENT
  const borderColor = approximate ? '#cbd5e1' : '#ffffff'
  const shadowColor = approximate ? 'rgba(148,163,184,0.3)' : 'rgba(2,132,199,0.35)'
  const dash = approximate ? '8,4' : 'none'
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${grad[0]},${grad[1]});border:2.5px solid ${borderColor};border-radius:7px;box-shadow:0 2px 8px ${shadowColor};stroke-dasharray:${dash}">
      ${CUST_STORE_SVG}
    </div>`,
    iconSize: [28, 28], iconAnchor: [14, 14],
  })
}

function employeeIcon(connection: string): L.DivIcon {
  const cfg = connection === 'connected' ? { grad: EMP_GRADIENT, shadow: 'rgba(22,163,74,0.35)', border: '#ffffff', active: true }
    : connection === 'delayed' ? { grad: EMP_DELAYED_GRADIENT, shadow: 'rgba(202,138,4,0.35)', border: '#ffffff', active: true }
    : connection === 'lost' ? { grad: EMP_LOST_GRADIENT, shadow: 'rgba(220,38,38,0.35)', border: '#ffffff', active: false }
    : { grad: EMP_OFFLINE_GRADIENT, shadow: 'rgba(148,163,184,0.3)', border: '#cbd5e1', active: false }
  const dotColor = connection === 'connected' ? '#22c55e' : connection === 'delayed' ? '#eab308' : '#94a3b8'
  const dotBorder = connection === 'connected' || connection === 'delayed' ? '#ffffff' : '#cbd5e1'
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${cfg.grad[0]},${cfg.grad[1]});border:2.5px solid ${cfg.border};border-radius:8px;box-shadow:0 2px 10px ${cfg.shadow}">
      ${EMP_PERSON_SVG}
      ${cfg.active ? `<div style="position:absolute;bottom:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:${dotBorder};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.2)"><div style="width:8px;height:8px;border-radius:50%;background:${dotColor}"></div></div>` : ''}
    </div>`,
    iconSize: [32, 32], iconAnchor: [16, 16],
  })
}

const LOCATION_SOURCE_LABEL: Record<string, string> = {
  tracking_runtime: 'تتبع مباشر',
  visit_checkin: 'تسجيل زيارة',
  visit_checkout: 'إنهاء زيارة',
  break_gps: 'استراحة',
  customer_location: 'موقع العميل',
  visit_gps: 'زيارة GPS',
  address_geocoded: 'ترميز عنوان',
  unknown: 'بدون موقع',
}

function getCoverageLevel(pct: number): string {
  if (pct >= 80) return 'excellent'
  if (pct >= 50) return 'medium'
  if (pct >= 20) return 'weak'
  return 'none'
}

const COVERAGE_COLORS: Record<string, string> = {
  excellent: COV_EXCELLENT,
  medium: COV_MEDIUM,
  weak: COV_WEAK,
  none: COV_NONE,
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

function cross(o: [number, number], a: [number, number], b: [number, number]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return []
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: [number, number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

function GovernorateOverlay({ selectedGov, customers, employees }: { selectedGov: string | null; customers: CoverageCustomer[]; employees: CoverageEmployee[] }) {
  const map = useMap()
  const polygon = useMemo(() => {
    if (!selectedGov) return []
    const pts: [number, number][] = [
      ...customers.filter(c => c.governorate === selectedGov && c.latitude && c.longitude).map(c => [c.latitude!, c.longitude!] as [number, number]),
      ...employees.filter(e => e.governorate === selectedGov && e.latitude && e.longitude).map(e => [e.latitude!, e.longitude!] as [number, number]),
    ]
    if (pts.length < 3) return []
    const hull = convexHull(pts)
    if (hull.length < 3) return []
    return hull
  }, [selectedGov, customers, employees])

  useEffect(() => {
    if (!selectedGov || polygon.length === 0) {
      if (selectedGov && polygon.length === 0) {
        const pts: [number, number][] = [
          ...customers.filter(c => c.governorate === selectedGov && c.latitude && c.longitude).map(c => [c.latitude!, c.longitude!] as [number, number]),
          ...employees.filter(e => e.governorate === selectedGov && e.latitude && e.longitude).map(e => [e.latitude!, e.longitude!] as [number, number]),
        ]
        if (pts.length > 0) {
          const center = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] as [number, number]
          map.setView(center, 10)
        }
      }
      return
    }
    if (polygon.length > 0) {
      map.fitBounds(polygon, { padding: [50, 50] })
    }
  }, [selectedGov, polygon, map, customers, employees])

  if (!selectedGov || polygon.length < 3) return null
  return (
    <Polygon
      positions={polygon}
      pathOptions={{
        color: '#0052cc',
        fillColor: '#0052cc',
        fillOpacity: 0.12,
        weight: 2.5,
        opacity: 0.6,
      }}
    />
  )
}

function MapLegend() {
  return (
    <div className="absolute bottom-4 right-3 z-[1000] bg-white/95 rounded-lg shadow-md border border-border px-2.5 py-2 text-[10px] leading-relaxed backdrop-blur-sm min-w-[140px]">
      <div className="font-semibold text-text mb-1 text-[11px] border-b border-border/50 pb-1">وسائل الإيضاح</div>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:18,height:18,background:'linear-gradient(135deg,#38bdf8,#0284c7)',borderRadius:4,border:'1.5px solid #fff',boxShadow:'0 1px 3px rgba(2,132,199,0.3)'}}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </span>
          <span className="text-text">عميل</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:20,height:20,background:'linear-gradient(135deg,#4ade80,#16a34a)',borderRadius:5,border:'1.5px solid #fff',boxShadow:'0 1px 3px rgba(22,163,74,0.3)'}}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </span>
          <span className="text-text">مندوب</span>
        </div>
        <div className="border-t border-border/30 pt-1 mt-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span style={{width:10,height:10,borderRadius:'50%',background:'#22c55e',border:'1.5px solid #fff',boxShadow:'0 0 0 1px #22c55e'}}></span>
            <span className="text-text-secondary">GPS مباشر</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{width:10,height:10,borderRadius:'50%',background:'#94a3b8',border:'1.5px dashed #cbd5e1'}}></span>
            <span className="text-text-secondary">موقع تقريبي</span>
          </div>
        </div>
        <div className="border-t border-border/30 pt-1 mt-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span style={{width:10,height:10,borderRadius:'50%',background:'#22c55e',border:'1.5px solid #fff',boxShadow:'0 0 0 1px #22c55e'}}></span>
            <span className="text-text-secondary">متصل</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{width:10,height:10,borderRadius:'50%',background:'#94a3b8',border:'1.5px solid #cbd5e1'}}></span>
            <span className="text-text-secondary">غير متصل</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const LAYERS = ['all', 'employees', 'customers'] as const
type Layer = typeof LAYERS[number]
const LAYER_LABELS: Record<Layer, string> = { all: 'الكل', employees: 'المناديب', customers: 'العملاء' }

interface GovAnalytics {
  name: string; totalCustomers: number; visibleCustomers: number
  totalEmployees: number; visibleEmployees: number
  customerCoverage: number; employeeCoverage: number
  missingCustomers: number; missingEmployees: number
  center?: [number, number]
}

function computeGovAnalytics(customers: CoverageCustomer[], employees: CoverageEmployee[]): GovAnalytics[] {
  const map = new Map<string, { totalCustomers: number; visibleCustomers: number; totalEmployees: number; visibleEmployees: number; points: [number, number][] }>()
  customers.forEach(c => {
    const g = c.governorate || 'غير معروف'
    const entry = map.get(g) || { totalCustomers: 0, visibleCustomers: 0, totalEmployees: 0, visibleEmployees: 0, points: [] }
    entry.totalCustomers++
    if (c.latitude && c.longitude) { entry.visibleCustomers++; entry.points.push([c.latitude, c.longitude]) }
    map.set(g, entry)
  })
  employees.forEach(e => {
    const g = e.governorate || 'غير معروف'
    const entry = map.get(g) || { totalCustomers: 0, visibleCustomers: 0, totalEmployees: 0, visibleEmployees: 0, points: [] }
    entry.totalEmployees++
    if (e.latitude && e.longitude) { entry.visibleEmployees++; entry.points.push([e.latitude, e.longitude]) }
    map.set(g, entry)
  })
  return Array.from(map.entries()).map(([name, data]) => ({
    name,
    totalCustomers: data.totalCustomers,
    visibleCustomers: data.visibleCustomers,
    totalEmployees: data.totalEmployees,
    visibleEmployees: data.visibleEmployees,
    customerCoverage: data.totalCustomers > 0 ? (data.visibleCustomers / data.totalCustomers) * 100 : 0,
    employeeCoverage: data.totalEmployees > 0 ? (data.visibleEmployees / data.totalEmployees) * 100 : 0,
    missingCustomers: data.totalCustomers - data.visibleCustomers,
    missingEmployees: data.totalEmployees - data.visibleEmployees,
    center: data.points.length > 0
      ? [data.points.reduce((s, p) => s + p[0], 0) / data.points.length, data.points.reduce((s, p) => s + p[1], 0) / data.points.length] as [number, number]
      : undefined,
  })).sort((a, b) => a.customerCoverage - b.customerCoverage || a.employeeCoverage - b.employeeCoverage)
}

export default function CoverageMapPage() {
  const [customers, setCustomers] = useState<CoverageCustomer[]>([])
  const [employees, setEmployees] = useState<CoverageEmployee[]>([])
  const [summary, setSummary] = useState<CoverageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [layer, setLayer] = useState<Layer>('all')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [showStats, setShowStats] = useState(true)
  const [statsTab, setStatsTab] = useState<'overview' | 'governorates' | 'representatives'>('overview')
  const [selectedGov, setSelectedGov] = useState<string | null>(null)
  const [showHeatMap, setShowHeatMap] = useState(false)
  const token = getToken()
  const navigate = useNavigate()

  const filteredCustomers = selectedGov ? customers.filter(c => c.governorate === selectedGov) : customers
  const filteredEmployees = selectedGov ? employees.filter(e => e.governorate === selectedGov) : employees

  const allGovAnalytics = useMemo(() => computeGovAnalytics(customers, employees), [customers, employees])

  const nationalSummary = useMemo(() => {
    const all = allGovAnalytics.reduce((acc, g) => ({
      totalCustomers: acc.totalCustomers + g.totalCustomers,
      visibleCustomers: acc.visibleCustomers + g.visibleCustomers,
      totalEmployees: acc.totalEmployees + g.totalEmployees,
      visibleEmployees: acc.visibleEmployees + g.visibleEmployees,
    }), { totalCustomers: 0, visibleCustomers: 0, totalEmployees: 0, visibleEmployees: 0 })
    return {
      ...all,
      customerCoverage: all.totalCustomers > 0 ? (all.visibleCustomers / all.totalCustomers) * 100 : 0,
      employeeCoverage: all.totalEmployees > 0 ? (all.visibleEmployees / all.totalEmployees) * 100 : 0,
    }
  }, [allGovAnalytics])

  const customerSrc = useMemo(() => ({
    location: customers.filter(c => c.location_source === 'customer_location').length,
    visit: customers.filter(c => c.location_source === 'visit_gps').length,
    geocoded: customers.filter(c => c.location_source === 'address_geocoded').length,
    unknown: customers.filter(c => c.location_source === 'unknown').length,
  }), [customers])

  const employeeSrc = useMemo(() => ({
    tracking: employees.filter(e => e.location_source === 'tracking_runtime').length,
    visitIn: employees.filter(e => e.location_source === 'visit_checkin').length,
    offline: employees.filter(e => e.status === 'offline').length,
    noData: employees.filter(e => !e.latitude && !e.longitude && e.status !== 'offline').length,
  }), [employees])

  const hiddenEmployees = employees.filter(e => !e.latitude || !e.longitude)
  const visibleEmployees = employees.filter(e => e.latitude && e.longitude)
  const visibleCustomers = customers.filter(c => c.latitude && c.longitude)

  const heatMapCircles = useMemo(() => {
    if (!showHeatMap) return []
    return allGovAnalytics.filter(g => g.center).map(g => {
      const avgPct = (g.customerCoverage + g.employeeCoverage) / 2
      return { name: g.name, center: g.center!, color: COVERAGE_COLORS[getCoverageLevel(avgPct)], avgPct, total: g.totalCustomers + g.totalEmployees }
    })
  }, [showHeatMap, allGovAnalytics])

  const fetchData = useCallback(async (isInitial: boolean) => {
    if (!token) return
    const repo = new LocationRepository(token)
    const mapData = await repo.getCoverageMap()
    if (isInitial && mapData.customers) setCustomers(mapData.customers)
    if (mapData.employees) setEmployees(mapData.employees)
    if (mapData.summary) setSummary(mapData.summary)
    setLastUpdate(new Date())
    if (isInitial) setLoading(false)
  }, [token])

  useEffect(() => { fetchData(true); const id = setInterval(() => fetchData(false), 60000); return () => clearInterval(id) }, [fetchData])

  const allPoints: [number, number][] = [
    ...(layer !== 'employees' ? filteredCustomers.filter(c => c.latitude && c.longitude).map(c => [c.latitude, c.longitude] as [number, number]) : []),
    ...(layer !== 'customers' ? filteredEmployees.filter(e => e.latitude && e.longitude).map(e => [e.latitude, e.longitude] as [number, number]) : []),
  ]

  const weakGovs = allGovAnalytics.filter(g => g.customerCoverage < 50 && g.totalCustomers > 0)

  if (loading) return (
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
        <p className="text-xs text-text-secondary">جاري تحميل لوحة القيادة...</p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 flex flex-col z-0" dir="rtl">
      {/* === Top Summary Bar === */}
      <div className="bg-white border-b border-border px-4 py-1.5 flex items-center gap-4 overflow-x-auto shrink-0 z-10 shadow-sm">
        <button onClick={() => navigate(-1)} className="text-base shrink-0 ml-1 hover:text-primary transition-colors">←</button>
        <div className="flex gap-3 text-[11px] text-text-secondary shrink-0 items-center">
          <span className="whitespace-nowrap font-bold text-text">العملاء: {fmtNum(summary?.total_customers)}</span>
          <span className="whitespace-nowrap">ظاهر <strong className="text-text">{fmtNum(nationalSummary.visibleCustomers)}</strong>
            <span className={`mr-0.5 font-semibold ${(() => { const l = getCoverageLevel(nationalSummary.customerCoverage); return COVERAGE_COLORS[l] })()}`}>({fmtPct(nationalSummary.customerCoverage)})</span>
          </span>
          <span className="whitespace-nowrap text-danger font-medium">مفقود {fmtNum(nationalSummary.totalCustomers - nationalSummary.visibleCustomers)}</span>
          <span className="w-px h-4 bg-border" />
          <span className="whitespace-nowrap font-bold text-green-700">المندوبين: {fmtNum(nationalSummary.totalEmployees)}</span>
          <span className="whitespace-nowrap">ظاهر <strong className="text-text">{fmtNum(nationalSummary.visibleEmployees)}</strong>
            <span className={`mr-0.5 font-semibold ${(() => { const l = getCoverageLevel(nationalSummary.employeeCoverage); return COVERAGE_COLORS[l] })()}`}>({fmtPct(nationalSummary.employeeCoverage)})</span>
          </span>
          <span className="whitespace-nowrap text-warning font-medium">غير متصل {fmtNum(employeeSrc.offline)}</span>
          <span className="w-px h-4 bg-border" />
          <span className="whitespace-nowrap">زيارات اليوم: <strong className="text-blue-700">{fmtNum(summary?.visited_customers_today)}</strong></span>
          <span className="whitespace-nowrap">طلبات اليوم: <strong className="text-amber-700">{fmtNum(summary?.today_orders)}</strong></span>
          <span className="whitespace-nowrap">مبيعات: <strong className="text-green-700">{fmtNum(summary?.today_sales)}</strong> ج</span>
        </div>
        {lastUpdate && <span className="text-[8px] text-text-secondary shrink-0 mr-auto opacity-50">{fmtDate(lastUpdate.toISOString())}</span>}
      </div>

      {/* === Weak Governorates Alert Bar === */}
      {weakGovs.length > 0 && !selectedGov && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-1 text-[11px] text-red-700 shrink-0 flex items-center gap-1.5">
          <span className="font-bold text-red-500 text-sm">⚡</span>
          <span className="font-medium">{weakGovs.length} محافظات ذات تغطية ضعيفة:</span>
          {weakGovs.slice(0, 3).map(g => (
            <button key={g.name} onClick={() => { setSelectedGov(g.name); setShowStats(true) }}
              className="underline hover:text-red-900 ml-1.5 cursor-pointer font-medium">{g.name} ({fmtPct(g.customerCoverage)})</button>
          ))}
          {weakGovs.length > 3 && <span className="text-red-500">و {weakGovs.length - 3} أخرى</span>}
        </div>
      )}

      {/* === Layer Toggle === */}
      <div className="absolute top-14 right-3 z-[1000] flex gap-1 bg-white/95 rounded-lg shadow-md border border-border p-0.5 backdrop-blur-sm">
        {LAYERS.map(l => (
          <button key={l} onClick={() => setLayer(l)}
            className={`px-3 py-1 text-[11px] rounded transition-colors font-medium ${layer === l ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-surface'}`}>
            {LAYER_LABELS[l]}
          </button>
        ))}
      </div>

      {/* === Back to Egypt === */}
      {selectedGov && (
        <button onClick={() => setSelectedGov(null)}
          className="absolute top-36 right-3 z-[1000] bg-white/95 rounded-lg shadow-md border border-border px-3 py-1.5 text-[11px] text-primary font-semibold hover:bg-surface transition-colors backdrop-blur-sm">
          ← عرض مصر بالكامل
        </button>
      )}

      {/* === Stats Panel (bottom-left, default open) === */}
      <div className="absolute bottom-4 left-3 z-[1000] max-w-[360px]">
        {!showStats ? (
          <button onClick={() => setShowStats(true)}
            className="bg-white rounded-lg shadow-md border border-border px-3 py-2 text-[11px] text-primary font-semibold hover:bg-surface transition-colors whitespace-nowrap shadow-lg">
            📊 فتح لوحة البيانات
          </button>
        ) : (
          <div className="bg-white rounded-lg shadow-lg border border-border overflow-hidden max-h-[75vh] flex flex-col">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface/50">
              <span className="text-[13px] font-bold text-text">{selectedGov || '🇪🇬 مصر'}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowStats(false)}
                  className="text-[10px] text-text-secondary hover:text-text transition-colors px-1.5 py-0.5 rounded hover:bg-border/30">إخفاء</button>
              </div>
            </div>

            {/* Mini National Summary (always visible at top) */}
            {!selectedGov && (
              <div className="px-3 py-2 border-b border-border/50 bg-surface/30">
                <div className="flex gap-5 text-[11px]">
                  <div>
                    <span className="text-text-secondary">العملاء </span>
                    <span className="font-bold text-text">{fmtNum(nationalSummary.totalCustomers)}</span>
                    <span className="text-text-secondary mr-1.5">|</span>
                    <span className="text-success font-semibold">{fmtNum(nationalSummary.visibleCustomers)}</span>
                    <span className={`mr-0.5 font-bold ${COVERAGE_COLORS[getCoverageLevel(nationalSummary.customerCoverage)]}`}>{fmtPct(nationalSummary.customerCoverage)}</span>
                  </div>
                  <div>
                    <span className="text-text-secondary">المندوبين </span>
                    <span className="font-bold text-text">{fmtNum(nationalSummary.totalEmployees)}</span>
                    <span className="text-text-secondary mr-1.5">|</span>
                    <span className="text-success font-semibold">{fmtNum(nationalSummary.visibleEmployees)}</span>
                    <span className={`mr-0.5 font-bold ${COVERAGE_COLORS[getCoverageLevel(nationalSummary.employeeCoverage)]}`}>{fmtPct(nationalSummary.employeeCoverage)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-0.5 px-3 pt-2 border-b border-border">
              {(['overview', 'governorates', 'representatives'] as const).map(tab => (
                <button key={tab} onClick={() => setStatsTab(tab)}
                  className={`px-3 py-1.5 text-[10px] rounded-t transition-colors font-medium ${statsTab === tab ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-surface'}`}>
                  {tab === 'overview' ? 'التشخيص' : tab === 'governorates' ? 'المحافظات' : 'المندوبين'}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="overflow-y-auto p-3 flex-1 max-h-[50vh]">
              {statsTab === 'overview' && (
                <div className="space-y-2">
                  {/* Visibility Diagnostics */}
                  <div className="text-[10px]">
                    <div className="font-bold text-text mb-1 text-[11px]">العملاء — أسباب الاختفاء</div>
                    <div className="mr-2 text-text-secondary space-y-0.5">
                      {customerSrc.location > 0 && <div className="flex items-center gap-1.5"><span className="text-success text-base leading-none">●</span><span>موقع العميل {customerSrc.location}</span></div>}
                      {customerSrc.visit > 0 && <div className="flex items-center gap-1.5"><span className="text-success text-base leading-none">●</span><span>زيارة GPS {customerSrc.visit}</span></div>}
                      {customerSrc.geocoded > 0 && <div className="flex items-center gap-1.5"><span style={{color: CUST_APPROX_COLOR}} className="text-base leading-none">◌</span><span>ترميز عنوان {customerSrc.geocoded}</span></div>}
                      {customerSrc.unknown > 0 && <div className="flex items-center gap-1.5"><span className="text-danger text-base leading-none">●</span><span>بدون موقع {customerSrc.unknown} — لا يوجد موقع عميل أو زيارة GPS أو ترميز</span></div>}
                    </div>
                    <div className="font-bold text-text mt-2 mb-1 text-[11px]">المندوبين — أسباب الاختفاء</div>
                    <div className="mr-2 text-text-secondary space-y-0.5">
                      {employeeSrc.tracking > 0 && <div className="flex items-center gap-1.5"><span className="text-success text-base leading-none">●</span><span>تتبع مباشر {employeeSrc.tracking}</span></div>}
                      {employeeSrc.visitIn > 0 && <div className="flex items-center gap-1.5"><span className="text-success text-base leading-none">●</span><span>تسجيل زيارة {employeeSrc.visitIn}</span></div>}
                      {employeeSrc.offline > 0 && <div className="flex items-center gap-1.5"><span className="text-warning text-base leading-none">●</span><span>لم يسجل الدخول {employeeSrc.offline}</span></div>}
                      {employeeSrc.noData > 0 && <div className="flex items-center gap-1.5"><span className="text-danger text-base leading-none">●</span><span>بدون بيانات {employeeSrc.noData} — لا تتبع ولا زيارة</span></div>}
                    </div>
                  </div>

                  {/* Heat Map Toggle */}
                  <div className="flex items-center gap-2 pt-1.5 border-t border-border/50">
                    <span className="text-[10px] font-semibold text-text">🗺️ خريطة التغطية</span>
                    <button onClick={() => setShowHeatMap(!showHeatMap)}
                      className={`px-2.5 py-0.5 text-[10px] rounded transition-colors font-semibold ${showHeatMap ? 'bg-primary text-white shadow-sm' : 'bg-gray-200 text-text-secondary hover:bg-gray-300'}`}>
                      {showHeatMap ? 'ON' : 'OFF'}
                    </button>
                    <div className="flex gap-1.5 mr-auto">
                      {[['قوية', COV_EXCELLENT], ['متوسطة', COV_MEDIUM], ['ضعيفة', COV_WEAK], ['بدون', COV_NONE]].map(([label, color]) => (
                        <span key={label} className="flex items-center gap-0.5 text-[8px] text-text-secondary">
                          <span style={{background: color, width: 6, height: 6, display: 'inline-block', borderRadius: '50%'}}></span>{label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {statsTab === 'governorates' && (
                <div>
                  {allGovAnalytics.length === 0 ? (
                    <div className="text-[11px] text-text-secondary text-center py-4">لا توجد بيانات</div>
                  ) : (
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr className="border-b border-border/50 text-text-secondary">
                          <th className="text-right py-1 px-1.5 font-semibold">المحافظة</th>
                          <th className="text-center py-1 px-1.5 font-semibold">العملاء</th>
                          <th className="text-center py-1 px-1.5 font-semibold">التغطية</th>
                          <th className="text-center py-1 px-1.5 font-semibold">مندوبين</th>
                          <th className="text-center py-1 px-1.5 font-semibold">المفقود</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allGovAnalytics.map(g => {
                          const custLevel = getCoverageLevel(g.customerCoverage)
                          const isSelected = g.name === selectedGov
                          const weak = g.customerCoverage < 50 && g.totalCustomers > 0
                          return (
                            <tr key={g.name} onClick={() => setSelectedGov(isSelected ? null : g.name)}
                              className={`border-b border-border/20 transition-colors cursor-pointer ${isSelected ? 'bg-primary/10 font-semibold' : weak ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-surface/50'}`}>
                              <td className="py-1 px-1.5 text-text truncate max-w-[70px]">{g.name}</td>
                              <td className="py-1 px-1.5 text-center text-text-secondary">{g.totalCustomers}</td>
                              <td className="py-1 px-1.5 text-center font-semibold" style={{color: COVERAGE_COLORS[custLevel]}}>{fmtPct(g.customerCoverage)}</td>
                              <td className="py-1 px-1.5 text-center text-text-secondary">{g.totalEmployees}</td>
                              <td className="py-1 px-1.5 text-center">{g.missingCustomers + g.missingEmployees > 0 ? <span className="text-danger font-semibold">{g.missingCustomers + g.missingEmployees}</span> : <span className="text-success font-semibold">0</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {weakGovs.length > 0 && !selectedGov && (
                    <div className="mt-2 p-2 bg-red-50 rounded border border-red-200 text-[10px] text-red-700 flex items-center gap-1">
                      <span className="font-bold text-red-500">⚡</span>
                      <span>{weakGovs.length} محافظة تحتاج اهتمام — انقر على المحافظة للتكبير</span>
                    </div>
                  )}
                </div>
              )}

              {statsTab === 'representatives' && (
                <div>
                  {employees.length === 0 ? (
                    <div className="text-[11px] text-text-secondary text-center py-4">لا توجد بيانات</div>
                  ) : (
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr className="border-b border-border/50 text-text-secondary">
                          <th className="text-right py-1 px-1.5 font-semibold">الاسم</th>
                          <th className="text-right py-1 px-1.5 font-semibold">المحافظة</th>
                          <th className="text-right py-1 px-1.5 font-semibold">المصدر</th>
                          <th className="text-center py-1 px-1.5 font-semibold">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map(e => {
                          const visible = !!(e.latitude && e.longitude)
                          return (
                            <tr key={e.employee_id} className={`border-b border-border/20 hover:bg-surface/50 ${e.status === 'offline' ? 'opacity-60' : ''}`}>
                              <td className="py-1 px-1.5 text-text font-semibold truncate max-w-[85px]">{e.name}</td>
                              <td className="py-1 px-1.5 text-text-secondary truncate max-w-[60px]">{e.governorate || '--'}</td>
                              <td className="py-1 px-1.5 text-text-secondary truncate max-w-[55px]">{e.location_source ? (LOCATION_SOURCE_LABEL[e.location_source] || e.location_source) : '--'}</td>
                              <td className="py-1 px-1.5 text-center">{visible ? <span className="text-success font-bold text-[11px]">نشط</span> : <span className="text-danger font-bold text-[11px]" title={e.status === 'offline' ? 'لم يسجل الدخول' : 'لا توجد بيانات'}>غير ظاهر</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {hiddenEmployees.length > 0 && (
                    <div className="mt-2 p-2 bg-surface rounded border border-border/50 text-[10px] text-text-secondary">
                      <span className="font-semibold text-text">لماذا {hiddenEmployees.length} مندوب غير ظاهر؟</span>
                      <ul className="list-disc mr-4 mt-1 space-y-0.5">
                        {employeeSrc.offline > 0 && <li>{employeeSrc.offline} لم يسجلوا الدخول اليوم</li>}
                        {employeeSrc.noData > 0 && <li>{employeeSrc.noData} لا توجد لديهم بيانات تتبع أو زيارة</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* === Map === */}
      <div className="flex-1 relative">
        <MapContainer center={[30.0444, 31.2357]} zoom={8} className="h-full w-full" scrollWheelZoom={true}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Governorate Highlight Polygon */}
          <GovernorateOverlay selectedGov={selectedGov} customers={customers} employees={employees} />

          {/* Heat Map Circles */}
          {showHeatMap && heatMapCircles.map(hc => (
            <Circle key={hc.name} center={hc.center}
              radius={Math.max(30000, Math.min(120000, hc.total * 2000))}
              pathOptions={{ color: hc.color, fillColor: hc.color, fillOpacity: 0.3, weight: 3, opacity: 0.7 }}>
              <Popup>
                <div className="text-center text-[11px]" dir="rtl">
                  <div className="font-bold">{hc.name}</div>
                  <div className="text-text-secondary text-[10px]">التغطية: <strong style={{color: hc.color}}>{fmtPct(hc.avgPct)}</strong></div>
                </div>
              </Popup>
            </Circle>
          ))}

          {/* Customers */}
          {layer !== 'employees' && filteredCustomers.filter(c => c.latitude && c.longitude).map(c => (
            <Marker key={`c-${c.id}`} position={[c.latitude, c.longitude]} icon={customerIcon(c.location_source === 'address_geocoded')}>
              <Popup>
                <div className="text-right text-xs leading-relaxed min-w-[220px]" dir="rtl">
                  <div className="font-bold text-sm text-text mb-0.5">{c.name || c.responsible_name}</div>
                  <div className="text-[10px] text-text-secondary mb-1.5 border-b border-border/30 pb-1">🆔 {c.code} · {c.owner_name || 'بدون مشرف'}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-text-secondary">📍 {c.governorate}{c.city ? `، ${c.city}` : ''}</span>
                    <span className={`font-semibold text-left ${c.location_source === 'customer_location' ? 'text-blue-600' : c.location_source === 'visit_gps' ? 'text-blue-600' : c.location_source === 'address_geocoded' ? 'text-gray-500' : ''}`}>
                      {LOCATION_SOURCE_LABEL[c.location_source] || c.location_source}
                    </span>
                    <span className="text-text-secondary">🕐 آخر زيارة: {fmtDate(c.last_visit_at)}</span>
                    <span className="text-text-secondary">📦 آخر طلب: {fmtDate(c.last_order_at)}</span>
                  </div>
                  {c.phone && <div className="text-[10px] text-text-secondary mt-1.5 border-t border-border/30 pt-1">📞 {c.phone}</div>}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Employees */}
          {layer !== 'customers' && filteredEmployees.filter(e => e.latitude && e.longitude).map(e => (
            <Marker key={`e-${e.employee_id}`} position={[e.latitude, e.longitude]} icon={employeeIcon(e.connection_status)}>
              <Popup>
                <div className="text-right text-xs leading-relaxed min-w-[220px]" dir="rtl">
                  <div className="font-bold text-sm text-green-700 mb-0.5">{e.name}</div>
                  <div className="text-[10px] text-text-secondary mb-1.5 border-b border-border/30 pb-1">🆔 {e.code} · {e.role_name}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-text-secondary">📍 {e.governorate}{e.city ? `، ${e.city}` : ''}</span>
                    <span className={`font-semibold text-left ${e.connection_status === 'connected' || e.connection_status === 'working' ? 'text-green-600' : e.connection_status === 'offline' ? 'text-red-600' : 'text-amber-600'}`}>
                      {e.connection_status === 'connected' || e.connection_status === 'working' ? '🟢 متصل' : e.connection_status === 'offline' ? '🔴 غير متصل' : '🟡 غير نشط'}
                    </span>
                    <span className="text-text-secondary col-span-2">
                      {e.location_source ? LOCATION_SOURCE_LABEL[e.location_source] || e.location_source : 'بدون موقع'}
                      {e.last_location_at ? ` · ${fmtTimeAgo(e.last_location_at)}` : ''}
                    </span>
                  </div>
                  {e.connection_status !== 'offline' && (
                    <div className="grid grid-cols-3 gap-2 text-[10px] border-t border-border/30 pt-1.5 mt-1.5 text-center">
                      <div className="bg-surface/50 rounded py-1"><span className="text-text-secondary block">📦</span><strong className="text-text text-[11px]">{e.order_count}</strong></div>
                      <div className="bg-surface/50 rounded py-1"><span className="text-text-secondary block">💰</span><strong className="text-text text-[11px]">{fmtNum(e.sales_value)}</strong></div>
                      <div className="bg-surface/50 rounded py-1"><span className="text-text-secondary block">👤</span><strong className="text-text text-[11px]">{e.visit_count}</strong></div>
                    </div>
                  )}
                  <PresenceLabel connectionStatus={e.connection_status} lastActivityAt={e.last_activity_at} lastActivityType={e.last_activity_type} />
                </div>
              </Popup>
            </Marker>
          ))}

          <FitBounds points={allPoints} />
        </MapContainer>

        {/* === Legend (always visible overlay) === */}
        <MapLegend />
      </div>
    </div>
  )
}
