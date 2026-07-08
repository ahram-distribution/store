import { supabase } from '../../../lib/supabase'
import type { ISalesOrderProvider, OrderSearchCriteria } from '../../contracts/ISalesOrderProvider'
import type { SalesOrder } from '../../../domain/models/salesOrder'
import { SalesOrderMapper } from '../../mappers/SalesOrderMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacySalesOrderProvider'

export class LegacySalesOrderProvider implements ISalesOrderProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async placeNewOrder(order: SalesOrder): Promise<void> {
    const items = order.lines.map((line) => ({
      product_id: line.productId,
      unit_type: line.unitType,
      unit_quantity: line.quantity,
      piece_quantity: Math.round(line.quantity * (line.unitType === 'carton' ? 1 : 0)),
      unit_price: line.unitPrice.amount,
      total_price: line.total.amount,
    }))
    const { error } = await supabase.rpc('governed_create_order', {
      p_token: this.context.token,
      p_customer_id: order.customerId,
      p_notes: order.notes ?? null,
      p_items: items,
      p_execution_location_id: null,
      p_execution_latitude: null,
      p_execution_longitude: null,
      p_execution_accuracy_meters: null,
      p_execution_captured_at: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async submitOrder(order: SalesOrder): Promise<void> {
    const { error } = await supabase.rpc('governed_submit_order', {
      p_token: this.context.token,
      p_id: order.id,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async approveOrder(order: SalesOrder): Promise<void> {
    const { error } = await supabase.rpc('governed_approve_order', {
      p_token: this.context.token,
      p_id: order.id,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('governed_return_order_for_revision', {
      p_token: this.context.token,
      p_id: orderId,
      p_reason: reason,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async cancelOrder(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('governed_change_order_status', {
      p_token: this.context.token,
      p_order_id: orderId,
      p_new_status: 'cancelled',
      p_reason: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async recordPayment(order: SalesOrder): Promise<void> {
    const { error } = await supabase.rpc('governed_record_credit_payment', {
      p_token: this.context.token,
      p_invoice_id: order.id,
      p_payment_method: 'cash',
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getOrderById(id: string): Promise<SalesOrder | null> {
    const { data, error } = await supabase.rpc('get_unified_order', {
      p_token: this.context.token,
      p_id: id,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data || data?.error) return null
    return SalesOrderMapper.fromUnifiedOrder(data)
  }

  async getCustomerOrders(customerId: string): Promise<SalesOrder[]> {
    const { data, error } = await supabase.rpc('get_customer_orders', {
      p_token: this.context.token,
      p_customer_id: customerId,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(SalesOrderMapper.fromUnifiedOrderItem)
  }

  async searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]> {
    const params: Record<string, unknown> = { p_token: this.context.token }
    if (criteria.status) params.p_status = Array.isArray(criteria.status) ? criteria.status[0] : criteria.status
    if (criteria.customerId) params.p_customer_id = criteria.customerId
    if (criteria.fromDate) params.p_date_from = criteria.fromDate.toISOString()
    if (criteria.toDate) params.p_date_to = criteria.toDate.toISOString()
    if (criteria.salesRepId) params.p_created_by = criteria.salesRepId
    if (criteria.searchText) params.p_search = criteria.searchText
    const { data, error } = await supabase.rpc('get_unified_orders', params)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(SalesOrderMapper.fromUnifiedOrderItem)
  }
}
