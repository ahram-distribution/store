import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { createMoney } from '../../domain/value-objects/Money'
import { createSalesOrder, createOrderLine } from '../../domain/models/salesOrder'
import type { SalesOrder } from '../../domain/models/salesOrder'
import type { ISalesOrderProvider } from '../../providers/contracts/ISalesOrderProvider'
import type { Session } from '../../domain/models/identity'

export interface CreateOrderCommand extends ICommand {
  readonly commandType: 'CreateOrderCommand'
  readonly companyId: string
  readonly customerId: string
  readonly customerName: string
  readonly salesRepId: string
  readonly lines: ReadonlyArray<{
    productId: string
    productName: string
    unitType: 'carton' | 'piece' | 'dozen'
    unitPrice: number
    quantity: number
  }>
  readonly discount?: number
  readonly notes?: string | null
  readonly session: Session
}

export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  readonly commandType = 'CreateOrderCommand' as const
  private salesOrderProvider: ISalesOrderProvider

  constructor(deps: { salesOrderProvider: ISalesOrderProvider }) {
    this.salesOrderProvider = deps.salesOrderProvider
  }

  async handle(command: CreateOrderCommand): Promise<ApplicationResult> {
    const orderId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const domainLines = command.lines.map(l =>
      createOrderLine(
        crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        l.productId,
        l.productName,
        l.unitType,
        createMoney(l.unitPrice),
        l.quantity,
      ),
    )
    const discount = command.discount !== undefined ? createMoney(command.discount) : undefined
    const order = createSalesOrder(
      orderId,
      command.companyId,
      command.customerId,
      command.customerName,
      command.salesRepId,
      domainLines,
      discount,
      command.notes,
    )
    try {
      await this.salesOrderProvider.placeNewOrder(order)
      return success(order satisfies SalesOrder)
    } catch (e) {
      return failure((e as Error).message, 'PERSISTENCE_ERROR')
    }
  }
}
