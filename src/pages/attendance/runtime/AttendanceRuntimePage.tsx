import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import toast from 'react-hot-toast'
import { Clock, Play, Coffee, LogOut, ArrowLeftFromLine, MapPin, Wifi, WifiOff, Database, AlertTriangle } from 'lucide-react'
import { trackingEngine } from '../../../services/trackingEngine'
import { heartbeatService, type SessionTimeoutEvent } from '../../../services/heartbeatService'
import { attendanceService } from '../../../services/attendance'
import { getCurrentLocation } from '../../../services/gpsService'
// import RuntimeTrackingStatus from './components/RuntimeTrackingStatus'
import RuntimeDailySummaryModal from './components/RuntimeDailySummaryModal'
import DeviceReadinessPanel from '../../../components/attendance/DeviceReadinessPanel'
import { useAuthStore } from '../../../store/auth'
import { formatTime } from '../../../utils/format'

interface DailyTarget {
  target_hours: number
  current_net_hours: number
  progress_pct: number
  remaining_seconds: number
  schedule_type: string
  last_7_days: DayEntry[]
}

interface DayEntry {
  date: string
  net_hours: number
  target_hours: number
  met_target: boolean
}

interface WorkdayStatus {
  status: string | null
  employee_name?: string
  employee_code?: string
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
  work_location?: string | null
  schedule_type?: string | null
  attendance_enabled?: boolean | null
  today_orders?: number
  today_sales?: number
  today_collections?: number
  today_new_customers?: number
  daily_target_vs_actual?: DailyTarget
}

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'أ'
  return n.toLocaleString('en-EG')
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const GPS_ERROR_MSG = 'لم يتم تسجيلك على النظام، حاول مرة أخرى'

async function getBatteryLevel(): Promise<number | null> {
  try {
    const battery = await (navigator as any).getBattery?.()
    return battery?.level ?? null
  } catch { return null }
}

export default function AttendanceRuntimePage() {
  const token = getToken()

  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<WorkdayStatus | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [deviceReady, setDeviceReady] = useState(false)
  const [trackingStatus, setTrackingStatus] = useState(trackingEngine.status)
  const [trackingInterval, setTrackingInterval] = useState(300)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_my_workday_status', { p_token: token })
    if (data && typeof data === 'object' && !('error' in (data as Record<string, unknown>))) {
      setStatus(data as WorkdayStatus)
    }
    setLoading(false)
  }, [token])

  const startTracking = useCallback(async (sessionId: string) => {
    try {
      const settings = await attendanceService.getWorkdaySettings()
      const interval = (settings as any)?.location_interval_seconds ?? 300
      setTrackingInterval(interval)
      const employeeId = useAuthStore.getState().user?.employee_id
      trackingEngine.start(sessionId, employeeId, interval)
    } catch {
      const employeeId = useAuthStore.getState().user?.employee_id
      trackingEngine.start(sessionId, employeeId, 300)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    pollRef.current = setInterval(fetchStatus, 30000)
    timerRef.current = setInterval(() => setCurrentTime(new Date()), 1000)

    const unsub = trackingEngine.subscribe(setTrackingStatus)

    const unsubTimeout = heartbeatService.onSessionTimeout((ev: SessionTimeoutEvent) => {
      if (ev.action === 'warning_issued') {
        toast(ev.message || 'تحذير: عدم نشاط', { icon: '⚠️', duration: 15000 })
      }
      if (ev.action === 'warning_active') {
        toast(ev.message || 'لم يتم رصد نشاط', { icon: '⏳', duration: 10000 })
      }
      if (ev.action === 'warning_cleared') {
        toast.success('تم تسجيل نشاط جديد. تم إلغاء تحذير الخمول.')
        fetchStatus()
      }
      if (ev.action === 'auto_closed') {
        toast(ev.message || 'تم إنهاء يوم العمل تلقائياً', { icon: '🔒', duration: 10000 })
        fetchStatus()
      }
    })

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      unsub()
      unsubTimeout()
    }
  }, [fetchStatus])

  useEffect(() => {
    if (!status?.session_id) return
    const sid = status.session_id
    const st = status.status
    const tk = token
    if (!tk) return

    const handleBeforeUnload = () => {
      if (st !== 'active' && st !== 'inactive_warning') return
      const lastLoc = trackingEngine.getLastSeen()?.lastGps
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/end_workday`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_token: tk,
          p_session_id: sid,
          p_latitude: lastLoc?.latitude ?? null,
          p_longitude: lastLoc?.longitude ?? null,
          p_close_reason: lastLoc ? 'manual_close' : 'no_activity_timeout',
        }),
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [token, status?.session_id, status?.status])

  useEffect(() => {
    if (status?.status === 'active' && status.session_id && !trackingEngine.status.running) {
      startTracking(status.session_id)
    }
    if (status?.status === 'completed' || status?.status === null) {
      if (trackingEngine.status.running) {
        trackingEngine.stop()
      }
    }
  }, [status, startTracking])

  const isBeforeWork = status?.status === null
  const isActive = (status?.status === 'active' || status?.status === 'inactive_warning') && !status?.on_break
  const isBreak = (status?.status === 'active' || status?.status === 'inactive_warning') && status?.on_break === true
  const isCompleted = status?.status === 'completed'
  const isInactiveWarning = status?.status === 'inactive_warning'

  const durationMinutes = status?.duration_minutes ?? 0
  const breakMinutes = status?.break_minutes ?? 0
  const netMinutes = isActive || isBreak
    ? (status?.started_at ? ((Date.now() - new Date(status.started_at).getTime()) / 60000) - breakMinutes : 0)
    : (status?.net_work_minutes ?? (durationMinutes - breakMinutes))

  const targetInfo = status?.daily_target_vs_actual

  const handleStart = async () => {
    setActionLoading('start')
    try {
      const result = await getCurrentLocation()
      if (!result.success) { toast.error(GPS_ERROR_MSG); setActionLoading(null); return }
      const battery = await getBatteryLevel()
      const { data, error } = await supabase.rpc('start_workday', {
        p_token: token,
        p_latitude: result.location!.latitude,
        p_longitude: result.location!.longitude,
        p_device_status: { battery, timestamp: new Date().toISOString() },
      })
      if (error) { toast.error(error.message || 'حدث خطأ'); setActionLoading(null); return }
      const errCode = (data as any)?.error
      if (errCode) {
        const msgs: Record<string, string> = {
          GPS_REQUIRED: 'لم يتم الحصول على موقع GPS دقيق — تأكد من فتح GPS وحاول مرة أخرى',
          ALREADY_ACTIVE: 'لديك يوم عمل نشط بالفعل',
          INVALID_SESSION: 'جلسة منتهية — الرجاء إعادة تسجيل الدخول',
          FORBIDDEN: 'ليس لديك صلاحية لبدء يوم العمل',
        }
        toast.error(msgs[errCode] || 'فشل في بدء يوم العمل')
        setActionLoading(null); return
      }
      const sessionId = (data as any)?.session_id
      const staleRecovered = (data as any)?.stale_recovered
      if (staleRecovered > 0) {
        toast(`تم إنهاء ${staleRecovered} يوم سابق تلقائياً`, { icon: '🔒', duration: 5000 })
      }
      toast.success('بدأ يوم العمل بنجاح')
      await fetchStatus()
      if (sessionId) startTracking(sessionId)
    } catch { toast.error('حدث خطأ في الاتصال') }
    finally { setActionLoading(null) }
  }

  const handleEnd = async () => {
    setActionLoading('end')
    try {
      await trackingEngine.flushNow()
      const result = await getCurrentLocation()
      if (!result.success) { toast.error(GPS_ERROR_MSG); setActionLoading(null); return }
      const battery = await getBatteryLevel()
      const { data, error } = await supabase.rpc('end_workday', {
        p_token: token,
        p_session_id: status?.session_id,
        p_latitude: result.location!.latitude,
        p_longitude: result.location!.longitude,
        p_device_status: { battery, timestamp: new Date().toISOString() },
      })
      if (error) { toast.error(error.message || 'حدث خطأ'); setActionLoading(null); return }
      const errCode = (data as any)?.error
      if (errCode) {
        const msgs: Record<string, string> = {
          GPS_REQUIRED: 'لم يتم الحصول على موقع GPS دقيق',
          SESSION_NOT_FOUND: 'لم يتم العثور على جلسة اليوم',
          INVALID_SESSION: 'جلسة منتهية — الرجاء إعادة تسجيل الدخول',
        }
        toast.error(msgs[errCode] || 'فشل في إنهاء يوم العمل')
        setActionLoading(null); return
      }
      const d = data as { attendance_status?: string; late_minutes?: number }
      if (d?.attendance_status === 'late') {
        toast(`⏰ تم تسجيل تأخير ${d.late_minutes} دقيقة`)
      } else {
        toast.success('تم إنهاء يوم العمل')
      }
      trackingEngine.stop()
      await fetchStatus()
    } catch { toast.error('حدث خطأ في الاتصال') }
    finally { setActionLoading(null) }
  }

  const handleStartBreak = async () => {
    setActionLoading('break')
    try {
      const result = await getCurrentLocation()
      if (!result.success) { toast.error(GPS_ERROR_MSG); setActionLoading(null); return }
      const { data, error } = await supabase.rpc('start_break', {
        p_token: token,
        p_session_id: status?.session_id,
        p_latitude: result.location!.latitude,
        p_longitude: result.location!.longitude,
        p_reason: 'استراحة',
      })
      if (error) { toast.error(error.message || 'حدث خطأ'); return }
      toast.success('تم أخذ استراحة')
      await fetchStatus()
    } catch { toast.error('حدث خطأ في الاتصال') }
    finally { setActionLoading(null) }
  }

  const handleEndBreak = async () => {
    setActionLoading('resume')
    try {
      const result = await getCurrentLocation()
      if (!result.success) { toast.error(GPS_ERROR_MSG); setActionLoading(null); return }
      if (status?.open_break_id) {
        const { data, error } = await supabase.rpc('end_break', {
          p_token: token,
          p_session_id: status?.session_id,
          p_break_id: status.open_break_id,
        })
        if (error) { toast.error(error.message || 'حدث خطأ'); return }
        toast.success('تمت العودة من الاستراحة')
        await fetchStatus()
      }
    } catch { toast.error('حدث خطأ في الاتصال') }
    finally { setActionLoading(null) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 to-white" dir="rtl">
        <div className="text-center">
          <Clock className="w-12 h-12 mx-auto text-blue-600 animate-pulse" />
          <p className="mt-4 text-gray-500">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 to-white" dir="rtl">
        <p className="text-gray-500">لا توجد بيانات</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-blue-50 to-white" dir="rtl">
      <div className="flex-1 px-3 pt-4 overflow-y-auto">
        <div className="mx-auto flex flex-col" style={{ maxWidth: '420px', minHeight: 'calc(100vh - 2rem)' }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <span className="text-base font-bold text-gray-800">{status.employee_name}</span>
            <span className="text-xs text-gray-400">
              {currentTime.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>

          {/* Inactive Warning Banner */}
          {isInactiveWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800">لم يتم رصد نشاط منذ فترة طويلة — سيتم إنهاء اليوم تلقائياً قريباً</p>
            </div>
          )}

          {/* Before Work */}
          {isBeforeWork && (
            <div className="flex flex-col items-center justify-center text-center pt-6 pb-2">
              <div className="text-6xl mb-3">🏁</div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">اليوم لم يبدأ بعد</h2>
              <p className="text-xs text-gray-500 mb-4">أنت على وشك بدء يوم جديد</p>
            </div>
          )}

          <div className="mb-3">
            <DeviceReadinessPanel onReadyChange={setDeviceReady} />
          </div>

          {/* Active / During Work */}
          {(isActive || isBreak) && (
            <div className="space-y-3">
              {/* Time Info */}
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 mb-0.5">وقت البدء</p>
                    <p className="text-sm font-bold text-gray-800">
                      {status.started_at
                        ? formatTime(status.started_at)
                        : '--'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 mb-0.5">الوقت الحالي</p>
                    <p className="text-sm font-bold text-gray-800 tabular-nums" dir="ltr">
{formatTime(currentTime, { second: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 mb-0.5">إجمالي مدة العمل</p>
                    <p className="text-base font-bold text-blue-600 tabular-nums" dir="ltr">{fmt(durationMinutes)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 mb-0.5">مدة الاستراحات</p>
                    <p className="text-base font-bold text-amber-600 tabular-nums" dir="ltr">{fmt(breakMinutes)}</p>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 text-center">
                  <p className="text-[10px] text-gray-400 mb-0.5">صافي ساعات العمل</p>
                  <p className="text-xl font-bold text-green-600 tabular-nums" dir="ltr">{fmt(netMinutes)}</p>
                </div>
              </div>

              {/* KPI Summary */}
              <div className="bg-white rounded-xl shadow-sm p-3">
                <p className="text-xs font-bold text-gray-700 mb-2">ملخص اليوم</p>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <KPICell value={String(status.today_orders ?? 0)} label="طلبات" color="blue" />
                  <KPICell value={fmtShort(status.today_sales ?? 0)} label="مبيعات" color="green" />
                  <KPICell value={fmtShort(status.today_collections ?? 0)} label="تحصيل" color="amber" />
                  <KPICell value={String(status.today_new_customers ?? 0)} label="عملاء جدد" color="purple" />
                  <KPICell value={String(status.visit_count ?? 0)} label="زيارات" color="orange" />
                </div>
                {targetInfo && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                    <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
                      <span>نسبة الإنجاز</span>
                      <span dir="ltr">{targetInfo.progress_pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          targetInfo.progress_pct >= 100 ? 'bg-green-500'
                          : targetInfo.progress_pct >= 80 ? 'bg-blue-500'
                          : targetInfo.progress_pct >= 50 ? 'bg-amber-500'
                          : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(targetInfo.progress_pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* GPS Tracking Status — hidden from employee view */}
              
            </div>
          )}

          {/* Completed */}
          {isCompleted && (
            <div className="bg-white rounded-xl shadow-sm p-5 text-center w-full">
              <div className="text-4xl mb-2">✅</div>
              <h2 className="text-base font-bold text-gray-800 mb-4">تم إنهاء اليوم بنجاح</h2>
              <div className="grid grid-cols-2 gap-2">
                <SummaryBox label="إجمالي اليوم" value={fmt(durationMinutes)} color="blue" />
                <SummaryBox label="صافي العمل" value={fmt(netMinutes)} color="green" />
                <SummaryBox
                  label="الحضور"
                  value={status.started_at
                    ? formatTime(status.started_at)
                    : '--'}
                  color="amber"
                />
                <SummaryBox
                  label="الانصراف"
                  value={status.ended_at
                    ? formatTime(status.ended_at)
                    : '--'}
                  color="gray"
                />
              </div>
            </div>
          )}

          {/* Action Buttons — directly below summary */}
          <div className="pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {isBeforeWork && (
              <button
                onClick={handleStart}
                disabled={actionLoading === 'start' || !deviceReady}
                className="w-full py-5 px-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-green-600 hover:to-emerald-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {actionLoading === 'start' ? (
                  <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-6 h-6" />
                )}
                بدء يوم العمل
              </button>
            )}

            {isBreak && (
              <div className="space-y-2.5">
                <div className="text-center mb-1">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-700">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    في استراحة
                  </span>
                </div>
                <button
                  onClick={handleEndBreak}
                  disabled={actionLoading === 'resume'}
                  className="w-full py-5 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-amber-600 hover:to-amber-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {actionLoading === 'resume' ? (
                    <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ArrowLeftFromLine className="w-6 h-6" />
                  )}
                  مواصلة العمل
                </button>
                <button
                  onClick={handleEnd}
                  disabled={actionLoading === 'end'}
                  className="w-full py-4 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-2xl text-base font-bold shadow-lg hover:from-red-600 hover:to-red-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'end' ? (
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <LogOut className="w-5 h-5" />
                  )}
                  إنهاء يوم العمل
                </button>
              </div>
            )}

            {isActive && (
              <div className="space-y-2.5">
                <div className="text-center mb-1">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1 rounded-full bg-green-100 text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    يعمل الآن
                  </span>
                </div>
                <button
                  onClick={handleStartBreak}
                  disabled={actionLoading === 'break'}
                  className="w-full py-5 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-amber-600 hover:to-amber-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {actionLoading === 'break' ? (
                    <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Coffee className="w-6 h-6" />
                  )}
                  أخذ استراحة
                </button>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setSummaryOpen(true)}
                    className="flex-1 py-4 bg-indigo-50 text-indigo-700 rounded-2xl text-sm font-bold hover:bg-indigo-100 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
                  >
                    <Clock className="w-5 h-5" />
                    الملخص
                  </button>
                  <button
                    onClick={handleEnd}
                    disabled={actionLoading === 'end'}
                    className="flex-1 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-2xl text-sm font-bold shadow-lg hover:from-red-600 hover:to-red-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading === 'end' ? (
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <LogOut className="w-5 h-5" />
                    )}
                    إنهاء اليوم
                  </button>
                </div>
              </div>
            )}

            {isCompleted && (
              <button
                onClick={handleStart}
                disabled={actionLoading === 'start'}
                className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl text-lg font-bold shadow-lg hover:from-green-600 hover:to-emerald-700 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {actionLoading === 'start' ? (
                  <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-6 h-6" />
                )}
                بدء يوم عمل جديد
              </button>
            )}
          </div>
        </div>
      </div>

      <RuntimeDailySummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        startedAt={status.started_at ?? null}
        endedAt={status.ended_at ?? null}
        durationMinutes={durationMinutes}
        breakMinutes={breakMinutes}
        netWorkMinutes={netMinutes}
        todayOrders={status.today_orders ?? 0}
        todaySales={status.today_sales ?? 0}
        todayCollections={status.today_collections ?? 0}
        todayNewCustomers={status.today_new_customers ?? 0}
        targetHours={targetInfo?.target_hours ?? 8}
        currentNetHours={targetInfo?.current_net_hours ?? 0}
        progressPct={targetInfo?.progress_pct ?? 0}
        attendanceEnabled={status.attendance_enabled ?? true}
      />
    </div>
  )
}

function KPICell({ value, label, color }: { value: string; label: string; color: string }) {
  const colors: Record<string, { text: string; bg: string }> = {
    blue: { text: 'text-blue-700', bg: 'bg-blue-50' },
    green: { text: 'text-green-700', bg: 'bg-green-50' },
    amber: { text: 'text-amber-700', bg: 'bg-amber-50' },
    purple: { text: 'text-purple-700', bg: 'bg-purple-50' },
    orange: { text: 'text-orange-700', bg: 'bg-orange-50' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-lg p-1.5 text-center`}>
      <div className={`text-xs font-bold ${c.text} tabular-nums`}>{value}</div>
      <div className={`text-[9px] ${c.text} opacity-70 leading-tight`}>{label}</div>
    </div>
  )
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-50 text-gray-700',
  }
  return (
    <div className={`${colors[color] || colors.gray} rounded-lg p-2.5`}>
      <div className="text-[10px]">{label}</div>
      <div className="text-base font-bold mt-0.5 tabular-nums" dir="ltr">{value}</div>
    </div>
  )
}
