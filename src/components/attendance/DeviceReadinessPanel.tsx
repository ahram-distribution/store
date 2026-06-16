import { useState, useEffect, useRef } from 'react'
import { getCurrentLocation } from '../../services/gpsService'

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail'
type PanelStatus = 'ready' | 'blocked_location' | 'blocked_gps' | 'checking'

interface DeviceCheck {
  label: string
  status: CheckStatus
  message: string
}

export default function DeviceReadinessPanel({
  onReadyChange,
}: {
  onReadyChange?: (ready: boolean) => void
}) {
  const [panelStatus, setPanelStatus] = useState<PanelStatus>('checking')
  const [checks, setChecks] = useState<DeviceCheck[]>([
    { label: 'الموقع', status: 'pending', message: '' },
    { label: 'GPS', status: 'pending', message: '' },
    { label: 'الإنترنت', status: 'pending', message: '' },
    { label: 'الإشعارات', status: 'pending', message: '' },
  ])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  const updateCheck = (index: number, update: Partial<DeviceCheck>) => {
    setChecks(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...update }
      return next
    })
  }

  const checkAll = async () => {
    setPanelStatus('checking')
    for (let i = 0; i < checks.length; i++) {
      updateCheck(i, { status: 'checking', message: '' })
    }

    // 1. Location permission
    updateCheck(0, { status: 'checking', message: 'جاري فحص إذن الموقع...' })
    let locationGranted = false
    try {
      if (navigator.permissions) {
        const perm = await navigator.permissions.query({ name: 'geolocation' })
        if (perm.state === 'granted') {
          locationGranted = true
          updateCheck(0, { status: 'pass', message: 'مفعل' })
        } else if (perm.state === 'denied') {
          updateCheck(0, { status: 'fail', message: 'مرفوض — يلزم التفعيل من الإعدادات' })
        } else {
          updateCheck(0, { status: 'fail', message: 'لم يتم منح الإذن بعد' })
        }
      } else {
        updateCheck(0, { status: 'pass', message: 'تم التفعيل' })
        locationGranted = true
      }
    } catch {
      updateCheck(0, { status: 'pass', message: 'تم التفعيل' })
      locationGranted = true
    }

    // 2. Internet
    updateCheck(2, { status: 'checking', message: 'جاري فحص الاتصال...' })
    if (navigator.onLine) {
      updateCheck(2, { status: 'pass', message: 'متصل' })
    } else {
      updateCheck(2, { status: 'fail', message: 'غير متصل — يلزم الاتصال بالإنترنت' })
    }

    // 3. Notifications
    updateCheck(3, { status: 'checking', message: 'جاري فحص الإشعارات...' })
    if ('Notification' in window && Notification.permission === 'granted') {
      updateCheck(3, { status: 'pass', message: 'مفعلة' })
    } else if ('Notification' in window && Notification.permission === 'denied') {
      updateCheck(3, { status: 'fail', message: 'غير مفعلة — يلزم التفعيل من الإعدادات' })
    } else {
      updateCheck(3, { status: 'pass', message: 'مفعلة' })
    }

    // 4. GPS (get current location with quick timeout)
    updateCheck(1, { status: 'checking', message: 'جاري تحديد الموقع...' })
    const gpsResult = await getCurrentLocation({ maxWaitMs: 10000, maxAccuracy: 200 })
    if (gpsResult.success && gpsResult.location) {
      updateCheck(1, { status: 'pass', message: `تم — دقة ${Math.round(gpsResult.location.accuracy)} متر` })
    } else {
      const errCode = gpsResult.error?.code
      if (errCode === 'TIMEOUT') {
        updateCheck(1, { status: 'fail', message: 'لم يتم الحصول على موقع — تأكد من فتح GPS' })
      } else if (errCode === 'UNSUPPORTED') {
        updateCheck(1, { status: 'fail', message: 'GPS غير مدعوم على هذا الجهاز' })
      } else {
        updateCheck(1, { status: 'fail', message: 'فشل تحديد الموقع — يلزم تشغيل GPS' })
      }
    }

    // Determine overall status
    setPanelStatus(prev => {
      const newStatus = determineOverall(locationGranted, gpsResult.success)
      if (onReadyChange) onReadyChange(newStatus === 'ready')
      return newStatus
    })
  }

  const handleEnableLocation = async () => {
    setActionLoading('location')
    try {
      const result = await getCurrentLocation({ maxWaitMs: 5000, maxAccuracy: 500 })
      if (result.success) {
        updateCheck(1, { status: 'pass', message: `تم — دقة ${Math.round(result.location!.accuracy)} متر` })
        updateCheck(0, { status: 'pass', message: 'مفعل' })
        setPanelStatus('ready')
        if (onReadyChange) onReadyChange(true)
      } else {
        const errCode = result.error?.code
        if (errCode === 'TIMEOUT') {
          updateCheck(1, { status: 'fail', message: 'GPS لم يستجب — تأكد من تشغيل GPS في الإعدادات' })
        } else {
          updateCheck(0, { status: 'fail', message: 'إذن الموقع مرفوض — اذهب إلى إعدادات الجهاز وافتح الموقع' })
        }
      }
    } catch {
      updateCheck(0, { status: 'fail', message: 'حدث خطأ — حاول مرة أخرى' })
    }
    setActionLoading(null)
  }

  useEffect(() => {
    checkAll()
  }, [])

  if (panelStatus === 'checking' && checks.every(c => c.status === 'pending')) {
    return null
  }

  const allPass = checks.every(c => c.status === 'pass')
  const anyFail = checks.some(c => c.status === 'fail')

  return (
    <div className={`rounded-xl p-4 border-2 ${
      allPass
        ? 'bg-green-50 border-green-300'
        : anyFail
          ? 'bg-red-50 border-red-300'
          : 'bg-amber-50 border-amber-300'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800">جهازية الجهاز</h3>
        {allPass ? (
          <span className="flex items-center gap-1 text-xs font-bold text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            الجهاز جاهز للعمل
          </span>
        ) : anyFail ? (
          <span className="flex items-center gap-1 text-xs font-bold text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            يوجد إعداد يحتاج تفعيل
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-bold text-amber-700">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            جاري الفحص...
          </span>
        )}
      </div>

      <div className="space-y-1.5 mb-3">
        {checks.map((check, i) => (
          <div key={i} className="flex items-center justify-between py-1">
            <span className="text-xs text-gray-700">{check.label}</span>
            <span className={`flex items-center gap-1 text-[10px] ${
              check.status === 'pass' ? 'text-green-700'
              : check.status === 'fail' ? 'text-red-700'
              : check.status === 'checking' ? 'text-amber-700'
              : 'text-gray-400'
            }`}>
              {check.status === 'checking' && (
                <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              )}
              {check.status === 'pass' && '✓'}
              {check.status === 'fail' && '✗'}
              {check.status === 'pending' && '○'}
              {check.message || (
                check.status === 'pending' ? 'بانتظار الفحص'
                : check.status === 'checking' ? 'جاري...'
                : ''
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {anyFail && (
          <button
            onClick={handleEnableLocation}
            disabled={actionLoading === 'location'}
            className="flex-1 bg-blue-600 text-white text-xs py-2.5 rounded-lg font-bold hover:bg-blue-700 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {actionLoading === 'location' ? 'جاري التفعيل...' : '📍 تفعيل الموقع'}
          </button>
        )}
        <button
          onClick={checkAll}
          disabled={actionLoading === 'check'}
          className={`${anyFail ? 'flex-1' : 'w-full'} bg-gray-100 text-gray-700 text-xs py-2.5 rounded-lg font-bold hover:bg-gray-200 active:scale-[0.97] transition-all disabled:opacity-50`}
        >
          {panelStatus === 'checking' ? 'جاري الفحص...' : '✅ فحص الجهاز'}
        </button>
      </div>
    </div>
  )
}

function determineOverall(locationGranted: boolean, gpsSuccess: boolean): PanelStatus {
  if (!locationGranted) return 'blocked_location'
  if (!gpsSuccess) return 'blocked_gps'
  return 'ready'
}
