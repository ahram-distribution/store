import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { ICustomerProvider, CustomerSearchCriteria } from '../../contracts/ICustomerProvider'
import type { Customer } from '../../../domain/models/customer'
import { createMoney } from '../../../domain/value-objects/Money'

export class MockCustomerProvider implements ICustomerProvider, IProvider {
  readonly name = 'customer'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async registerNewCustomer(customer: Customer): Promise<void> {
    return
  }

  async suspendCustomer(customerId: string): Promise<void> {
    return
  }

  async updateCreditLimit(customerId: string, newLimit: number): Promise<void> {
    return
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    if (id === 'nonexistent') return null
    return {
      id,
      companyId: 'comp-1',
      customerType: 'retail',
      tradeName: 'Mock Customer',
      fullName: 'Mock Customer Full',
      phone: { number: '01234567890', countryCode: '+2' },
      address: { street: 'Mock St', district: 'Mock District', city: 'Mock City', governorate: 'Mock Gov' },
      status: 'active',
      creditLimit: createMoney(5000),
      outstandingBalance: createMoney(0),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
  }

  async searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]> {
    return []
  }
}
