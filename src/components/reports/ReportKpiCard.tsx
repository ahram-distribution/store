import type { KpiCardData } from '../../types/reports'

const COLOR_MAP: Record<string, string> = {
  emerald: 'bg-gradient-to-br from-emerald-50 to-green-100/60 border-emerald-200/50 text-success',
  amber: 'bg-gradient-to-br from-amber-50 to-yellow-100/60 border-amber-200/50 text-warning',
  blue: 'bg-gradient-to-br from-blue-50 to-indigo-100/60 border-blue-200/50 text-primary',
  violet: 'bg-gradient-to-br from-violet-50 to-purple-100/60 border-violet-200/50 text-accent',
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toFixed(1) + '%'
}

function kpiFontClass(formatted: string): string {
  if (formatted === '\u2014') return 'text-xl sm:text-2xl'
  const len = formatted.length
  if (len <= 8) return 'text-xl sm:text-2xl'
  if (len <= 10) return 'text-lg sm:text-xl'
  if (len <= 12) return 'text-base sm:text-lg'
  return 'text-sm sm:text-base'
}

interface ReportKpiCardProps {
  data: KpiCardData
  onClick?: () => void
}

export function ReportKpiCard({ data, onClick }: ReportKpiCardProps) {
  const formatted = data.format === 'currency' ? fmtMoney(data.value)
    : data.format === 'percentage' ? fmtPct(data.value)
    : fmt(data.value)

  const colorClass = COLOR_MAP[data.color || 'blue']
  const fontClass = kpiFontClass(formatted)

  return (
    <div
      className={`rounded-xl p-3 sm:p-4 text-center border shadow-sm overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] ${colorClass}`}
      onClick={onClick}
    >
      {data.icon && <div className="text-xl sm:text-2xl mb-1">{data.icon}</div>}
      <div className={`${fontClass} font-bold whitespace-nowrap`}>
        {formatted}
      </div>
      <div className="text-[11px] text-text-secondary mt-1 font-medium">{data.label}</div>
    </div>
  )
}

export function KpiCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {children}
    </div>
  )
}
