import type { ICommand } from './ICommand'
import type { IQuery } from './IQuery'
import type { ApplicationResult } from '../results/ApplicationResult'

export interface IApplicationPipeline {
  executeCommand<TCommand extends ICommand>(
    command: TCommand,
  ): Promise<ApplicationResult>

  executeQuery<TQuery extends IQuery<TResult>, TResult>(
    query: TQuery,
  ): Promise<ApplicationResult<TResult>>
}
