import type { ISalesOrderProvider, OrderSearchCriteria } from '../../contracts/ISalesOrderProvider'
import type { SalesOrder } from '../../../domain/models/salesOrder'
import { SalesOrderMapper } from '../../mappers/SalesOrderMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseSalesOrderProvider'

export class SupabaseSalesOrderProvider implements ISalesOrderProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async placeNewOrder(order: SalesOrder): Promise<void> {
    const items = order.lines.map((line) => ({
      product_id: line.productId,
      product_name: line.productName,
      unit_type: line.unitType,
      unit_price: line.unitPrice.amount,
      unit_quantity: line.quantity,
      total_price: line.total.amount,
    }))
    const { data, error } = await supabase
      .from('orders')
      .insert({
        company_id: order.companyId,
        customer_id: order.customerId,
        snapshot_customer_name: order.customerName,
        owner_id: this.context.identityId,
        created_by: this.context.identityId,
        status: 'draft',
        subtotal: order.subtotal.amount,
        discount_amount: order.discount.amount,
        total_amount: order.grandTotal.amount,
        notes: order.notes ?? undefined,
      })
      .select()
      .single()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const orderId = (data as any)?.id
    if (!orderId) throw new ProviderException('Failed to create order', PROVIDER_NAME)
    for (const item of items) {
      const { error: itemError } = await supabase
        .from('order_items')
        .insert({ ...item, order_id: orderId })
      if (itemError) throw new ProviderException(itemError.message, PROVIDER_NAME, itemError)
    }
  }

  async submitOrder(order: SalesOrder): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async approveOrder(order: SalesOrder): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'reviewing', updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'returned_for_revision', notes: reason, updated_at: new Date().toISOString() })
      .eq('id', orderId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async cancelOrder(orderId: string): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', orderId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async recordPayment(order: SalesOrder): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .insert({
        order_id: order.id,
        customer_id: order.customerId,
        method: 'cash',
        amount: order.grandTotal.amount,
        status: 'approved',
      })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getOrderById(id: string): Promise<SalesOrder | null> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    const adapted = { ...data, items: (data as any).order_items ?? [] }
    return SalesOrderMapper.fromUnifiedOrder(adapted)
  }

  async getCustomerOrders(customerId: string): Promise<SalesOrder[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map((row) => SalesOrderMapper.fromUnifiedOrderItem(row))
  }

  async searchOrders(criteria: OrderSearchCriteria): Promise<SalesOrder[]> {
    let query = supabase.from('orders').select('*')
    if (criteria.companyId) query = query.eq('company_id', criteria.companyId)
    if (criteria.status) {
      const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status]
      query = query.in('status', statuses)
    }
    if (criteria.customerId) query = query.eq('customer_id', criteria.customerId)
    if (criteria.salesRepId) query = query.eq('owner_id', criteria.salesRepId)
    if (criteria.fromDate) query = query.gte('created_at', criteria.fromDate.toISOString())
    if (criteria.toDate) query = query.lte('created_at', criteria.toDate.toISOString())
    if (criteria.searchText) query = query.or(`snapshot_customer_name.ilike.%${criteria.searchText}%,order_number.ilike.%${criteria.searchText}%`)
    if (criteria.limit) query = query.limit(criteria.limit)
    if (criteria.offset) query = query.range(criteria.offset, criteria.offset + (criteria.limit ?? 50) - 1)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map((row) => SalesOrderMapper.fromUnifiedOrderItem(row))
  }
}
