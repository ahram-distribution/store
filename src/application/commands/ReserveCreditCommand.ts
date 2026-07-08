import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { createMoney } from '../../domain/value-objects/Money'
import { createCredit, applyCredit } from '../../domain/models/credit'
import type { ICustomerProvider } from '../../providers/contracts/ICustomerProvider'
import type { Session } from '../../domain/models/identity'

export interface ReserveCreditCommand extends ICommand {
  readonly commandType: 'ReserveCreditCommand'
  readonly customerId: string
  readonly amount: number
  readonly reason: string
  readonly session: Session
}

export class ReserveCreditHandler implements ICommandHandler<ReserveCreditCommand> {
  readonly commandType = 'ReserveCreditCommand' as const
  private customerProvider: ICustomerProvider

  constructor(deps: { customerProvider: ICustomerProvider }) {
    this.customerProvider = deps.customerProvider
  }

  async handle(command: ReserveCreditCommand): Promise<ApplicationResult> {
    const customer = await this.customerProvider.getCustomerById(command.customerId)
    if (!customer) return failure('Customer not found', 'NOT_FOUND')
    try {
      const credit = createCredit(command.customerId, customer.creditLimit)
      const updated = applyCredit(command.customerId, credit, createMoney(command.amount), command.reason)
      return success(updated)
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
