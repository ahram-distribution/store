import { useAuthStore } from '../../store/auth'
import { useDesktopStore } from '../store/desktopStore'
import { getWorkspaceCommands } from '../workspace/WorkspaceRegistry'
import { QuickSearch } from '../navigation/QuickSearch'
import { DateRangeSelector } from './DateRangeSelector'
import { CompanySelector } from './CompanySelector'
import { BranchSelector } from './BranchSelector'
import { WarehouseSelector } from './WarehouseSelector'

export function Toolbar() {
  const { user, logout } = useAuthStore()
  const setQuickSearchOpen = useDesktopStore((s) => s.setQuickSearchOpen)
  const activeTab = useDesktopStore((s) => s.activeTab)
  const wsState = useDesktopStore((s) => s.workspaceState)
  const triggerRefresh = useDesktopStore((s) => s.triggerRefresh)
  const notificationCount = useDesktopStore((s) => s.notificationCount)
  const displayName = user != null ? String((user as unknown as Record<string, unknown>).name ?? '') : ''

  const activeWs = wsState.find((t) => t.id === activeTab)
  const activeType = activeWs?.type ?? ''
  const commands = activeType ? getWorkspaceCommands(activeType) : []

  return (
    <header
      style={{
        height: 'var(--dt-toolbar-height)',
        background: 'var(--dt-bg-toolbar)',
        borderBottom: '1px solid var(--dt-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Layer 1 - Global Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 8,
          height: '50%',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setQuickSearchOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px',
            background: 'var(--dt-bg)',
            border: '1px solid var(--dt-border)',
            borderRadius: 'var(--dt-radius-md)',
            color: 'var(--dt-text-muted)',
            fontSize: 'var(--dt-font-size-sm)',
            cursor: 'pointer',
            minWidth: 180,
          }}
        >
          <span style={{ fontSize: 12 }}>🔍</span>
          <span>بحث سريع...</span>
          <span style={{ marginRight: 'auto' }} />
          <kbd style={{ fontSize: 9, color: 'var(--dt-text-muted)', background: 'var(--dt-bg-surface)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--dt-border)' }}>
            Ctrl+K
          </kbd>
        </button>

        <DateRangeSelector />
        <CompanySelector />
        <BranchSelector />
        <WarehouseSelector />

        <div style={{ width: 1, height: 20, background: 'var(--dt-border)', flexShrink: 0 }} />

        <button
          onClick={() => triggerRefresh('current')}
          title="تحديث (Ctrl+R)"
          style={{
            background: 'transparent', border: '1px solid var(--dt-border)',
            borderRadius: 'var(--dt-radius-sm)', padding: '2px 8px',
            cursor: 'pointer', color: 'var(--dt-text-secondary)',
            fontSize: 14,
          }}
        >
          🔄
        </button>

        <QuickSearch />

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--dt-font-size-sm)',
          }}
        >
          <button
            title="الإشعارات"
            style={{
              position: 'relative',
              background: 'transparent', border: '1px solid var(--dt-border)',
              borderRadius: 'var(--dt-radius-sm)', padding: '2px 8px',
              cursor: 'pointer', color: 'var(--dt-text-secondary)',
              fontSize: 14,
            }}
          >
            🔔
            {notificationCount > 0 && (
              <span
                style={{
                  position: 'absolute', top: -4, right: -4,
                  background: 'var(--dt-danger)', color: 'white',
                  borderRadius: '50%', width: 16, height: 16,
                  fontSize: 9, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700,
                }}
              >
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </button>
          <span style={{ color: 'var(--dt-text-secondary)', fontSize: 'var(--dt-font-size-xs)' }}>
            {displayName || 'مستخدم'}
          </span>
          <button
            onClick={logout}
            title="تسجيل الخروج"
            style={{
              background: 'transparent',
              border: '1px solid var(--dt-border)',
              borderRadius: 'var(--dt-radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              color: 'var(--dt-text-secondary)',
              fontSize: 'var(--dt-font-size-xs)',
            }}
          >
            خروج
          </button>
        </div>
      </div>

      {/* Layer 2 - Workspace Commands */}
      {commands.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 4,
            height: '50%',
            flexShrink: 0,
            borderTop: '1px solid var(--dt-border)',
            background: 'var(--dt-bg-surface)',
          }}
        >
          {commands.map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => cmd.action(activeTab || '')}
              title={cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', background: 'transparent',
                border: '1px solid transparent', borderRadius: 'var(--dt-radius-sm)',
                color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-xs)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dt-bg-hover)'; e.currentTarget.style.borderColor = 'var(--dt-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
            >
              {cmd.icon && <span style={{ fontSize: 12 }}>{cmd.icon}</span>}
              <span>{cmd.label}</span>
              {cmd.shortcut && (
                <kbd style={{ fontSize: 9, color: 'var(--dt-text-muted)', marginRight: 4 }}>{cmd.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </header>
  )
}
