import { useState, useRef, useEffect } from 'react'
import { Calendar } from 'lucide-react'

export type TimeFilter = 'today' | 'yesterday' | 'last_7' | 'last_30' | 'this_month' | 'prev_month' | 'custom'

interface TimeFilterOption {
  key: TimeFilter
  label: string
}

const FILTERS: TimeFilterOption[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'last_7', label: 'آخر 7 أيام' },
  { key: 'last_30', label: 'آخر 30 يوماً' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'نطاق مخصص' },
]

interface TimeFilterBarProps {
  active: TimeFilter
  onChange: (filter: TimeFilter) => void
  onCustomRange?: (from: string, to: string) => void
}

export default function TimeFilterBar({ active, onChange }: TimeFilterBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const showCustomRange = active === 'custom'

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              active === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showCustomRange && (
        <div className="bg-white rounded-lg border border-gray-200 p-2 mb-2 flex items-center gap-2">
          <input type="date" className="text-xs border border-gray-200 rounded px-2 py-1 flex-1" />
          <span className="text-xs text-gray-400">→</span>
          <input type="date" className="text-xs border border-gray-200 rounded px-2 py-1 flex-1" />
        </div>
      )}
    </div>
  )
}
