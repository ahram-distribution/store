import { supabase } from '../lib/supabase'

interface CustomerInfo {
  id: string
  company_name: string
  code: string
  business_type?: string
}

interface LoginResult {
  success: boolean
  token?: string
  identity_type?: 'employee' | 'customer'
  employee?: { id: string; full_name: string; code: string; manager_id: string | null }
  customer?: CustomerInfo
  roles?: string[]
  expires_at?: string
  error?: string
}

interface SessionResult {
  valid: boolean
  identity_id?: string
  identity_type?: 'employee' | 'customer'
  employee_id?: string
  customer_id?: string
  full_name?: string
  company_name?: string
  code?: string
  roles?: string[]
  expires_at?: string
}

export interface RegisterParams {
  phone: string
  password: string
  companyName: string
  responsibleName: string
  businessType: string
  latitude: number
  longitude: number
  accuracyMeters: number
  formattedAddress?: string
  email?: string
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  console.log(`[rpc] calling ${fn} with args:`, JSON.stringify(args))
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    console.error(`[rpc] ${fn} FAILED — Supabase error:`, JSON.stringify(error))
    throw error
  }
  console.log(`[rpc] ${fn} response:`, JSON.stringify(data))
  if (data && typeof data === 'object' && 'error' in data && typeof (data as any).error === 'string') {
    console.log(`[rpc] ${fn} error field char codes:`, Array.from((data as any).error).map((c: string) => c.codePointAt(0)))
  }
  return data as T
}

export const authService = {
  async login(phone: string, password: string): Promise<LoginResult> {
    const result = await rpc<LoginResult>('login', { p_phone: phone, p_password: password })
    return result
  },

  async logout(token: string): Promise<void> {
    await rpc('logout', { p_token: token })
  },

  async validateSession(token: string): Promise<SessionResult> {
    const result = await rpc<SessionResult>('validate_session', { p_token: token })
    return result
  },

  async checkCapability(token: string, code: string): Promise<boolean> {
    const result = await rpc<boolean>('check_capability', { p_token: token, p_code: code })
    return result
  },

  async register(params: RegisterParams): Promise<LoginResult> {
    const result = await rpc<LoginResult>('register_customer', {
      p_phone: params.phone,
      p_password: params.password,
      p_company_name: params.companyName,
      p_responsible_name: params.responsibleName,
      p_business_type: params.businessType,
      p_latitude: params.latitude,
      p_longitude: params.longitude,
      p_accuracy_meters: params.accuracyMeters,
      p_formatted_address: params.formattedAddress || null,
      p_email: params.email || null,
    })
    return result
  },
}

export async function requireCapability(code: string): Promise<boolean> {
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  if (!token) return false
  return authService.checkCapability(token, code)
}
