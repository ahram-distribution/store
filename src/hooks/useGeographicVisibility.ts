import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCartStore } from '../store/cart'
import {
  getGeographicVisibilityHiddenProducts,
  bumpGeographicVisibilityEpoch,
  toVisibilitySets,
  emptyVisibilitySets,
} from '../services/geographicVisibility'
import type { VisibilitySets } from '../services/geographicVisibility'

export interface GeographicVisibilityState extends VisibilitySets {
  isResolving: boolean
  reload: () => void
}

export function useGeographicVisibility(): GeographicVisibilityState {
  const governorateId = useCartStore((s) => s.geographicContext?.governorateId)
  const [sets, setSets] = useState<VisibilitySets>(emptyVisibilitySets)
  const [isResolving, setIsResolving] = useState(false)
  const [reloadEpoch, setReloadEpoch] = useState(0)

  const reload = useCallback(() => {
    setReloadEpoch((e) => e + 1)
  }, [])

  useEffect(() => {
    if (!governorateId) {
      setSets(emptyVisibilitySets())
      setIsResolving(false)
      return
    }
    let cancelled = false
    setIsResolving(true)
    getGeographicVisibilityHiddenProducts(governorateId)
      .then((rows) => {
        if (cancelled) return
        setSets(toVisibilitySets(rows))
      })
      .catch(() => {
        if (cancelled) return
        setSets(emptyVisibilitySets())
      })
      .finally(() => {
        if (!cancelled) setIsResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [governorateId, reloadEpoch])

  useEffect(() => {
    const channel = supabase
      .channel('geo-visibility-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'geographic_visibility_rules' }, () => {
        bumpGeographicVisibilityEpoch()
        reload()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { hiddenProductIds: sets.hiddenProductIds, hiddenCompanyIds: sets.hiddenCompanyIds, isResolving, reload }
}