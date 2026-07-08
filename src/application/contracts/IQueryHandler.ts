import type { IQuery } from './IQuery'
import type { ApplicationResult } from '../results/ApplicationResult'

export interface IQueryHandler<TQuery extends IQuery<TResult>, TResult> {
  readonly queryType: string
  handle(query: TQuery): Promise<ApplicationResult>
}
