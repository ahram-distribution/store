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
      {/* Logo */}
      <div className="text-center mb-12">
        <div
          className="w-24 h-24 mx-auto mb-5 rounded-3xl flex items-center justify-center shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.15) 0%, rgba(201, 162, 39, 0.05) 100%)',
            border: '1px solid rgba(201, 162, 39, 0.2)',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(201, 162, 39, 0.1)',
          }}
        >
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#C9A227" />
            <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-wide" style={{ letterSpacing: '0.02em' }}>شركة الأهرام</h1>
        <p className="text-sm mt-1 font-medium" style={{ color: '#E0B85A' }}>للتجارة والتوزيع</p>
      </div>

      {/* Gold progress line */}
      <div className="gold-progress mb-8" />

      {/* Tagline */}
      <p className="text-xs" style={{ color: 'rgba(255, 255, 255, 0.45)' }}>نظام تشغيل متكامل للتوزيع والمبيعات</p>

      {/* Message */}
      {message && (
        <div className="absolute bottom-20 left-0 right-0 text-center">
          <p className="text-xs" style={{ color: 'rgba(255, 255, 255, 0.35)' }}>{message}</p>
        </div>
      )}
    </div>
  )
}
