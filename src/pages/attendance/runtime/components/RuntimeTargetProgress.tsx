function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

interface RuntimeTargetProgressProps {
  targetHours: number
  currentNetHours: number
  progressPct: number
  remainingSeconds: number
}

export default function RuntimeTargetProgress({
  targetHours, currentNetHours, progressPct, remainingSeconds,
}: RuntimeTargetProgressProps) {
  const barColor = progressPct >= 100
    ? 'bg-gradient-to-r from-green-500 to-green-600'
    : progressPct >= 70
    ? 'bg-gradient-to-r from-blue-500 to-blue-600'
    : 'bg-gradient-to-r from-amber-500 to-amber-600'

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-gray-700">المستهدف اليوم</span>
        <span className="text-xs text-gray-400">{targetHours} ساعات</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-1000 ease-out`}
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-gray-500">{currentNetHours} ساعة فعلية</span>
        <span className="text-xs font-bold text-gray-700">{progressPct}%</span>
      </div>
      {progressPct < 100 && remainingSeconds > 0 && (
        <div className="text-xs text-amber-600 mt-1">
          متبقي {fmt(remainingSeconds / 60)}
        </div>
      )}
      {progressPct >= 100 && (
        <div className="text-xs text-green-600 mt-1 font-bold">✓ تم تحقيق المستهدف</div>
      )}
    </div>
  )
}
