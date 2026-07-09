import { type ActiveFiltersProps, type ActiveFilterItem } from '../../types/data-list'

function FilterChip({ filter }: { filter: ActiveFilterItem }) {
  return (
    <span className="inline-flex items-center gap-1 bg-surface border border-border/50 rounded-lg px-2 py-1 text-[10px] text-text-secondary font-medium">
      <span>{filter.label}: {filter.value}</span>
      {filter.onRemove && (
        <button
          onClick={filter.onRemove}
          className="text-text-muted hover:text-text-secondary transition-colors mr-0.5"
          aria-label={`إزالة فلتر ${filter.label}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </span>
  )
}

export function ActiveFilters({ filters, className = '' }: ActiveFiltersProps) {
  if (filters.length === 0) return null

  return (
    <div className={'flex flex-wrap gap-1.5 ' + className}>
      {filters.map((f) => (
        <FilterChip key={f.id} filter={f} />
      ))}
    </div>
  )
}
