import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { IValidator } from '../contracts/IValidator'
import type { IAuthorizationPolicy } from '../contracts/IAuthorizationPolicy'
import type { ICommand } from '../contracts/ICommand'
import type { IQuery } from '../contracts/IQuery'
import type { ApplicationResult } from '../results/ApplicationResult'
import {
  success, failure, validationFailure, authorizationFailure,
} from '../results/ApplicationResult'

export interface PipelineDependencies {
  validators: Map<string, IValidator>
  policies: Map<string, IAuthorizationPolicy>
  commandHandlers: Map<string, ICommandHandler<ICommand>>
  queryHandlers: Map<string, IQueryHandler<IQuery<unknown>, unknown>>
}

export function createPipeline(deps: PipelineDependencies) {
  return {
    async executeCommand<TCommand extends ICommand>(
      command: TCommand,
    ): Promise<ApplicationResult> {
      const validator = deps.validators.get(command.commandType)
      if (validator) {
        const errors = validator.validate(command)
        if (errors.length > 0) return validationFailure(errors)
      }

      const policy = deps.policies.get(command.commandType)
      if (policy) {
        const session = (command as Record<string, unknown>).session as { identityId: string } | undefined
        if (session) {
          const decision = policy.authorize(session as never)
          if (!decision.allowed) {
            return authorizationFailure(decision.reason ?? 'Access denied')
          }
        }
      }

      const handler = deps.commandHandlers.get(command.commandType)
      if (!handler) return failure(`No handler for command type: ${command.commandType}`, 'HANDLER_NOT_FOUND')

      return handler.handle(command)
    },

    async executeQuery<TQuery extends IQuery<TResult>, TResult>(
      query: TQuery,
    ): Promise<ApplicationResult<TResult>> {
      const handler = deps.queryHandlers.get(query.queryType)
      if (!handler) return failure(`No handler for query type: ${query.queryType}`, 'HANDLER_NOT_FOUND')
      return handler.handle(query) as Promise<ApplicationResult<TResult>>
    },
  }
}
