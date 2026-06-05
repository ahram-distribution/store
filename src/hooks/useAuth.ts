import { useEffect } from 'react'
import { useAuthStore } from '../store/auth'

export function useAuth() {
  const { user, token, loading, restoreSession } = useAuthStore()

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  return { user, token, loading }
}
