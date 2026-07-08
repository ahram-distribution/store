export interface ICommand {
  readonly commandId: string
  readonly commandType: string
  readonly correlationId?: string
  readonly timestamp: Date
}
