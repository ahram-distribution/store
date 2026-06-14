import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { useState, useEffect } from 'react'
import { authService } from '../../services/auth'
import { isUpperManagement } from '../../utils/roleNormalization'

const UPPER_MGMT_CODES = new Set(['ADMIN-001', 'WRQ1006', 'WRQ1003', 'WRQ1002', 'WRQ1004'])

function isUpperManagementUser(user: { identity_type: string; code?: string; roles?: string[] } | null): boolean {
  if (!user || user.identity_type !== 'employee') return false
  if (UPPER_MGMT_CODES.has(user.code ?? '')) return true
  return user.roles?.some((r) => isUpperManagement(r)) ?? false
}

interface ProtectedRouteProps {
  children: React.ReactNode
  requireCapability?: string
  employeeOnly?: boolean
  customerOnly?: boolean
  requireUpperManagement?: boolean
}

export function ProtectedRoute({ children, requireCapability, employeeOnly, customerOnly, requireUpperManagement }: ProtectedRouteProps) {
  const { user, token } = useAuthStore()
  const [capabilityOk, setCapabilityOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token || !user) {
      setCapabilityOk(false)
      return
    }
    if (employeeOnly && user.identity_type !== 'employee') {
      setCapabilityOk(false)
      return
    }
    if (customerOnly && user.identity_type !== 'customer') {
      setCapabilityOk(false)
      return
    }
    if (requireUpperManagement) {
      setCapabilityOk(isUpperManagementUser(user))
      return
    }
    if (requireCapability) {
      if (isUpperManagementUser(user)) {
        setCapabilityOk(true)
        return
      }
      authService.checkCapability(token, requireCapability).then(setCapabilityOk).catch(() => setCapabilityOk(false))
    } else {
      setCapabilityOk(true)
    }
  }, [token, user, requireCapability, employeeOnly, customerOnly, requireUpperManagement])

  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  if (capabilityOk === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!capabilityOk) {
    const redirect = user.identity_type === 'employee' ? '/dashboard' : '/storefront'
    return <Navigate to={redirect} replace />
  }

  return <>{children}</>
}
