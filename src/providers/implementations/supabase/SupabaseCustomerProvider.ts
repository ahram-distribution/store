import type { ICustomerProvider, CustomerSearchCriteria } from '../../contracts/ICustomerProvider'
import type { Customer } from '../../../domain/models/customer'
import { CustomerMapper } from '../../mappers/CustomerMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseCustomerProvider'

export class SupabaseCustomerProvider implements ICustomerProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async registerNewCustomer(customer: Customer): Promise<void> {
    const { error } = await supabase.rpc('governed_create_customer', {
      p_token: this.context.token,
      p_company_name: customer.tradeName || customer.fullName,
      p_phone: customer.phone.number,
      p_responsible_name: customer.fullName,
      p_business_type: (customer.customerType === 'retail' ? 'retail' : 'wholesaler') as any,
      p_street_address: customer.address.street || null,
      p_landmark: customer.address.district || null,
      p_city_id: null,
      p_governorate_id: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async suspendCustomer(customerId: string): Promise<void> {
    const { error } = await supabase
      .from('customers')
      .update({ is_active: false })
      .eq('id', customerId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async updateCreditLimit(customerId: string, newLimit: number): Promise<void> {
    const { error } = await supabase
      .from('customers')
      .update({ credit_limit: newLimit })
      .eq('id', customerId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return CustomerMapper.fromLegacyRow(data)
  }

  async searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]> {
    let query = supabase.from('customers').select('*')
    if (criteria.companyId) query = query.eq('company_id', criteria.companyId)
    if (criteria.searchQuery) {
      query = query.or(`name.ilike.%${criteria.searchQuery}%,full_name.ilike.%${criteria.searchQuery}%,phone.ilike.%${criteria.searchQuery}%`)
    }
    if (criteria.customerType) query = query.eq('customer_type', criteria.customerType)
    if (criteria.status === 'active') query = query.eq('is_active', true)
    if (criteria.status === 'suspended') query = query.eq('is_active', false)
    if (criteria.limit) query = query.limit(criteria.limit)
    if (criteria.offset && criteria.limit) {
      query = query.range(criteria.offset, criteria.offset + criteria.limit - 1)
    }
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(CustomerMapper.fromLegacyRow)
  }
}
