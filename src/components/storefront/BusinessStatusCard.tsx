import type { BusinessStatus, BusinessStatusCardData } from '../../utils/cart-availability'
import { Package } from 'lucide-react'

interface BusinessStatusCardProps {
  data: BusinessStatusCardData
  compact?: boolean
  className?: string
}

const STATUS_STYLE: Record<Exclude<BusinessStatus, null>, { shell: string; text: string; chip: string; dot: string }> = {
  green: {
    shell: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    chip: 'bg-emerald-100 text-emerald-800',
    dot: '🟢',
  },
  yellow: {
    shell: 'bg-yellow-50 border-yellow-200',
    text: 'text-yellow-800',
    chip: 'bg-yellow-100 text-yellow-800',
    dot: '🟡',
  },
  red: {
    shell: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    chip: 'bg-red-100 text-red-800',
    dot: '🔴',
  },
}

export function BusinessStatusCard({ data, compact, className }: BusinessStatusCardProps) {
  if (!data?.status) return null
  const style = STATUS_STYLE[data.status]
  const hasChip = Boolean(data.chipLabel)

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${style.shell} ${className ?? ''}`}>
        <span className="text-sm leading-none">{style.dot}</span>
        <span className={`text-xs font-semibold ${style.text} leading-snug`}>{data.verdict}</span>
        {data.status === 'red' && hasChip && (
          <span className={`inline-flex items-center gap-1 rounded ${style.chip} px-2 py-0.5 text-[11px]`}>
            <Package className="w-3 h-3" />
            {data.chipLabel}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-lg border p-3 ${style.shell} ${data.status === 'green' ? 'p-2' : ''} ${className ?? ''}`}>
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-sm leading-none mt-0.5">{style.dot}</span>
        <div className="flex flex-col gap-1 min-w-0">
          <p className={`font-semibold leading-snug ${style.text} ${data.status === 'green' ? 'text-xs' : 'text-sm'}`}>
            {data.verdict}
          </p>
          {data.productName && (
            <p className={`text-[11px] ${style.text} opacity-90 leading-snug`}>
              <span className="font-bold">{data.productName}</span>
              {data.requestedLabel && <span> — المطلوب: {data.requestedLabel}</span>}
              {data.executableLabel && <span> — المتوقع تنفيذه: {data.executableLabel}</span>}
            </p>
          )}
          {data.status !== 'green' && data.detail && (
            <p className={`text-xs ${style.text} opacity-90 leading-snug`}>{data.detail}</p>
          )}
          {data.status !== 'green' && data.lead && (
            <p className={`text-xs ${style.text} opacity-90 leading-snug`}>{data.lead}</p>
          )}
          {data.status !== 'green' && hasChip && (
            <span className={`inline-flex items-center gap-1 w-fit rounded ${style.chip} px-2.5 py-1 text-xs`}>
              <Package className="w-3.5 h-3.5" />
              {data.chipLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
