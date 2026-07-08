export interface IValidator<TInput = unknown> {
  readonly ruleName: string
  validate(input: TInput): ReadonlyArray<{ field: string; message: string }>
}
