export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'prev_month' | 'custom'

export interface FilterState {
  datePreset: DatePreset
  dateFrom: string
  dateTo: string
  search: string
  managerId: string | null
  employeeId: string | null
}

export function createDefaultFilter(overrides?: Partial<FilterState>): FilterState {
  return {
    datePreset: 'month',
    dateFrom: '',
    dateTo: '',
    search: '',
    managerId: null,
    employeeId: null,
    ...overrides,
  }
}
