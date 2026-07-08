import type { WorkdayStatus } from '../enums'
import { type GeoLocation, createGeoLocation } from '../value-objects'

export interface AttendanceRecord {
  readonly id: string
  readonly employeeId: string
  readonly date: Date
  readonly checkIn: Date
  readonly checkOut: Date | null
  readonly checkInLocation: GeoLocation | null
  readonly checkOutLocation: GeoLocation | null
  readonly notes: string | null
}

export interface Workday {
  readonly id: string
  readonly companyId: string
  readonly employeeId: string
  readonly date: Date
  readonly status: WorkdayStatus
  readonly checkIn: Date | null
  readonly checkOut: Date | null
  readonly checkInLocation: GeoLocation | null
  readonly checkOutLocation: GeoLocation | null
  readonly notes: string | null
}

export function startWorkday(
  id: string,
  companyId: string,
  employeeId: string,
  date: Date,
  location?: GeoLocation,
): Workday {
  return { id, companyId, employeeId, date, status: 'active' as WorkdayStatus, checkIn: new Date(), checkOut: null, checkInLocation: location ?? null, checkOutLocation: null, notes: null }
}

export function endWorkday(workday: Workday, location?: GeoLocation): Workday {
  return { ...workday, status: 'completed' as WorkdayStatus, checkOut: new Date(), checkOutLocation: location ?? null }
}

export function createAttendanceRecord(
  id: string,
  employeeId: string,
  checkIn: Date,
  location?: GeoLocation,
): AttendanceRecord {
  return { id, employeeId, date: checkIn, checkIn, checkOut: null, checkInLocation: location ?? null, checkOutLocation: null, notes: null }
}

export function recordCheckOut(record: AttendanceRecord, checkOut: Date, location?: GeoLocation): AttendanceRecord {
  return { ...record, checkOut, checkOutLocation: location ?? null }
}
