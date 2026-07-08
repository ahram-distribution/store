import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { IInventoryProvider } from '../../contracts/IInventoryProvider'
import type { InventoryRecord, StockReservation } from '../../../domain/models/inventory'
import { StockReservationStatus } from '../../../domain/enums/DocumentStatus'

export class MockInventoryProvider implements IInventoryProvider, IProvider {
  readonly name = 'inventory'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async reserveStock(productId: string, quantity: number, orderId: string): Promise<StockReservation> {
    return {
      id: `${orderId}-${productId}-mock`,
      orderId,
      productId,
      quantityReserved: quantity,
      status: StockReservationStatus.Active,
      createdAt: new Date(),
    }
  }

  async releaseReservation(reservationId: string): Promise<void> {
    return
  }

  async adjustInventory(productId: string, quantity: number, reason: string): Promise<InventoryRecord> {
    return {
      id: `${productId}-inv`,
      productId,
      companyId: 'comp-1',
      quantity,
      lastCountedAt: null,
      notes: reason,
      updatedAt: new Date(),
    }
  }

  async confirmShipment(productId: string, quantityShipped: number): Promise<InventoryRecord> {
    return this.adjustInventory(productId, -quantityShipped, 'shipment_confirmed')
  }

  async getInventoryLevel(productId: string): Promise<InventoryRecord | null> {
    if (productId === 'unknown') return null
    return {
      id: `${productId}-inv`,
      productId,
      companyId: 'comp-1',
      quantity: 100,
      lastCountedAt: null,
      notes: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
  }

  async getInventoryByCompany(companyId: string): Promise<InventoryRecord[]> {
    return []
  }
}
