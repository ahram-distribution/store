import type { IProvider, HealthCheckResult, ProviderStatus } from '../../contracts/IProvider'
import type { IAttendanceProvider } from '../../contracts/IAttendanceProvider'
import type { Workday } from '../../../domain/models/attendance'
import { WorkdayStatus } from '../../../domain/enums/WorkdayStatus'

export class MockAttendanceProvider implements IAttendanceProvider, IProvider {
  readonly name = 'attendance'
  readonly status: ProviderStatus = 'connected'

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'connected', latencyMs: 0, message: 'Mock OK', timestamp: new Date() }
  }

  async startWorkday(workday: Workday): Promise<void> {
    return
  }

  async endWorkday(workdayId: string, checkOut: Date, latitude?: number, longitude?: number): Promise<void> {
    return
  }

  async getWorkdayById(id: string): Promise<Workday | null> {
    if (id === 'nonexistent') return null
    return {
      id,
      companyId: 'comp-1',
      employeeId: 'emp-1',
      date: new Date('2026-07-05'),
      status: WorkdayStatus.Active,
      checkIn: new Date('2026-07-05T08:00:00Z'),
      checkOut: null,
      checkInLocation: null,
      checkOutLocation: null,
      notes: null,
    }
  }

  async getWorkdayByEmployeeAndDate(employeeId: string, date: Date): Promise<Workday | null> {
    return {
      id: 'wd-1',
      companyId: 'comp-1',
      employeeId,
      date,
      status: WorkdayStatus.Active,
      checkIn: new Date('2026-07-05T08:00:00Z'),
      checkOut: null,
      checkInLocation: null,
      checkOutLocation: null,
      notes: null,
    }
  }

  async getWorkdayRange(companyId: string, from: Date, to: Date): Promise<Workday[]> {
    return []
  }
}
