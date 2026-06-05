import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { useState, useEffect } from 'react'
import { authService } from '../../services/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireCapability?: string
  employeeOnly?: boolean
  customerOnly?: boolean
}

export function ProtectedRoute({ children, requireCapability, employeeOnly, customerOnly }: ProtectedRouteProps) {
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
    if (requireCapability) {
      authService.checkCapability(token, requireCapability).then(setCapabilityOk).catch(() => setCapabilityOk(false))
    } else {
      setCapabilityOk(true)
    }
  }, [token, user, requireCapability, employeeOnly, customerOnly])

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
