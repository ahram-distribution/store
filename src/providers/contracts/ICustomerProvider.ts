import type { Customer } from '../../domain/models/customer'
import type { CustomerType } from '../../domain/enums'

export interface CustomerSearchCriteria {
  companyId: string
  searchQuery?: string
  customerType?: CustomerType
  status?: string
  limit?: number
  offset?: number
}

export interface ICustomerProvider {
  registerNewCustomer(customer: Customer): Promise<void>
  suspendCustomer(customerId: string): Promise<void>
  updateCreditLimit(customerId: string, newLimit: number): Promise<void>

  getCustomerById(id: string): Promise<Customer | null>
  searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]>
}
