import type { Customer } from '../../domain/models/customer'
import { createMoney } from '../../domain/value-objects/Money'
import type { CustomerType } from '../../domain/enums/CustomerType'
import type { DocumentStatus } from '../../domain/enums/DocumentStatus'

export class CustomerMapper {
  static fromLegacyRow(row: any): Customer {
    return {
      id: row.id,
      companyId: row.company_id ?? '',
      code: row.code ?? row.customer_code ?? '',
      customerType: (row.customer_type ?? 'retail') as CustomerType,
      tradeName: row.name ?? row.trade_name ?? row.company_name ?? '',
      fullName: row.full_name ?? row.name ?? '',
      phone: { number: row.phone ?? '', countryCode: '+2' },
      address: {
        street: row.street_address ?? row.address_line1 ?? '',
        district: row.landmark ?? row.address_line2 ?? '',
        city: row.city_name ?? row.city ?? '',
        governorate: row.governorate_name ?? row.governorate ?? '',
      },
      status: (row.is_active !== false ? 'active' : 'suspended') as DocumentStatus,
      creditLimit: createMoney(Number(row.credit_limit) || 0),
      outstandingBalance: createMoney(Number(row.outstanding_balance) || 0),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at ?? row.created_at),
    }
  }
}
