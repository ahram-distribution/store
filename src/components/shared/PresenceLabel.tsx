const ACTIVITY_LABELS: Record<string, string> = {
  heartbeat: 'نبض النظام',
  gps: 'تتبع GPS',
  visit: 'زيارة',
  order: 'طلب',
  collection: 'تحصيل',
}

const STATUS_ICONS: Record<string, string> = {
  connected: '🟢',
  delayed: '🟡',
  lost: '🔴',
  no_data: '⚪',
}

const STATUS_LABELS: Record<string, string> = {
  connected: 'متصل',
  delayed: 'متأخر',
  lost: 'منقطع',
  no_data: 'لا يوجد نشاط',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'منذ لحظات'
  if (minutes < 60) return `منذ ${minutes} دقيقة`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (remaining === 0) return `منذ ${hours} ساعة`
  return `منذ ${hours} ساعة و ${remaining} دقيقة`
}

interface PresenceLabelProps {
  connectionStatus: string
  lastActivityAt: string | null
  lastActivityType: string | null
}

export default function PresenceLabel({ connectionStatus, lastActivityAt, lastActivityType }: PresenceLabelProps) {
  const icon = STATUS_ICONS[connectionStatus] ?? '⚪'
  const label = STATUS_LABELS[connectionStatus] ?? 'غير معروف'
  const activityLabel = lastActivityType
    ? ACTIVITY_LABELS[lastActivityType] ?? lastActivityType
    : null

  return (
    <div className="text-[10px] leading-tight">
      <span>{icon} {label}</span>
      {lastActivityAt && activityLabel && (
        <div className="text-gray-400 mt-0.5">
          آخر نشاط: {activityLabel} {timeAgo(lastActivityAt)}
        </div>
      )}
      {!lastActivityAt && (
        <div className="text-gray-400 mt-0.5">لا يوجد نشاط</div>
      )}
    </div>
  )
}
