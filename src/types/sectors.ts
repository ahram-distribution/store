export interface Sector {
  id: string
  name: string
  name_ar: string | null
  description: string | null
  is_active: boolean
  governorate_count: number
  created_at: string
  updated_at: string
}

export interface SectorGovernorate {
  governorate_id: string
  governorate_code: string
  governorate_name_ar: string
  governorate_name_en: string
}

export interface GeographicPriceRule {
  id: string
  rule_name: string
  adjustment_percent: number
  scope: string
  sector_id: string | null
  sector_name: string | null
  governorate_id: string | null
  governorate_name: string | null
  company_ids: string[]
  company_names: string[]
  product_ids: string[]
  product_names: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EmployeeGeographicAssignment {
  id: string
  employee_id: string
  assignment_type: 'governorate' | 'sector'
  governorate_id: string | null
  governorate_name: string | null
  sector_id: string | null
  sector_name: string | null
  created_at: string
}

export interface GeographicAdjustment {
  adjustment_percent: number
  rule_name: string
  scope: string
  applied_level: string
}

export interface CustomerSectorInfo {
  governorate_id: string | null
  governorate_name: string | null
  sector_id: string | null
  sector_name: string | null
}

export interface GeographicCustomerCount {
  governorate_id: string
  governorate_name: string
  sector_id: string | null
  sector_name: string | null
  customer_count: number
}

export interface GeographicVisibilityRule {
  id: string
  rule_name: string
  scope: string
  sector_ids: string[]
  sector_names: string[]
  governorate_ids: string[]
  governorate_names: string[]
  company_ids: string[]
  company_names: string[]
  product_ids: string[]
  product_names: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}
