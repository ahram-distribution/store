export type ApplicationResult<T = unknown> =
  | SuccessResult<T>
  | FailureResult
  | ValidationFailureResult
  | AuthorizationFailureResult
  | ConflictResult

export interface SuccessResult<T = unknown> {
  readonly type: 'success'
  readonly data: T
}

export interface FailureResult {
  readonly type: 'failure'
  readonly message: string
  readonly code: string
}

export interface ValidationFailureResult {
  readonly type: 'validation_failure'
  readonly errors: ReadonlyArray<{ field: string; message: string }>
}

export interface AuthorizationFailureResult {
  readonly type: 'authorization_failure'
  readonly message: string
}

export interface ConflictResult {
  readonly type: 'conflict'
  readonly message: string
  readonly currentState?: unknown
}

export function success<T>(data: T): SuccessResult<T> {
  return { type: 'success', data }
}

export function failure(message: string, code: string = 'APPLICATION_ERROR'): FailureResult {
  return { type: 'failure', message, code }
}

export function validationFailure(errors: ReadonlyArray<{ field: string; message: string }>): ValidationFailureResult {
  return { type: 'validation_failure', errors }
}

export function authorizationFailure(message: string): AuthorizationFailureResult {
  return { type: 'authorization_failure', message }
}

export function conflict(message: string, currentState?: unknown): ConflictResult {
  return { type: 'conflict', message, currentState }
}

export function isSuccess<T>(r: ApplicationResult<T>): r is SuccessResult<T> {
  return r.type === 'success'
}

export function isFailure(r: ApplicationResult): r is FailureResult {
  return r.type === 'failure'
}

export function isValidationFailure(r: ApplicationResult): r is ValidationFailureResult {
  return r.type === 'validation_failure'
}

export function isAuthorizationFailure(r: ApplicationResult): r is AuthorizationFailureResult {
  return r.type === 'authorization_failure'
}

export function isConflict(r: ApplicationResult): r is ConflictResult {
  return r.type === 'conflict'
}
