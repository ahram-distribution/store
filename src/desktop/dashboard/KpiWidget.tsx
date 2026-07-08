interface KpiWidgetProps {
  title: string
  value: string | number
  subtitle?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  icon?: string
  color?: string
  loading?: boolean
}

export function KpiWidget({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon,
  color = 'var(--dt-primary)',
  loading = false,
}: KpiWidgetProps) {
  return (
    <div
      style={{
        background: 'var(--dt-bg-surface)',
        borderRadius: 'var(--dt-radius-lg)',
        border: '1px solid var(--dt-border)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 4,
          height: '100%',
          background: color,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </span>
        {icon && <span style={{ fontSize: 18, opacity: 0.6 }}>{icon}</span>}
      </div>

      {loading ? (
        <div
          style={{
            height: 28,
            width: '60%',
            background: 'var(--dt-border-light)',
            borderRadius: 4,
            animation: 'dt-pulse 1.5s ease-in-out infinite',
          }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 'var(--dt-font-size-2xl)', fontWeight: 700, color: 'var(--dt-text-primary)', lineHeight: 1.1 }}>
            {value}
          </span>
          {trend && trendValue && (
            <span
              style={{
                fontSize: 'var(--dt-font-size-xs)',
                fontWeight: 600,
                color:
                  trend === 'up'
                    ? 'var(--dt-success)'
                    : trend === 'down'
                      ? 'var(--dt-danger)'
                      : 'var(--dt-text-muted)',
              }}
            >
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
            </span>
          )}
        </div>
      )}

      {subtitle && (
        <span style={{ fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-muted)' }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}
