import { useEffect, useState } from 'react'
import { useDesktopStore } from '../store/desktopStore'

export function StatusBar() {
  const [clock, setClock] = useState(new Date())
  const selectedRows = useDesktopStore((s) => s.selectedRows)
  const activeTab = useDesktopStore((s) => s.activeTab)
  const wsState = useDesktopStore((s) => s.workspaceState)

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  const activeWs = wsState.find((t) => t.id === activeTab)

  return (
    <footer
      style={{
        height: 'var(--dt-statusbar-height)',
        background: 'var(--dt-bg-statusbar)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        fontSize: 'var(--dt-font-size-xs)',
        color: 'var(--dt-text-statusbar)',
        gap: 12,
        flexShrink: 0,
      }}
    >
      {/* Business Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dt-warning)', display: 'inline-block' }} />
          معلق: 0
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dt-danger)', display: 'inline-block' }} />
          معطل: 0
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dt-accent)', display: 'inline-block' }} />
          متأخر: 0
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dt-success)', display: 'inline-block' }} />
          الحضور: 0
        </span>
      </div>

      {selectedRows.size > 0 && (
        <span style={{ color: 'var(--dt-accent)' }}>
          {selectedRows.size} صف(وف) محدد
        </span>
      )}

      {activeWs && (
        <span style={{ color: 'var(--dt-text-statusbar)', opacity: 0.6 }}>
          {activeWs.icon} {activeWs.label}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {/* Technical Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, direction: 'ltr' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dt-success)', display: 'inline-block' }} />
          متصل
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dt-success)', display: 'inline-block' }} />
          DB
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dt-success)', display: 'inline-block' }} />
          Sync
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          REP-001
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span>
          {clock.toLocaleDateString('ar-SA', {
            year: 'numeric', month: 'short', day: 'numeric',
          })}
        </span>
        <span>
          {clock.toLocaleTimeString('ar-SA', {
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>
    </footer>
  )
}
