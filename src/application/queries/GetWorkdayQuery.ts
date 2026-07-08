import type { IQuery } from '../contracts/IQuery'
import type { IQueryHandler } from '../contracts/IQueryHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import type { IAttendanceProvider } from '../../providers/contracts/IAttendanceProvider'

export interface GetWorkdayQuery extends IQuery {
  readonly queryType: 'GetWorkdayQuery'
  readonly employeeId: string
  readonly date: string
}

export class GetWorkdayHandler implements IQueryHandler<GetWorkdayQuery, import('../../domain/models/attendance').Workday> {
  readonly queryType = 'GetWorkdayQuery' as const
  private attendanceProvider: IAttendanceProvider

  constructor(deps: { attendanceProvider: IAttendanceProvider }) {
    this.attendanceProvider = deps.attendanceProvider
  }

  async handle(query: GetWorkdayQuery): Promise<ApplicationResult> {
    const workday = await this.attendanceProvider.getWorkdayByEmployeeAndDate(query.employeeId, new Date(query.date))
    if (!workday) return failure('Workday not found', 'NOT_FOUND')
    return success(workday)
  }
}
