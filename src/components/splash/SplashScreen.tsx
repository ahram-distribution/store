import { useEffect, useState } from 'react'

interface SplashScreenProps {
  onFinish: () => void
  message?: string
}

export function SplashScreen({ onFinish, message }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const minDisplay = setTimeout(() => {
      setFadeOut(true)
      setTimeout(() => {
        setDone(true)
        onFinish()
      }, 600)
    }, 1800)
    return () => clearTimeout(minDisplay)
  }, [onFinish])

  if (done) return null

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-600 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: '#071B4D' }}
    >
      {/* Background mark */}
      <img
        src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 320,
          opacity: 0.04,
          pointerEvents: 'none',
        }}
      />

      {/* Foreground */}
      <div className="flex flex-col items-center" style={{ position: 'relative', zIndex: 1, marginTop: -48 }}>
        <img
          src={`${import.meta.env.BASE_URL}pwa/branding/logo.png`}
          alt="الأهرام"
          style={{ width: 88, height: 88, marginBottom: 20, objectFit: 'contain' }}
        />

        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#C9A227', textAlign: 'center' }}>
          الأهرام للتجارة والتوزيع
        </h1>

        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.65)', textAlign: 'center', marginTop: 8 }}>
          نظام تشغيل متكامل للتوزيع والمبيعات
        </p>

        <div style={{ width: 140, height: 3, borderRadius: 999, background: 'rgba(201,162,39,.15)', marginTop: 28, position: 'relative', overflow: 'hidden' }}>
          <div className="splash-progress-bar" />
        </div>

        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', textAlign: 'center', marginTop: 14 }}>
          جاري تهيئة النظام...
        </p>

        {message && (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', textAlign: 'center', marginTop: 8 }}>{message}</p>
        )}
      </div>
    </div>
  )
}
