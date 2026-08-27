import { memo } from 'react'
import type { ResolvePreset } from '../../lib/dateRange'

export interface SahlDateFilterState {
  preset: ResolvePreset
  customFrom: string
  customTo: string
}

const DATE_PRESETS: Array<{ key: ResolvePreset; label: string }> = [
  { key: 'all', label: 'كل الفترات' },
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'الأمس' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'prev_week', label: 'الأسبوع السابق' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'year', label: 'هذا العام' },
  { key: 'custom', label: 'نطاق مخصص' },
]

interface SahlDateFilterProps {
  value: SahlDateFilterState
  onChange: (v: SahlDateFilterState) => void
  compact?: boolean
}

export default memo(function SahlDateFilter({ value, onChange, compact }: SahlDateFilterProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {DATE_PRESETS.map(p => (
          <button key={p.key} onClick={() => onChange({ preset: p.key, customFrom: p.key === 'custom' ? value.customFrom : '', customTo: p.key === 'custom' ? value.customTo : '' })}
            className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              value.preset === p.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50 hover:border-primary/40'
            }`}>
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex gap-2 items-center">
          <input type="date" value={value.customFrom} onChange={e => onChange({ ...value, customFrom: e.target.value })}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
          <span className="text-[10px] text-text-secondary">إلى</span>
          <input type="date" value={value.customTo} onChange={e => onChange({ ...value, customTo: e.target.value })}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
        </div>
      )}
    </div>
  )
})
