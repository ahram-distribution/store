import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success } from '../results/ApplicationResult'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'

export interface SalesDashboardData {
  totalOrders: number
  totalSales: number
  pendingOrders: number
  approvedOrders: number
  deliveredOrders: number
}

export interface GetSalesDashboardQuery extends IQuery {
  readonly queryType: 'GetSalesDashboardQuery'
  readonly companyId: string
  readonly fromDate: string
  readonly toDate: string
}

export class GetSalesDashboardHandler implements IQueryHandler<GetSalesDashboardQuery, SalesDashboardData> {
  readonly queryType = 'GetSalesDashboardQuery' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(query: GetSalesDashboardQuery): Promise<ApplicationResult> {
    const orders = await this.salesOrderProvider.searchOrders({ companyId: query.companyId })
    const totalSales = orders.reduce((sum, o) => sum + o.grandTotal.amount, 0)
    const data: SalesDashboardData = {
      totalOrders: orders.length,
      totalSales,
      pendingOrders: orders.filter(o => o.status === 'submitted' || o.status === 'reviewing').length,
      approvedOrders: orders.filter(o => o.status === 'approved').length,
      deliveredOrders: orders.filter(o => o.status === 'delivered').length,
    }
    return success(data)
  }
}
