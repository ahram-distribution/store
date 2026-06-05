import { useNavigate } from 'react-router-dom'
import { Zap, Clock, Gavel, Layers, CreditCard } from 'lucide-react'

const shortcuts = [
  { label: 'صفقة اليوم', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50', path: '/daily-deals' },
  { label: 'عرض الساعة', icon: Clock, color: 'text-emerald-500', bg: 'bg-emerald-50', path: '/flash-offers' },
  { label: 'المزاد', icon: Gavel, color: 'text-violet-500', bg: 'bg-violet-50', path: '/auctions' },
  { label: 'اختر شريحتك', icon: Layers, color: 'text-blue-500', bg: 'bg-blue-50', path: '/tiers' },
  { label: 'قسم الائتمان', icon: CreditCard, color: 'text-rose-500', bg: 'bg-rose-50', path: '/credit' },
]

export function BusinessShortcuts() {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-5 gap-1.5">
      {shortcuts.map((s) => (
        <div
          key={s.label}
          onClick={() => s.path && navigate(s.path)}
          className="bg-white border border-[#E5E7EB] rounded-2xl flex flex-col items-center justify-center gap-1 py-2.5 shadow-sm active:shadow-inner transition-shadow cursor-pointer"
        >
          <div className={`w-8 h-8 ${s.bg} rounded-full flex items-center justify-center`}>
            <s.icon className={`w-4 h-4 ${s.color}`} />
          </div>
          <span className="text-[10px] font-medium text-[#111827] leading-tight text-center px-0.5">{s.label}</span>
        </div>
      ))}
    </div>
  )
}