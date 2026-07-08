import type { ICommand } from '../contracts/ICommand'
import type { ICommandHandler } from '../contracts/ICommandHandler'
import type { ApplicationResult } from '../results/ApplicationResult'
import { success, failure } from '../results/ApplicationResult'
import { endWorkday } from '../../domain/models/attendance'
import type { IAttendanceProvider } from '../../providers/contracts/IAttendanceProvider'
import type { Session } from '../../domain/models/identity'

export interface EndWorkdayCommand extends ICommand {
  readonly commandType: 'EndWorkdayCommand'
  readonly workdayId: string
  readonly latitude?: number
  readonly longitude?: number
  readonly session: Session
}

export class EndWorkdayHandler implements ICommandHandler<EndWorkdayCommand> {
  readonly commandType = 'EndWorkdayCommand' as const
  private attendanceProvider: IAttendanceProvider

  constructor(deps: { attendanceProvider: IAttendanceProvider }) {
    this.attendanceProvider = deps.attendanceProvider
  }

  async handle(command: EndWorkdayCommand): Promise<ApplicationResult> {
    const workday = await this.attendanceProvider.getWorkdayById(command.workdayId)
    if (!workday) return failure('Workday not found', 'NOT_FOUND')
    try {
      const location = command.latitude !== undefined && command.longitude !== undefined
        ? { latitude: command.latitude, longitude: command.longitude, accuracy: 0, timestamp: new Date() }
        : undefined
      const updated = endWorkday(workday, location)
      await this.attendanceProvider.endWorkday(updated.id, updated.checkOut!, command.latitude, command.longitude)
      return success(updated)
    } catch (e) {
      return failure((e as Error).message, 'DOMAIN_ERROR')
    }
  }
}
