import { supabase } from '../../../lib/supabase'
import type { IAttendanceProvider } from '../../contracts/IAttendanceProvider'
import type { Workday } from '../../../domain/models/attendance'
import { AttendanceMapper } from '../../mappers/AttendanceMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'

const PROVIDER_NAME = 'LegacyAttendanceProvider'

export class LegacyAttendanceProvider implements IAttendanceProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async startWorkday(workday: Workday): Promise<void> {
    const lat = workday.checkInLocation?.latitude
    const lng = workday.checkInLocation?.longitude
    const { error } = await supabase.rpc('start_workday', {
      p_token: this.context.token,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_device_status: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async endWorkday(workdayId: string, checkOut: Date, latitude?: number, longitude?: number): Promise<void> {
    const { error } = await supabase.rpc('end_workday', {
      p_token: this.context.token,
      p_session_id: workdayId,
      p_latitude: latitude ?? null,
      p_longitude: longitude ?? null,
      p_device_status: null,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getWorkdayById(id: string): Promise<Workday | null> {
    const { data, error } = await supabase.rpc('get_my_workday_status', { p_token: this.context.token })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    if (data.session_id !== id) return null
    return AttendanceMapper.fromLegacyRow(data)
  }

  async getWorkdayByEmployeeAndDate(employeeId: string, date: Date): Promise<Workday | null> {
    const dateStr = date.toISOString().split('T')[0]
    const { data, error } = await supabase.rpc('get_employee_workday_history', {
      p_token: this.context.token,
      p_employee_id: employeeId,
      p_from: dateStr,
      p_to: dateStr,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    if (arr.length === 0) return null
    return AttendanceMapper.fromLegacyRow(arr[0])
  }

  async getWorkdayRange(companyId: string, from: Date, to: Date): Promise<Workday[]> {
    const fromStr = from.toISOString().split('T')[0]
    const toStr = to.toISOString().split('T')[0]
    const { data, error } = await supabase.rpc('get_workday_report', {
      p_token: this.context.token,
      p_from: fromStr,
      p_to: toStr,
    })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(AttendanceMapper.fromLegacyRow)
  }
}
