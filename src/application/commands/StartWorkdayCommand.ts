import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { startWorkday } from '../../domain/models/attendance'
import type { Workday } from '../../domain/models/attendance'
import type { IAttendanceProvider } from '../../providers/contracts/IAttendanceProvider'
import type { Session } from '../../domain/models/identity'

export interface StartWorkdayCommand extends ICommand {
  readonly commandType: 'StartWorkdayCommand'
  readonly companyId: string
  readonly employeeId: string
  readonly date: string
  readonly latitude?: number
  readonly longitude?: number
  readonly session: Session
}

export class StartWorkdayHandler implements ICommandHandler<StartWorkdayCommand> {
  readonly commandType = 'StartWorkdayCommand' as const
  private attendanceProvider: IAttendanceProvider

  constructor(deps: { attendanceProvider: IAttendanceProvider }) {
    this.attendanceProvider = deps.attendanceProvider
  }

  async handle(command: StartWorkdayCommand): Promise<ApplicationResult> {
    const existing = await this.attendanceProvider.getWorkdayByEmployeeAndDate(command.employeeId, new Date(command.date))
    if (existing && existing.status === 'active') return failure('Workday already active for this date', 'CONFLICT')

    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const location = command.latitude !== undefined && command.longitude !== undefined
      ? { latitude: command.latitude, longitude: command.longitude, accuracy: 0, timestamp: new Date() }
      : undefined
    const workday = startWorkday(id, command.companyId, command.employeeId, new Date(command.date), location)
    try {
      await this.attendanceProvider.startWorkday(workday)
      return success(workday satisfies Workday)
    } catch (e) {
      return failure((e as Error).message, 'PERSISTENCE_ERROR')
    }
  }
}
