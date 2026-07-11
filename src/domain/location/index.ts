export { LocationRepository, createLocationRepository } from './repository'
export { formatAccuracy, getLocationAccuracyLabel, ACCURACY_COLORS } from './accuracy'
export { buildRegisteredAddress, composeAddress, formatAddressPreview } from './address-builder'
export { geocoding } from './geocoding'
export { getCustomerLocationColor, getEmployeeStatusColor, hasGpsLocation, getEmployeesByStatus } from './coverage'

export type {
  Governorate,
  City,
  StructuredAddress,
  AddressInput,
  GpsLocation,
  LocationRecord,
  AccuracyInfo,
  NominatimAddress,
  GeocodeResult,
  CoverageSummary,
  CoverageCustomer,
  CoverageEmployee,
  CoverageMapData,
} from './types'

export {
  LOCATION_SOURCE_PRIORITY,
  LOCATION_SOURCE_LABELS,
} from './types'
