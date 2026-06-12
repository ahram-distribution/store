import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../../../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface TeamMapEmployee {
  employee_id: string
  name: string
  role_name: string | null
  latitude: number
  longitude: number
  status: string
  connection_status: string
  duration_minutes: number
  last_seen_at: string | null
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function createMarkerIcon(color: string): L.DivIcon {
  const colors: Record<string, string> = {
    green: '#22c55e', yellow: '#eab308', red: '#ef4444', gray: '#9ca3af',
  }
  const fill = colors[color] || colors.gray
  return L.divIcon({
    className: 'bg-transparent',
    html: `<div style="width:14px;height:14px;background:${fill};border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 0) {
      if (points.length === 1) map.setView(points[0], 13)
      else map.fitBounds(points, { padding: [30, 30] })
    }
  }, [points, map])
  return null
}

export default function MapTab() {
  const [employees, setEmployees] = useState<TeamMapEmployee[]>([])
  const navigate = useNavigate()
  const token = getToken()

  useEffect(() => {
    if (!token) return
    const fetchMap = async () => {
      const { data } = await supabase.rpc('get_team_map', { p_token: token })
      if (data && Array.isArray(data)) setEmployees(data as TeamMapEmployee[])
    }
    fetchMap()
    const interval = setInterval(fetchMap, 60000)
    return () => clearInterval(interval)
  }, [token])

  const points: [number, number][] = employees
    .filter((e) => e.latitude && e.longitude)
    .map((e) => [e.latitude, e.longitude])

  const statusColor = (s: string) => {
    switch (s) {
      case 'connected': return 'green'
      case 'delayed': return 'yellow'
      case 'lost': return 'red'
      default: return 'gray'
    }
  }

  if (employees.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
        <p className="text-sm">لا توجد بيانات للموقع</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4" style={{ height: 400 }}>
      <MapContainer center={points[0] || [30.0444, 31.2357]} zoom={12}
        style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
        <FitBounds points={points} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {employees.filter((e) => e.latitude && e.longitude).map((e) => (
          <Marker key={e.employee_id} position={[e.latitude, e.longitude]}
            icon={createMarkerIcon(statusColor(e.connection_status))}>
            <Popup>
              <div className="text-xs" style={{ direction: 'rtl', textAlign: 'right', minWidth: 120 }}>
                <p className="font-bold text-gray-800">{e.name}</p>
                {e.role_name && <p className="text-gray-500">{e.role_name}</p>}
                <p className="text-gray-400 mt-0.5">
                  {e.duration_minutes ? `${Math.round(e.duration_minutes / 60)}h ${e.duration_minutes % 60}m` : '--'}
                </p>
                {e.last_seen_at && (
                  <p className="text-gray-400">آخر ظهور: {new Date(e.last_seen_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p>
                )}
                <button
                  onClick={() => navigate(`/attendance/employee/${e.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
                  className="mt-1 text-blue-600 underline font-bold"
                >
                  التفاصيل
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="flex items-center justify-center gap-3 py-1.5 text-[10px] text-gray-500 bg-gray-50">
        <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-1" />متصل</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-yellow-500 ml-1" />متأخر</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1" />منقطع</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-1" />لا يوجد</span>
      </div>
    </div>
  )
}
