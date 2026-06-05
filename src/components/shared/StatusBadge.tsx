interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'مسودة' },
  submitted: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'مقدم' },
  reviewing: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'قيد المراجعة' },
  returned_for_revision: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'معاد للتعديل' },
  approved: { bg: 'bg-green-100', text: 'text-green-700', label: 'معتمد' },
  preparing: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'قيد التجهيز' },
  prepared: { bg: 'bg-teal-100', text: 'text-teal-700', label: 'تم التجهيز' },
  ready_for_dispatch: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'بانتظار القرار' },
  sent_to_delivery: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'أرسل للتوصيل' },
  deferred: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'مؤجل' },
  dispatched: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'تم الشحن' },
  delivered: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'تم التسليم' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'ملغي' },
  active: { bg: 'bg-green-100', text: 'text-green-700', label: 'نشط' },
  completed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'مكتمل' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'معلق' },
  live: { bg: 'bg-red-100', text: 'text-red-700', label: 'مباشر' },
  ended: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'منتهي' },
  awarded: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'تم الترسية' },
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = statusConfig[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status }
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-3 py-1'

  return (
    <span className={`${config.bg} ${config.text} ${sizeClass} rounded-full font-medium inline-block`}>
      {config.label}
    </span>
  )
}
