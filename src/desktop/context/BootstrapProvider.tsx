import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createApp } from '../../bootstrap'
import type { BootstrapContext } from '../../bootstrap'
import { useAuthStore } from '../../store/auth'

const BootstrapCtx = createContext<BootstrapContext | null>(null)

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuthStore()

  const ctx = useMemo(() => {
    if (!token) return null
    return createApp({
      mode: 'legacy',
      context: {
        token,
        identityId: user?.identity_id || '',
        identityType: user?.identity_type || 'employee',
        companyId: '',
        roles: user?.roles || [],
        device: 'desktop',
      },
    })
  }, [token, user?.identity_id, user?.identity_type, user?.roles])

  if (!ctx) return null

  return <BootstrapCtx.Provider value={ctx}>{children}</BootstrapCtx.Provider>
}

export function useBootstrap(): BootstrapContext {
  const ctx = useContext(BootstrapCtx)
  if (!ctx) throw new Error('useBootstrap must be used within BootstrapProvider')
  return ctx
}
