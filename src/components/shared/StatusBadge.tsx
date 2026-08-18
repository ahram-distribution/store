import { memo } from 'react'
import { ORDER_STATUS_LABELS } from '../../types/order-display'

interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md' | 'lg'
}

const statusStyle: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-500' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-600' },
  reviewing: { bg: 'bg-blue-50', text: 'text-blue-600' },
  returned_for_revision: { bg: 'bg-blue-50', text: 'text-blue-600' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  preparing: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  prepared: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  dispatched: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  delivered: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  completed: { bg: 'bg-blue-50', text: 'text-blue-600' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-500' },
  live: { bg: 'bg-red-50', text: 'text-red-600' },
  ended: { bg: 'bg-gray-100', text: 'text-gray-500' },
  awarded: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
}

const ENTITY_LABELS: Record<string, string> = {
  active: 'نشط',
  completed: 'مكتمل',
  pending: 'معلق',
  live: 'مباشر',
  ended: 'منتهي',
  awarded: 'تم الترسية',
}

export const StatusBadge = memo(function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const style = statusStyle[status] || { bg: 'bg-gray-100', text: 'text-gray-600' }
  const label = ORDER_STATUS_LABELS[status] || ENTITY_LABELS[status] || status
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : size === 'md' ? 'text-xs px-3 py-1' : 'text-sm px-4 py-1.5'

  return (
    <span className={`${style.bg} ${style.text} ${sizeClass} rounded-full font-semibold inline-block`}>
      {label}
    </span>
  )
})
