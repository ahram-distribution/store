import { Target, ShoppingCart, DollarSign, HandCoins, Users, Clock, Coffee, Timer } from 'lucide-react'

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function fmtShort(n: number): string {
  return Math.round(n).toLocaleString('en-EG')
}

interface RuntimeTodaySummaryProps {
  durationMinutes: number
  netWorkMinutes: number
  breakMinutes: number
  targetHours: number
  progressPct: number
  todayOrders: number
  todaySales: number
  todayCollections: number
  todayNewCustomers: number
}

export default function RuntimeTodaySummary({
  durationMinutes, netWorkMinutes, breakMinutes, targetHours, progressPct,
  todayOrders, todaySales, todayCollections, todayNewCustomers,
}: RuntimeTodaySummaryProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-bold text-gray-700">ملخص اليوم</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 mb-2">
        <SummaryCell icon={<Clock className="w-3.5 h-3.5" />} value={fmt(durationMinutes)} label="الساعات" color="blue" />
        <SummaryCell icon={<Timer className="w-3.5 h-3.5" />} value={fmt(netWorkMinutes)} label="صافي" color="green" />
        <SummaryCell icon={<Coffee className="w-3.5 h-3.5" />} value={fmt(breakMinutes)} label="استراحة" color="amber" />
        <SummaryCell icon={<Target className="w-3.5 h-3.5" />} value={`${targetHours}h`} label="الهدف" color="purple" />
        <SummaryCell icon={<ShoppingCart className="w-3.5 h-3.5" />} value={`${todayOrders}`} label="طلبات" color="blue" />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <SummaryCell icon={<DollarSign className="w-3.5 h-3.5" />} value={fmtShort(todaySales)} label="مبيعات" color="green" />
        <SummaryCell icon={<HandCoins className="w-3.5 h-3.5" />} value={fmtShort(todayCollections)} label="تحصيل" color="amber" />
        <SummaryCell icon={<Users className="w-3.5 h-3.5" />} value={`${todayNewCustomers}`} label="عملاء" color="purple" />
        <SummaryCell
          icon={<Target className="w-3.5 h-3.5" />}
          value={`${progressPct}%`}
          label="الإنجاز"
          color={progressPct >= 100 ? 'green' : progressPct >= 70 ? 'blue' : 'amber'}
        />
      </div>
    </div>
  )
}

function SummaryCell({ icon, value, label, color }: {
  icon: React.ReactNode
  value: string
  label: string
  color: 'blue' | 'green' | 'amber' | 'purple'
}) {
  const bgMap = { blue: 'bg-blue-50', green: 'bg-green-50', amber: 'bg-amber-50', purple: 'bg-purple-50' }
  const textMap = { blue: 'text-blue-700', green: 'text-green-700', amber: 'text-amber-700', purple: 'text-purple-700' }
  const iconMap = { blue: 'text-blue-500', green: 'text-green-500', amber: 'text-amber-500', purple: 'text-purple-500' }

  return (
    <div className={`${bgMap[color]} rounded-xl p-1.5 text-center`}>
      <div className={`${iconMap[color]} flex justify-center mb-0.5`}>{icon}</div>
      <div className={`text-xs font-bold ${textMap[color]} tabular-nums leading-tight`}>{value}</div>
      <div className={`text-[9px] ${textMap[color]} opacity-70`}>{label}</div>
    </div>
  )
}
