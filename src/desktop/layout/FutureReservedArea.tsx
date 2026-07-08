import { useState } from 'react'

const RESERVED_SLOTS = 7

export function FutureReservedArea() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        height: expanded ? 28 : 16,
        background: 'var(--dt-bg-surface)',
        borderTop: '1px solid var(--dt-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: expanded ? 8 : 0,
        flexShrink: 0,
        transition: 'height 200ms ease, background 200ms ease',
        overflow: 'hidden',
        cursor: expanded ? 'default' : 'pointer',
        position: 'relative',
      }}
      title="منطقة التوسع المستقبلي"
    >
      {!expanded && (
        <span style={{ fontSize: 10, color: 'var(--dt-text-muted)', opacity: 0.5 }}>
          • • • • • • •
        </span>
      )}
      {expanded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--dt-font-size-xs)',
            color: 'var(--dt-text-muted)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--dt-text-secondary)', marginLeft: 8 }}>
            مساحة التوسع
          </span>
          {Array.from({ length: RESERVED_SLOTS }, (_, i) => (
            <div
              key={i}
              style={{
                width: 40,
                height: 18,
                border: '1px dashed var(--dt-border)',
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                color: 'var(--dt-text-muted)',
                opacity: 0.5,
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
