import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import type { IInventoryProvider } from '../../providers/contracts/IInventoryProvider'

export interface GetInventoryQuery extends IQuery {
  readonly queryType: 'GetInventoryQuery'
  readonly productId: string
}

export class GetInventoryHandler implements IQueryHandler<GetInventoryQuery, import('../../domain/models/inventory').InventoryRecord> {
  readonly queryType = 'GetInventoryQuery' as const
  private inventoryProvider: IInventoryProvider

  constructor(deps: { inventoryProvider: IInventoryProvider }) {
    this.inventoryProvider = deps.inventoryProvider
  }

  async handle(query: GetInventoryQuery): Promise<ApplicationResult> {
    const record = await this.inventoryProvider.getInventoryLevel(query.productId)
    if (!record) return failure('Inventory record not found', 'NOT_FOUND')
    return success(record)
  }
}
