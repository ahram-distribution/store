import { useState, useEffect } from 'react'
import { authService } from '../services/auth'
import { useAuthStore } from '../store/auth'
import { isUpperManagement } from '../utils/roleNormalization'

const UPPER_MGMT_CODES = new Set(['ADMIN-001', 'WRQ1006', 'WRQ1003', 'WRQ1002', 'WRQ1004'])

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const cache = new Map<string, { value: boolean; expiry: number }>()

const CACHE_TTL = 5 * 60 * 1000

function isUpperManagementUser(): boolean {
  const user = useAuthStore.getState().user
  if (!user) return false
  if (UPPER_MGMT_CODES.has(user.code ?? '')) return true
  return user.roles?.some((r: string) => isUpperManagement(r)) ?? false
}

export function useCapability(code: string | null | undefined): boolean {
  const [result, setResult] = useState<boolean>(false)

  useEffect(() => {
    if (!code) {
      setResult(true)
      return
    }

    const cached = cache.get(code)
    if (cached && cached.expiry > Date.now()) {
      setResult(cached.value)
      return
    }

    if (isUpperManagementUser()) {
      setResult(true)
      return
    }

    const token = getToken()
    if (!token) {
      setResult(false)
      return
    }

    authService.checkCapability(token, code).then((ok) => {
      cache.set(code, { value: ok, expiry: Date.now() + CACHE_TTL })
      setResult(ok)
    }).catch(() => setResult(false))
  }, [code])

  return result
}
