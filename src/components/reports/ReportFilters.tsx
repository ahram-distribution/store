import { UnifiedFilterBar } from '../shared/UnifiedFilterBar'
import { computeDateRange } from '../../lib/dateRange'
import type { FilterState } from '../../types/filters'

export { UnifiedFilterBar as ReportFilters }
export { computeDateRange }

export function todayFilter(): FilterState {
  const range = computeDateRange('today')
  return { datePreset: 'today', dateFrom: range.dateFrom, dateTo: range.dateTo, search: '', managerId: null, employeeId: null }
}

export function monthFilter(): FilterState {
  const range = computeDateRange('month')
  return { datePreset: 'month', dateFrom: range.dateFrom, dateTo: range.dateTo, search: '', managerId: null, employeeId: null }
}
