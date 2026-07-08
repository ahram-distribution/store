import type { TrackingSessionStatus } from '../enums'
import { type GeoLocation } from '../value-objects'

export interface CheckIn {
  readonly id: string
  readonly sessionId: string
  readonly customerId: string
  readonly timestamp: Date
  readonly location: GeoLocation | null
  readonly notes: string | null
  readonly orderId: string | null
}

export interface TrackingSession {
  readonly id: string
  readonly employeeId: string
  readonly date: Date
  readonly status: TrackingSessionStatus
  readonly checkIns: readonly CheckIn[]
  readonly startedAt: Date
  readonly endedAt: Date | null
}

export function startTrackingSession(id: string, employeeId: string, date: Date): TrackingSession {
  return { id, employeeId, date, status: 'active' as TrackingSessionStatus, checkIns: [], startedAt: new Date(), endedAt: null }
}

export function endTrackingSession(session: TrackingSession): TrackingSession {
  return { ...session, status: 'completed' as TrackingSessionStatus, endedAt: new Date() }
}

export function addCheckIn(
  session: TrackingSession,
  checkIn: CheckIn,
): TrackingSession {
  if (session.status !== 'active') throw new Error('Cannot check in to an inactive session')
  return { ...session, checkIns: [...session.checkIns, checkIn] }
}

export function createCheckIn(
  id: string,
  sessionId: string,
  customerId: string,
  location?: GeoLocation,
  notes?: string | null,
  orderId?: string | null,
): CheckIn {
  return { id, sessionId, customerId, timestamp: new Date(), location: location ?? null, notes: notes ?? null, orderId: orderId ?? null }
}
