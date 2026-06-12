import { create } from 'zustand'
import { authService, type RegisterParams } from '../services/auth'

interface SessionUser {
  identity_id: string
  identity_type: 'employee' | 'customer'
  employee_id?: string
  customer_id?: string
  full_name?: string
  company_name?: string
  code?: string
  roles: string[]
}

interface AuthState {
  user: SessionUser | null
  token: string | null
  loading: boolean
  login: (phone: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (params: RegisterParams) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,

  login: async (phone: string, password: string) => {
    const result = await authService.login(phone, password)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const token = result.token!
    localStorage.setItem('session_token', token)

    const user: SessionUser = {
      identity_id: '',
      identity_type: result.identity_type!,
      roles: result.roles || [],
    }

    if (result.identity_type === 'employee' && result.employee) {
      user.employee_id = result.employee.id
      user.full_name = result.employee.full_name
      user.code = result.employee.code
    } else if (result.customer) {
      user.customer_id = result.customer.id
      user.company_name = result.customer.company_name
      user.full_name = result.customer.company_name
    }

    set({ user, token, loading: false })
    return { success: true }
  },

  register: async (params: RegisterParams) => {
    const result = await authService.register(params)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const token = result.token!
    localStorage.setItem('session_token', token)

    const user: SessionUser = {
      identity_id: '',
      identity_type: 'customer',
      roles: [],
    }

    if (result.customer) {
      user.customer_id = result.customer.id
      user.company_name = result.customer.company_name
      user.full_name = result.customer.company_name
    }

    set({ user, token, loading: false })
    return { success: true }
  },

  logout: async () => {
    const { token } = get()
    if (token) {
      try { await authService.logout(token) } catch { /* ignore */ }
    }
    localStorage.removeItem('session_token')
    set({ user: null, token: null })
  },

  restoreSession: async () => {
    const token = localStorage.getItem('session_token')
    if (!token) {
      set({ loading: false })
      return
    }

    try {
      const result = await authService.validateSession(token)
      if (!result.valid) {
        localStorage.removeItem('session_token')
        set({ user: null, token: null, loading: false })
        return
      }

      const user: SessionUser = {
        identity_id: result.identity_id!,
        identity_type: result.identity_type!,
        roles: result.roles || [],
      }

      if (result.identity_type === 'employee') {
        user.employee_id = result.employee_id
        user.full_name = result.full_name
        user.code = result.code
      } else {
        user.customer_id = result.customer_id
        user.company_name = result.company_name
        user.full_name = result.company_name
      }

      set({ user, token, loading: false })
    } catch {
      localStorage.removeItem('session_token')
      set({ user: null, token: null, loading: false })
    }
  },
}))
