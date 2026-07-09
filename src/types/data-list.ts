export interface SortOption {
  value: string
  label: string
}

export type PageSize = 12 | 24 | 48 | 100

export const PAGE_SIZE_OPTIONS: PageSize[] = [12, 24, 48, 100]

export interface PaginationState {
  page: number
  pageSize: PageSize
  total: number
  totalPages: number
}

export interface ActiveFilterItem {
  id: string
  label: string
  value: string
  onRemove?: () => void
}

export type RefreshState = 'idle' | 'loading' | 'error'

export interface ResultsSummaryProps {
  total: number
  filters: ActiveFilterItem[]
  onRefresh?: () => void
  refreshState?: RefreshState
  dateFrom?: string
  dateTo?: string
  lastRefresh?: string
  executionTimeMs?: number
  serverSource?: string
  title?: string
  unit?: string
}

export interface PaginationFooterProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export interface PageSizeSelectorProps {
  value: PageSize
  onChange: (size: PageSize) => void
  options?: PageSize[]
}

export interface SortSelectorProps {
  options: SortOption[]
  value: string
  onChange: (value: string) => void
}

export interface CardGridProps {
  children: React.ReactNode
  className?: string
}

export interface ActiveFiltersProps {
  filters: ActiveFilterItem[]
  className?: string
}

export interface EmptyStateProps {
  message?: string
  onReset?: () => void
}

export interface KpiChipConfig {
  id: string
  label: string
  count: number
  dotClass: string
  chipClass: string
  activeChipClass: string
}

export interface StatusKpiBarProps {
  chips: KpiChipConfig[]
  selectedId?: string
  onToggle: (id: string) => void
  className?: string
}
