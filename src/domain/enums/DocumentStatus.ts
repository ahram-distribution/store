export const DocumentStatus = {
  Active: 'active',
  Inactive: 'inactive',
  Suspended: 'suspended',
} as const

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus]

export const ReservationStatus = {
  Active: 'active',
  Converted: 'converted',
  Released: 'released',
} as const

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus]

export const TrackingSessionStatus = {
  Active: 'active',
  Completed: 'completed',
  Interrupted: 'interrupted',
} as const

export type TrackingSessionStatus = (typeof TrackingSessionStatus)[keyof typeof TrackingSessionStatus]

export const StockReservationStatus = {
  Active: 'active',
  Fulfilled: 'fulfilled',
  Released: 'released',
} as const

export type StockReservationStatus = (typeof StockReservationStatus)[keyof typeof StockReservationStatus]

export const AuctionStatus = {
  Pending: 'pending',
  Active: 'active',
  Closed: 'closed',
  Cancelled: 'cancelled',
} as const

export type AuctionStatus = (typeof AuctionStatus)[keyof typeof AuctionStatus]

export const ReturnStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Completed: 'completed',
} as const

export type ReturnStatus = (typeof ReturnStatus)[keyof typeof ReturnStatus]
