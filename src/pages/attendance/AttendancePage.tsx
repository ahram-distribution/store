import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { Clock, Play, LogOut, Coffee, ShoppingCart, DollarSign, Users, Target } from 'lucide-react'

interface WorkdayStatus {
  status: string
  session_id?: string
  started_at?: string
  ended_at?: string
  duration_minutes?: number
  break_count?: number
  break_minutes?: number
  visit_count?: number
  net_work_minutes?: number
  on_break?: boolean
  open_break_id?: string
  work_location?: string
  schedule_type?: string
  attendance_enabled?: boolean
  today_orders?: number
  today_sales?: number
  today_collections?: number
  today_new_customers?: number
  daily_target_vs_actual?: {
    target_hours: number
    current_net_hours: number
    progress_pct: number
    remaining_seconds: number
    schedule_type: string
  }
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export default function AttendancePage() {
  const [status, setStatus] = useState<WorkdayStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()

  const fetchStatus = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_my_workday_status', { p_token: token })
    setStatus(data as WorkdayStatus | null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(() => {
      setCurrentTime(new Date())
      fetchStatus()
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleAction = async (action: string) => {
    setActionLoading(action)
    try {
      if (action === 'start') {
        const pos = await getGpsPosition()
        const result = await supabase.rpc('start_workday', {
          p_token: token,
          p_latitude: pos?.latitude ?? null,
          p_longitude: pos?.longitude ?? null,
          p_device_status: { battery: await getBatteryLevel(), timestamp: new Date().toISOString() },
        })
        if (result.error) { toast.error(result.error.message || 'حدث خطأ'); return }
        toast.success('بدأ يوم العمل بنجاح')
      } else if (action === 'end') {
        const pos = await getGpsPosition()
        const result = await supabase.rpc('end_workday', {
          p_token: token,
          p_session_id: status?.session_id,
          p_latitude: pos?.latitude ?? null,
          p_longitude: pos?.longitude ?? null,
          p_device_status: { battery: await getBatteryLevel(), timestamp: new Date().toISOString() },
        })
        if (result.error) { toast.error(result.error.message || 'حدث خطأ'); return }
        const d = result.data as { attendance_status?: string; late_minutes?: number }
        if (d?.attendance_status === 'late') {
          toast(`تم تسجيل تأخير ${d.late_minutes} دقيقة`, { icon: '⏰' })
        } else {
          toast.success('تم إنهاء يوم العمل')
        }
      } else if (action === 'break') {
        const pos = await getGpsPosition()
        const result = await supabase.rpc('start_break', {
          p_token: token,
          p_session_id: status?.session_id,
          p_latitude: pos?.latitude ?? null,
          p_longitude: pos?.longitude ?? null,
          p_reason: 'استراحة',
        })
        if (result.error) { toast.error(result.error.message || 'حدث خطأ'); return }
        toast.success('تم أخذ استراحة')
      } else if (action === 'resume') {
        if (status?.open_break_id) {
          const result = await supabase.rpc('end_break', {
            p_token: token,
            p_session_id: status?.session_id,
            p_break_id: status.open_break_id,
          })
          if (result.error) { toast.error(result.error.message || 'حدث خطأ'); return }
          toast.success('تمت العودة من الاستراحة')
        }
      }
      await fetchStatus()
    } catch (err) {
      toast.error('حدث خطأ في الاتصال')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50" dir="rtl">
        <div className="text-center">
          <Clock className="w-12 h-12 mx-auto text-blue-600 animate-pulse" />
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (!status || status.status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 to-white p-6" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <Clock className="w-20 h-20 mx-auto text-blue-600 mb-6" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">الحضور والانصراف</h1>
          <button
            onClick={() => handleAction('start')}
            disabled={actionLoading === 'start'}
            className="w-full py-5 px-8 bg-blue-600 text-white rounded-2xl text-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {actionLoading === 'start' ? (
              <span className="animate-spin">⏳</span>
            ) : (
              <Play className="w-6 h-6" />
            )}
            بدء يوم العمل
          </button>
          {status?.ended_at && (
            <div className="mt-6 p-4 bg-gray-50 rounded-xl">
              <p className="text-gray-600">تم إنهاء اليوم السابق</p>
              <p className="text-sm text-gray-400">
                {status.duration_minutes ? formatDuration(status.duration_minutes) : ''}
              </p>
            </div>
          )}
          <p className="mt-6 text-gray-500">يوم موفق بإذن الله 🎉</p>
        </div>
      </div>
    )
  }

  const isBreak = status.status === 'active' && status.on_break === true
  const totalMinutes = status.duration_minutes ?? 0
  const breakMinutes = status.break_minutes ?? 0
  const netMinutes = status.net_work_minutes ?? (totalMinutes - breakMinutes)

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-blue-50 to-white p-5" dir="rtl">
      <div className="w-full max-w-sm mx-auto">

        {/* Work Policy Badge */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
            {status.work_location === 'office' ? 'مكتبي' : 'ميداني'}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
            {status.schedule_type === 'fixed_shift' ? 'دوام ثابت' :
             status.schedule_type === 'hourly' ? 'بالساعة' : 'دوام مرن'}
          </span>
          {status.attendance_enabled === false && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
              غير خاضع للتقييم
            </span>
          )}
        </div>

        <h1 className="text-xl font-bold text-gray-800 text-center mb-6">الحضور والانصراف</h1>

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-5 space-y-3">
          {status.started_at && (
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500">الحضور</span>
              <span className="font-bold text-gray-800">
                {new Date(status.started_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center py-1 border-t border-gray-100">
            <span className="text-gray-500">مدة اليوم</span>
            <span className="font-bold text-gray-800">{formatDuration(totalMinutes)}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-t border-gray-100">
            <span className="text-gray-500">الاستراحات</span>
            <span className="font-bold text-amber-600">{formatDuration(breakMinutes)}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-t border-gray-100">
            <span className="text-gray-500">صافي وقت العمل</span>
            <span className="font-bold text-green-600 text-lg">{formatDuration(netMinutes)}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-t border-gray-100">
            <span className="text-gray-500">الزيارات</span>
            <span className="font-bold text-gray-800">{status.visit_count ?? 0}</span>
          </div>
        </div>

        {/* Target vs Actual */}
        {status.daily_target_vs_actual && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-gray-700 text-sm">المستهدف اليوم</span>
              </div>
              <span className="text-xs text-gray-400">{status.daily_target_vs_actual.target_hours} ساعة</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${Math.min(status.daily_target_vs_actual.progress_pct, 100)}%`,
                  background: status.daily_target_vs_actual.progress_pct >= 100
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : status.daily_target_vs_actual.progress_pct >= 70
                    ? 'linear-gradient(90deg, #3b82f6, #2563eb)'
                    : 'linear-gradient(90deg, #f59e0b, #d97706)',
                }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>{status.daily_target_vs_actual.current_net_hours} ساعة فعلية</span>
              <span>{status.daily_target_vs_actual.progress_pct}%</span>
            </div>
            {status.daily_target_vs_actual.progress_pct < 100 && status.daily_target_vs_actual.remaining_seconds > 0 && (
              <p className="text-xs text-amber-600 mt-2">
                متبقي {formatDuration(status.daily_target_vs_actual.remaining_seconds / 60)}
              </p>
            )}
          </div>
        )}

        {/* Today KPIs */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-xl">
              <ShoppingCart className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">الطلبيات</p>
              <p className="text-lg font-bold text-gray-800">{status.today_orders ?? 0}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-xl">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">المبيعات</p>
              <p className="text-lg font-bold text-gray-800">{Number(status.today_sales ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl">
              <DollarSign className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">التحصيلات</p>
              <p className="text-lg font-bold text-gray-800">{Number(status.today_collections ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-xl">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">عملاء جدد</p>
              <p className="text-lg font-bold text-gray-800">{status.today_new_customers ?? 0}</p>
            </div>
          </div>
        </div>

        {isBreak ? (
          <div className="text-center mb-5">
            <span className="inline-block px-4 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-bold">
              🟡 في استراحة
            </span>
          </div>
        ) : (
          <div className="text-center mb-5">
            <span className="inline-block px-4 py-1 bg-green-100 text-green-700 rounded-full text-sm font-bold">
              ✅ يعمل
            </span>
          </div>
        )}

        <div className="space-y-3">
            {isBreak ? (
              <button
                onClick={() => handleAction('resume')}
                disabled={actionLoading === 'resume'}
                className="w-full py-4 px-6 bg-amber-500 text-white rounded-2xl text-lg font-bold shadow-lg hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {actionLoading === 'resume' ? '⏳' : <Play className="w-5 h-5" />}
                مواصلة العمل
              </button>
            ) : (
              <button
                onClick={() => handleAction('break')}
                disabled={actionLoading === 'break'}
                className="w-full py-4 px-6 bg-amber-500 text-white rounded-2xl text-lg font-bold shadow-lg hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {actionLoading === 'break' ? '⏳' : <Coffee className="w-5 h-5" />}
                أخذ استراحة
              </button>
            )}
            <button
              onClick={() => handleAction('end')}
              disabled={actionLoading === 'end'}
              className="w-full py-4 px-6 bg-red-500 text-white rounded-2xl text-lg font-bold shadow-lg hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {actionLoading === 'end' ? '⏳' : <LogOut className="w-5 h-5" />}
              إنهاء يوم العمل
            </button>
          </div>
      </div>
    </div>
  )
}

import { getCurrentLocation } from '../../services/gpsService'

async function getGpsPosition(): Promise<{ latitude: number; longitude: number } | null> {
  const result = await getCurrentLocation()
  if (result.success && result.location) {
    return { latitude: result.location.latitude, longitude: result.location.longitude }
  }
  return null
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    const battery = await (navigator as any).getBattery?.()
    return battery?.level ?? null
  } catch { return null }
}
