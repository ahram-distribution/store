export interface PendingPoint {
  id?: number
  employee_id: string
  session_id: string
  latitude?: number | null
  longitude?: number | null
  accuracy_meters?: number | null
  altitude_meters?: number | null
  speed_mps?: number | null
  heading_degrees?: number | null
  battery_pct?: number | null
  recorded_at: string
  point_type: string
  retries: number
  priority?: number
  failure_reason?: string
}

export interface SignalEntry {
  id?: number
  type: 'app_open' | 'app_resume' | 'visit_checkin' | 'visit_checkout' | 'order_created' | 'collection_created' | 'customer_created'
  session_id: string
  employee_id?: string
  recorded_at: string
  retries: number
}

export interface AuthInfo {
  supabaseUrl: string
  anonKey: string
  token: string
  employeeId: string
  sessionId?: string
}

const DB_NAME = 'ahram-tracking'
const DB_VERSION = 3

async function notifySW(type: string, payload?: unknown) {
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type, payload })
    }
  } catch {}
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pending_points')) {
        const store = db.createObjectStore('pending_points', { keyPath: 'id', autoIncrement: true })
        store.createIndex('employee_id', 'employee_id', { unique: false })
        store.createIndex('point_type', 'point_type', { unique: false })
        store.createIndex('priority', 'priority', { unique: false })
      }
      if (!db.objectStoreNames.contains('auth_store')) {
        db.createObjectStore('auth_store', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const trackingQueue = {
  async addPoint(point: Omit<PendingPoint, 'id' | 'retries'>): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readwrite')
      tx.objectStore('pending_points').add({ ...point, retries: 0 })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          notifySW('QUEUE_UPDATED')
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      try {
        const key = `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        localStorage.setItem(key, JSON.stringify(point))
        notifySW('QUEUE_UPDATED')
      } catch {}
    }
  },

  async addHeartbeat(point: { employee_id: string; session_id: string; recorded_at: string }): Promise<void> {
    return this.addPoint({
      employee_id: point.employee_id,
      session_id: point.session_id,
      recorded_at: point.recorded_at,
      point_type: 'heartbeat',
      priority: 0,
    })
  },

  async addSignal(signal: Omit<SignalEntry, 'id' | 'retries'>): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readwrite')
      tx.objectStore('pending_points').add({
        employee_id: signal.employee_id || '',
        session_id: signal.session_id,
        recorded_at: signal.recorded_at,
        point_type: signal.type,
        priority: 0,
        retries: 0,
      })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => { notifySW('QUEUE_UPDATED'); resolve() }
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      try {
        const key = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        localStorage.setItem(key, JSON.stringify(signal))
        notifySW('QUEUE_UPDATED')
      } catch {}
    }
  },

  async getSignals(): Promise<SignalEntry[]> {
    const all = await this.getPending()
    const signalTypes = new Set(['app_open', 'app_resume', 'visit_checkin', 'visit_checkout', 'order_created', 'collection_created', 'customer_created'])
    return all
      .filter((p) => signalTypes.has(p.point_type))
      .map((p) => ({
        id: p.id,
        type: p.point_type as SignalEntry['type'],
        session_id: p.session_id,
        employee_id: p.employee_id,
        recorded_at: p.recorded_at,
        retries: p.retries,
      }))
  },

  async getPending(): Promise<PendingPoint[]> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readonly')
      const all = tx.objectStore('pending_points').getAll()
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(all.result as PendingPoint[])
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      const points: PendingPoint[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('tp_')) {
          try { points.push(JSON.parse(localStorage.getItem(key)!)) } catch {}
        }
      }
      return points
    }
  },

  async getByType(type: string): Promise<PendingPoint[]> {
    const all = await this.getPending()
    return all.filter((p) => p.point_type === type)
  },

  async count(): Promise<number> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readonly')
      const count = tx.objectStore('pending_points').count()
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(count.result)
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      let c = 0
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith('tp_')) c++
      }
      return c
    }
  },

  async removePoints(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readwrite')
      const store = tx.objectStore('pending_points')
      for (const id of ids) store.delete(id)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          notifySW('QUEUE_UPDATED')
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  },

  async clear(): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readwrite')
      tx.objectStore('pending_points').clear()
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          notifySW('QUEUE_UPDATED')
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('tp_')) keys.push(key)
      }
      keys.forEach((k) => localStorage.removeItem(k))
    }
  },

  async incrementRetries(ids: number[]): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('pending_points', 'readwrite')
      const store = tx.objectStore('pending_points')
      for (const id of ids) {
        const req = store.get(id)
        req.onsuccess = () => {
          const point = req.result as PendingPoint | undefined
          if (point) {
            point.retries = (point.retries || 0) + 1
            store.put(point)
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  },

  async storeSessionId(sessionId: string): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('auth_store', 'readwrite')
      tx.objectStore('auth_store').put({ key: 'current_session', sessionId })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      try { localStorage.setItem('tracking_session_id', sessionId) } catch {}
    }
  },

  async getSessionId(): Promise<string | null> {
    try {
      const db = await openDB()
      const tx = db.transaction('auth_store', 'readonly')
      const req = tx.objectStore('auth_store').get('current_session')
      return new Promise((resolve) => {
        tx.oncomplete = () => resolve(req.result?.sessionId ?? null)
        tx.onerror = () => resolve(null)
      })
    } catch {
      try { return localStorage.getItem('tracking_session_id') } catch { return null }
    }
  },

  async storeAuth(info: AuthInfo): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('auth_store', 'readwrite')
      tx.objectStore('auth_store').put({ key: 'auth', ...info })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          notifySW('AUTH_UPDATED', info)
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  },

  async getAuth(): Promise<AuthInfo | null> {
    try {
      const db = await openDB()
      const tx = db.transaction('auth_store', 'readonly')
      const req = tx.objectStore('auth_store').get('auth')
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          const result = req.result as AuthInfo & { key: string } | undefined
          resolve(result ? { supabaseUrl: result.supabaseUrl, anonKey: result.anonKey, token: result.token, employeeId: result.employeeId } : null)
        }
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      return null
    }
  },

  async clearAuth(): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction('auth_store', 'readwrite')
      tx.objectStore('auth_store').delete('auth')
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  },
}
