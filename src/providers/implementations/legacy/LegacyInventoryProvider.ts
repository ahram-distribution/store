import { supabase } from '../../../lib/supabase'
import type { IInventoryProvider } from '../../contracts/IInventoryProvider'
import type { InventoryRecord, StockReservation } from '../../../domain/models/inventory'
import { StockReservationStatus } from '../../../domain/enums/DocumentStatus'
import { InventoryMapper } from '../../mappers/InventoryMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacyInventoryProvider'

export class LegacyInventoryProvider implements IInventoryProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async reserveStock(productId: string, quantity: number, orderId: string): Promise<StockReservation> {
    const id = `${orderId}-${productId}-${Date.now()}`
    return {
      id,
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
    const { error } = await supabase.rpc('governed_update_product_inventory', {
      p_token: this.context.token,
      p_product_id: productId,
      p_quantity: quantity,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const current = await this.getInventoryLevel(productId)
    return current ?? {
      id: `${productId}-inv`,
      productId,
      companyId: '',
      quantity,
      lastCountedAt: null,
      notes: reason ?? null,
      updatedAt: new Date(),
    }
  }

  async confirmShipment(productId: string, quantityShipped: number): Promise<InventoryRecord> {
    return this.adjustInventory(productId, -quantityShipped, 'shipment_confirmed')
  }

  async getInventoryLevel(productId: string): Promise<InventoryRecord | null> {
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: this.context.token,
      p_active_only: false,
      p_visible_only: false,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    const found = arr.find((p: any) => p.id === productId)
    return found ? InventoryMapper.fromProductRow(found) : null
  }

  async getInventoryByCompany(companyId: string): Promise<InventoryRecord[]> {
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: this.context.token,
      p_company_id: companyId,
      p_active_only: false,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(InventoryMapper.fromProductRow)
  }
}
