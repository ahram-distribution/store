import { useEffect, useRef } from 'react'
import { useDesktopStore } from '../store/desktopStore'

export function ContextMenu() {
  const { contextMenu, hideContextMenu } = useDesktopStore()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handle = () => hideContextMenu()
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [contextMenu, hideContextMenu])

  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const overflowX = rect.right - window.innerWidth
    const overflowY = rect.bottom - window.innerHeight
    if (overflowX > 0) menu.style.left = `${contextMenu.x - overflowX - 10}px`
    if (overflowY > 0) menu.style.top = `${contextMenu.y - overflowY - 10}px`
  }, [contextMenu])

  if (!contextMenu) return null

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: contextMenu.x,
        top: contextMenu.y,
        zIndex: 10000,
        background: 'var(--dt-bg-menu)',
        border: '1px solid var(--dt-border)',
        borderRadius: 'var(--dt-radius-md)',
        boxShadow: 'var(--dt-shadow-menu)',
        minWidth: 180,
        padding: 4,
      }}
    >
      {contextMenu.items.map((item, i) =>
        item.divider ? (
          <div
            key={i}
            style={{ height: 1, background: 'var(--dt-border)', margin: '4px 0' }}
          />
        ) : (
          <button
            key={i}
            onClick={() => {
              if (!item.disabled) item.action()
              hideContextMenu()
            }}
            disabled={item.disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              border: 'none',
              background: 'transparent',
              cursor: item.disabled ? 'default' : 'pointer',
              color: item.disabled ? 'var(--dt-text-muted)' : 'var(--dt-text-primary)',
              fontSize: 'var(--dt-font-size-sm)',
              borderRadius: 'var(--dt-radius-sm)',
              opacity: item.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = 'var(--dt-bg-row-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {item.icon && <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{item.icon}</span>}
            <span style={{ flex: 1, textAlign: 'right' }}>{item.label}</span>
            {item.shortcut && (
              <kbd style={{ fontSize: 10, color: 'var(--dt-text-muted)', fontFamily: 'var(--dt-font-mono)' }}>
                {item.shortcut}
              </kbd>
            )}
          </button>
        )
      )}
    </div>
  )
}
