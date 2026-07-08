import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import type { ICustomerProvider } from '../../providers/contracts/ICustomerProvider'

export interface GetCustomerQuery extends IQuery {
  readonly queryType: 'GetCustomerQuery'
  readonly customerId: string
}

export class GetCustomerHandler implements IQueryHandler<GetCustomerQuery, import('../../domain/models/customer').Customer> {
  readonly queryType = 'GetCustomerQuery' as const
  private customerProvider: ICustomerProvider

  constructor(deps: { customerProvider: ICustomerProvider }) {
    this.customerProvider = deps.customerProvider
  }

  async handle(query: GetCustomerQuery): Promise<ApplicationResult> {
    const customer = await this.customerProvider.getCustomerById(query.customerId)
    if (!customer) return failure('Customer not found', 'NOT_FOUND')
    return success(customer)
  }
}
