import type { AppConfig } from './ProviderConfig'
import { createProviderSet } from './ProviderFactory'
import type { ProviderSet } from './ProviderConfig'
import type { ICommand } from '../application/contracts/ICommand'
import type { IQuery } from '../application/contracts/IQuery'
import type { ICommandHandler } from '../application/contracts/ICommandHandler'
import type { IQueryHandler } from '../application/contracts/IQueryHandler'
import type { IValidator } from '../application/contracts/IValidator'
import type { IAuthorizationPolicy } from '../application/contracts/IAuthorizationPolicy'
import { createPipeline } from '../application/pipeline/ApplicationPipeline'
import { CreateOrderHandler } from '../application/commands/CreateOrderCommand'
import { SubmitOrderHandler } from '../application/commands/SubmitOrderCommand'
import { ApproveOrderHandler } from '../application/commands/ApproveOrderCommand'
import { RejectOrderHandler } from '../application/commands/RejectOrderCommand'
import { CancelOrderHandler } from '../application/commands/CancelOrderCommand'
import { CreateCustomerHandler } from '../application/commands/CreateCustomerCommand'
import { ReceiveCollectionHandler } from '../application/commands/ReceiveCollectionCommand'
import { StartWorkdayHandler } from '../application/commands/StartWorkdayCommand'
import { EndWorkdayHandler } from '../application/commands/EndWorkdayCommand'
import { ReserveCreditHandler } from '../application/commands/ReserveCreditCommand'
import { GetOrderHandler } from '../application/queries/GetOrderQuery'
import { GetCustomerHandler } from '../application/queries/GetCustomerQuery'
import { SearchProductsHandler } from '../application/queries/SearchProductsQuery'
import { GetInventoryHandler } from '../application/queries/GetInventoryQuery'
import { GetWorkdayHandler } from '../application/queries/GetWorkdayQuery'
import { GetSalesDashboardHandler } from '../application/queries/GetSalesDashboardQuery'
import { createOrderValidator } from '../application/validators/CreateOrderValidator'
import { submitOrderValidator } from '../application/validators/SubmitOrderValidator'
import { createCustomerValidator } from '../application/validators/CreateCustomerValidator'
import { receiveCollectionValidator } from '../application/validators/ReceiveCollectionValidator'
import { approveOrderPolicy } from '../application/policies/ApproveOrderPolicy'
import { createOrderPolicy } from '../application/policies/CreateOrderPolicy'
import { collectionPolicy } from '../application/policies/CollectionPolicy'
import { attendancePolicy } from '../application/policies/AttendancePolicy'

export interface ApplicationApi {
  pipeline: ReturnType<typeof createPipeline>
  providers: ProviderSet
}

export function composeApplication(config: AppConfig): ApplicationApi {
  const providers = createProviderSet(config.backend, config.context)

  const commandHandlers = new Map<string, ICommandHandler<ICommand>>()
  const queryHandlers = new Map<string, IQueryHandler<IQuery<unknown>, unknown>>()
  const validators = new Map<string, IValidator>()
  const policies = new Map<string, IAuthorizationPolicy>()

  commandHandlers.set('CreateOrderCommand', new CreateOrderHandler({ salesOrderProvider: providers.salesOrder }))
  commandHandlers.set('SubmitOrderCommand', new SubmitOrderHandler({ salesOrderProvider: providers.salesOrder }))
  commandHandlers.set('ApproveOrderCommand', new ApproveOrderHandler({ salesOrderProvider: providers.salesOrder }))
  commandHandlers.set('RejectOrderCommand', new RejectOrderHandler({ salesOrderProvider: providers.salesOrder }))
  commandHandlers.set('CancelOrderCommand', new CancelOrderHandler({ salesOrderProvider: providers.salesOrder }))
  commandHandlers.set('CreateCustomerCommand', new CreateCustomerHandler({ customerProvider: providers.customer }))
  commandHandlers.set('ReceiveCollectionCommand', new ReceiveCollectionHandler({
    salesOrderProvider: providers.salesOrder,
    collectionProvider: providers.collection,
  }))
  commandHandlers.set('StartWorkdayCommand', new StartWorkdayHandler({ attendanceProvider: providers.attendance }))
  commandHandlers.set('EndWorkdayCommand', new EndWorkdayHandler({ attendanceProvider: providers.attendance }))
  commandHandlers.set('ReserveCreditCommand', new ReserveCreditHandler({ customerProvider: providers.customer }))

  queryHandlers.set('GetOrderQuery', new GetOrderHandler({ salesOrderProvider: providers.salesOrder }))
  queryHandlers.set('GetCustomerQuery', new GetCustomerHandler({ customerProvider: providers.customer }))
  queryHandlers.set('SearchProductsQuery', new SearchProductsHandler({ productCatalogProvider: providers.productCatalog }))
  queryHandlers.set('GetInventoryQuery', new GetInventoryHandler({ inventoryProvider: providers.inventory }))
  queryHandlers.set('GetWorkdayQuery', new GetWorkdayHandler({ attendanceProvider: providers.attendance }))
  queryHandlers.set('GetSalesDashboardQuery', new GetSalesDashboardHandler({ salesOrderProvider: providers.salesOrder }))

  validators.set('CreateOrderCommand', createOrderValidator)
  validators.set('SubmitOrderCommand', submitOrderValidator)
  validators.set('CreateCustomerCommand', createCustomerValidator)
  validators.set('ReceiveCollectionCommand', receiveCollectionValidator)

  policies.set('ApproveOrderCommand', approveOrderPolicy)
  policies.set('CreateOrderCommand', createOrderPolicy)
  policies.set('ReceiveCollectionCommand', collectionPolicy)
  policies.set('StartWorkdayCommand', attendancePolicy)
  policies.set('EndWorkdayCommand', attendancePolicy)

  const pipeline = createPipeline({ validators, policies, commandHandlers, queryHandlers })

  return { pipeline, providers }
}
