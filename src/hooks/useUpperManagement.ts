import { useAuthStore } from '../store/auth'
import { isUpperManagement } from '../utils/roleNormalization'

export function useUpperManagement(): boolean {
  const roles = useAuthStore((s) => s.user?.roles)
  return roles?.some((r: string) => isUpperManagement(r)) ?? false
}
