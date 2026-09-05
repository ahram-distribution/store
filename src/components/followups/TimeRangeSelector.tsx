import { useState } from 'react'
import { cairoDateComponents, cairoMidnightISO } from '../../lib/dateRange'

export type FollowUpTimePreset = 'today' | 'last_7d' | 'last_30d' | 'last_quarter' | 'last_6m' | 'last_year' | 'since_creation' | 'custom'

export interface FollowUpTimeRange {
  preset: FollowUpTimePreset
  label: string
  from: string | null
  to: string | null
}

export const FOLLOW_UP_TIME_PRESETS: Array<{ key: FollowUpTimePreset; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'last_7d', label: 'آخر 7 أيام' },
  { key: 'last_30d', label: 'آخر 30 يوم' },
  { key: 'last_quarter', label: 'آخر 3 أشهر' },
  { key: 'last_6m', label: 'آخر 6 أشهر' },
  { key: 'last_year', label: 'آخر 12 شهر' },
  { key: 'since_creation', label: 'منذ إنشاء العميل' },
  { key: 'custom', label: 'مخصص' },
]

function daysBackIso(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const [y, m, d] = cairoDateComponents(now)
  return cairoMidnightISO(y, m, d)
}

export function todayIso(): string {
  const [y, m, d] = cairoDateComponents(new Date())
  return cairoMidnightISO(y, m, d)
}

function resolveRange(preset: FollowUpTimePreset, customFrom?: string, customTo?: string): { from: string | null; to: string | null } {
  if (preset === 'today') return { from: todayIso(), to: new Date().toISOString() }
  if (preset === 'since_creation') return { from: null, to: null }
  if (preset === 'last_7d') return { from: daysBackIso(7), to: new Date().toISOString() }
  if (preset === 'last_30d') return { from: daysBackIso(30), to: new Date().toISOString() }
  if (preset === 'last_quarter') return { from: daysBackIso(90), to: new Date().toISOString() }
  if (preset === 'last_6m') return { from: daysBackIso(180), to: new Date().toISOString() }
  if (preset === 'last_year') return { from: daysBackIso(365), to: new Date().toISOString() }
  // custom
  if (!customFrom && !customTo) return { from: null, to: null }
  const from = customFrom ? cairoMidnightISO(...(customFrom.split('-').map(Number) as [number, number, number])) : null
  const to = customTo
    ? (() => {
        const [ty, tm, td] = customTo.split('-').map(Number)
        const d = new Date(cairoMidnightISO(ty, tm, td))
        d.setDate(d.getDate() + 1)
        return d.toISOString()
      })()
    : new Date().toISOString()
  return { from, to }
}

interface TimeRangeSelectorProps {
  value: FollowUpTimeRange
  onChange: (range: FollowUpTimeRange) => void
  layout?: 'row' | 'stack'
}

export function TimeRangeSelector({ value, onChange, layout = 'row' }: TimeRangeSelectorProps) {
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const pick = (key: FollowUpTimePreset) => {
    const { from, to } = resolveRange(key, customFrom, customTo)
    onChange({
      preset: key,
      label: FOLLOW_UP_TIME_PRESETS.find((p) => p.key === key)?.label ?? key,
      from,
      to,
    })
  }

  const applyCustom = () => {
    const { from, to } = resolveRange('custom', customFrom, customTo)
    onChange({ preset: 'custom', label: 'فترة مخصصة', from, to })
  }

  return (
    <div className={layout === 'row' ? 'flex flex-wrap items-center gap-1.5' : 'space-y-1.5'}>
      <span className="text-[10px] text-text-secondary font-semibold">الفترة:</span>
      {FOLLOW_UP_TIME_PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => pick(p.key)}
          className={`text-[10px] px-2 py-1 rounded-lg font-semibold transition-colors ${
            value.preset === p.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-neutral-50'
          }`}
        >
          {p.label}
        </button>
      ))}
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-surface rounded-lg px-2 py-1 text-[11px] border border-border"
          />
          <span className="text-[10px] text-text-secondary">إلى</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-surface rounded-lg px-2 py-1 text-[11px] border border-border"
          />
          <button onClick={applyCustom} className="text-[10px] bg-primary text-white px-2.5 py-1 rounded-lg font-semibold">تطبيق</button>
        </div>
      )}
    </div>
  )
}