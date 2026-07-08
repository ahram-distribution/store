import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'

export interface GetOrderQuery extends IQuery {
  readonly queryType: 'GetOrderQuery'
  readonly orderId: string
}

export class GetOrderHandler implements IQueryHandler<GetOrderQuery, import('../../domain/models/salesOrder').SalesOrder> {
  readonly queryType = 'GetOrderQuery' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(query: GetOrderQuery): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(query.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')
    return success(order)
  }
}
