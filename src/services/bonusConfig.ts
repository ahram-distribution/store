import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

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

let liveChannel: RealtimeChannel | null = null

/**
 * Live global-mode watch (Global Benefit Mode).
 *
 * Two signals converge on the same callback:
 * 1. Broadcast `bonus_mode_changed` (announced by the admin after a successful
 *    governed_set_bonus_mode RPC) — immediate, works regardless of DB grants.
 * 2. postgres_changes INSERT on public.bonus_mode_audit (the append-only audit
 *    row written by the mode-change RPC) — same mechanism as geo rules.
 *
 * The callback should invalidateBonusModeCache() then re-read so the cart store
 * flips bonusMode instantly without reload or polling (spec §24).
 */
export function subscribeToBonusModeChanges(onChange: () => void): () => void {
  if (liveChannel) {
    void supabase.removeChannel(liveChannel)
    liveChannel = null
  }
  const channel = supabase.channel('bonus-mode-live')
  channel
    .on('broadcast', { event: 'bonus_mode_changed' }, () => onChange())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bonus_mode_audit' }, () => onChange())
    .subscribe()
  liveChannel = channel
  return () => {
    if (liveChannel === channel) {
      void supabase.removeChannel(channel)
      liveChannel = null
    }
  }
}

/**
 * Announces a successful governed mode change to every connected client
 * (including the admin's own session) so storefront/cart views flip immediately.
 */
export function announceBonusModeChanged(): void {
  const channel = supabase.channel('bonus-mode-live')
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.send({
        type: 'broadcast',
        event: 'bonus_mode_changed',
        payload: { at: Date.now() },
      })
      setTimeout(() => {
        void supabase.removeChannel(channel)
      }, 1000)
    }
  })
}