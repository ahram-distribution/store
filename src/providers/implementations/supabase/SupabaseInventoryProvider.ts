import type { IInventoryProvider } from '../../contracts/IInventoryProvider'
import type { InventoryRecord, StockReservation } from '../../../domain/models/inventory'
import { StockReservationStatus } from '../../../domain/enums/DocumentStatus'
import { InventoryMapper } from '../../mappers/InventoryMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseInventoryProvider'

export class SupabaseInventoryProvider implements IInventoryProvider {
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
      p_id: productId,
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
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('product_id', productId)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return {
      id: data.id,
      productId: data.product_id,
      companyId: '',
      quantity: data.quantity,
      lastCountedAt: data.last_counted_at ? new Date(data.last_counted_at) : null,
      notes: data.notes,
      updatedAt: new Date(data.updated_at),
    }
  }

  async getInventoryByCompany(companyId: string): Promise<InventoryRecord[]> {
    const { data, error } = await supabase
      .from('products')
      .select('*, inventory(*)')
      .eq('company_id', companyId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(InventoryMapper.fromProductRow)
  }
}
