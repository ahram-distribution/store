import { X, Clock, Timer, Coffee, ShoppingCart, DollarSign, HandCoins, Users, Target } from 'lucide-react'
import { formatTime } from '../../../../utils/format'

function fmt(m: number): string {
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

interface RuntimeDailySummaryModalProps {
  open: boolean
  onClose: () => void
  startedAt: string | null
  endedAt: string | null
  durationMinutes: number
  breakMinutes: number
  netWorkMinutes: number
  todayOrders: number
  todaySales: number
  todayCollections: number
  todayNewCustomers: number
  targetHours: number
  currentNetHours: number
  progressPct: number
  attendanceEnabled: boolean
}

export default function RuntimeDailySummaryModal({
  open, onClose, startedAt, endedAt, durationMinutes, breakMinutes, netWorkMinutes,
  todayOrders, todaySales, todayCollections, todayNewCustomers,
  targetHours, currentNetHours, progressPct, attendanceEnabled,
}: RuntimeDailySummaryModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideUp 0.25s ease-out' }}
      >
        <div className="sticky top-0 bg-white pt-4 pb-2 px-5 border-b border-gray-100 flex items-center justify-between rounded-t-3xl">
          <span className="text-lg font-bold text-gray-800">📋 ملخص اليوم</span>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section title="⏰ أوقات العمل">
            <Row label="وقت الحضور" value={startedAt ? formatTime(startedAt) : '--'} icon={<Clock className="w-4 h-4 text-blue-500" />} />
            {endedAt && <Row label="وقت الانصراف" value={formatTime(endedAt)} icon={<Clock className="w-4 h-4 text-gray-500" />} />}
            <Row label="إجمالي اليوم" value={fmt(durationMinutes)} icon={<Timer className="w-4 h-4 text-blue-500" />} />
            <Row label="الاستراحات" value={fmt(breakMinutes)} icon={<Coffee className="w-4 h-4 text-amber-500" />} />
            <Row label="صافي العمل" value={fmt(netWorkMinutes)} icon={<Timer className="w-4 h-4 text-green-500" />} />
          </Section>

          {attendanceEnabled && (
            <>
              <Section title="📊 الإنتاجية">
                <Row label="عدد الطلبيات" value={`${todayOrders}`} icon={<ShoppingCart className="w-4 h-4 text-blue-500" />} />
                <Row label="قيمة المبيعات" value={`${todaySales.toLocaleString('en-EG')} ج.م`} icon={<DollarSign className="w-4 h-4 text-green-500" />} />
                <Row label="قيمة التحصيلات" value={`${todayCollections.toLocaleString('en-EG')} ج.م`} icon={<HandCoins className="w-4 h-4 text-amber-500" />} />
                <Row label="العملاء الجدد" value={`${todayNewCustomers}`} icon={<Users className="w-4 h-4 text-purple-500" />} />
              </Section>

              <Section title="🎯 تحقيق الهدف">
                <Row label="الهدف اليوم" value={`${targetHours} ساعات`} icon={<Target className="w-4 h-4 text-purple-500" />} />
                <Row label="تم الإنجاز" value={`${currentNetHours} ساعات`} icon={<Target className="w-4 h-4 text-blue-500" />} />
                <Row label="نسبة الإنجاز" value={`${progressPct}%`} icon={<Target className={`w-4 h-4 ${progressPct >= 100 ? 'text-green-500' : 'text-amber-500'}`} />} />
              </Section>
            </>
          )}

          <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
            آخر تحديث: {formatTime(new Date())}
          </div>
        </div>

        <div className="px-5 pb-6">
          <button
            onClick={onClose}
            className="w-full py-3.5 bg-gray-100 text-gray-700 rounded-2xl text-base font-bold hover:bg-gray-200 transition-all"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-bold text-gray-700 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Row({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-xl">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-800 tabular-nums">{value}</span>
    </div>
  )
}
