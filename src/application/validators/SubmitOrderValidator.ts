import type { ICommand } from '../contracts/ICommand'
import type { IValidator } from '../contracts/IValidator'

export interface SubmitOrderValidatorInput extends ICommand {
  readonly orderId: string
}

export const submitOrderValidator: IValidator<SubmitOrderValidatorInput> = {
  ruleName: 'SubmitOrderValidator',
  validate(input) {
    const errors: Array<{ field: string; message: string }> = []
    if (!input.orderId) errors.push({ field: 'orderId', message: 'Order ID is required' })
    return errors
  },
}
