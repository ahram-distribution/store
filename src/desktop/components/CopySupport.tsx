import { useEffect } from 'react'
import { useDesktopStore } from '../store/desktopStore'

export function CopySupport() {
  const { selectedRows, clearSelectedRows } = useDesktopStore()

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const selection = window.getSelection()
      if (selection && selection.toString().length > 0) return

      if (selectedRows.size > 0) {
        e.preventDefault()
        const text = Array.from(selectedRows).join('\t')
        e.clipboardData?.setData('text/plain', text)
        clearSelectedRows()
      }
    }

    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [selectedRows, clearSelectedRows])

  return null
}
