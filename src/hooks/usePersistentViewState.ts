import { useState, useEffect, useCallback } from 'react'
import { FilterStateService } from '../services/filterStateService'

export function usePersistentViewState<T extends Record<string, any>>(
  pageKey: string,
  defaultState: T
): [T, (update: Partial<T> | ((prev: T) => Partial<T>)) => void, () => void] {
  const [state, setState] = useState<T>(() =>
    FilterStateService.restore(pageKey, defaultState)
  )

  useEffect(() => {
    FilterStateService.save(pageKey, state)
  }, [pageKey, state])

  const update = useCallback((updateOrFn: Partial<T> | ((prev: T) => Partial<T>)) => {
    setState(prev => {
      const patch = typeof updateOrFn === 'function'
        ? (updateOrFn as (prev: T) => Partial<T>)(prev)
        : updateOrFn
      return { ...prev, ...patch }
    })
  }, [])

  const reset = useCallback(() => {
    setState(defaultState)
    FilterStateService.clear(pageKey)
  }, [pageKey, defaultState])

  return [state, update, reset]
}
