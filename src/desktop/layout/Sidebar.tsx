import { NavMenu } from '../navigation/NavMenu'
import { useDesktopStore } from '../store/desktopStore'

export function Sidebar() {
  const collapsed = useDesktopStore((s) => s.sidebarCollapsed)
  const toggle = useDesktopStore((s) => s.togglesidebar)

  return (
    <aside
      data-collapsed={collapsed}
      style={{
        width: collapsed ? 52 : 'var(--dt-sidebar-width)',
        background: 'var(--dt-bg-sidebar)',
        borderLeft: '1px solid var(--dt-border-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 150ms ease',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: 'var(--dt-toolbar-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? 0 : '0 16px',
          borderBottom: '1px solid var(--dt-border-sidebar)',
          flexShrink: 0,
        }}
      >
        {!collapsed && (
          <span style={{ color: 'white', fontWeight: 700, fontSize: 15, letterSpacing: '0.3px' }}>
            الأهرام
          </span>
        )}
        <button
          onClick={toggle}
          title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--dt-text-sidebar)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          {collapsed ? '☰' : '◀'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
        <NavMenu collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--dt-border-sidebar)',
            fontSize: 'var(--dt-font-size-xs)',
            color: 'var(--dt-text-sidebar-heading)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dt-success)', display: 'inline-block' }} />
            v1.2.1
          </div>
        </div>
      )}
    </aside>
  )
}
