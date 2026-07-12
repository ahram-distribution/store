import { supabase } from '../../lib/supabase'
import type { Governorate, City, LocationRecord, GpsLocation, CoverageMapData, GeocodeResult, EnrichLocationInput } from './types'

export class LocationRepository {
  constructor(private token: string) {}

  // ============================================================
  // Reference Data
  // ============================================================

  async getGovernorates(): Promise<Governorate[]> {
    const { data } = await supabase.rpc('get_reference_governorates', { p_token: this.token })
    if (Array.isArray(data)) return data as Governorate[]
    if (data && typeof data === 'object' && !(data as any).error) return [data as any]
    return []
  }

  async getCities(governorateId?: string): Promise<City[]> {
    const { data } = await supabase.rpc('get_reference_cities', {
      p_token: this.token,
      p_governorate_id: governorateId || null,
    })
    if (Array.isArray(data)) return data as City[]
    if (data && typeof data === 'object' && !(data as any).error) return [data as any]
    return []
  }

  // ============================================================
  // GPS Location Records
  // ============================================================

  async fetchLocation(id: string): Promise<LocationRecord | null> {
    const { data } = await supabase.rpc('get_governed_location', { p_token: this.token, p_id: id })
    const result = data as any
    if (result?.error) return null
    return result as LocationRecord
  }

  async fetchLocations(ids: string[]): Promise<Map<string, LocationRecord>> {
    const filtered = ids.filter(Boolean)
    if (filtered.length === 0) return new Map()
    const { data } = await supabase.rpc('get_governed_locations', { p_token: this.token, p_ids: filtered })
    const map = new Map<string, LocationRecord>()
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && !r.error) map.set(r.id, r as LocationRecord)
      }
    }
    return map
  }

  async saveLocation(gps: GpsLocation): Promise<string | null> {
    const { data } = await supabase.rpc('governed_create_location', {
      p_token: this.token,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
      p_accuracy_meters: gps.accuracy,
    })
    const result = data as any
    if (result?.error) return null
    return result.id as string
  }

  // ============================================================
  // Geocoding
  // ============================================================

  // ============================================================
  // Location Enrichment
  // ============================================================

  async enrichLocation(locationId: string, input: EnrichLocationInput): Promise<boolean> {
    const { data } = await supabase.rpc('enrich_location', {
      p_token: this.token,
      p_location_id: locationId,
      p_governorate_id: input.governorate_id || null,
      p_city_id: input.city_id || null,
      p_road: input.road || null,
      p_formatted_address: input.formatted_address || null,
      p_geocoding_provider: input.geocoding_provider || 'nominatim',
      p_enrichment_version: input.enrichment_version || 1,
    })
    const result = data as any
    return result?.success === true
  }

  async geocodeCustomerAddress(customerId: string): Promise<GeocodeResult> {
    const { data } = await supabase.rpc('geocode_customer_address', {
      p_token: this.token,
      p_customer_id: customerId,
    })
    return (data as GeocodeResult) || { status: 'error', error: 'No response' }
  }

  // ============================================================
  // Coverage Map
  // ============================================================

  async getCoverageMap(): Promise<CoverageMapData> {
    const { data } = await supabase.rpc('get_coverage_map', { p_token: this.token })
    const result = data as any
    if (result?.error) return { summary: { total_customers: 0, active_employees: 0, covered_governorates: 0, visited_customers_today: 0, today_orders: 0, today_sales: 0 }, customers: [], employees: [] }
    return result as CoverageMapData
  }
}

export function createLocationRepository(token: string): LocationRepository {
  return new LocationRepository(token)
}
