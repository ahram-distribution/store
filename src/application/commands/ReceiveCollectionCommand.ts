import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { createMoney } from '../../domain/value-objects/Money'
import { createCashPayment, createCheckPayment } from '../../domain/models/payment'
import { recordPayment } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { ICollectionProvider } from '../../providers/contracts/ICollectionProvider'
import type { Session } from '../../domain/models/identity'

export interface ReceiveCollectionCommand extends ICommand {
  readonly commandType: 'ReceiveCollectionCommand'
  readonly orderId: string
  readonly customerId: string
  readonly amount: number
  readonly paymentMethod: 'cash' | 'check'
  readonly checkNumber?: string
  readonly bankName?: string
  readonly checkDueDate?: string
  readonly session: Session
}

export class ReceiveCollectionHandler implements ICommandHandler<ReceiveCollectionCommand> {
  readonly commandType = 'ReceiveCollectionCommand' as const
  private salesOrderProvider: ISalesOrderProvider
  private collectionProvider: ICollectionProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider; collectionProvider: ICollectionProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
    this.collectionProvider = deps.collectionProvider
  }

  async handle(command: ReceiveCollectionCommand): Promise<ApplicationResult> {
    const order = await this.salesOrderProvider.getOrderById(command.orderId)
    if (!order) return failure('Order not found', 'NOT_FOUND')

    const paymentId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const amount = createMoney(command.amount)

    const tryRecord = () => {
      let payment
      if (command.paymentMethod === 'check') {
        payment = createCheckPayment(paymentId, command.orderId, command.customerId, amount, command.checkNumber ?? '', command.bankName ?? '', new Date(command.checkDueDate ?? Date.now()))
      } else {
        payment = createCashPayment(paymentId, command.orderId, command.customerId, amount)
      }
      const updatedOrder = recordPayment(order, amount)
      return { updatedOrder, payment }
    }

    try {
      const { updatedOrder, payment } = tryRecord()
      await this.salesOrderProvider.recordPayment(updatedOrder)
      if (command.paymentMethod === 'check') {
        await this.collectionProvider.receiveCheckPayment(payment)
      } else {
        await this.collectionProvider.receiveCashPayment(payment)
      }
      return success({ order: updatedOrder, payment })
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
