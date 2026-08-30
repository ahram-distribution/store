import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import 'leaflet/dist/leaflet.css'

export interface ExecMapMarker {
  id: string
  latitude: number
  longitude: number
  label: string
  sub?: string
  color?: string
}

function centerOf(points: [number, number][]): [number, number] {
  if (!points.length) return [30.0444, 31.2357]
  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  const lat = lats.reduce((a, b) => a + b, 0) / lats.length
  const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length
  return [lat, lng]
}

function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const b = L.latLngBounds(points)
    if (points.length === 1) {
      map.fitBounds(b.pad(0.4))
    } else {
      map.fitBounds(b.pad(0.2))
    }
  }, [map, points])
  return null
}

export function ExecutiveMap({ markers, height = 320 }: { markers: ExecMapMarker[]; height?: number }) {
  const points = useMemo(() => markers.map((m) => [m.latitude, m.longitude] as [number, number]), [markers])

  return (
    <div style={{ height, width: '100%', borderRadius: 12 }} className="overflow-hidden border border-border" dir="ltr">
      <MapContainer center={centerOf(points)} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <FitAll points={points} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {markers.map((m) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:24px;height:24px;border-radius:50%;background:${m.color || '#2563eb'};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          })
          return (
            <Marker key={m.id} position={[m.latitude, m.longitude]} icon={icon}>
              <Popup>
                <div dir="rtl" className="text-xs font-semibold">{m.label}</div>
                {m.sub ? <div dir="rtl" className="text-[10px] text-gray-500">{m.sub}</div> : null}
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}