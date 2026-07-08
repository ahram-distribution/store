import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { cancelOrder } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { Session } from '../../domain/models/identity'

export interface CancelOrderCommand extends ICommand {
  readonly commandType: 'CancelOrderCommand'
  readonly orderId: string
  readonly session: Session
}

export class CancelOrderHandler implements ICommandHandler<CancelOrderCommand> {
  readonly commandType = 'CancelOrderCommand' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(command: CancelOrderCommand): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(command.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')
    try {
      const { order: cancelled, event } = cancelOrder(order)
      await this.salesOrderProvider.cancelOrder(cancelled.id)
      return success({ order: cancelled, event })
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
