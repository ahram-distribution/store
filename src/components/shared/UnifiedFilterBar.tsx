import { useState, useCallback, useEffect, useRef } from 'react'
import { SearchableSelect } from './SearchableSelect'
import type { FilterState, DatePreset } from '../../types/filters'
import { computeDateRange } from '../../lib/dateRange'

interface UnifiedFilterBarProps {
  value: FilterState
  onChange: (filters: FilterState) => void
  showSearch?: boolean
  showMonthSelector?: boolean
  showDateRange?: boolean
  showManagerFilter?: boolean
  showEmployeeFilter?: boolean
  managerOptions?: { value: string; label: string }[]
  employeeOptions?: { value: string; label: string }[]
  searchPlaceholder?: string
  managerPlaceholder?: string
  employeePlaceholder?: string
}

const MONTH_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'الأسبوع الحالي' },
  { key: 'month', label: 'الشهر الحالي' },
  { key: 'prev_month', label: 'الشهر السابق' },
]

export function UnifiedFilterBar({
  value,
  onChange,
  showSearch = false,
  showMonthSelector = true,
  showDateRange = true,
  showManagerFilter = false,
  showEmployeeFilter = false,
  managerOptions,
  employeeOptions,
  searchPlaceholder = 'بحث...',
  managerPlaceholder = 'كل المديرين',
  employeePlaceholder = 'كل المناديب',
}: UnifiedFilterBarProps) {
  const [customFrom, setCustomFrom] = useState(value.dateFrom ? value.dateFrom.slice(0, 10) : '')
  const [customTo, setCustomTo] = useState(value.dateTo ? value.dateTo.slice(0, 10) : '')

  const prevManagerIdRef = useRef(value.managerId)
  useEffect(() => {
    if (prevManagerIdRef.current !== value.managerId) {
      prevManagerIdRef.current = value.managerId
      if (value.employeeId) {
        onChange({ ...value, employeeId: null })
      }
    }
  }, [value.managerId, value.employeeId, onChange])

  const handlePreset = useCallback((key: DatePreset) => {
    if (key === 'all') {
      onChange({ ...value, datePreset: 'all', dateFrom: '', dateTo: '' })
    } else if (key === 'custom') {
      const range = computeDateRange('custom', customFrom || undefined, customTo || undefined)
      onChange({ ...value, datePreset: key, dateFrom: range.dateFrom, dateTo: range.dateTo })
    } else {
      const range = computeDateRange(key)
      onChange({ ...value, datePreset: key, dateFrom: range.dateFrom, dateTo: range.dateTo })
    }
  }, [value, customFrom, customTo, onChange])

  const handleCustomApply = useCallback(() => {
    const range = computeDateRange('custom', customFrom || undefined, customTo || undefined)
    onChange({ ...value, datePreset: 'custom', dateFrom: range.dateFrom, dateTo: range.dateTo })
  }, [value, customFrom, customTo, onChange])

  const showPresets = showMonthSelector || showDateRange
  const showDropdowns = showManagerFilter || showEmployeeFilter

  return (
    <div className="space-y-2">
      {showPresets && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {showMonthSelector && MONTH_PRESETS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handlePreset(opt.key)}
              className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                value.datePreset === opt.key
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary border border-border/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {showDateRange && (
            <button
              onClick={() => handlePreset('custom')}
              className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                value.datePreset === 'custom'
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary border border-border/50'
              }`}
            >
              فترة مخصصة
            </button>
          )}
        </div>
      )}

      {showDateRange && value.datePreset === 'custom' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
          />
          <span className="text-xs text-text-secondary self-center">إلى</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleCustomApply}
            className="shrink-0 text-xs px-3 py-1.5 bg-primary text-white rounded-lg font-semibold"
          >
            تطبيق
          </button>
        </div>
      )}

      {(showSearch || showDropdowns) && (
        <div className="flex gap-2">
          {showSearch && (
            <input
              type="text"
              value={value.search}
              onChange={(e) => onChange({ ...value, search: e.target.value })}
              placeholder={searchPlaceholder}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors"
            />
          )}
          {showManagerFilter && managerOptions && (
            <SearchableSelect
              items={managerOptions.map((o) => ({ id: o.value, name: o.label }))}
              value={value.managerId || ''}
              onChange={(id) => onChange({ ...value, managerId: id || null })}
              placeholder={managerPlaceholder}
              resetLabel={managerPlaceholder}
              className="w-[200px] shrink-0"
            />
          )}
          {showEmployeeFilter && employeeOptions && (
            <SearchableSelect
              items={employeeOptions.map((o) => ({ id: o.value, name: o.label }))}
              value={value.employeeId || ''}
              onChange={(id) => onChange({ ...value, employeeId: id || null })}
              placeholder={employeePlaceholder}
              resetLabel={employeePlaceholder}
              className="w-[200px] shrink-0"
            />
          )}
        </div>
      )}
    </div>
  )
}
