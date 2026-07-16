import { useState } from 'react'
import { computeDateRange, cairoDateComponents, cairoMidnightISO } from '../lib/dateRange'

export type PresetKey = 'today' | 'yesterday' | 'week' | 'month' | 'prev_month' | 'custom'

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
  { key: 'week', label: 'الأسبوع الحالي' },
  { key: 'month', label: 'الشهر الحالي' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'فترة مخصصة' },
]

function computeRange(preset: PresetKey, customFrom: string, customTo: string): TimeRange {
  const nowUtc = new Date()
  const [y, m, d] = cairoDateComponents(nowUtc)

  switch (preset) {
    case 'today': {
      const from = cairoMidnightISO(y, m, d)
      return { from, to: from, preset }
    }
    case 'yesterday': {
      const yesterday = new Date(y, m - 1, d)
      yesterday.setDate(yesterday.getDate() - 1)
      const from = cairoMidnightISO(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate())
      return { from, to: from, preset }
    }
    case 'week': {
      const { dateFrom, dateTo } = computeDateRange('week')
      return { from: dateFrom, to: dateTo, preset }
    }
    case 'month': {
      const { dateFrom, dateTo } = computeDateRange('month')
      return { from: dateFrom, to: dateTo, preset }
    }
    case 'prev_month': {
      const { dateFrom, dateTo } = computeDateRange('prev_month')
      return { from: dateFrom, to: dateTo, preset }
    }
    case 'custom':
      return { from: customFrom || cairoMidnightISO(y, m, d), to: customTo || cairoMidnightISO(y, m, d), preset }
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
  return computeRange('today', '', '')
}

export function thisMonthRange(): TimeRange {
  return computeRange('month', '', '')
}

export function last30Range(): TimeRange {
  return computeRange('month', '', '')
}
