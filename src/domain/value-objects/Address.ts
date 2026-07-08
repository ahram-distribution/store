import type { GeoLocation } from './GeoLocation'

export interface Address {
  readonly street: string
  readonly district: string
  readonly city: string
  readonly governorate: string
  readonly coordinates?: GeoLocation
}

export function createAddress(street: string, district: string, city: string, governorate: string, coordinates?: GeoLocation): Address {
  return { street, district, city, governorate, coordinates }
}
