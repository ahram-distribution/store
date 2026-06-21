const ICONS: Record<string, string> = {
  'النشطون': '🟢', 'في استراحة': '☕', 'منقطع': '🔴', 'لم يبدؤوا': '⚪',
  'الطلبات': '📦', 'المبيعات': '💰', 'عملاء جدد': '👤', 'الزيارات': '📍',
  'نسبة التقدم': '📊',
}

interface GlobalCountersProps {
  activeCount: number
  onBreakCount: number
  connectionLossCount: number
  noStartCount: number
  totalOrders: number
  totalSales: number
  totalNewCustomers: number
  totalVisits: number
  teamProgressPct?: number
  onCounterClick?: (label: string) => void
}

interface CounterItem {
  icon: string
  label: string
  value: string
  rawValue: number
}

export default function GlobalCounters({
  activeCount, onBreakCount, connectionLossCount, noStartCount,
  totalOrders, totalSales, totalNewCustomers, totalVisits,
  teamProgressPct, onCounterClick
}: GlobalCountersProps) {

  const counters: CounterItem[] = [
    { icon: '🟢', label: 'النشطون', value: String(activeCount), rawValue: activeCount },
    { icon: '☕', label: 'في استراحة', value: String(onBreakCount), rawValue: onBreakCount },
    { icon: '🔴', label: 'منقطع', value: String(connectionLossCount), rawValue: connectionLossCount },
    { icon: '⚪', label: 'لم يبدؤوا', value: String(noStartCount), rawValue: noStartCount },
    { icon: '📦', label: 'الطلبات', value: String(totalOrders), rawValue: totalOrders },
    { icon: '💰', label: 'المبيعات', value: totalSales.toLocaleString('en-EG'), rawValue: totalSales },
    { icon: '👤', label: 'عملاء جدد', value: String(totalNewCustomers), rawValue: totalNewCustomers },
    { icon: '📍', label: 'الزيارات', value: String(totalVisits), rawValue: totalVisits },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
      {counters.map((c, i) => (
        <div key={i}
          className={`bg-white rounded-xl shadow-sm p-2.5 ${onCounterClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
          onClick={() => onCounterClick?.(c.label)}
        >
          {c.label === 'نسبة التقدم' ? (
            <>
              <p className="text-[10px] font-bold text-gray-400">{c.icon} {c.label}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs font-bold text-gray-500">--</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${teamProgressPct ?? 0}%` }} />
                </div>
                <span className="text-xs font-bold text-blue-600">{(teamProgressPct ?? 0).toFixed(0)}%</span>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-bold text-gray-400">{c.icon} {c.label}</p>
              <p className="text-lg font-bold text-gray-800 mt-0.5">{c.value}</p>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
