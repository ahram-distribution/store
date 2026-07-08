import type { ICollectionProvider } from '../../contracts/ICollectionProvider'
import type { Payment, CheckPayment } from '../../../domain/models/payment'
import { CollectionMapper } from '../../mappers/CollectionMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseCollectionProvider'

export class SupabaseCollectionProvider implements ICollectionProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async receiveCashPayment(payment: Payment): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .insert({
        order_id: payment.orderId,
        customer_id: payment.customerId,
        method: 'cash',
        amount: payment.amount.amount,
        status: 'approved',
      })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async receiveCheckPayment(payment: CheckPayment): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .insert({
        order_id: payment.orderId,
        customer_id: payment.customerId,
        method: 'check',
        amount: payment.amount.amount,
        reference_number: payment.checkNumber,
        bank_name: payment.bankName,
        due_date: payment.dueDate.toISOString(),
        status: 'pending',
      })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async depositCheck(checkId: string): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .update({ status: 'deposited' })
      .eq('id', checkId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async clearCheck(checkId: string): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .update({ status: 'cleared' })
      .eq('id', checkId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async returnCheck(checkId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('collections')
      .update({ status: 'returned', reference_number: reason })
      .eq('id', checkId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getPaymentsByOrder(orderId: string): Promise<Payment[]> {
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('order_id', orderId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map((row) => CollectionMapper.paymentFromLegacyRow(row, orderId))
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return CollectionMapper.paymentFromLegacyRow(data)
  }
}
