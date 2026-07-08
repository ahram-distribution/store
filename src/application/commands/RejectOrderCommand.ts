import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { rejectOrder } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { Session } from '../../domain/models/identity'

export interface RejectOrderCommand extends ICommand {
  readonly commandType: 'RejectOrderCommand'
  readonly orderId: string
  readonly reason: string
  readonly session: Session
}

export class RejectOrderHandler implements ICommandHandler<RejectOrderCommand> {
  readonly commandType = 'RejectOrderCommand' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(command: RejectOrderCommand): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(command.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')
    try {
      const { order: rejected, event } = rejectOrder(order, command.reason)
      await this.salesOrderProvider.rejectOrder(rejected.id, command.reason)
      return success({ order: rejected, event })
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
