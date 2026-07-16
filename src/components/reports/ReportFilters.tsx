import { useState, useCallback } from 'react'
import type { ReportPreset, ReportFilters as FilterState } from '../../types/reports'
import { computeDateRange } from '../../lib/dateRange'

export type { DateRangePreset as ReportPreset } from '../../lib/dateRange'
export { computeDateRange } from '../../lib/dateRange'

const PRESET_OPTIONS: { key: ReportPreset; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'الأسبوع الحالي' },
  { key: 'month', label: 'الشهر الحالي' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'فترة مخصصة' },
]

interface ReportFiltersProps {
  value: FilterState
  onChange: (filters: FilterState) => void
  scope: 'company' | 'team' | 'self'
  managerOptions?: { value: string; label: string }[]
  employeeOptions?: { value: string; label: string }[]
}

export function ReportFilters({ value, onChange, scope, managerOptions, employeeOptions }: ReportFiltersProps) {
  const [customFrom, setCustomFrom] = useState(value.dateFrom ? value.dateFrom.slice(0, 10) : '')
  const [customTo, setCustomTo] = useState(value.dateTo ? value.dateTo.slice(0, 10) : '')

  const showManagerSelect = scope === 'company'
  const showEmployeeSelect = scope !== 'self'

  const handlePreset = useCallback((key: ReportPreset) => {
    if (key === 'custom') {
      const range = computeDateRange('custom', customFrom || undefined, customTo || undefined)
      onChange({ ...value, preset: key, dateFrom: range.dateFrom, dateTo: range.dateTo })
    } else {
      const range = computeDateRange(key)
      onChange({ ...value, preset: key, dateFrom: range.dateFrom, dateTo: range.dateTo })
    }
  }, [value, customFrom, customTo, onChange])

  const handleCustomApply = useCallback(() => {
    const range = computeDateRange('custom', customFrom || undefined, customTo || undefined)
    onChange({ ...value, preset: 'custom', dateFrom: range.dateFrom, dateTo: range.dateTo })
  }, [value, customFrom, customTo, onChange])

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {PRESET_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => handlePreset(opt.key)}
            className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              value.preset === opt.key
                ? 'bg-primary text-white'
                : 'bg-surface text-text-secondary border border-border/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {value.preset === 'custom' && (
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

      {(showManagerSelect || showEmployeeSelect) && (
        <div className="flex gap-2">
          {showManagerSelect && managerOptions && (
            <select
              value={value.managerId || ''}
              onChange={(e) => onChange({ ...value, managerId: e.target.value || null })}
              className="flex-1 text-xs px-2 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
            >
              <option value="">كل المديرين</option>
              {managerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          {showEmployeeSelect && employeeOptions && (
            <select
              value={value.employeeId || ''}
              onChange={(e) => onChange({ ...value, employeeId: e.target.value || null })}
              className="flex-1 text-xs px-2 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary"
            >
              <option value="">كل المناديب</option>
              {employeeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}

export function todayFilter(): FilterState {
  const range = computeDateRange('today')
  return { preset: 'today', ...range, managerId: null, employeeId: null }
}

export function monthFilter(): FilterState {
  const range = computeDateRange('month')
  return { preset: 'month', ...range, managerId: null, employeeId: null }
}
