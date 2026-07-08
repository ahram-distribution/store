import type { ICommand } from '../contracts/ICommand'
import type { IValidator } from '../contracts/IValidator'

export interface CreateOrderValidatorInput extends ICommand {
  readonly companyId: string
  readonly customerId: string
  readonly customerName: string
  readonly salesRepId: string
  readonly lines: ReadonlyArray<{
    productId: string
    productName: string
    unitType: string
    unitPrice: number
    quantity: number
  }>
  readonly discount?: number
}

export const createOrderValidator: IValidator<CreateOrderValidatorInput> = {
  ruleName: 'CreateOrderValidator',
  validate(input) {
    const errors: Array<{ field: string; message: string }> = []
    if (!input.companyId) errors.push({ field: 'companyId', message: 'Company is required' })
    if (!input.customerId) errors.push({ field: 'customerId', message: 'Customer is required' })
    if (!input.customerName) errors.push({ field: 'customerName', message: 'Customer name is required' })
    if (!input.salesRepId) errors.push({ field: 'salesRepId', message: 'Sales rep is required' })
    if (!input.lines || input.lines.length === 0) {
      errors.push({ field: 'lines', message: 'Order must have at least one line' })
    } else {
      input.lines.forEach((line, i) => {
        if (!line.productId) errors.push({ field: `lines[${i}].productId`, message: 'Product is required' })
        if (!line.productName) errors.push({ field: `lines[${i}].productName`, message: 'Product name is required' })
        if (line.unitPrice <= 0) errors.push({ field: `lines[${i}].unitPrice`, message: 'Unit price must be positive' })
        if (line.quantity <= 0) errors.push({ field: `lines[${i}].quantity`, message: 'Quantity must be positive' })
      })
    }
    if (input.discount !== undefined && input.discount < 0) {
      errors.push({ field: 'discount', message: 'Discount cannot be negative' })
    }
    return errors
  },
}
