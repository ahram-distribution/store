import type { NominatimAddress } from './types'

const _reverseGeocodeCache = new Map<string, string>()
const _structuredGeocodeCache = new Map<string, NominatimAddress>()
const _geocodeQueue: Array<{ lat: number; lng: number; resolve: (addr: NominatimAddress | null) => void }> = []
let _geocodeProcessing = false
const NOMINATIM_INTERVAL_MS = 1200

async function _processNominatimQueue(): Promise<void> {
  if (_geocodeProcessing) return
  _geocodeProcessing = true
  while (_geocodeQueue.length > 0) {
    const item = _geocodeQueue.shift()!
    const cacheKey = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`
    const cached = _structuredGeocodeCache.get(cacheKey)
    if (cached) { item.resolve(cached); continue }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${item.lat}&lon=${item.lng}&accept-language=ar`,
        { headers: { 'User-Agent': 'AhramDistApp/1.0' } }
      )
      if (!res.ok) { item.resolve(null); continue }
      const data = await res.json()
      const addr: NominatimAddress = {
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

function extractShortAddress(addr: NominatimAddress): string {
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

export const geocoding = {
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`
    const cached = _reverseGeocodeCache.get(cacheKey)
    if (cached) return cached
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`,
        { headers: { 'User-Agent': 'AhramDistApp/1.0' } }
      )
      if (!response.ok) return null
      const data = await response.json()
      const address = data.display_name || null
      if (address) _reverseGeocodeCache.set(cacheKey, address)
      return address
    } catch { return null }
  },

  async reverseGeocodeStructured(lat: number, lng: number): Promise<NominatimAddress | null> {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`
    const cached = _structuredGeocodeCache.get(cacheKey)
    if (cached) return cached
    if (_geocodeQueue.length > 200) return null
    return new Promise(resolve => {
      _geocodeQueue.push({ lat, lng, resolve })
      _processNominatimQueue()
    })
  },

  formatShortAddress(lat: number, lng: number, addr?: NominatimAddress | null): string | null {
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
    if (meters < 1000) return `${Math.round(meters)}م`
    return `${(meters / 1000).toFixed(2)}كم`
  },
}
