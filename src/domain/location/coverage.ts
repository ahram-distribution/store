import { ACCURACY_COLORS } from './accuracy'
import type { CoverageCustomer, CoverageEmployee, CoverageMapData } from './types'

export function getCustomerLocationColor(source: string): string {
  return ACCURACY_COLORS[source] || ACCURACY_COLORS.UNKNOWN
}

export function getEmployeeStatusColor(status: string): string {
  switch (status) {
    case 'connected': return 'text-success'
    case 'delayed': return 'text-warning'
    case 'lost': return 'text-danger'
    case 'on_break': return 'text-accent'
    case 'on_visit': return 'text-primary'
    default: return 'text-text-muted'
  }
}

export function hasGpsLocation(customer: CoverageCustomer): boolean {
  return customer.latitude != null && customer.longitude != null
}

export function getEmployeesByStatus(employees: CoverageEmployee[]): Record<string, CoverageEmployee[]> {
  const groups: Record<string, CoverageEmployee[]> = {}
  for (const emp of employees) {
    const key = emp.connection_status || 'unknown'
    if (!groups[key]) groups[key] = []
    groups[key].push(emp)
  }
  return groups
}
