// ---- Reference Geography ----
export interface Governorate {
  id: string
  code: string
  name_ar: string
  latitude: number | null
  longitude: number | null
}

export interface City {
  id: string
  governorate_id: string
  code: string
  name_ar: string
  latitude: number | null
  longitude: number | null
}

// ---- Structured Address (customer_addresses) ----
export interface StructuredAddress {
  governorate_id: string | null
  city_id: string | null
  governorate_name: string | null
  city_name: string | null
  street_address: string | null
  landmark: string | null
  registered_address: string | null
  latitude: number | null
  longitude: number | null
  location_accuracy: string | null
  address_source: 'manual' | 'mixed' | null
}

export interface AddressInput {
  governorate_id?: string | null
  city_id?: string | null
  street_address?: string | null
  landmark?: string | null
  latitude?: number | null
  longitude?: number | null
  accuracy_meters?: number | null
}

// ---- GPS Location (unified_locations) ----
export interface GpsLocation {
  latitude: number
  longitude: number
  accuracy: number | null
}

export type EnrichmentStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface LocationRecord {
  id: string
  latitude: number
  longitude: number
  accuracy_meters: number | null
  formatted_address: string | null
  google_maps_url: string
  captured_at: string
  created_at: string
  // Enrichment fields
  governorate_id: string | null
  city_id: string | null
  road: string | null
  enriched_at: string | null
  enrichment_status: EnrichmentStatus | null
  geocoding_provider: string | null
  enrichment_version: number | null
  // Resolved names from reference tables
  governorate_name: string | null
  city_name: string | null
}

export interface EnrichLocationInput {
  governorate_id?: string | null
  city_id?: string | null
  road?: string | null
  formatted_address?: string | null
  geocoding_provider?: string
  enrichment_version?: number
}

// ---- Accuracy ----
export interface AccuracyInfo {
  label: string
  className: string
  detail: string
}

// ---- Geocoding (Nominatim) ----
export interface NominatimAddress {
  house_number?: string
  road?: string
  suburb?: string
  neighbourhood?: string
  city_district?: string
  county?: string
  city?: string
  town?: string
  village?: string
  state?: string
  country?: string
  displayName: string
}

export interface GeocodeResult {
  status: 'geocoded' | 'already_geocoded' | 'error'
  latitude?: number
  longitude?: number
  error?: string
}

// ---- Coverage Map ----
export interface CoverageSummary {
  total_customers: number
  active_employees: number
  covered_governorates: number
  visited_customers_today: number
  today_orders: number
  today_sales: number
}

export interface CoverageCustomer {
  id: string
  code: string
  name: string
  responsible_name: string
  phone: string
  governorate: string
  city: string
  governorate_id: string | null
  city_id: string | null
  street_address: string | null
  landmark: string | null
  formatted_address: string
  location_source: string
  location_accuracy: string
  latitude: number | null
  longitude: number | null
  owner_code: string
  owner_name: string
  created_at: string
  total_orders: number
  total_sales: number
  last_order_at: string | null
  last_visit_at: string | null
}

export interface CoverageEmployee {
  employee_id: string
  name: string
  code: string
  role_name: string
  status: string
  connection_status: string
  latitude: number | null
  longitude: number | null
  accuracy_meters: number | null
  last_seen_at: string | null
  last_activity_at: string | null
  last_activity_type: string | null
  last_location_at: string | null
  duration_minutes: number
  order_count: number
  sales_value: number
  visit_count: number
  new_customer_count: number
}

export interface CoverageMapData {
  summary: CoverageSummary
  customers: CoverageCustomer[]
  employees: CoverageEmployee[]
}

// ---- Location Source Priority ----
export const LOCATION_SOURCE_PRIORITY: Record<string, number> = {
  customer_location: 3,
  visit_gps: 2,
  address_geocoded: 1,
  unknown: 0,
}

export const LOCATION_SOURCE_LABELS: Record<string, string> = {
  customer_location: 'موقع العميل',
  visit_gps: 'زيارة GPS',
  address_geocoded: 'ترميز جغرافي',
  unknown: 'غير معروف',
}
