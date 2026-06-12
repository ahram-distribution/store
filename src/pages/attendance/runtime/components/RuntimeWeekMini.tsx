interface DayEntry {
  date: string
  net_hours: number
  target_hours: number
  met_target: boolean
}

interface RuntimeWeekMiniProps {
  last7Days: DayEntry[]
}

function dayName(dateStr: string): string {
  const d = new Date(dateStr)
  const names = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
  return names[d.getDay()] || '--'
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const t = new Date()
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()
}

export default function RuntimeWeekMini({ last7Days }: RuntimeWeekMiniProps) {
  if (!last7Days || last7Days.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs text-gray-400 text-center">لا توجد بيانات للأيام السبعة الماضية</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3">
      <div className="grid grid-cols-7 gap-1">
        {last7Days.map((day) => {
          const today = isToday(day.date)
          const met = day.met_target
          const pct = day.target_hours > 0 ? Math.min(Math.round((day.net_hours / day.target_hours) * 100), 100) : 0
          return (
            <div
              key={day.date}
              className={`text-center rounded-xl p-1.5 ${today ? 'ring-2 ring-blue-300 bg-blue-50' : ''}`}
            >
              <div className="text-[10px] font-bold text-gray-500">{dayName(day.date)}</div>
              <div className="text-sm font-bold text-gray-800 tabular-nums">{day.net_hours.toFixed(1)}</div>
              <div className="flex justify-center mt-0.5">
                {pct >= 100 ? (
                  <span className="text-green-500 text-xs">✓</span>
                ) : pct > 0 ? (
                  <span className="text-amber-500 text-xs">{pct}%</span>
                ) : (
                  <span className="text-gray-300 text-xs">--</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
