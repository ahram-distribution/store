import { useDesktopStore } from '../store/desktopStore'

export function Breadcrumbs() {
  const workspaceState = useDesktopStore((s) => s.workspaceState)
  const activeTab = useDesktopStore((s) => s.activeTab)

  const active = workspaceState.find((w) => w.id === activeTab)
  if (!active) return null

  return (
    <nav
      style={{
        height: 'var(--dt-breadcrumb-height)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        fontSize: 'var(--dt-font-size-sm)',
        color: 'var(--dt-text-secondary)',
        borderBottom: '1px solid var(--dt-border)',
        background: 'var(--dt-bg-surface)',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <span style={{ color: 'var(--dt-text-muted)', fontSize: 10 }}>▦</span>
      <span style={{ color: 'var(--dt-text-primary)', fontWeight: 600 }}>
        {active.icon} {active.label}
      </span>
    </nav>
  )
}
