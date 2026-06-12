import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { MapPinned, User, Navigation, Clock, Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface TeamCounters {
  active: number
  on_break: number
  on_visit: number
  not_started: number
  connection_lost: number
  zero_visits_today: number
  zero_orders_today: number
  inactive_over_2h: number
}

interface TeamMember {
  employee_id: string
  name: string
  role_name: string
  status: string
  connection_status: string
  latitude: number
  longitude: number
  last_seen_at?: string
  duration_minutes: number
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
  visit_count: number
}

export default function TeamMapPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [counters, setCounters] = useState<TeamCounters | null>(null)
  const [loading, setLoading] = useState(true)
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_team_map', { p_token: token?.trim() }).then(({ data }) => {
      if (data) {
        const d = data as { counters: TeamCounters; employees: TeamMember[] }
        setCounters(d.counters ?? null)
        setMembers(d.employees ?? [])
      }
      setLoading(false)
    })
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <p className="text-gray-500">جاري تحميل خريطة الفريق...</p>
      </div>
    )
  }

  const formatDuration = (m?: number) => {
    if (m == null) return '--'
    const h = Math.floor(m / 60)
    const min = Math.round(m % 60)
    return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'working': return <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">يعمل</span>
      case 'on_visit': return <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">زيارة</span>
      case 'on_break': return <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">استراحة</span>
      default: return null
    }
  }

  const connectionIcon = (status: string) => {
    switch (status) {
      case 'connected': return <span className="text-green-500">🟢</span>
      case 'delayed': return <span className="text-yellow-500">🟡</span>
      case 'lost': return <span className="text-red-500">🔴</span>
      default: return <span className="text-gray-300">⚪</span>
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <MapPinned className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">خريطة الفريق</h1>
        </div>

        {counters && (
          <div className="grid grid-cols-4 gap-1.5 mb-4">
            <div className="bg-green-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-green-600">{counters.active}</p>
              <p className="text-[10px] text-green-700">نشط</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-blue-600">{counters.on_visit}</p>
              <p className="text-[10px] text-blue-700">زيارة</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-amber-600">{counters.on_break}</p>
              <p className="text-[10px] text-amber-700">استراحة</p>
            </div>
            <div className="bg-red-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-red-600">{counters.connection_lost}</p>
              <p className="text-[10px] text-red-700">انقطاع</p>
            </div>
          </div>
        )}

        {counters && (
          <div className="grid grid-cols-4 gap-1.5 mb-4">
            <div className="bg-gray-100 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-gray-600">{counters.not_started}</p>
              <p className="text-[10px] text-gray-500">لم يبدأ</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-purple-600">{counters.zero_visits_today}</p>
              <p className="text-[10px] text-purple-700">بلا زيارات</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-orange-600">{counters.zero_orders_today}</p>
              <p className="text-[10px] text-orange-700">بلا طلبات</p>
            </div>
            <div className="bg-rose-50 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-rose-600">{counters.inactive_over_2h}</p>
              <p className="text-[10px] text-rose-700">خامل 2س</p>
            </div>
          </div>
        )}

        {members.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <MapPinned className="w-12 h-12 mx-auto mb-3" />
            لا توجد بيانات موقع حالياً
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.employee_id}
                className="bg-white rounded-2xl shadow-sm p-4 cursor-pointer active:scale-95 transition-all hover:shadow-md"
                onClick={() => navigate(`/attendance/map/${m.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {connectionIcon(m.connection_status)}
                    <span className="font-bold text-gray-800">{m.name}</span>
                    {m.role_name && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{m.role_name}</span>}
                    {statusBadge(m.status)}
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${m.latitude},${m.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 text-xs bg-blue-50 px-2 py-1 rounded-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Navigation className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(m.duration_minutes)}
                  {m.last_seen_at && <span>— آخر ظهور: {new Date(m.last_seen_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
                <div className="flex gap-1 mt-1.5 text-[10px] flex-wrap">
                  <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">طلبات {m.order_count ?? 0}</span>
                  <span className="text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">مبيعات {m.sales_value?.toLocaleString('ar-EG')} ج.م</span>
                  <span className="text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded">تحصيل {m.collection_count ?? 0}</span>
                  <span className="text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded">قيمة {m.collection_amount?.toLocaleString('ar-EG')} ج.م</span>
                  <span className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">جدد {m.new_customer_count ?? 0}</span>
                  <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">زيارات {m.visit_count ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
