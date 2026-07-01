export type EntityType = 'order' | 'customer' | 'visit' | 'collection'

export type HealthState = 'healthy' | 'loading' | 'warning' | 'no_data' | 'error'

export interface KpiValue {
  value: number | null
  target?: number | null
  pct?: number | null
  health?: HealthState
}

export interface ActivityKpis {
  orders: KpiValue
  sales: KpiValue
  customers: KpiValue
  visits: KpiValue
  collections: KpiValue
}

export interface Navigator {
  (entityType: EntityType, entityId?: string): void
}
