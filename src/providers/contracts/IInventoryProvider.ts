import type { InventoryRecord, StockReservation } from '../../domain/models/inventory'

export interface IInventoryProvider {
  reserveStock(productId: string, quantity: number, orderId: string): Promise<StockReservation>
  releaseReservation(reservationId: string): Promise<void>
  adjustInventory(productId: string, quantity: number, reason: string): Promise<InventoryRecord>
  confirmShipment(productId: string, quantityShipped: number): Promise<InventoryRecord>

  getInventoryLevel(productId: string): Promise<InventoryRecord | null>
  getInventoryByCompany(companyId: string): Promise<InventoryRecord[]>
}
