interface LocalSessionResult {
  valid: boolean
  identity_id?: string
  identity_type?: string
  employee_id?: string
  customer_id?: string
  full_name?: string
  code?: string
  roles?: string[]
  expires_at?: string
  error?: string
}

function getApi() {
  const api = (window as any).api?.auth
  if (!api) throw new Error('Desktop auth API not available')
  return api
}

interface DesktopLoginResult {
  success: boolean
  token?: string
  identity_id?: string
  identity_type?: 'employee' | 'customer'
  employee?: { id: string; full_name: string; code: string; manager_id: string | null }
  roles?: string[]
  error?: string
}

interface DesktopOfflineStatus {
  healthy: boolean
  offlineReady: boolean
  lastSyncAt: string | null
  syncing: boolean
  error?: string
}

export const desktopAuth = {
  async localLogin(phone: string, password: string): Promise<DesktopLoginResult> {
    return getApi().localLogin(phone, password)
  },

  async offlineStatus(): Promise<DesktopOfflineStatus> {
    return getApi().offlineStatus()
  },

  async localValidateSession(token: string): Promise<LocalSessionResult> {
    return getApi().validateSession(token)
  },

  async localCreateSession(params: {
    token: string
    identity_id: string
    employee_id?: string | null
    customer_id?: string | null
    identity_type: string
    phone: string
    password: string
    full_name?: string
    code?: string
  }): Promise<{ success: boolean; error?: string }> {
    return getApi().createSession(params)
  },

  async localDeleteSession(token: string): Promise<{ success: boolean; error?: string }> {
    return getApi().deleteSession(token)
  },
}
