import { useAuthStore } from '../../store/auth'
import { useDesktopStore } from '../store/desktopStore'
import { COMMAND_CENTER_TYPE } from '../workspace/types'
import { createDefaultState, getAllDefinitions } from '../workspace/WorkspaceRegistry'

interface NavMenuProps {
  collapsed: boolean
}

const EXECUTIVE_SUPERVISOR_ROLES = ['executive-supervisor', 'admin', 'manager']

export function NavMenu({ collapsed }: NavMenuProps) {
  const addWorkspace = useDesktopStore((s) => s.addWorkspace)
  const setActiveTab = useDesktopStore((s) => s.setActiveTab)
  const activeTab = useDesktopStore((s) => s.activeTab)
  const wsState = useDesktopStore((s) => s.workspaceState)
  const user = useAuthStore((s) => s.user)

  const userRole = user != null ? String((user as unknown as Record<string, string>).role ?? '') : ''

  const definitions = getAllDefinitions().filter((d) => {
    if (!d.roles || d.roles.length === 0) return true
    return d.roles.some((r) => EXECUTIVE_SUPERVISOR_ROLES.includes(r))
  })

  const handleOpen = (type: string) => {
    const existing = wsState.find((t) => t.type === type)
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    const ws = createDefaultState(type)
    addWorkspace(ws)
  }

  const handleHomeClick = () => {
    const cc = wsState.find((t) => t.type === COMMAND_CENTER_TYPE)
    if (cc) {
      setActiveTab(cc.id)
    }
  }

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {!collapsed && (
        <div style={{ padding: '6px 14px 2px', fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-sidebar-heading)', fontWeight: 600 }}>
          {userRole ? `مرحباً, ${userRole}` : 'القائمة'}
        </div>
      )}
      {definitions.map((def) => {
        const isActive = wsState.some((t) => t.id === activeTab && t.type === def.type)
        const isCommandCenter = def.type === COMMAND_CENTER_TYPE
        return (
          <button
            key={def.type}
            onClick={isCommandCenter ? handleHomeClick : () => handleOpen(def.type)}
            title={collapsed ? def.label : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: collapsed ? 0 : 10,
              padding: collapsed ? '10px 0' : '7px 14px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              background: isActive ? 'var(--dt-bg-sidebar-active)' : 'transparent',
              border: 'none',
              color: isActive ? 'var(--dt-text-sidebar-active)' : 'var(--dt-text-sidebar)',
              cursor: 'pointer',
              fontSize: collapsed ? 18 : 'var(--dt-font-size-sm)',
              fontWeight: isActive ? 600 : 400,
              borderRadius: 0,
              position: 'relative',
              width: '100%',
              transition: 'background 100ms',
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--dt-bg-sidebar-hover)' }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: collapsed ? 20 : 15, flexShrink: 0 }}>
              {def.icon}
            </span>
            {!collapsed && (
              <span style={{ flex: 1, textAlign: 'right' }}>{def.label}</span>
            )}
            {isActive && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 3,
                  bottom: 3,
                  width: 3,
                  background: 'var(--dt-accent)',
                  borderRadius: '0 2px 2px 0',
                }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
