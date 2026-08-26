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
  scope: 'sector' | 'governorate' | 'company_governorate' | 'product_governorate' | 'product_company_governorate' | 'company_sector' | 'product_sector'
  sector_id: string | null
  sector_name: string | null
  governorate_id: string | null
  governorate_name: string | null
  company_id: string | null
  company_name: string | null
  product_id: string | null
  product_name: string | null
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
