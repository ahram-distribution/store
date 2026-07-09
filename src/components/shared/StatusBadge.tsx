interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'مسودة' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'مقدم' },
  reviewing: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'قيد المراجعة' },
  returned_for_revision: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'معاد للتعديل' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'معتمد' },
  preparing: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'قيد التجهيز' },
  prepared: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'تم التجهيز' },
  ready_for_dispatch: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'بانتظار القرار' },
  sent_to_delivery: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'أرسل للتوصيل' },
  dispatched: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'تم الشحن' },
  delivered: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'تم التسليم' },
  deferred: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'مؤجل' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600', label: 'ملغي' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'نشط' },
  completed: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'مكتمل' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'معلق' },
  live: { bg: 'bg-red-50', text: 'text-red-600', label: 'مباشر' },
  ended: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'منتهي' },
  awarded: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'تم الترسية' },
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
