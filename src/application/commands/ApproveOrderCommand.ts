import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { reviewOrder, approveOrder } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { Session } from '../../domain/models/identity'

export interface ApproveOrderCommand extends ICommand {
  readonly commandType: 'ApproveOrderCommand'
  readonly orderId: string
  readonly session: Session
}

export class ApproveOrderHandler implements ICommandHandler<ApproveOrderCommand> {
  readonly commandType = 'ApproveOrderCommand' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(command: ApproveOrderCommand): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(command.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')
    try {
      const { order: reviewed } = reviewOrder(order)
      const { order: approved, event } = approveOrder(reviewed)
      await this.salesOrderProvider.approveOrder(approved)
      return success({ order: approved, event })
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
