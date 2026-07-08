import type { ICommand } from '../contracts/ICommand'
import type { IValidator } from '../contracts/IValidator'

export interface ReceiveCollectionValidatorInput extends ICommand {
  readonly orderId: string
  readonly amount: number
  readonly paymentMethod: string
  readonly checkNumber?: string
}

export const receiveCollectionValidator: IValidator<ReceiveCollectionValidatorInput> = {
  ruleName: 'ReceiveCollectionValidator',
  validate(input) {
    const errors: Array<{ field: string; message: string }> = []
    if (!input.orderId) errors.push({ field: 'orderId', message: 'Order ID is required' })
    if (input.amount <= 0) errors.push({ field: 'amount', message: 'Amount must be positive' })
    if (!input.paymentMethod) errors.push({ field: 'paymentMethod', message: 'Payment method is required' })
    if (input.paymentMethod === 'check' && !input.checkNumber) {
      errors.push({ field: 'checkNumber', message: 'Check number is required for check payments' })
    }
    return errors
  },
}
