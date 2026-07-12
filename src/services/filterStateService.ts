const STORAGE_PREFIX = 'persist_view_'

export const FilterStateService = {
  save<T>(pageKey: string, state: T): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(state))
    } catch { }
  },

  restore<T>(pageKey: string, defaults: T): T {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + pageKey)
      if (!raw) return defaults
      return { ...defaults, ...JSON.parse(raw) }
    } catch { return defaults }
  },

  clear(pageKey: string): void {
    try { localStorage.removeItem(STORAGE_PREFIX + pageKey) } catch { }
  },

  clearAll(): void {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX))
      keys.forEach(k => localStorage.removeItem(k))
    } catch { }
  },
}
