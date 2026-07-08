import { useRef, useCallback } from 'react'
import { useDesktopStore } from '../store/desktopStore'

export function WorkspaceTabs() {
  const {
    workspaceState: tabs,
    activeTab,
    setActiveTab,
    closeWorkspace,
    pinTab,
    reorderTabs,
    setDragTabId,
    dragTabId,
  } = useDesktopStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button === 1) {
        e.preventDefault()
        closeWorkspace(id)
      }
    },
    [closeWorkspace]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      setDragTabId(id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
    },
    [setDragTabId]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault()
      const sourceId = e.dataTransfer.getData('text/plain')
      if (sourceId === targetId) return
      const fromIdx = tabs.findIndex((t) => t.id === sourceId)
      const toIdx = tabs.findIndex((t) => t.id === targetId)
      if (fromIdx !== -1 && toIdx !== -1) reorderTabs(fromIdx, toIdx)
      setDragTabId(null)
    },
    [tabs, reorderTabs, setDragTabId]
  )

  const handleDragEnd = useCallback(() => setDragTabId(null), [setDragTabId])

  if (tabs.length === 0) return null

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        background: 'var(--dt-bg)',
        borderBottom: '1px solid var(--dt-border)',
        padding: '0 4px',
        gap: 1,
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        direction: 'ltr',
      }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTab
        const isDragging = tab.id === dragTabId
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              fontSize: 'var(--dt-font-size-sm)',
              color: isActive ? 'var(--dt-primary)' : isDragging ? 'var(--dt-accent)' : 'var(--dt-text-secondary)',
              background: isActive ? 'var(--dt-bg-surface)' : 'transparent',
              borderTopLeftRadius: 'var(--dt-radius-sm)',
              borderTopRightRadius: 'var(--dt-radius-sm)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: isActive ? '1px solid var(--dt-border)' : '1px solid transparent',
              borderBottom: isActive ? '1px solid transparent' : undefined,
              marginBottom: isActive ? -1 : 0,
              userSelect: 'none',
              opacity: isDragging ? 0.5 : 1,
              maxWidth: 180,
              flexShrink: 0,
            }}
            title={tab.label}
          >
            <span style={{ fontSize: 12, flexShrink: 0 }}>{tab.icon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, direction: 'rtl' }}>
              {tab.label}
            </span>
            {tab.pinned && <span style={{ fontSize: 9, color: 'var(--dt-accent)' }}>📌</span>}
            {!tab.pinned && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeWorkspace(tab.id)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 11,
                  color: 'inherit',
                  opacity: 0.4,
                  lineHeight: 1,
                  flexShrink: 0,
                  width: 14,
                  height: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; e.currentTarget.style.opacity = '1' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0.4' }}
                title="إغلاق"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
