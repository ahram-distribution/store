import type { Workday } from '../../domain/models/attendance'
import { createGeoLocation } from '../../domain/value-objects/GeoLocation'
import { WorkdayStatus } from '../../domain/enums/WorkdayStatus'

export class AttendanceMapper {
  static fromLegacyRow(row: any): Workday {
    return {
      id: row.session_id ?? row.id,
      companyId: row.company_id ?? '',
      employeeId: row.employee_id ?? row.employeeId ?? '',
      date: new Date(row.date ?? row.started_at ?? row.created_at),
      status: (row.status === 'active' ? WorkdayStatus.Active : WorkdayStatus.Completed),
      checkIn: row.started_at ? new Date(row.started_at) : (row.check_in ? new Date(row.check_in) : null),
      checkOut: row.ended_at ? new Date(row.ended_at) : (row.check_out ? new Date(row.check_out) : null),
      checkInLocation: row.check_in_latitude ? createGeoLocation(
        Number(row.check_in_latitude),
        Number(row.check_in_longitude),
        Number(row.check_in_accuracy) || 0,
        new Date(row.check_in_captured_at ?? row.started_at),
      ) : null,
      checkOutLocation: row.check_out_latitude ? createGeoLocation(
        Number(row.check_out_latitude),
        Number(row.check_out_longitude),
        Number(row.check_out_accuracy) || 0,
        new Date(row.check_out_captured_at ?? row.ended_at),
      ) : null,
      notes: row.notes ?? row.close_reason ?? null,
    }
  }
}
