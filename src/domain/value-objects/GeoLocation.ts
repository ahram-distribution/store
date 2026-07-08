export interface GeoLocation {
  readonly latitude: number
  readonly longitude: number
  readonly accuracy: number
  readonly timestamp: Date
}

export function createGeoLocation(latitude: number, longitude: number, accuracy: number = 0, timestamp: Date = new Date()): GeoLocation {
  return { latitude, longitude, accuracy, timestamp }
}

export function isValidGeoLocation(loc: GeoLocation): boolean {
  return loc.latitude >= -90 && loc.latitude <= 90
    && loc.longitude >= -180 && loc.longitude <= 180
    && loc.accuracy >= 0
}
