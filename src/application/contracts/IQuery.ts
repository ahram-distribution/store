export interface IQuery<TResult = unknown> {
  readonly queryId: string
  readonly queryType: string
  readonly correlationId?: string
}
