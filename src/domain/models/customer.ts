import type { Address } from '../value-objects'
import type { CustomerType } from '../enums'
import type { PhoneNumber } from '../value-objects'
import type { DocumentStatus } from '../enums'

export interface Customer {
  readonly id: string
  readonly companyId: string
  readonly code: string
  readonly customerType: CustomerType
  readonly tradeName: string
  readonly fullName: string
  readonly phone: PhoneNumber
  readonly address: Address
  readonly status: DocumentStatus
  readonly creditLimit: import('../value-objects').Money
  readonly outstandingBalance: import('../value-objects').Money
  readonly createdAt: Date
  readonly updatedAt: Date
}

export function createCustomer(
  id: string,
  companyId: string,
  code: string,
  customerType: CustomerType,
  tradeName: string,
  fullName: string,
  phone: PhoneNumber,
  address: Address,
  creditLimit: import('../value-objects').Money,
): Customer {
  const now = new Date()
  return {
    id, companyId, code: code || '',
    customerType, tradeName, fullName, phone, address,
    status: 'active' as DocumentStatus,
    creditLimit,
    outstandingBalance: { amount: 0, currency: 'EGP' },
    createdAt: now,
    updatedAt: now,
  }
}

export function suspendCustomer(customer: Customer): Customer {
  return { ...customer, status: 'suspended' as DocumentStatus, updatedAt: new Date() }
}

export function isCustomerSuspended(customer: Customer): boolean {
  return customer.status === 'suspended'
}

export function canPlaceOrder(customer: Customer): boolean {
  return customer.status === 'active'
    && customer.outstandingBalance.amount <= customer.creditLimit.amount
}
