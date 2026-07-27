import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../../store/notifications'

const TOAST_DURATION = 4000

export function NotificationToast() {
  const toastNotification = useNotificationStore((s) => s.toastNotification)
  const dismissToast = useNotificationStore((s) => s.dismissToast)
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!toastNotification) {
      setVisible(false)
      setExiting(false)
      prevIdRef.current = null
      return
    }

    if (toastNotification.id === prevIdRef.current) return
    prevIdRef.current = toastNotification.id

    setExiting(false)
    setVisible(true)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => {
        setVisible(false)
        setExiting(false)
        dismissToast()
        prevIdRef.current = null
      }, 300)
    }, TOAST_DURATION)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toastNotification, dismissToast])

  if (!visible || !toastNotification) return null

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (toastNotification.target_path) {
      navigate(toastNotification.target_path)
    }
    setExiting(true)
    setTimeout(() => {
      setVisible(false)
      setExiting(false)
      dismissToast()
      prevIdRef.current = null
    }, 200)
  }

  return (
    <div
      className="notification-toast"
      onClick={handleClick}
      style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: exiting ? 'translateX(-50%) translateY(-120%)' : 'translateX(-50%) translateY(0)',
        zIndex: 10000,
        width: 'calc(100% - 32px)',
        maxWidth: '400px',
        background: 'rgba(11, 61, 145, 0.95)',
        color: '#fff',
        borderRadius: '16px',
        padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(201, 162, 39, 0.2)',
        cursor: toastNotification.target_path ? 'pointer' : 'default',
        transition: 'transform 0.3s cubic-bezier(.21,1.02,.73,1), opacity 0.3s ease',
        opacity: exiting ? 0 : 1,
        direction: 'rtl',
      }}
      role="alert"
      aria-live="assertive"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'rgba(201, 162, 39, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#C9A227" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '13px', lineHeight: '1.3', marginBottom: '2px' }}>
            {toastNotification.title}
          </div>
          <div style={{ fontSize: '12px', opacity: 0.85, lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {toastNotification.message}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (timerRef.current) clearTimeout(timerRef.current)
            setExiting(true)
            setTimeout(() => {
              setVisible(false)
              setExiting(false)
              dismissToast()
              prevIdRef.current = null
            }, 200)
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '16px',
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label="إغلاق"
        >
          ×
        </button>
      </div>
    </div>
  )
}
