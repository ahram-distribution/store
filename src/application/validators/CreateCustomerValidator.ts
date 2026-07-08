import type { ICommand } from '../contracts/ICommand'
import type { IValidator } from '../contracts/IValidator'

export interface CreateCustomerValidatorInput extends ICommand {
  readonly tradeName: string
  readonly fullName: string
  readonly phone: string
  readonly street: string
  readonly district: string
  readonly city: string
  readonly governorate: string
  readonly creditLimit: number
}

export const createCustomerValidator: IValidator<CreateCustomerValidatorInput> = {
  ruleName: 'CreateCustomerValidator',
  validate(input) {
    const errors: Array<{ field: string; message: string }> = []
    if (!input.tradeName) errors.push({ field: 'tradeName', message: 'Trade name is required' })
    if (!input.fullName) errors.push({ field: 'fullName', message: 'Full name is required' })
    if (!input.phone) errors.push({ field: 'phone', message: 'Phone is required' })
    if (!input.city) errors.push({ field: 'city', message: 'City is required' })
    if (input.creditLimit < 0) errors.push({ field: 'creditLimit', message: 'Credit limit cannot be negative' })
    return errors
  },
}
