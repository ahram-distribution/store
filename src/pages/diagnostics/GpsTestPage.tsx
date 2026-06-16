import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  getCurrentLocation,
  startWatching,
  stopWatching,
  isWatching,
  getLastKnownLocation,
  getAccuracyLabel,
} from '../../services/gpsService'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function detectPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navicator as any)?.standalone === true
}

interface DeviceInfo {
  userAgent: string
  platform: string
  vendor: string
  isPWA: boolean
  isSecure: boolean
  language: string
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
}

interface GpsFix {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  heading: number | null
  speed: number | null
  capturedAt: string
}

type PermStatus = 'granted' | 'prompt' | 'denied' | 'unknown'

function formatDelta(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function GpsTestPage() {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [permStatus, setPermStatus] = useState<PermStatus>('unknown')
  const [currentFix, setCurrentFix] = useState<GpsFix | null>(null)
  const [fixLoading, setFixLoading] = useState(false)
  const [monitorFixes, setMonitorFixes] = useState<GpsFix[]>([])
  const [monitoring, setMonitoring] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])

  const [policyTest, setPolicyTest] = useState<{
    status: 'idle' | 'running' | 'success' | 'failed'
    elapsedMs: number | null
    fixAccuracy: number | null
  }>({ status: 'idle', elapsedMs: null, fixAccuracy: null })

  const [dbTest, setDbTest] = useState<{
    status: 'idle' | 'running' | 'success' | 'failed'
    result: string | null
  }>({ status: 'idle', result: null })

  const [signalTest, setSignalTest] = useState<{
    status: 'idle' | 'waiting' | 'done'
    startTime: number | null
    elapsedMs: number | null
  }>({ status: 'idle', startTime: null, elapsedMs: null })

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLog(prev => [...prev, { timestamp: new Date().toISOString(), level, message }])
  }, [])

  useEffect(() => {
    setDeviceInfo({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      isPWA: detectPWA(),
      isSecure: window.isSecureContext,
      language: navigator.language,
    })
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((s) => {
        setPermStatus(s.state as PermStatus)
        s.addEventListener('change', () => setPermStatus(s.state as PermStatus))
      }).catch(() => setPermStatus('unknown'))
    }
  }, [])

  useEffect(() => {
    return () => { if (isWatching()) stopWatching() }
  }, [])

  const handleGetLocation = async () => {
    setFixLoading(true)
    setCurrentFix(null)
    const start = Date.now()
    const result = await getCurrentLocation()
    if (result.success && result.location) {
      const loc = result.location
      setCurrentFix({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        altitude: null,
        heading: null,
        speed: null,
        capturedAt: loc.capturedAt,
      })
      addLog('success', `تم الحصول على الموقع — الدقة ${loc.accuracy}m بعد ${formatDelta(Date.now() - start)}`)
    } else {
      addLog('error', `فشل الحصول على الموقع: ${result.error?.message || 'خطأ غير معروف'}`)
    }
    setFixLoading(false)
  }

  const handleStartMonitor = () => {
    if (isWatching()) return
    setMonitorFixes([])
    setMonitoring(true)
    addLog('info', 'بدء مراقبة الموقع المتكررة...')
    startWatching({
      onLocation: (loc) => {
        setMonitorFixes(prev => [{
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          altitude: null,
          heading: null,
          speed: null,
          capturedAt: loc.capturedAt,
        }, ...prev].slice(0, 100))
      },
      onError: (err) => {
        addLog('error', `مراقبة GPS: خطأ ${err.code} — ${err.message}`)
      },
    })
  }

  const handleStopMonitor = () => {
    stopWatching()
    setMonitoring(false)
    addLog('info', 'تم إيقاف المراقبة')
  }

  const handleSignalTest = async () => {
    const start = Date.now()
    setSignalTest({ status: 'waiting', startTime: start, elapsedMs: null })
    addLog('info', 'بدء اختبار مدة الحصول على أول إشارة...')
    const result = await getCurrentLocation()
    if (result.success) {
      const elapsed = Date.now() - start
      setSignalTest({ status: 'done', startTime: start, elapsedMs: elapsed })
      addLog('success', `تم الحصول على أول إشارة بعد ${formatDelta(elapsed)}`)
    } else {
      addLog('error', `فشل اختبار الإشارة: ${result.error?.message}`)
      setSignalTest({ status: 'idle', startTime: null, elapsedMs: null })
    }
  }

  const handlePolicyTest = async () => {
    setPolicyTest({ status: 'running', elapsedMs: null, fixAccuracy: null })
    addLog('info', 'بدء اختبار سياسة الـ30 ثانية (الدقة ≤100m)...')
    const start = Date.now()
    const result = await getCurrentLocation()
    const elapsed = Date.now() - start
    if (result.success && result.location) {
      setPolicyTest({ status: 'success', elapsedMs: elapsed, fixAccuracy: result.location.accuracy })
      addLog('success', `نجاح اختبار السياسة — الدقة ${result.location.accuracy}m بعد ${formatDelta(elapsed)}`)
    } else {
      setPolicyTest({ status: 'failed', elapsedMs: elapsed, fixAccuracy: null })
      addLog('warn', `فشل اختبار السياسة — لم يتم الحصول على دقة ≤100m خلال 30 ثانية: ${result.error?.message}`)
    }
  }

  const handleDbTest = async () => {
    const token = getToken()
    if (!token) {
      addLog('error', 'لا يوجد رمز جلسة — يجب تسجيل الدخول')
      setDbTest({ status: 'failed', result: 'لا يوجد رمز جلسة' })
      return
    }
    if (!currentFix) {
      addLog('error', 'لا توجد بيانات موقع — احصل على الموقع أولاً')
      setDbTest({ status: 'failed', result: 'لا توجد بيانات موقع' })
      return
    }
    setDbTest({ status: 'running', result: null })
    addLog('info', 'جاري اختبار كتابة نقطة تتبع في قاعدة البيانات...')
    try {
      const { data, error } = await supabase.rpc('insert_gps_test_point', {
        p_latitude: currentFix.latitude,
        p_longitude: currentFix.longitude,
        p_accuracy: currentFix.accuracy,
        p_altitude: currentFix.altitude,
        p_speed: currentFix.speed,
        p_heading: currentFix.heading,
        p_device_info: { userAgent: navigator.userAgent, platform: navigator.platform },
      })
      if (error) throw error
      const r = data as any
      if (r?.success) {
        setDbTest({ status: 'success', result: `تم بنجاح — id=${r.id}` })
        addLog('success', `تم تسجيل نقطة الاختبار بنجاح (${r.id})`)
      } else {
        throw new Error(r?.error || 'فشل غير معروف')
      }
    } catch (err: any) {
      const msg = err.message || err.toString?.() || 'خطأ غير معروف'
      setDbTest({ status: 'failed', result: msg })
      addLog('error', `فشل اختبار قاعدة البيانات: ${msg}`)
    }
  }

  const clearLog = () => setLog([])

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 p-4 pb-20">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-800 text-center">🧪 مختبر اختبار GPS</h1>
        <p className="text-xs text-gray-500 text-center">صفحة تشخيص مستقلة — لا تؤثر على نظام الحضور أو التتبع</p>

        {/* Device Info */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-1">
          <h2 className="text-sm font-bold text-gray-700 mb-2">📱 معلومات الجهاز</h2>
          {deviceInfo && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
              <InfoRow label="نوع الجهاز" value={deviceInfo.platform} />
              <InfoRow label="المتصفح" value={deviceInfo.userAgent.split('/')[0]} />
              <InfoRow label="نظام التشغيل" value={navigator.platform} />
              <InfoRow label="PWA" value={deviceInfo.isPWA ? 'نعم' : 'لا'} />
              <InfoRow label="HTTPS" value={deviceInfo.isSecure ? 'آمن ✅' : 'غير آمن ❌'} />
              <InfoRow label="اللغة" value={deviceInfo.language} />
              <InfoRow label="حالة الإذن" value={<PermBadge status={permStatus} />} />
            </div>
          )}
        </section>

        {/* Current Location */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">📍 الموقع الحالي</h2>
          <button
            onClick={handleGetLocation}
            disabled={fixLoading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {fixLoading ? 'جارٍ الحصول على الموقع...' : 'الحصول على الموقع الحالي'}
          </button>
          {currentFix && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <InfoRow label="Latitude" value={currentFix.latitude.toFixed(7)} />
                <InfoRow label="Longitude" value={currentFix.longitude.toFixed(7)} />
                <InfoRow label="Accuracy" value={`${currentFix.accuracy}m`} />
                <InfoRow label="Altitude" value={currentFix.altitude !== null ? `${currentFix.altitude.toFixed(1)}m` : 'غير متوفر'} />
                <InfoRow label="Heading" value={currentFix.heading !== null ? `${currentFix.heading.toFixed(1)}°` : 'غير متوفر'} />
                <InfoRow label="Speed" value={currentFix.speed !== null ? `${currentFix.speed.toFixed(1)} m/s` : 'غير متوفر'} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{currentFix.capturedAt}</p>
            </div>
          )}
        </section>

        {/* Accuracy Classifier */}
        {currentFix && (
          <section className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-700 mb-2">🎯 تصنيف الدقة</h2>
            <div className="text-center">
              <div className={`inline-block px-4 py-2 rounded-lg border text-sm font-bold ${getAccuracyLabel(currentFix.accuracy).color} bg-white`}>
                {getAccuracyLabel(currentFix.accuracy).label}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                الدقة الحالية: <span className="font-bold text-gray-700" dir="ltr">{currentFix.accuracy} متر</span>
              </div>
            </div>
          </section>
        )}

        {/* Signal Timing */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">⏱ مدة الحصول على الإشارة</h2>
          <button
            onClick={handleSignalTest}
            disabled={signalTest.status === 'waiting'}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {signalTest.status === 'waiting' ? 'بانتظار الإشارة...' : 'اختبار مدة الإشارة'}
          </button>
          {signalTest.status === 'done' && signalTest.elapsedMs !== null && (
            <div className="text-center text-sm">
              <span className="text-green-600 font-bold">تم الحصول على أول إشارة بعد {formatDelta(signalTest.elapsedMs)}</span>
            </div>
          )}
        </section>

        {/* 30s Policy Test */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">🧪 اختبار سياسة الأهرام (30s / ≤100m)</h2>
          <button
            onClick={handlePolicyTest}
            disabled={policyTest.status === 'running'}
            className="w-full py-3 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {policyTest.status === 'running' ? 'جارٍ الاختبار (30 ثانية)...' : 'اختبار تسجيل حضور'}
          </button>
          {policyTest.status === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center text-sm">
              <p className="text-green-700 font-bold">✅ نجاح فوري</p>
              <p className="text-green-600 text-xs mt-1">الدقة {policyTest.fixAccuracy}m — الزمن {policyTest.elapsedMs !== null ? formatDelta(policyTest.elapsedMs) : ''}</p>
            </div>
          )}
          {policyTest.status === 'failed' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center text-sm">
              <p className="text-red-700 font-bold">❌ فشل</p>
              <p className="text-red-600 text-xs mt-1">لم يتم الحصول على دقة ≤100m خلال 30 ثانية</p>
            </div>
          )}
        </section>

        {/* Database Test */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">💾 اختبار كتابة نقطة تتبع</h2>
          <button
            onClick={handleDbTest}
            disabled={dbTest.status === 'running' || !currentFix}
            className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {dbTest.status === 'running' ? 'جارٍ الإرسال...' : 'اختبار تسجيل نقطة تتبع'}
          </button>
          {dbTest.status === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-green-700 font-bold text-sm">✅ نجاح</p>
              <p className="text-green-600 text-xs mt-1">{dbTest.result}</p>
            </div>
          )}
          {dbTest.status === 'failed' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-red-700 font-bold text-sm">❌ فشل</p>
              <p className="text-red-600 text-xs mt-1 break-all">{dbTest.result}</p>
            </div>
          )}
        </section>

        {/* Monitoring */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">📡 المراقبة المتكررة</h2>
          <div className="flex gap-2">
            <button
              onClick={handleStartMonitor}
              disabled={monitoring}
              className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              بدء المراقبة
            </button>
            <button
              onClick={handleStopMonitor}
              disabled={!monitoring}
              className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              إيقاف
            </button>
          </div>
          {monitoring && (
            <p className="text-xs text-green-600 text-center animate-pulse">المراقبة نشطة — انتظار نقاط GPS جديدة...</p>
          )}
          {monitorFixes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="p-1.5 text-right">الوقت</th>
                    <th className="p-1.5 text-right">الدقة</th>
                    <th className="p-1.5 text-right">خط العرض</th>
                    <th className="p-1.5 text-right">خط الطول</th>
                  </tr>
                </thead>
                <tbody>
                  {monitorFixes.map((f, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="p-1.5 text-gray-500">{new Date(f.capturedAt).toLocaleTimeString('ar-EG')}</td>
                      <td className="p-1.5 font-mono" dir="ltr">{f.accuracy}m</td>
                      <td className="p-1.5 font-mono text-[9px]" dir="ltr">{f.latitude.toFixed(6)}</td>
                      <td className="p-1.5 font-mono text-[9px]" dir="ltr">{f.longitude.toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Diagnostic Log */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700">📋 سجل التشخيص</h2>
            <button onClick={clearLog} className="text-xs text-red-500 hover:text-red-700">مسح</button>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 h-48 overflow-y-auto font-mono text-[10px] leading-relaxed" dir="ltr">
            {log.length === 0 && <p className="text-gray-500 text-center mt-10">لا توجد أخطاء بعد</p>}
            {log.map((entry, i) => (
              <div key={i} className={
                entry.level === 'error' ? 'text-red-400'
                : entry.level === 'warn' ? 'text-yellow-400'
                : entry.level === 'success' ? 'text-green-400'
                : 'text-gray-300'
              }>
                <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString('ar-EG')}</span> {entry.message}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-medium">{value}</span>
    </div>
  )
}

function PermBadge({ status }: { status: PermStatus }) {
  const s = {
    granted: 'bg-green-100 text-green-700',
    prompt: 'bg-amber-100 text-amber-700',
    denied: 'bg-red-100 text-red-700',
    unknown: 'bg-gray-100 text-gray-500',
  }
  const l: Record<PermStatus, string> = {
    granted: 'ممنوح ✅',
    prompt: 'يطلب',
    denied: 'مرفوض ❌',
    unknown: 'غير معروف',
  }
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${s[status]}`}>{l[status]}</span>
}
