import type { StockReservationStatus } from '../enums'
import { type Money, ZeroMoney } from '../value-objects'

export interface InventoryRecord {
  readonly id: string
  readonly productId: string
  readonly companyId: string
  readonly quantity: number
  readonly lastCountedAt: Date | null
  readonly notes: string | null
  readonly updatedAt: Date
}

export interface StockReservation {
  readonly id: string
  readonly orderId: string
  readonly productId: string
  readonly quantityReserved: number
  readonly status: StockReservationStatus
  readonly createdAt: Date
}

export function createInventoryRecord(
  id: string,
  productId: string,
  companyId: string,
  quantity?: number,
): InventoryRecord {
  return { id, productId, companyId, quantity: quantity ?? 0, lastCountedAt: null, notes: null, updatedAt: new Date() }
}

export function adjustInventory(record: InventoryRecord, adjustment: number): InventoryRecord {
  const newQty = record.quantity + adjustment
  if (newQty < 0) throw new Error('Inventory cannot be negative')
  return { ...record, quantity: newQty, updatedAt: new Date() }
}

export function countInventory(record: InventoryRecord, actualQuantity: number): InventoryRecord {
  return { ...record, quantity: actualQuantity, lastCountedAt: new Date(), updatedAt: new Date() }
}

export function reserveStock(
  id: string,
  orderId: string,
  productId: string,
  quantityReserved: number,
): StockReservation {
  return { id, orderId, productId, quantityReserved, status: 'active' as StockReservationStatus, createdAt: new Date() }
}

export function fulfillReservation(reservation: StockReservation): StockReservation {
  return { ...reservation, status: 'fulfilled' as StockReservationStatus }
}

export function releaseReservation(reservation: StockReservation): StockReservation {
  return { ...reservation, status: 'released' as StockReservationStatus }
}
