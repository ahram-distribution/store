import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { submitOrder } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { Session } from '../../domain/models/identity'

export interface SubmitOrderCommand extends ICommand {
  readonly commandType: 'SubmitOrderCommand'
  readonly orderId: string
  readonly session: Session
}

export class SubmitOrderHandler implements ICommandHandler<SubmitOrderCommand> {
  readonly commandType = 'SubmitOrderCommand' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(command: SubmitOrderCommand): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(command.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')
    try {
      const { order: submitted, event } = submitOrder(order)
      await this.salesOrderProvider.submitOrder(submitted)
      return success({ order: submitted, event })
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
