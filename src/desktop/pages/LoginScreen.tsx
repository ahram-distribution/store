import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../../store/auth'

export function LoginScreen() {
  const login = useAuthStore((s) => s.login)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!phone.trim() || !password.trim()) {
      setError('يرجى إدخال رقم الهاتف وكلمة المرور')
      return
    }
    setError('')
    setSubmitting(true)
    const result = await login(phone.trim(), password)
    setSubmitting(false)
    if (!result.success) {
      setError(result.error || 'فشل تسجيل الدخول')
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0B3D91 0%, #062559 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(201, 162, 39, 0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.97)',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.15)',
          width: 380,
          padding: '40px 32px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #0B3D91, #062559)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            fontSize: 28,
            color: '#C9A227',
            fontWeight: 700,
          }}
        >
          أ
        </div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#0F172A',
            margin: 0,
            marginBottom: 4,
          }}
        >
          الأهرام للتجارة والتوزيع
        </h1>
        <p
          style={{
            fontSize: 13,
            color: '#94A3B8',
            margin: '0 0 28px',
          }}
        >
          نظام تشغيل التوزيع والمبيعات المتكامل
        </p>
        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>رقم الهاتف</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="أدخل رقم الهاتف"
              autoFocus
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                background: '#F8FAFC',
                transition: 'border-color 150ms ease',
                direction: 'rtl',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#0B3D91')}
              onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                background: '#F8FAFC',
                transition: 'border-color 150ms ease',
                direction: 'rtl',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#0B3D91')}
              onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
            />
          </div>
          {error && (
            <div
              style={{
                padding: '8px 12px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 8,
                color: '#DC2626',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 0',
              border: 'none',
              borderRadius: 8,
              background: submitting ? '#94A3B8' : 'linear-gradient(135deg, #0B3D91, #0A357E)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'opacity 150ms ease',
              marginTop: 4,
            }}
          >
            {submitting ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>
        <p style={{ fontSize: 11, color: '#CBD5E1', marginTop: 24, textAlign: 'center' }}>
          شركة الأهرام للتجارة والتوزيع © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
