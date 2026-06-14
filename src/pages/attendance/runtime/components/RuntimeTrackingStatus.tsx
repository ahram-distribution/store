import type { TrackingStatus } from '../../../../services/trackingEngine'
import { formatTime } from '../../../../utils/format'

interface RuntimeTrackingStatusProps {
  status: TrackingStatus
}

export default function RuntimeTrackingStatus({ status }: RuntimeTrackingStatusProps) {
  if (!status.running) return null

  const gpsColor = status.gpsAvailable ? 'text-green-600' : 'text-red-500'
  const gpsBg = status.gpsAvailable ? 'bg-green-50' : 'bg-red-50'
  const gpsLabel = status.gpsAvailable ? 'GPS يعمل' : 'GPS غير متاح'

  const syncColor = status.lastSyncAt
    ? (Date.now() - new Date(status.lastSyncAt).getTime()) < 60000
      ? 'text-green-600'
      : 'text-amber-600'
    : 'text-gray-400'

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${status.gpsAvailable ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`font-bold ${gpsColor}`}>{gpsLabel}</span>
          {status.gpsAccuracy != null && (
            <span className="text-gray-400">({Math.round(status.gpsAccuracy)}م)</span>
          )}
        </div>
        <span className={syncColor}>
          {status.lastSyncAt
            ? `آخر مزامنة: ${formatTime(status.lastSyncAt)}`
            : 'لم تتم المزامنة'}
        </span>
      </div>

      <div className="flex items-center justify-between text-gray-400">
        <span>
          الفاصل: {status.intervalSeconds >= 60
            ? `${status.intervalSeconds / 60} دقيقة`
            : `${status.intervalSeconds} ثانية`}
        </span>
        {status.pendingCount > 0 && (
          <span className="text-amber-600 font-bold">
            {status.pendingCount} نقطة ← {navigator.onLine ? 'جارٍ الإرسال...' : 'بانتظار الاتصال'}
          </span>
        )}
        {status.pendingCount === 0 && (
          <span className="text-green-600">جميع النقاط متزامنة</span>
        )}
      </div>

      {status.lastPointAt && (
        <div className="text-gray-400">
          آخر نقطة: {formatTime(status.lastPointAt, { second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
