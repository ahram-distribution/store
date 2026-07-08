import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { createPhoneNumber } from '../../domain/value-objects/PhoneNumber'
import { createMoney } from '../../domain/value-objects/Money'
import { createCustomer } from '../../domain/models/customer'
import type { Customer } from '../../domain/models/customer'
import type { ICustomerProvider } from '../../providers/contracts/ICustomerProvider'
import type { Session } from '../../domain/models/identity'

export interface CreateCustomerCommand extends ICommand {
  readonly commandType: 'CreateCustomerCommand'
  readonly companyId: string
  readonly tradeName: string
  readonly fullName: string
  readonly phone: string
  readonly street: string
  readonly district: string
  readonly city: string
  readonly governorate: string
  readonly customerType: 'retail' | 'wholesale' | 'distributor'
  readonly creditLimit: number
  readonly session: Session
}

export class CreateCustomerHandler implements ICommandHandler<CreateCustomerCommand> {
  readonly commandType = 'CreateCustomerCommand' as const
  private customerProvider: ICustomerProvider

  constructor(deps: { customerProvider: ICustomerProvider }) {
    this.customerProvider = deps.customerProvider
  }

  async handle(command: CreateCustomerCommand): Promise<ApplicationResult> {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const phone = createPhoneNumber(command.phone)
    const address = { street: command.street, district: command.district, city: command.city, governorate: command.governorate }
    const creditLimit = createMoney(command.creditLimit)
    const customer = createCustomer(id, command.companyId, command.customerType, command.tradeName, command.fullName, phone, address, creditLimit)
    try {
      await this.customerProvider.registerNewCustomer(customer)
      return success(customer satisfies Customer)
    } catch (e) {
      return failure((e as Error).message, 'PERSISTENCE_ERROR')
    }
  }
}
