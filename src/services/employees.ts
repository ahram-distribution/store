import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export const employeeService = {
  async getAll(token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return supabase.rpc('get_governed_employees', { p_token: t })
  },
  async getById(id: string, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    return supabase.rpc('get_governed_employee', { p_token: t, p_id: id })
  },
  async getByRole(roleName: string, token?: string) {
    const t = token || getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    const { data: employees } = await supabase.rpc('get_governed_employees', { p_token: t })
    if (!employees) return { data: [], error: null }
    const arr = Array.isArray(employees) ? employees : []
    const filtered = arr.filter((e: any) =>
      Array.isArray(e.roles) && e.roles.some((r: any) => r.name === roleName)
    )
    return { data: filtered, error: null }
  },
  async getSubordinates(managerId: string) {
    const t = getToken()
    if (!t) return { data: null, error: new Error('NO_TOKEN') }
    const { data } = await supabase.rpc('get_governed_employees', { p_token: t })
    if (!data) return { data: null, error: null }
    const arr = Array.isArray(data) ? data : []
    return { data: arr.filter((e: any) => e.manager_id === managerId), error: null }
  },
}
