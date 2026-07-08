import { useEffect } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import type { RefreshLevel } from '../store/desktopStore'

export function KeyboardShortcuts() {
  const setQuickSearchOpen = useDesktopStore((s) => s.setQuickSearchOpen)
  const toggleSidebar = useDesktopStore((s) => s.togglesidebar)
  const triggerRefresh = useDesktopStore((s) => s.triggerRefresh)
  const { selectedRows, clearSelectedRows } = useDesktopStore()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement)?.tagName
      )

      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setQuickSearchOpen(true)
        return
      }

      if (e.ctrlKey && e.altKey && e.key === 'r') {
        e.preventDefault()
        triggerRefresh('all' as RefreshLevel)
        return
      }

      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        triggerRefresh('visible' as RefreshLevel)
        return
      }

      if (e.ctrlKey && e.key === 'r' && !isInput) {
        e.preventDefault()
        triggerRefresh('current' as RefreshLevel)
        return
      }

      if (e.ctrlKey && e.key === 'a' && !isInput) {
        e.preventDefault()
        return
      }

      if (e.ctrlKey && e.key === 'c') {
        return
      }

      if (e.ctrlKey && e.key === 'f' && !isInput) {
        e.preventDefault()
        return
      }

      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault()
        window.print()
        return
      }

      if (e.ctrlKey && e.key === 's' && !isInput) {
        e.preventDefault()
        return
      }

      if (e.key === 'Escape') {
        if (selectedRows.size > 0) {
          clearSelectedRows()
        }
        return
      }

      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
        return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setQuickSearchOpen, toggleSidebar, selectedRows, clearSelectedRows, triggerRefresh])

  return null
}
