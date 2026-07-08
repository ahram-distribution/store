import type { IAttendanceProvider } from '../../contracts/IAttendanceProvider'
import type { Workday } from '../../../domain/models/attendance'
import { AttendanceMapper } from '../../mappers/AttendanceMapper'
import { ProviderException } from '../../contracts/exceptions'
import type { RequestContext } from '../../contracts/RequestContext'
import { supabase } from './client'

const PROVIDER_NAME = 'SupabaseAttendanceProvider'

export class SupabaseAttendanceProvider implements IAttendanceProvider {
  private context: RequestContext

  constructor(context: RequestContext) {
    this.context = context
  }

  async startWorkday(workday: Workday): Promise<void> {
    const lat = workday.checkInLocation?.latitude
    const lng = workday.checkInLocation?.longitude
    const { error } = await supabase
      .from('workday_sessions')
      .insert({
        company_id: workday.companyId,
        employee_id: workday.employeeId,
        date: workday.date.toISOString().split('T')[0],
        status: 'active',
        started_at: workday.checkIn?.toISOString() ?? new Date().toISOString(),
        check_in_latitude: lat ?? null,
        check_in_longitude: lng ?? null,
        notes: workday.notes ?? null,
      })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async endWorkday(workdayId: string, checkOut: Date, latitude?: number, longitude?: number): Promise<void> {
    const { error } = await supabase
      .from('workday_sessions')
      .update({
        status: 'completed',
        ended_at: checkOut.toISOString(),
        check_out_latitude: latitude ?? null,
        check_out_longitude: longitude ?? null,
      })
      .eq('session_id', workdayId)
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
  }

  async getWorkdayById(id: string): Promise<Workday | null> {
    const { data, error } = await supabase
      .from('workday_sessions')
      .select('*')
      .eq('session_id', id)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return AttendanceMapper.fromLegacyRow(data)
  }

  async getWorkdayByEmployeeAndDate(employeeId: string, date: Date): Promise<Workday | null> {
    const dateStr = date.toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('workday_sessions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', dateStr)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    if (!data) return null
    return AttendanceMapper.fromLegacyRow(data)
  }

  async getWorkdayRange(companyId: string, from: Date, to: Date): Promise<Workday[]> {
    const fromStr = from.toISOString().split('T')[0]
    const toStr = to.toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('workday_sessions')
      .select('*')
      .gte('date', fromStr)
      .lte('date', toStr)
      .order('started_at', { ascending: false })
    if (error) throw new ProviderException(error.message, PROVIDER_NAME, error)
    const arr = Array.isArray(data) ? data : []
    return arr.map(AttendanceMapper.fromLegacyRow)
  }
}
