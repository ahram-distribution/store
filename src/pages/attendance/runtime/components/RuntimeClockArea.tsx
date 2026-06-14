import { Clock, Coffee, Timer } from 'lucide-react'
import { formatTime } from '../../../../utils/format'

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

interface RuntimeClockAreaProps {
  currentTime: Date
  startedAt: string | null
  durationMinutes: number
  netWorkMinutes: number
  breakMinutes: number
  onBreak: boolean
}

export default function RuntimeClockArea({
  currentTime, startedAt, durationMinutes, netWorkMinutes, breakMinutes, onBreak,
}: RuntimeClockAreaProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="text-center mb-3">
        <div className="text-4xl font-bold text-gray-800 tabular-nums tracking-wider" dir="ltr">
          {formatTime(currentTime, { second: '2-digit', hour12: false })}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">الوقت الحالي</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <Timer className="w-4 h-4 text-blue-500 mx-auto mb-1" />
          <div className="text-lg font-bold text-gray-800 tabular-nums" dir="ltr">{fmt(durationMinutes)}</div>
          <div className="text-[10px] text-blue-600">مدة اليوم</div>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <Timer className="w-4 h-4 text-green-500 mx-auto mb-1" />
          <div className="text-lg font-bold text-green-700 tabular-nums" dir="ltr">{fmt(netWorkMinutes)}</div>
          <div className="text-[10px] text-green-600">صافي العمل</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${onBreak ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <Coffee className={`w-4 h-4 mx-auto mb-1 ${onBreak ? 'text-amber-500' : 'text-gray-400'}`} />
          <div className={`text-lg font-bold tabular-nums ${onBreak ? 'text-amber-700' : 'text-gray-800'}`} dir="ltr">{fmt(breakMinutes)}</div>
          <div className={`text-[10px] ${onBreak ? 'text-amber-600' : 'text-gray-400'}`}>الاستراحات</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <Clock className="w-4 h-4 text-gray-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-gray-800 tabular-nums" dir="ltr">
            {startedAt ? formatTime(startedAt, { hour12: false }) : '--:--'}
          </div>
          <div className="text-[10px] text-gray-400">الحضور</div>
        </div>
      </div>
    </div>
  )
}
