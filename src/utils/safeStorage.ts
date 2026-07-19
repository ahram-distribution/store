/**
 * Safe localStorage wrappers that never throw.
 *
 * Browsers may deny access to localStorage in private/incognito mode,
 * when storage is full, or when running in a sandboxed iframe.
 * Every function here returns a fallback value on failure instead of
 * propagating the exception.
 */

export function storageRead(key: string, fallback: string | null = null): string | null {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function storageWrite(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function storageRemove(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Safe sessionStorage wrappers with the same guarantees.
 */

export function sessionRead(key: string, fallback: string | null = null): string | null {
  try {
    return sessionStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function sessionWrite(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function sessionRemove(key: string): boolean {
  try {
    sessionStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
