import type { Workday } from '../../domain/models/attendance'

export interface AttendanceDateRange {
  companyId: string
  from: Date
  to: Date
}

export interface IAttendanceProvider {
  startWorkday(workday: Workday): Promise<void>
  endWorkday(workdayId: string, checkOut: Date, latitude?: number, longitude?: number): Promise<void>

  getWorkdayById(id: string): Promise<Workday | null>
  getWorkdayByEmployeeAndDate(employeeId: string, date: Date): Promise<Workday | null>
  getWorkdayRange(companyId: string, from: Date, to: Date): Promise<Workday[]>
}
