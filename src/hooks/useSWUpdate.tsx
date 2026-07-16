import { useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'

const BASE = import.meta.env.BASE_URL || '/store/'

export function useSWUpdate() {
  const toastIdRef = useRef<string | null>(null)

  const dismissToast = useCallback(() => {
    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current)
      toastIdRef.current = null
    }
  }, [])

  const activateUpdate = useCallback(() => {
    dismissToast()
    navigator.serviceWorker.getRegistration(BASE).then((reg) => {
      if (reg?.waiting) {
        const nav = navigator as any
        const onControllerChange = () => {
          nav.removeEventListener('controllerchange', onControllerChange)
          window.location.reload()
        }
        nav.addEventListener('controllerchange', onControllerChange)
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      } else {
        window.location.reload()
      }
    })
  }, [dismissToast])

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

    // --- PWA: detect waiting Service Worker ---
    navigator.serviceWorker.ready.then((reg) => {
      if (!mounted) return

      const checkWaiting = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          if (mounted) showUpdateToast()
        }
      }

      checkWaiting()

      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing
        if (!newSW) return

        newSW.addEventListener('statechange', () => {
          if (!mounted) return
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast()
          }
        })
      })
    })

    // --- Web: poll build-manifest.json for new deployments ---
    const CURRENT_ID = __BUILD_ID__
    if (CURRENT_ID === 'dev') return () => { mounted = false }

    const poll = async () => {
      try {
        const res = await fetch(`${BASE}build-manifest.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const manifest = await res.json()
        if (manifest.build_id && manifest.build_id !== CURRENT_ID && mounted) {
          showUpdateToast()
        }
      } catch { /* offline or missing file — ignore */ }
    }

    poll()
    const interval = setInterval(poll, 60_000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [showUpdateToast])
}
