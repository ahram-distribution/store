import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Eye, MapPin, User, Clock, Navigation, History, FileText, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface LiveEntry {
  employee_id: string
  name: string
  role_name: string
  status: string
  session_status: string
  started_at?: string
  duration_minutes?: number
  latitude?: number
  longitude?: number
  last_seen_at?: string
  connection_status: string
  visit_count: number
  break_count: number
  break_minutes: number
  net_minutes: number
  last_seen_label: string
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
}

interface NoStartEntry {
  employee_id: string
  name: string
}

interface EndedEntry {
  employee_id: string
  name: string
  ended_at?: string
  duration_minutes?: number
  visit_count?: number
}

interface LiveData {
  active_count: number
  on_visit_count: number
  on_break_count: number
  connection_loss_count: number
  no_start_count: number
  ended_count: number
  zero_visits_count: number
  zero_orders_count: number
  employees: LiveEntry[]
  no_start_employees: NoStartEntry[]
  ended_employees: EndedEntry[]
}

export default function LiveMonitoringPage({ embedded }: { embedded?: boolean }) {
  const [data, setData] = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [locationPopup, setLocationPopup] = useState<LiveEntry | null>(null)
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    const fetchLive = async () => {
      const { data, error } = await supabase.rpc('get_live_workday_overview', { p_token: token?.trim() })
      if (error) { setLoading(false); return }
      if (data && typeof data === 'object' && !('error' in (data as Record<string, unknown>))) {
        setData(data as LiveData)
      }
      setLoading(false)
    }
    fetchLive()
    const interval = setInterval(fetchLive, 30000)
    return () => clearInterval(interval)
  }, [token])

  const formatDuration = (m?: number) => {
    if (m == null) return '--'
    const h = Math.floor(m / 60)
    const min = Math.round(m % 60)
    return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <span className="text-green-500 text-lg">🟢</span>
      case 'delayed': return <span className="text-yellow-500 text-lg">🟡</span>
      case 'lost': return <span className="text-red-500 text-lg">🔴</span>
      default: return <span className="text-gray-300 text-lg">⚪</span>
    }
  }

  const connectionIcon = (status: string) => {
    switch (status) {
      case 'on_visit': return <span className="text-lg">🔵</span>
      case 'on_break': return <span className="text-lg">🟡</span>
      case 'working': return <span className="text-lg">🟢</span>
      default: return <span className="text-lg">⚪</span>
    }
  }

  const renderEmployeeCard = (entry: LiveEntry) => (
    <div
      key={entry.employee_id}
      className="bg-white rounded-2xl shadow-sm p-4 active:scale-95 transition-all cursor-pointer hover:shadow-md"
      onClick={() => setLocationPopup(entry)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {connectionIcon(entry.status)}
          <span className="font-bold text-gray-800">{entry.name}</span>
          {entry.role_name && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{entry.role_name}</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full ${entry.status === 'working' ? 'bg-green-100 text-green-700' : entry.status === 'on_visit' ? 'bg-blue-100 text-blue-700' : entry.status === 'on_break' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
            {entry.status === 'working' ? 'يعمل' : entry.status === 'on_visit' ? 'في زيارة' : entry.status === 'on_break' ? 'استراحة' : entry.connection_status === 'lost' ? 'انقطاع' : '--'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {statusIcon(entry.connection_status)}
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
        <Clock className="w-3 h-3" />
        {entry.started_at ? new Date(entry.started_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}
        <span className="mx-1">|</span>
        <span className="font-bold text-gray-600">مدة: {formatDuration(entry.duration_minutes)}</span>
      </div>

      <div className="text-xs text-gray-500 mb-2">
        {entry.last_seen_label}
      </div>

      <div className="grid grid-cols-4 gap-1 mb-1">
        <div className="bg-blue-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-blue-600 font-bold">{entry.visit_count ?? 0}</p>
          <p className="text-[10px] text-blue-500">زيارات</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-amber-600 font-bold">{entry.break_count ?? 0}</p>
          <p className="text-[10px] text-amber-500">استراحات</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-purple-600 font-bold">{formatDuration(entry.break_minutes)}</p>
          <p className="text-[10px] text-purple-500">استراحة</p>
        </div>
        <div className="bg-green-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-green-600 font-bold">{formatDuration(entry.net_minutes)}</p>
          <p className="text-[10px] text-green-500">صافي</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-3">
        <div className="bg-orange-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-orange-600 font-bold">{entry.order_count ?? 0}</p>
          <p className="text-[10px] text-orange-500">طلبات</p>
        </div>
        <div className="bg-orange-100 rounded-lg p-1.5 text-center">
          <p className="text-xs text-orange-700 font-bold">{entry.sales_value?.toLocaleString('ar-EG')} ج.م</p>
          <p className="text-[10px] text-orange-600">مبيعات</p>
        </div>
        <div className="bg-cyan-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-cyan-600 font-bold">{entry.collection_count ?? 0}</p>
          <p className="text-[10px] text-cyan-500">تحصيل</p>
        </div>
        <div className="bg-rose-50 rounded-lg p-1.5 text-center">
          <p className="text-xs text-rose-600 font-bold">{entry.new_customer_count ?? 0}</p>
          <p className="text-[10px] text-rose-500">عملاء جدد</p>
        </div>
      </div>

      {entry.connection_status === 'lost' && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1 mb-2">
          انقطاع متابعة
        </div>
      )}

      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {entry.latitude && (
          <button
            onClick={() => window.open(`https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`, '_blank')}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-blue-50 text-blue-600 py-1.5 rounded-xl hover:bg-blue-100"
          >
            <MapPin className="w-3 h-3" />
            الموقع
          </button>
        )}
        <button
          onClick={() => navigate(`/attendance/map/${entry.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
          className="flex-1 flex items-center justify-center gap-1 text-xs bg-indigo-50 text-indigo-600 py-1.5 rounded-xl hover:bg-indigo-100"
        >
          <Navigation className="w-3 h-3" />
          التفاصيل
        </button>
        <button
          onClick={() => navigate(`/attendance/history?employee=${entry.employee_id}`)}
          className="flex-1 flex items-center justify-center gap-1 text-xs bg-teal-50 text-teal-600 py-1.5 rounded-xl hover:bg-teal-100"
        >
          <History className="w-3 h-3" />
          السجل
        </button>
      </div>
    </div>
  )

  if (loading) {
    if (embedded) {
      return <p className="text-center text-gray-400 text-sm py-8">جاري تحميل المراقبة المباشرة...</p>
    }
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <p className="text-gray-500">جاري تحميل المراقبة المباشرة...</p>
      </div>
    )
  }

  const employees = data?.employees ?? []
  const noStart = data?.no_start_employees ?? []
  const ended = data?.ended_employees ?? []

  const activeCount = employees.filter(e => e.status === 'working').length
  const onVisitCount = employees.filter(e => e.status === 'on_visit').length
  const onBreakCount = employees.filter(e => e.status === 'on_break').length
  const lostCount = employees.filter(e => e.connection_status === 'lost').length

  const working = employees.filter(e => e.status === 'working')
  const onVisit = employees.filter(e => e.status === 'on_visit')
  const onBreak = employees.filter(e => e.status === 'on_break')
  const lost = employees.filter(e => e.connection_status === 'lost' && e.status !== 'on_break')

  const content = (
    <>
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        <div className="bg-green-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-green-600">{activeCount}</p>
          <p className="text-[10px] text-green-700">نشط</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-blue-600">{onVisitCount}</p>
          <p className="text-[10px] text-blue-700">زيارة</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-amber-600">{onBreakCount}</p>
          <p className="text-[10px] text-amber-700">استراحة</p>
        </div>
        <div className="bg-red-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-red-600">{lostCount}</p>
          <p className="text-[10px] text-red-700">انقطاع</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mb-5">
        <div className="bg-gray-100 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-gray-600">{noStart.length}</p>
          <p className="text-[10px] text-gray-500">لم يبدأ</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-purple-600">{data?.zero_visits_count ?? 0}</p>
          <p className="text-[10px] text-purple-700">بلا زيارات</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-orange-600">{data?.zero_orders_count ?? 0}</p>
          <p className="text-[10px] text-orange-700">بلا طلبات</p>
        </div>
        <div className="bg-rose-50 rounded-xl p-2 text-center">
          <p className="text-lg font-bold text-rose-600">{ended.length}</p>
          <p className="text-[10px] text-rose-700">منتهي</p>
        </div>
      </div>

      {employees.length === 0 && noStart.length === 0 && ended.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <User className="w-12 h-12 mx-auto mb-3" />
          لا يوجد موظفون يعملون حالياً
        </div>
      ) : (
        <>
          {working.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-gray-500 mb-2">🟢 يعملون</h2>
              <div className="space-y-3 mb-4">{working.map(renderEmployeeCard)}</div>
            </>
          )}

          {onVisit.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-blue-500 mb-2">🔵 في زيارة</h2>
              <div className="space-y-3 mb-4">{onVisit.map(renderEmployeeCard)}</div>
            </>
          )}

          {onBreak.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-amber-500 mb-2">🟡 في استراحة</h2>
              <div className="space-y-3 mb-4">{onBreak.map(renderEmployeeCard)}</div>
            </>
          )}

          {lost.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-red-500 mb-2">🔴 انقطاع متابعة</h2>
              <div className="space-y-3 mb-4">{lost.map(renderEmployeeCard)}</div>
            </>
          )}

          {noStart.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-gray-500 mb-2">❌ لم يبدأوا اليوم</h2>
              <div className="space-y-2 mb-4">
                {noStart.map((ns) => (
                  <div key={ns.employee_id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-800">{ns.name}</span>
                    </div>
                    <span className="text-xs text-red-500">لم يبدأ بعد</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {ended.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-gray-500 mb-2">⬜ أنهوا يوم العمل</h2>
              <div className="space-y-2 mb-4">
                {ended.map((ed) => (
                  <div key={ed.employee_id} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-800">{ed.name}</span>
                      </div>
                      <span className="text-xs text-green-600 font-bold">{formatDuration(ed.duration_minutes)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {ed.visit_count != null && <span>زيارات: {ed.visit_count}</span>}
                      {ed.ended_at && <span className="mr-2">انتهى: {new Date(ed.ended_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {locationPopup && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-5" onClick={() => setLocationPopup(null)}>
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-gray-400" />
                <span className="font-bold text-gray-800 text-lg">{locationPopup.name}</span>
              </div>
              <button onClick={() => setLocationPopup(null)} className="p-1 hover:bg-gray-100 rounded-xl">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="bg-blue-50 rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-blue-700 text-sm">الموقع الحالي</span>
              </div>
              {locationPopup.latitude ? (
                <>
                  <p className="text-xs text-blue-600 font-mono mb-2">
                    {locationPopup.latitude?.toFixed(4)}, {locationPopup.longitude?.toFixed(4)}
                  </p>
                  <button
                    onClick={() => window.open(`https://www.google.com/maps?q=${locationPopup.latitude},${locationPopup.longitude}`, '_blank')}
                    className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 flex items-center justify-center gap-1"
                  >
                    <Navigation className="w-4 h-4" />
                    فتح الخريطة
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-500">لا توجد بيانات موقع</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div>
                <span className="text-gray-400 text-xs">الحالة</span>
                <p className="font-bold">{locationPopup.status === 'working' ? 'يعمل' : locationPopup.status === 'on_visit' ? 'في زيارة' : locationPopup.status === 'on_break' ? 'في استراحة' : '--'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">مدة اليوم</span>
                <p className="font-bold">{formatDuration(locationPopup.duration_minutes)}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">صافي العمل</span>
                <p className="font-bold text-green-600">{formatDuration(locationPopup.net_minutes)}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">الزيارات</span>
                <p className="font-bold">{locationPopup.visit_count ?? 0}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">الطلبات</span>
                <p className="font-bold text-orange-600">{locationPopup.order_count ?? 0}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">التحصيل</span>
                <p className="font-bold text-cyan-600">{locationPopup.collection_count ?? 0}</p>
              </div>
            </div>

            <div className="text-xs text-gray-400 mb-4">
              آخر تحديث: {locationPopup.last_seen_at ? new Date(locationPopup.last_seen_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--'}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setLocationPopup(null); navigate(`/attendance/map/${locationPopup.employee_id}/${new Date().toISOString().slice(0, 10)}`) }}
                className="flex-1 bg-indigo-50 text-indigo-600 py-2 rounded-xl text-sm font-bold hover:bg-indigo-100"
              >
                خريطة اليوم
              </button>
              <button
                onClick={() => { setLocationPopup(null); navigate(`/attendance/history?employee=${locationPopup.employee_id}`) }}
                className="flex-1 bg-teal-50 text-teal-600 py-2 rounded-xl text-sm font-bold hover:bg-teal-100"
              >
                سجل الأيام
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div dir="rtl">{content}</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Eye className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">المراقبة المباشرة</h1>
        </div>
        {content}
      </div>
    </div>
  )
}
