import { memo } from 'react'
import { formatCurrencyShort } from '../../utils/format'

interface SahlKpiCardProps {
  label: string
  value: number
  format?: 'currency' | 'count' | 'text'
  color?: 'success' | 'danger' | 'warning' | 'primary' | 'text'
  icon?: string
  active?: boolean
  onClick?: () => void
  subtitle?: string
  traceLabel?: string
}

const colorClasses: Record<string, string> = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  primary: 'text-primary',
  text: 'text-text',
}

const borderColorMap: Record<string, string> = {
  success: 'border-success hover:border-success/50',
  danger: 'border-danger hover:border-danger/50',
  warning: 'border-warning hover:border-warning/50',
  primary: 'border-primary hover:border-primary/50',
  text: 'border-border hover:border-primary/50',
}

const activeBorderMap: Record<string, string> = {
  success: 'border-success ring-1 ring-success/30',
  danger: 'border-danger ring-1 ring-danger/30',
  warning: 'border-warning ring-1 ring-warning/30',
  primary: 'border-primary ring-1 ring-primary/30',
  text: 'border-primary ring-1 ring-primary/20',
}

export default memo(function SahlKpiCard({ label, value, format = 'currency', color = 'text', icon, active, onClick, subtitle, traceLabel }: SahlKpiCardProps) {
  const display = format === 'currency' ? formatCurrencyShort(value) : format === 'count' ? String(value) : String(value)

  const Wrapper = onClick ? 'button' : 'div'
  const wrapperProps = onClick ? { onClick, type: 'button' as const } : {}

  return (
    <Wrapper
      {...wrapperProps}
      className={`bg-white rounded-xl border p-4 text-left transition-all ${
        active ? activeBorderMap[color] || activeBorderMap.text : borderColorMap[color] || borderColorMap.text
      } ${onClick ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-xs">{icon}</span>}
        <div className="text-[10px] text-text-secondary">{label}</div>
      </div>
      <div className={`text-lg font-bold mt-1 ${colorClasses[color] || 'text-text'}`}>
        {display}
      </div>
      {subtitle && <div className="text-[9px] text-text-secondary mt-0.5">{subtitle}</div>}
      {active && traceLabel && (
        <div className="text-[9px] text-primary mt-1">🔍 {traceLabel}</div>
      )}
    </Wrapper>
  )
})
