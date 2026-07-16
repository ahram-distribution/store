const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
const CACHE_NAME = `ahram-${BUILD_ID}`
const SUPABASE_URL = self.__VITE_SUPABASE_URL__ || ''
const SUPABASE_ANON_KEY = self.__VITE_SUPABASE_ANON_KEY__ || ''

declare const self: ServiceWorkerGlobalScope & {
  __VITE_SUPABASE_URL__?: string
  __VITE_SUPABASE_ANON_KEY__?: string
  __BUILD_ID__?: string
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ---- IndexedDB helpers ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ahram-tracking', 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pending_points')) {
        const store = db.createObjectStore('pending_points', { keyPath: 'id', autoIncrement: true })
        store.createIndex('employee_id', 'employee_id', { unique: false })
        store.createIndex('point_type', 'point_type', { unique: false })
      }
      if (!db.objectStoreNames.contains('auth_store')) {
        db.createObjectStore('auth_store', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('sw_flags')) {
        db.createObjectStore('sw_flags', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAuth() {
  try {
    const db = await openDB()
    const tx = db.transaction('auth_store', 'readonly')
    const req = tx.objectStore('auth_store').get('auth')
    return new Promise<any>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
    })
  } catch { return null }
}

async function getPendingPoints(): Promise<any[]> {
  try {
    const db = await openDB()
    const tx = db.transaction('pending_points', 'readonly')
    const req = tx.objectStore('pending_points').getAll()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result || [])
      tx.onerror = () => reject(tx.error)
    })
  } catch { return [] }
}

async function setFlag(key: string, value: string) {
  try {
    const db = await openDB()
    const tx = db.transaction('sw_flags', 'readwrite')
    tx.objectStore('sw_flags').put({ key, value, updated_at: new Date().toISOString() })
    await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(0); tx.onerror = () => reject(tx.error) })
  } catch {}
}

async function getFlag(key: string): Promise<string | null> {
  try {
    const db = await openDB()
    const tx = db.transaction('sw_flags', 'readonly')
    const req = tx.objectStore('sw_flags').get(key)
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(req.result?.value ?? null)
      tx.onerror = () => resolve(null)
    })
  } catch { return null }
}

// ---- Sync logic ----

async function syncTrackingPoints(batch: any[], auth: any, supabaseUrl: string) {
  const validBatch = batch.filter((p: any) => {
    if (p.point_type === 'heartbeat') return true
    return p.latitude != null && p.longitude != null
  })
  if (validBatch.length === 0) return { synced: 0, syncedIds: [], rejected: batch.length, rejectedDetails: 'all null lat/lng' }

  const sessionIds = [...new Set(validBatch.map((p: any) => p.session_id).filter(Boolean))]
  let synced = 0
  let syncedIds: number[] = []
  let rejected = 0
  let rejectedDetails = ''

  for (const sid of sessionIds) {
    const sessionBatch = validBatch.filter((p: any) => p.session_id === sid)
    const gpsPoints = sessionBatch.filter((p: any) => p.point_type !== 'heartbeat')
    const heartbeats = sessionBatch.filter((p: any) => p.point_type === 'heartbeat')

    if (gpsPoints.length > 0) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_tracking_points`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': auth.anonKey,
            'Authorization': `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            p_token: auth.token,
            p_session_id: sid,
            p_points: gpsPoints.map((p: any) => ({
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy_meters: p.accuracy_meters,
              altitude_meters: p.altitude_meters,
              speed_mps: p.speed_mps,
              heading_degrees: p.heading_degrees,
              battery_pct: p.battery_pct,
              recorded_at: p.recorded_at,
              point_type: p.point_type,
            })),
          }),
        })
        if (res.ok) {
          const result = await res.json()
          if (!result.error) {
            const ids = gpsPoints.filter((p: any) => p.id != null).map((p: any) => p.id)
            synced += ids.length
            syncedIds.push(...ids)
          } else {
            rejected += gpsPoints.length
            rejectedDetails += `session ${sid} RPC error; `
          }
        } else {
          rejected += gpsPoints.length
          rejectedDetails += `session ${sid} HTTP ${res.status}; `
        }
      } catch (err) {
        rejected += gpsPoints.length
        rejectedDetails += `session ${sid} network error; `
      }
    }

    if (heartbeats.length > 0) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/record_heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': auth.anonKey,
            'Authorization': `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ p_token: auth.token, p_session_id: sid }),
        })
        if (res.ok) {
          const result = await res.json()
          if (!result.error) {
            const ids = heartbeats.filter((p: any) => p.id != null).map((p: any) => p.id)
            synced += ids.length
            syncedIds.push(...ids)
          } else {
            rejected += heartbeats.length
          }
        } else {
          rejected += heartbeats.length
        }
      } catch {
        rejected += heartbeats.length
      }
    }
  }

  return { synced, syncedIds, rejected, rejectedDetails }
}

async function flushQueue() {
  try {
    const auth = await getAuth()
    if (!auth || !auth.token || !auth.supabaseUrl) {
      const cnt = await getPendingPoints().then(p => p.length).catch(() => 0)
      if (cnt > 0) {
        console.warn(`[SW] flushQueue: no auth available, ${cnt} points pending (will retry)`)
        await setFlag('last_auth_missing', new Date().toISOString())
      }
      return
    }

    const supabaseUrl = (auth.supabaseUrl || SUPABASE_URL).replace(/\/+$/, '')
    const points = await getPendingPoints()
    if (points.length === 0) return

    const batchSize = 50
    let totalSynced = 0
    let totalRemoved = 0

    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize)
      try {
        const { synced, syncedIds } = await syncTrackingPoints(batch, auth, supabaseUrl)

        // ONLY delete points that were successfully synced
        // Failed/rejected/invalid points stay in queue for retry
        if (syncedIds.length > 0) {
          const db = await openDB()
          const tx = db.transaction('pending_points', 'readwrite')
          const store = tx.objectStore('pending_points')
          for (const id of syncedIds) store.delete(id)
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          })
          totalRemoved += syncedIds.length
        }
        totalSynced += synced
      } catch {
        break
      }
    }

    await setFlag('last_sync', new Date().toISOString())
    await setFlag('last_sync_count', String(totalSynced))
  } catch {}
}

// ---- Install ----

self.addEventListener('install', (event) => {
  const precacheUrls = self.__WB_MANIFEST?.map((e) => e.url) || []
  if (precacheUrls.length > 0) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(precacheUrls))
    )
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  event.waitUntil(flushQueue())
})

// ---- Background Sync ----

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-tracking-points' || event.tag === 'sync-heartbeat') {
    event.waitUntil(flushQueue())
  }
})

// ---- Message handler ----

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {}

  switch (type) {
    case 'TRACKING_AUTH_UPDATE':
    case 'AUTH_UPDATED':
      if (payload) {
        const dbPromise = openDB().then((db) => {
          const tx = db.transaction('auth_store', 'readwrite')
          tx.objectStore('auth_store').put({ key: 'auth', ...payload })
          return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          })
        })
        event.waitUntil(dbPromise)
      }
      break

    case 'QUEUE_UPDATED':
      event.waitUntil(flushQueue())
      break

    case 'FLUSH_NOW':
      event.waitUntil(flushQueue())
      break

    case 'SYNC_TRACKING_POINTS':
      event.waitUntil(flushQueue())
      break

    case 'RESET_AUTH':
      {
        const dbPromise = openDB().then((db) => {
          const tx = db.transaction('auth_store', 'readwrite')
          tx.objectStore('auth_store').delete('auth')
          return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          })
        })
        event.waitUntil(dbPromise)
      }
      break

    case 'SKIP_WAITING':
      self.skipWaiting()
      break
  }
})

// ---- Periodicsync (if available) ----

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tracking-heartbeat') {
    event.waitUntil(flushQueue())
  }
})

// ---- Push ----

self.addEventListener('push', (event) => {
  let data: any = {}
  try { data = event.data?.json() || {} } catch {}

  const title = data.title || 'تتبع الموقع'
  const body = data.body || 'يبدو أن التطبيق متوقف، افتح التطبيق لاستئناف المزامنة.'
  const icon = data.icon || '/icons/icon-192x192.png'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icons/icon-192x192.png',
      tag: 'tracking-reminder',
      renotify: true,
      requireInteraction: true,
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const urlToOpen = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(urlToOpen) && 'focus' in client) return client.focus()
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen)
    })
  )
})

// ---- Fetch (precache + offline + SPA navigation) ----

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/rest/v1/rpc/')) return

  // SPA navigation: network-first with cache fallback
  // Network-first ensures fresh content after deployment while cache fallback provides offline support
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch('/store/index.html').catch(() =>
        caches.match('/store/index.html')
      )
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      }).catch(() => cached || new Response('Offline', { status: 503 }))
    })
  )
})
