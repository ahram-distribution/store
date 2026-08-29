import { useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'

const BASE = import.meta.env.BASE_URL || '/store/'
const BUILD_MANIFEST_POLL_MS = 60_000
const SW_UPDATE_CHECK_MS = 5 * 60_000
const UPDATE_ACTION_TIMEOUT_MS = 12_000

export function useSWUpdate() {
  const toastIdRef = useRef<string | null>(null)

  const dismissToast = useCallback(() => {
    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current)
      toastIdRef.current = null
    }
  }, [])

  const waitForControllerChange = useCallback(
    (timeoutMs: number = UPDATE_ACTION_TIMEOUT_MS) => {
      return new Promise<void>((resolve) => {
        const sw = navigator.serviceWorker
        let done = false
        const timer = setTimeout(finish, timeoutMs)
        function finish() {
          if (done) return
          done = true
          clearTimeout(timer)
          sw.removeEventListener('controllerchange', onControllerChange)
          resolve()
        }
        function onControllerChange() {
          finish()
        }
        sw.addEventListener('controllerchange', onControllerChange)
      })
    },
    []
  )

  const waitForWaitingWorker = useCallback((reg: ServiceWorkerRegistration) => {
    return new Promise<ServiceWorker | null>((resolve) => {
      let settled = false
      const timer = setTimeout(() => settle(reg.waiting || null), UPDATE_ACTION_TIMEOUT_MS)
      function settle(sw: ServiceWorker | null) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reg.removeEventListener('updatefound', onUpdateFound)
        resolve(sw)
      }
      function attach(sw: ServiceWorker) {
        const onState = () => {
          if (sw.state === 'installed' || sw.state === 'activated') settle(sw)
        }
        sw.addEventListener('statechange', onState)
        if (sw.state === 'installed' || sw.state === 'activated') settle(sw)
      }
      function onUpdateFound() {
        const sw = reg.installing
        if (sw) attach(sw)
        else settle(reg.waiting || null)
      }
      reg.addEventListener('updatefound', onUpdateFound)
      if (reg.installing) attach(reg.installing)
      else if (reg.waiting) settle(reg.waiting)
    })
  }, [])

  const activateUpdate = useCallback(async () => {
    dismissToast()
    try {
      const reg = await navigator.serviceWorker.getRegistration(BASE)
      if (!reg) {
        window.location.reload()
        return
      }

      let waiting = reg.waiting
      if (!waiting) {
        // Force an immediate update check so the action does not depend on a
        // waiting worker already being present. Bounded by UPDATE_ACTION_TIMEOUT_MS.
        try {
          reg.update().catch(() => {})
        } catch {
          /* offline or unsupported — fall through to bounded wait */
        }
        waiting = (await waitForWaitingWorker(reg)) || reg.waiting
      }

      if (!waiting) {
        // No new worker became available — a plain reload is the fallback.
        // The service worker's navigation handler now fetches the latest
        // index.html network-first, so this reload still picks the new build.
        window.location.reload()
        return
      }

      const controllerChanged = waitForControllerChange()
      waiting.postMessage({ type: 'SKIP_WAITING' })
      await controllerChanged
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }, [dismissToast, waitForControllerChange, waitForWaitingWorker])

  const showUpdateToast = useCallback(() => {
    if (toastIdRef.current) return
    toastIdRef.current = toast(
      (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', direction: 'rtl' }}>
          <span style={{ fontSize: '14px' }}>نسخة جديدة متاحة</span>
          <button
            onClick={() => activateUpdate()}
            style={{
              background: '#C9A227', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '6px 16px', cursor: 'pointer',
              fontWeight: 600, fontSize: '14px',
            }}
          >
            تحديث
          </button>
        </div>
      ),
      { duration: Infinity }
    )
  }, [activateUpdate])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let mounted = true
    const cleanups: Array<() => void> = []
    const pushCleanup = (fn: () => void) => cleanups.push(fn)

    navigator.serviceWorker.ready
      .then((reg) => {
        if (!mounted) return

        let updating = false
        const runUpdateCheck = () => {
          if (updating) return
          updating = true
          const done = () => { updating = false }
          try {
            const promise = reg.update()
            if (promise && typeof promise.then === 'function') {
              ;(promise as Promise<unknown>).then(done, done)
            } else {
              done()
            }
          } catch {
            done()
          }
        }

        const showToastIfNew = () => {
          if (mounted && reg.waiting && navigator.serviceWorker.controller) {
            showUpdateToast()
          }
        }

        const onUpdateFound = () => {
          const newSW = reg.installing
          if (!newSW) return
          newSW.addEventListener('statechange', () => {
            if (!mounted) return
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast()
            }
          })
        }

        showToastIfNew()
        runUpdateCheck()

        reg.addEventListener('updatefound', onUpdateFound)
        pushCleanup(() => reg.removeEventListener('updatefound', onUpdateFound))

        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') runUpdateCheck()
        }
        const onFocus = () => runUpdateCheck()
        const onPageShow = () => runUpdateCheck()

        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('focus', onFocus)
        window.addEventListener('pageshow', onPageShow)

        const swCheckInterval = setInterval(runUpdateCheck, SW_UPDATE_CHECK_MS)

        pushCleanup(() => {
          document.removeEventListener('visibilitychange', onVisibilityChange)
          window.removeEventListener('focus', onFocus)
          window.removeEventListener('pageshow', onPageShow)
          clearInterval(swCheckInterval)
        })
      })
      .catch(() => {
        /* no service worker registration — ignore */
      })

    // --- Web: poll build-manifest.json for new deployments ---
    const CURRENT_ID = __BUILD_ID__
    if (CURRENT_ID === 'dev') {
      return () => {
        mounted = false
        cleanups.forEach((fn) => fn())
      }
    }

    const poll = async () => {
      try {
        const res = await fetch(`${BASE}build-manifest.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const manifest = await res.json()
        if (manifest.build_id && manifest.build_id !== CURRENT_ID && mounted) {
          showUpdateToast()
        }
      } catch {
        /* offline or missing file — ignore */
      }
    }

    poll()
    const interval = setInterval(poll, BUILD_MANIFEST_POLL_MS)
    pushCleanup(() => clearInterval(interval))

    return () => {
      mounted = false
      cleanups.forEach((fn) => fn())
    }
  }, [showUpdateToast])
}