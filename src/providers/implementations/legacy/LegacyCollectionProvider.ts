import { supabase } from '../../../lib/supabase'
import type { ICollectionProvider } from '../../contracts/ICollectionProvider'
import type { Payment, CheckPayment } from '../../../domain/models/payment'
import { CollectionMapper } from '../../mappers/CollectionMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacyCollectionProvider'

export class LegacyCollectionProvider implements ICollectionProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async receiveCashPayment(payment: Payment): Promise<void> {
    const { error } = await supabase.rpc('governed_record_credit_payment', {
      p_token: this.context.token,
      p_invoice_id: payment.orderId,
      p_payment_method: 'cash',
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async receiveCheckPayment(payment: CheckPayment): Promise<void> {
    const { error } = await supabase.rpc('governed_record_cheque', {
      p_token: this.context.token,
      p_invoice_id: payment.orderId,
      p_cheque_number: payment.checkNumber,
      p_bank_name: payment.bankName,
      p_amount: payment.amount.amount,
      p_due_date: payment.dueDate.toISOString(),
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async depositCheck(checkId: string): Promise<void> {
    const { error } = await supabase.rpc('governed_update_check_status', {
      p_token: this.context.token,
      p_check_id: checkId,
      p_status: 'deposited',
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async clearCheck(checkId: string): Promise<void> {
    const { error } = await supabase.rpc('governed_update_check_status', {
      p_token: this.context.token,
      p_check_id: checkId,
      p_status: 'cleared',
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async returnCheck(checkId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('governed_update_check_status', {
      p_token: this.context.token,
      p_check_id: checkId,
      p_status: 'returned',
      p_reason: reason,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getPaymentsByOrder(orderId: string): Promise<Payment[]> {
    const { data, error } = await supabase.rpc('get_unified_order', {
      p_token: this.context.token,
      p_id: orderId,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data || data?.error) return []
    const collections = data.collections ?? []
    return collections.map((c: any) => CollectionMapper.paymentFromLegacyRow(c, orderId))
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const { data, error } = await supabase.rpc('get_governed_collections', { p_token: this.context.token })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    const found = arr.find((c: any) => c.id === id)
    if (!found) return null
    return CollectionMapper.paymentFromLegacyRow(found)
  }
}
