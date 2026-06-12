interface TeamAggregates {
  active_employee_count: number
  total_net_minutes: number | null
  total_target_minutes: number | null
  progress_pct: number
  avg_net_minutes: number | null
  avg_target_minutes: number | null
  late_count: number
  zero_orders_count: number
  zero_visits_count: number
  best_performer: { employee_id: string; name: string; score: number } | null
  worst_performer: { employee_id: string; name: string; score: number } | null
}

interface ProductivityAreaProps {
  team: TeamAggregates
  endedCount: number
  onVisitCount: number
  timeFilter: string
}

const fmt = (m?: number | null) => {
  if (m == null) return '--'
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

export default function ProductivityArea({ team, endedCount, onVisitCount, timeFilter }: ProductivityAreaProps) {
  const pct = team.progress_pct ?? 0
  const barColor = pct >= 100 ? 'bg-green-500'
    : pct >= 80 ? 'bg-blue-500'
    : pct >= 50 ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <div className="mb-4">
      <div className="bg-white rounded-xl shadow-sm p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-gray-700">تقدم الفريق</span>
          <span className="text-xs font-bold" dir="ltr">{pct.toFixed(0)}%</span>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="text-[10px] text-gray-400 flex items-center justify-between" dir="ltr">
          <span>{fmt(team.avg_net_minutes)} avg · {fmt(team.total_target_minutes)} target</span>
        </div>

        {timeFilter === 'today' && (
          <>
            {/* Best / Worst */}
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <div className="bg-emerald-50 rounded-lg p-2">
                <p className="text-[10px] text-emerald-600 font-bold mb-0.5">🏆 أفضل أداء</p>
                {team.best_performer
                  ? <><p className="text-xs font-bold text-gray-800">{team.best_performer.name}</p><p className="text-[10px] text-emerald-600">{team.best_performer.score}%</p></>
                  : <p className="text-[10px] text-gray-400">—</p>}
              </div>
              <div className="bg-red-50 rounded-lg p-2">
                <p className="text-[10px] text-red-600 font-bold mb-0.5">📉 أسوأ أداء</p>
                {team.worst_performer
                  ? <><p className="text-xs font-bold text-gray-800">{team.worst_performer.name}</p><p className="text-[10px] text-red-600">{team.worst_performer.score}%</p></>
                  : <p className="text-[10px] text-gray-400">—</p>}
              </div>
            </div>

            {/* Extra stats */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500">
              {team.late_count > 0 && <span>⏰ متأخرون: {team.late_count}</span>}
              <span>✅ منتهون: {endedCount}</span>
              {onVisitCount > 0 && <span>🔵 في زيارة: {onVisitCount}</span>}
              {team.zero_orders_count > 0 && <span>📦 بلا طلبات: {team.zero_orders_count}</span>}
              {team.zero_visits_count > 0 && <span>📍 بلا زيارات: {team.zero_visits_count}</span>}
              <span>📊 متوسط: {fmt(team.avg_net_minutes)} / {fmt(team.avg_target_minutes)} ({pct.toFixed(0)}%)</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
