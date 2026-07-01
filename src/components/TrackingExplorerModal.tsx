import { useMemo, useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker as LeafletMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { locationService } from '../services/location'

const visitIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:20px;line-height:1">📍</span>', iconSize: [20, 20], iconAnchor: [10, 18] })
const stopIcon = L.divIcon({ className: 'bg-transparent', html: '<span style="font-size:18px;line-height:1">⏸️</span>', iconSize: [18, 18], iconAnchor: [9, 9] })

function MapFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useMemo(() => { if (points.length > 0) map.fitBounds(points, { padding: [40, 40] }) }, [points])
  return null
}

function fmtTime(t?: string) {
  if (!t) return '--'
  try { return new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return t && t.length >= 5 ? t.slice(0, 5) : t }
}

interface TLEvent {
  time: string; type: string; title: string; description: string
  latitude?: string | null; longitude?: string | null
}

interface MapData {
  route: Array<{ latitude: number; longitude: number; time: string; type: string }>
  visit_locations: Array<{ visit_id: string; customer_id: string; customer_name: string; latitude: number; longitude: number; check_in_at: string; check_out_at: string | null; visit_result: string }>
  long_stops?: Array<{ start_time: string; end_time: string; duration_minutes: number; latitude: number; longitude: number }>
  total_distance_km: number; total_points: number
}

interface Props {
  open: boolean; onClose: () => void
  employeeName: string; employeeCode: string; date: string
  sessionStart?: string | null; sessionEnd?: string | null
  timeline: { events: TLEvent[] } | null
  mapData: MapData | null
}

export default function TrackingExplorerModal({ open, onClose, employeeName, employeeCode, date, sessionStart, sessionEnd, timeline, mapData }: Props) {
  const [addresses, setAddresses] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || !mapData?.visit_locations) return
    let cancelled = false
    mapData.visit_locations.forEach((v) => {
      const key = `${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`
      if (!addresses[key]) {
        locationService.reverseGeocodeStructured(v.latitude, v.longitude).then((addr) => {
          if (cancelled) return
          if (addr) {
            const short = locationService.formatShortAddress(v.latitude, v.longitude, addr)
            setAddresses((prev) => ({ ...prev, [key]: short || addr.displayName }))
          }
        })
      }
    })
    return () => { cancelled = true }
  }, [open, mapData])

  const routePoints: [number, number][] = useMemo(() => {
    if (!mapData?.route) return []
    return mapData.route.map((p) => [p.latitude, p.longitude])
  }, [mapData])

  const durationMinutes = useMemo(() => {
    if (!sessionStart || !sessionEnd) return null
    const s = new Date(sessionStart).getTime()
    const e = new Date(sessionEnd).getTime()
    if (isNaN(s) || isNaN(e)) return null
    const raw = Math.round((e - s) / 60000)
    if (raw > 960) return null
    return raw
  }, [sessionStart, sessionEnd])

  if (!open) return null

  const hasMapData = routePoints.length > 0 || (mapData?.visit_locations && mapData.visit_locations.length > 0)

  function fmtDuration(min: number) {
    const h = Math.floor(min / 60); const m = min % 60
    return h > 0 ? `${h}س ${m}د` : `${m}د`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div>
            <h2 className="text-sm font-bold text-text">مستكشف التتبع</h2>
            <p className="text-xs text-text-secondary">{employeeName} ({employeeCode}) — {date?.slice(0, 10)}</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text p-1 text-lg">&times;</button>
        </div>

        <div className="grid grid-cols-4 gap-2 p-4 bg-surface/30 text-center text-xs">
          <div><div className="text-lg font-bold text-text">{mapData?.total_distance_km ? `${mapData.total_distance_km} كم` : '\u2014'}</div><div className="text-[10px] text-text-secondary">المسافة</div></div>
          <div><div className="text-lg font-bold text-text">{mapData?.total_points ?? 0}</div><div className="text-[10px] text-text-secondary">نقاط التتبع</div></div>
          <div><div className="text-lg font-bold text-text">{mapData?.visit_locations?.length ?? 0}</div><div className="text-[10px] text-text-secondary">الزيارات</div></div>
          <div><div className="text-lg font-bold text-text">{durationMinutes != null ? fmtDuration(durationMinutes) : '\u2014'}</div><div className="text-[10px] text-text-secondary">المدة</div></div>
        </div>

        {hasMapData ? (
          <div className="rounded-lg overflow-hidden mx-4 mb-4" style={{ height: 350 }}>
            <MapContainer center={routePoints[0] || [30.0, 31.0]} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
              <MapFitBounds points={routePoints} />
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {routePoints.length > 1 && (
                <Polyline positions={routePoints} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7 }} />
              )}
              {mapData?.visit_locations?.map((v) => {
                const addrKey = `${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`
                const addr = addresses[addrKey]
                return (
                <LeafletMarker key={v.visit_id} position={[v.latitude, v.longitude]} icon={visitIcon}>
                  <Popup>
                    <div className="text-xs">
                      <p className="font-bold">{v.customer_name}</p>
                      <p className="text-text-secondary">{fmtTime(v.check_in_at)}{v.check_out_at ? ` → ${fmtTime(v.check_out_at)}` : ''}</p>
                      {addr && <p className="text-text-secondary text-[10px]">{addr}</p>}
                      {v.visit_result && <p className="text-text-secondary">{v.visit_result}</p>}
                    </div>
                  </Popup>
                </LeafletMarker>
              )})}
              {routePoints.length > 0 && (
                <CircleMarker center={routePoints[0]} radius={8}
                  pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9 }}>
                  <Popup><div className="text-xs font-bold">بداية المسار</div><div className="text-text-secondary">{fmtTime(mapData?.route[0]?.time)}</div></Popup>
                </CircleMarker>
              )}
              {routePoints.length > 1 && (
                <CircleMarker center={routePoints[routePoints.length - 1]} radius={8}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 }}>
                  <Popup><div className="text-xs font-bold">نهاية المسار</div><div className="text-text-secondary">{fmtTime(mapData?.route[mapData.route.length - 1]?.time)}</div></Popup>
                </CircleMarker>
              )}
              {mapData?.long_stops?.map((stop, i) => (
                <LeafletMarker key={i} position={[stop.latitude, stop.longitude]} icon={stopIcon}>
                  <Popup>
                    <div className="text-xs"><p>توقف {stop.duration_minutes} دقيقة</p><p className="text-text-secondary">{fmtTime(stop.start_time)} → {fmtTime(stop.end_time)}</p></div>
                  </Popup>
                </LeafletMarker>
              ))}
            </MapContainer>
          </div>
        ) : (
          <div className="text-center py-8 text-text-secondary text-sm mx-4 mb-4 bg-surface/30 rounded-lg">لا توجد بيانات مسار</div>
        )}

        {hasMapData && (
          <div className="px-4 pb-2 flex flex-wrap gap-3 text-[10px] text-text-secondary">
            <span><span className="inline-block w-3 h-3 rounded-full bg-green-500 align-middle ml-1" />بداية المسار{mapData?.route?.[0]?.time ? `: ${fmtTime(mapData.route[0].time)}` : ''}</span>
            <span><span className="inline-block w-3 h-3 rounded-full bg-red-500 align-middle ml-1" />نهاية المسار{mapData?.route?.[mapData.route.length - 1]?.time ? `: ${fmtTime(mapData.route[mapData.route.length - 1].time)}` : ''}</span>
            <span><span className="ml-1">📍</span>زيارة</span>
            <span><span className="ml-1">⏸️</span>توقف طويل</span>
            <span><span className="inline-block w-3 h-0.5 bg-blue-500 align-middle ml-1" />المسار</span>
          </div>
        )}

        {mapData?.long_stops && mapData.long_stops.length > 0 && (
          <div className="px-4 pb-3">
            <h3 className="text-xs font-bold text-text mb-1">توقفات طويلة</h3>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {mapData.long_stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-text-secondary">{fmtTime(stop.start_time)} → {fmtTime(stop.end_time)}</span>
                  <span className="text-text font-semibold">{stop.duration_minutes} د</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {timeline?.events && timeline.events.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-bold text-text mb-2">الأحداث</h3>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {[...timeline.events].sort((a, b) => a.time.localeCompare(b.time)).map((ev, i) => (
                <div key={i} className="flex items-center gap-2 py-1 text-xs border-b border-border/30 last:border-0">
                  <span className="text-text-secondary w-12 shrink-0">{fmtTime(ev.time)}</span>
                  <span className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                  <span className="font-semibold text-text-secondary">{ev.title}</span>
                  {ev.description ? <span className="text-text">&mdash; {ev.description}</span> : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
