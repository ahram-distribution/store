import { useState, useEffect } from 'react'
import { authService } from '../services/auth'
import { useAuthStore } from '../store/auth'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const cache = new Map<string, { value: boolean; expiry: number }>()

const CACHE_TTL = 5 * 60 * 1000

function hasRolePrefix(prefix: string): boolean {
  const user = useAuthStore.getState().user
  if (!user?.roles) return false
  const roles = user.roles.map((r) => r.toLowerCase().replace(/[^a-z0-9]/g, ''))
  return roles.some((r) => r.includes(prefix))
}

const SUPER_CAPABILITIES = new Set([
  'orders.approve', 'orders.cancel', 'orders.dispatch', 'orders.create',
  'orders.review', 'orders.manage',
  'customers.create', 'customers.update', 'customers.manage',
  'collections.create', 'collections.approve', 'collections.update', 'collections.read',
  'visits.create',
  'warehouse.prepare', 'warehouse.complete_preparation',
  'delivery.dispatch', 'delivery.deliver', 'transportation.send_to_delivery',
  'employees.manage', 'products.manage', 'companies.manage',
  'returns.create', 'returns.approve', 'returns.read',
  'credit.manage', 'credit.view', 'credit.review',
  'deals.manage',
])

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

    if (SUPER_CAPABILITIES.has(code) && hasRolePrefix('superadmin')) {
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
