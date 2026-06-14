import { supabase } from '../lib/supabase'
import type { GpsLocation } from './gpsService'

export interface LocationRecord {
  id: string
  latitude: number
  longitude: number
  accuracy_meters: number | null
  google_maps_url: string
  formatted_address: string | null
  captured_at: string
  created_at: string
}

export type FreshLocation = GpsLocation

const _reverseGeocodeCache = new Map<string, string>()

export const locationService = {
  buildGoogleMapsUrl(lat: number, lng: number): string {
    return 'https://www.google.com/maps?q=' + lat + ',' + lng
  },

  openGoogleMaps(lat: number, lng: number): void {
    window.location.href = this.buildGoogleMapsUrl(lat, lng)
  },

  formatAccuracy(accuracy: number | null | undefined): { label: string; className: string; detail: string } {
    if (accuracy === null || accuracy === undefined) {
      return { label: 'غير محدد', className: 'text-text-secondary', detail: '' }
    }
    const rounded = Math.round(accuracy)
    const detail = rounded + ' متر'
    if (rounded <= 20) return { label: 'ممتازة', className: 'text-success', detail }
    if (rounded <= 50) return { label: 'جيدة', className: 'text-accent', detail }
    if (rounded <= 100) return { label: 'مقبولة', className: 'text-warning', detail }
    if (rounded <= 200) return { label: 'ضعيفة', className: 'text-danger', detail }
    return { label: 'ضعيفة جداً', className: 'text-danger/70', detail }
  },

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const cacheKey = lat.toFixed(5) + ',' + lng.toFixed(5)
    const cached = _reverseGeocodeCache.get(cacheKey)
    if (cached) return cached
    try {
      const response = await fetch(
        'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&accept-language=ar',
        { headers: { 'User-Agent': 'AhramDistApp/1.0' } }
      )
      if (!response.ok) return null
      const data = await response.json()
      const address = data.display_name || null
      if (address) _reverseGeocodeCache.set(cacheKey, address)
      return address
    } catch {
      return null
    }
  },

  async fetchLocation(locationId: string): Promise<LocationRecord | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return null
    const { data } = await supabase.rpc('get_governed_location', { p_token: token, p_id: locationId })
    const result = data as any
    if (result?.error) return null
    return result as LocationRecord
  },

  async fetchLocations(locationIds: string[]): Promise<Map<string, LocationRecord>> {
    const ids = locationIds.filter(Boolean)
    if (ids.length === 0) return new Map()
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return new Map()
    const { data } = await supabase.rpc('get_governed_locations', { p_token: token, p_ids: ids })
    const map = new Map<string, LocationRecord>()
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && !r.error) map.set(r.id, r as LocationRecord)
      }
    }
    return map
  },

  saveLocation(gps: GpsLocation): Promise<string | null> {
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) return Promise.resolve(null)
    return supabase.rpc('governed_create_location', {
      p_token: token,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
      p_accuracy_meters: gps.accuracy,
    }).then(({ data }) => {
      const result = data as any
      if (result?.error) return null
      return result.id as string
    })
  },
}

export function getLocationAccuracyLabel(accuracy: number | null | undefined): string {
  return locationService.formatAccuracy(accuracy).label
}
