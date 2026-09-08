import { supabase } from '../lib/supabase'

/**
 * Bonus Mode global configuration client (Phase 3).
 *
 * Reads bonus_mode_enabled via the Phase 1 governed RPC get_governed_bonus_config
 * (spec §9, D-O6). Default = OFF when the call fails, the RPC claims INVALID_SESSION,
 * or the session has no token. Cached with a module-level epoch that mirrors
 * geographicPricing: the whole cart session sees ONE consistent decision, and a
 * fresh read can be forced via invalidateBonusModeCache() (spec §17.2 epoch
 * invalidation). Keyed by epoch + session token so an account switch re-resolves.
 */
let epoch = 0
let cached: { key: string; enabled: boolean } | null = null
let inflight: { key: string; promise: Promise<boolean> } | null = null

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function currentBonusModeEpoch(): number {
  return epoch
}

export function invalidateBonusModeCache(): void {
  epoch += 1
  cached = null
  inflight = null
}

export async function readBonusMode(): Promise<boolean> {
  const key = `${epoch}|${getToken() ?? ''}`
  if (cached?.key === key) return cached.enabled
  if (inflight?.key === key) return inflight.promise

  const promise = (async (): Promise<boolean> => {
    try {
      const token = getToken()
      const { data, error } = await supabase.rpc('get_governed_bonus_config', { p_token: token ?? null })
      if (error) return false
      if (data?.error) return false
      const enabled = data?.bonus_mode_enabled === true
      if (cached?.key !== key) cached = { key, enabled }
      return enabled
    } catch {
      return false
    } finally {
      if (inflight?.key === key) inflight = null
    }
  })()

  inflight = { key, promise }
  return promise
}