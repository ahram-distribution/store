import {
  LocationRepository,
  formatAccuracy,
  geocoding,
} from '../domain/location'

import type {
  LocationRecord,
  GpsLocation,
  NominatimAddress,
} from '../domain/location'

export type { LocationRecord, GpsLocation, NominatimAddress }
export type FreshLocation = GpsLocation
export type StructuredAddress = NominatimAddress

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function getRepo(): LocationRepository | null {
  const token = getToken()
  if (!token) return null
  return new LocationRepository(token)
}

export const locationService = {
  buildGoogleMapsUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps?q=${lat},${lng}`
  },

  openGoogleMaps(lat: number, lng: number): void {
    window.location.href = this.buildGoogleMapsUrl(lat, lng)
  },

  formatAccuracy(accuracy: number | null | undefined) {
    return formatAccuracy(accuracy)
  },

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    return geocoding.reverseGeocode(lat, lng)
  },

  async reverseGeocodeStructured(lat: number, lng: number): Promise<NominatimAddress | null> {
    return geocoding.reverseGeocodeStructured(lat, lng)
  },

  formatShortAddress(lat: number, lng: number, addr?: NominatimAddress | null): string | null {
    return geocoding.formatShortAddress(lat, lng, addr)
  },

  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return geocoding.haversineDistance(lat1, lng1, lat2, lng2)
  },

  formatDistance(meters: number): string {
    return geocoding.formatDistance(meters)
  },

  async fetchLocation(locationId: string): Promise<LocationRecord | null> {
    const repo = getRepo()
    if (!repo) return null
    return repo.fetchLocation(locationId)
  },

  async fetchLocations(locationIds: string[]): Promise<Map<string, LocationRecord>> {
    const repo = getRepo()
    if (!repo) return new Map()
    return repo.fetchLocations(locationIds)
  },

  async saveLocation(gps: GpsLocation): Promise<string | null> {
    const repo = getRepo()
    if (!repo) return null
    return repo.saveLocation(gps)
  },
}

export function getLocationAccuracyLabel(accuracy: number | null | undefined): string {
  return formatAccuracy(accuracy).label
}
