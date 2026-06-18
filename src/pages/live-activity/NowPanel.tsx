interface NowPanelData {
  employees_in_visit: number
  employees_working: number
  employees_on_break: number
  orders_in_progress: number
  collection_in_progress: number
}

export function NowPanel({ data }: { data: NowPanelData | null }) {
  const items = [
    { icon: '📍', label: 'داخل زيارة', value: data?.employees_in_visit ?? 0, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    { icon: '🚗', label: 'في الطريق', value: data?.employees_working ?? 0, color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    { icon: '☕', label: 'استراحة', value: data?.employees_on_break ?? 0, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    { icon: '📦', label: 'طلبات جارية', value: data?.orders_in_progress ?? 0, color: 'text-primary', bg: 'bg-blue-50 border-blue-200' },
    { icon: '💵', label: 'تحصيل جارٍ', value: data?.collection_in_progress ?? 0, color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
  ]
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm">🔴</span>
        <h2 className="text-xs font-semibold text-text">يحدث الآن</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <div key={it.label} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${it.bg}`}>
            <span className="text-sm">{it.icon}</span>
            <span className={`text-sm font-bold ${it.color}`}>{it.value}</span>
            <span className="text-[10px] text-text-secondary">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
