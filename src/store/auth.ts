import { create } from 'zustand'
import { authService, type RegisterParams } from '../services/auth'
import { storageRead, storageWrite, storageRemove } from '../utils/safeStorage'
import { desktopAuth } from '../services/desktopAuth'

const isDesktop = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

export interface SessionUser {
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
  sessionExpired: boolean
  login: (phone: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (params: RegisterParams) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
  clearSessionExpired: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,
  sessionExpired: false,

  login: async (phone: string, password: string) => {
    if (isDesktop) {
      const desktopResult = await desktopAuth.localLogin(phone, password)
      if (!desktopResult.success) {
        return { success: false, error: desktopResult.error }
      }

      const token = desktopResult.token!
      storageWrite('session_token', token)

      const user: SessionUser = {
        identity_id: desktopResult.identity_id || '',
        identity_type: desktopResult.identity_type || 'employee',
        roles: desktopResult.roles || [],
      }

      if (desktopResult.identity_type === 'employee' && desktopResult.employee) {
        user.employee_id = desktopResult.employee.id
        user.full_name = desktopResult.employee.full_name
        user.code = desktopResult.employee.code
      }

      set({ user, token, loading: false })
      return { success: true }
    }

    const result = await authService.login(phone, password)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const token = result.token!
    storageWrite('session_token', token)

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

    if (isDesktop) {
      try {
        const r = await desktopAuth.localCreateSession({
          token,
          identity_id: result.identity_id || '',
          employee_id: result.employee?.id || null,
          customer_id: result.customer?.id || null,
          identity_type: result.identity_type || 'employee',
          phone,
          password,
          full_name: result.employee?.full_name || result.customer?.company_name || '',
          code: result.employee?.code || result.customer?.code || '',
        })
        if (!r.success) console.error('[auth] local session bootstrap failed:', r.error)
      } catch (e) {
        console.error('[auth] local session bootstrap threw:', e)
      }
    }

    return { success: true }
  },

  register: async (params: RegisterParams) => {
    const result = await authService.register(params)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const token = result.token!
    storageWrite('session_token', token)

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

    if (isDesktop) {
      try {
        const r = await desktopAuth.localCreateSession({
          token,
          identity_id: result.identity_id || '',
          customer_id: result.customer?.id || null,
          identity_type: 'customer',
          phone: params.phone,
          password: params.password,
          full_name: result.customer?.company_name || '',
          code: result.customer?.code || '',
        })
        if (!r.success) console.error('[auth] register local session bootstrap failed:', r.error)
      } catch (e) {
        console.error('[auth] register local session bootstrap threw:', e)
      }
    }

    return { success: true }
  },

  logout: async () => {
    const { token } = get()
    if (token) {
      try { await authService.logout(token) } catch { /* ignore */ }
      if (isDesktop) {
        try { await desktopAuth.localDeleteSession(token) } catch { /* ignore */ }
      }
    }
    storageRemove('session_token')
    set({ user: null, token: null, sessionExpired: false })
  },

  clearSessionExpired: () => {
    set({ sessionExpired: false })
  },

  restoreSession: async () => {
    if (isDesktop) {
      storageRemove('session_token')
      set({ user: null, token: null, loading: false, sessionExpired: false })
      return
    }

    const token = storageRead('session_token')
    if (!token) {
      set({ loading: false })
      return
    }

    try {
      const result = await authService.validateSession(token)
      if (!result.valid) {
        storageRemove('session_token')
        set({ user: null, token: null, loading: false, sessionExpired: true })
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
      storageRemove('session_token')
      set({ user: null, token: null, loading: false, sessionExpired: true })
    }
  },
}))
