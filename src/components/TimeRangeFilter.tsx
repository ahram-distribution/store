import { useState } from 'react'

export type PresetKey = 'today' | 'yesterday' | 'last_7' | 'last_30' | 'this_month' | 'prev_month' | 'custom'

export interface TimeRange {
  from: string
  to: string
  preset: PresetKey
}

interface PresetOption {
  key: PresetKey
  label: string
}

const PRESETS: PresetOption[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'last_7', label: 'آخر 7 أيام' },
  { key: 'last_30', label: 'آخر 30 يوماً' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'نطاق مخصص' },
]

function computeRange(preset: PresetKey, customFrom: string, customTo: string): TimeRange {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  switch (preset) {
    case 'today':
      return { from: today, to: today, preset }
    case 'yesterday': {
      const d = new Date(); d.setDate(d.getDate() - 1)
      const y = d.toISOString().slice(0, 10)
      return { from: y, to: y, preset }
    }
    case 'last_7': {
      const d = new Date(); d.setDate(d.getDate() - 6)
      return { from: d.toISOString().slice(0, 10), to: today, preset }
    }
    case 'last_30': {
      const d = new Date(); d.setDate(d.getDate() - 29)
      return { from: d.toISOString().slice(0, 10), to: today, preset }
    }
    case 'this_month': {
      const d = new Date()
      const first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
      return { from: first, to: today, preset }
    }
    case 'prev_month': {
      const d = new Date()
      const y = d.getFullYear(); const m = d.getMonth()
      const first = new Date(y, m - 1, 1).toISOString().slice(0, 10)
      const last = new Date(y, m, 0).toISOString().slice(0, 10)
      return { from: first, to: last, preset }
    }
    case 'custom':
      return { from: customFrom || today, to: customTo || today, preset }
  }
}

interface TimeRangeFilterProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

export default function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)

  const handlePreset = (key: PresetKey) => {
    const range = computeRange(key, customFrom, customTo)
    onChange(range)
  }

  const handleCustomApply = () => {
    const range = computeRange('custom', customFrom, customTo)
    onChange(range)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 overflow-x-auto">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              value.preset === p.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {value.preset === 'custom' && (
        <div className="bg-white rounded-lg border border-gray-200 p-2 mb-2 flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 flex-1"
          />
          <span className="text-xs text-gray-400">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 flex-1"
          />
          <button
            onClick={handleCustomApply}
            className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg"
          >
            تطبيق
          </button>
        </div>
      )}

      <div className="text-[11px] text-gray-400 mb-2">
        {value.from} → {value.to}
      </div>
    </div>
  )
}

export function todayRange(): TimeRange {
  const t = new Date().toISOString().slice(0, 10)
  return { from: t, to: t, preset: 'today' }
}

export function thisMonthRange(): TimeRange {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  return { from: first, to: today, preset: 'this_month' }
}

export function last30Range(): TimeRange {
  const now = new Date()
  const d = new Date(); d.setDate(d.getDate() - 29)
  return { from: d.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), preset: 'last_30' }
}
