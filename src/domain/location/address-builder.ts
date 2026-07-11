import type { StructuredAddress, AddressInput } from './types'

export function buildRegisteredAddress(address: StructuredAddress): string {
  const parts: string[] = []
  if (address.governorate_name) parts.push(address.governorate_name)
  if (address.city_name) parts.push(address.city_name)
  if (address.street_address) parts.push(address.street_address)
  if (address.landmark) parts.push(address.landmark)
  return parts.join(' - ')
}

export function composeAddress(input: AddressInput): string {
  const parts: string[] = []
  if (input.street_address) parts.push(input.street_address)
  if (input.landmark) parts.push(input.landmark)
  return parts.join(' - ')
}

export function formatAddressPreview(governorateName: string | null, cityName: string | null, street: string, landmark: string): string {
  const parts: string[] = []
  if (governorateName) parts.push(governorateName)
  if (cityName) parts.push(cityName)
  if (street.trim()) parts.push(street.trim())
  if (landmark.trim()) parts.push(landmark.trim())
  return parts.join(' - ')
}
