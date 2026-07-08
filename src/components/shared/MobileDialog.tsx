import { type ReactNode, useEffect } from 'react'

interface MobileDialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** className for the inner content card */
  className?: string
}

export function MobileDialog({ open, onClose, title, children, footer, className = '' }: MobileDialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className={'w-full sm:max-w-sm bg-white rounded-2xl flex flex-col max-h-[calc(100dvh-6rem)] ' + className}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between p-4 pb-3">
          <h3 className="text-sm font-bold text-text">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs text-text-secondary">إلغاء</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 p-4 pt-3 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
