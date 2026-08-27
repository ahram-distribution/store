import { memo } from 'react'

export interface DetailField {
  label: string
  value: React.ReactNode
  mono?: boolean
  color?: string
  bold?: boolean
}

export interface DetailSection {
  title?: string
  fields: DetailField[]
}

interface SahlDetailPanelProps {
  title: string
  subtitle?: string
  sections: DetailSection[]
  statusBadge?: { label: string; className: string }
  actions?: React.ReactNode
  onClose: () => void
}

export default memo(function SahlDetailPanel({ title, subtitle, sections, statusBadge, actions, onClose }: SahlDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{title}</h3>
              {subtitle && <p className="text-[10px] text-white/70 mt-0.5">{subtitle}</p>}
            </div>
            {statusBadge && (
              <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {sections.map((sec, si) => (
            <div key={si}>
              {sec.title && <h4 className="text-[10px] font-bold text-text-secondary uppercase mb-2">{sec.title}</h4>}
              <div className="space-y-2.5">
                {sec.fields.map((f, fi) => (
                  <div key={fi} className="flex justify-between items-center gap-4">
                    <span className="text-xs text-text-secondary shrink-0">{f.label}</span>
                    <span className={`text-xs text-left ${f.mono ? 'font-mono' : ''} ${f.bold ? 'font-bold' : 'font-semibold'} ${f.color || 'text-text'}`}>
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {actions && <div className="border-t border-border px-5 py-3 flex gap-2">{actions}</div>}

        <div className="border-t border-border p-3 text-center">
          <button onClick={onClose} className="text-text-secondary text-xs py-1">إغلاق</button>
        </div>
      </div>
    </div>
  )
})
