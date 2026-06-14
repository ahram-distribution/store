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

export interface StructuredAddress {
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

const _reverseGeocodeCache = new Map<string, string>()
const _structuredGeocodeCache = new Map<string, StructuredAddress>()
const _geocodeQueue: Array<{ lat: number; lng: number; resolve: (addr: StructuredAddress | null) => void }> = []
let _geocodeProcessing = false
const NOMINATIM_INTERVAL_MS = 1200

async function _processNominatimQueue(): Promise<void> {
  if (_geocodeProcessing) return
  _geocodeProcessing = true
  while (_geocodeQueue.length > 0) {
    const item = _geocodeQueue.shift()!
    const cacheKey = item.lat.toFixed(5) + ',' + item.lng.toFixed(5)
    const cached = _structuredGeocodeCache.get(cacheKey)
    if (cached) {
      item.resolve(cached)
      continue
    }
    try {
      const res = await fetch(
        'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + item.lat + '&lon=' + item.lng + '&accept-language=ar',
        { headers: { 'User-Agent': 'AhramDistApp/1.0' } }
      )
      if (!res.ok) { item.resolve(null); continue }
      const data = await res.json()
      const addr: StructuredAddress = {
        house_number: data.address?.house_number,
        road: data.address?.road,
        suburb: data.address?.suburb,
        neighbourhood: data.address?.neighbourhood,
        city_district: data.address?.city_district,
        county: data.address?.county,
        city: data.address?.city,
        town: data.address?.town,
        village: data.address?.village,
        state: data.address?.state,
        country: data.address?.country,
        displayName: data.display_name,
      }
      _structuredGeocodeCache.set(cacheKey, addr)
      item.resolve(addr)
    } catch { item.resolve(null) }
    await new Promise(r => setTimeout(r, NOMINATIM_INTERVAL_MS))
  }
  _geocodeProcessing = false
}

function extractShortAddress(addr: StructuredAddress): string {
  const parts: string[] = []
  const streetParts: string[] = []
  if (addr.house_number) streetParts.push(addr.house_number)
  if (addr.road) streetParts.push(addr.road)
  if (streetParts.length > 0) parts.push(streetParts.join(' '))
  const area = addr.suburb || addr.neighbourhood || addr.city_district
  if (area) parts.push(area)
  const cityName = addr.city || addr.town || addr.village
  if (cityName && cityName !== area) parts.push(cityName)
  if (addr.state && addr.state !== cityName && addr.state !== area) parts.push(addr.state)
  return parts.join(' - ')
}

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

  async reverseGeocodeStructured(lat: number, lng: number): Promise<StructuredAddress | null> {
    const cacheKey = lat.toFixed(5) + ',' + lng.toFixed(5)
    const cached = _structuredGeocodeCache.get(cacheKey)
    if (cached) return cached
    if (_geocodeQueue.length > 200) return null
    return new Promise(resolve => {
      _geocodeQueue.push({ lat, lng, resolve })
      _processNominatimQueue()
    })
  },

  formatShortAddress(lat: number, lng: number, addr?: StructuredAddress | null): string | null {
    if (addr) return extractShortAddress(addr)
    return null
  },

  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  },

  formatDistance(meters: number): string {
    if (meters < 1000) return Math.round(meters) + 'م'
    return (meters / 1000).toFixed(2) + 'كم'
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
