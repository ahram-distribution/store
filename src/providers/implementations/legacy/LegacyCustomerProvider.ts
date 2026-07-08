import { supabase } from '../../../lib/supabase'
import type { ICustomerProvider, CustomerSearchCriteria } from '../../contracts/ICustomerProvider'
import type { Customer } from '../../../domain/models/customer'
import { CustomerMapper } from '../../mappers/CustomerMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacyCustomerProvider'

export class LegacyCustomerProvider implements ICustomerProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async registerNewCustomer(customer: Customer): Promise<void> {
    const { error } = await supabase.rpc('governed_create_customer', {
      p_token: this.context.token,
      p_name: customer.tradeName || customer.fullName,
      p_full_name: customer.fullName,
      p_phone: customer.phone.number,
      p_customer_type: customer.customerType,
      p_credit_limit: customer.creditLimit.amount,
      p_address_line1: customer.address.street,
      p_address_line2: customer.address.district,
      p_city: customer.address.city,
      p_governorate: customer.address.governorate,
      p_latitude: null,
      p_longitude: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async suspendCustomer(customerId: string): Promise<void> {
    const { error } = await supabase.rpc('governed_deactivate_customer', {
      p_token: this.context.token,
      p_id: customerId,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async updateCreditLimit(customerId: string, newLimit: number): Promise<void> {
    const { error } = await supabase.rpc('governed_update_customer', {
      p_token: this.context.token,
      p_id: customerId,
      p_credit_limit: newLimit,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    const { data, error } = await supabase.rpc('get_governed_customer', {
      p_token: this.context.token,
      p_id: id,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data || data?.error) return null
    return CustomerMapper.fromLegacyRow(data)
  }

  async searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]> {
    const params: Record<string, unknown> = { p_token: this.context.token }
    if (criteria.searchQuery) params.p_search = criteria.searchQuery
    const { data, error } = await supabase.rpc('get_governed_customers', params)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(CustomerMapper.fromLegacyRow)
  }
}
