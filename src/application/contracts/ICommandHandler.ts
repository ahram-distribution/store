import type { ICommand } from './ICommand'
import type { ApplicationResult } from '../results/ApplicationResult'

export interface ICommandHandler<TCommand extends ICommand> {
  readonly commandType: string
  handle(command: TCommand): Promise<ApplicationResult>
}
