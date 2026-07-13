import { useEffect } from 'react'
import toast from 'react-hot-toast'

export function useSWUpdate() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let mounted = true

    navigator.serviceWorker.register('/store/sw.js').then((reg) => {
      if (!mounted) return

      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing
        if (!newSW) return

        newSW.addEventListener('statechange', () => {
          if (!mounted) return
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            toast(
              (t) => (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    direction: 'rtl',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>نسخة جديدة متاحة</span>
                  <button
                    onClick={() => {
                      toast.dismiss(t.id)
                      window.location.reload()
                    }}
                    style={{
                      background: '#C9A227',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '6px 16px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '14px',
                    }}
                  >
                    تحديث
                  </button>
                </div>
              ),
              { duration: Infinity }
            )
          }
        })
      })
    })

    return () => {
      mounted = false
    }
  }, [])
}
