import { useState, memo } from 'react'
import { SearchableSelect } from './shared/SearchableSelect'

export interface FilterValues {
  datePreset: string
  dateFrom: string
  dateTo: string
  search: string
  employeeId: string
}

interface SmartFilterBarProps {
  searchPlaceholder?: string
  employees: { id: string; name: string }[]
  customerSearch?: boolean
  employeeLabel?: string
  onFilterChange: (filters: FilterValues) => void
  initialFilters?: Partial<FilterValues>
  collapsible?: boolean
}

const DATE_PRESETS = [
  { key: 'all', label: 'كل الفترات' },
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'الأمس' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'custom', label: 'فترة' },
]

export default memo(function SmartFilterBar({ searchPlaceholder, employees, employeeLabel, onFilterChange, initialFilters, collapsible = true }: SmartFilterBarProps) {
  const [datePreset, setDatePreset] = useState(initialFilters?.datePreset ?? 'month')
  const [dateFrom, setDateFrom] = useState(initialFilters?.dateFrom ?? '')
  const [dateTo, setDateTo] = useState(initialFilters?.dateTo ?? '')
  const [search, setSearch] = useState(initialFilters?.search ?? '')
  const [employeeId, setEmployeeId] = useState(initialFilters?.employeeId ?? '')

  const emit = (partial: Partial<FilterValues>) => {
    const vals: FilterValues = {
      datePreset, dateFrom, dateTo, search, employeeId, ...partial
    }
    onFilterChange(vals)
  }

  const handleDatePreset = (key: string) => {
    setDatePreset(key)
    if (key !== 'custom') {
      setDateFrom(''); setDateTo('')
    }
    emit({ datePreset: key, dateFrom: key === 'custom' ? dateFrom : '', dateTo: key === 'custom' ? dateTo : '' })
  }

  return (
    <div className="space-y-2">
      {/* Date presets */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {DATE_PRESETS.map(p => (
          <button key={p.key} onClick={() => handleDatePreset(p.key)}
            className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              datePreset === p.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {datePreset === 'custom' && (
        <div className="flex gap-2">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); emit({ dateFrom: e.target.value }) }}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
          <span className="text-xs text-text-secondary self-center">إلى</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); emit({ dateTo: e.target.value }) }}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
        </div>
      )}

      {/* Search + Employee filter row */}
      <div className="flex gap-2">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); emit({ search: e.target.value }) }}
          placeholder={searchPlaceholder || 'بحث بالاسم أو الكود...'}
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors" />
        <SearchableSelect
          items={employees}
          value={employeeId}
          onChange={(id) => { setEmployeeId(id); emit({ employeeId: id }) }}
          placeholder={employeeLabel || 'كل المناديب'}
          className="w-[240px] shrink-0"
        />
      </div>
    </div>
  )
})
