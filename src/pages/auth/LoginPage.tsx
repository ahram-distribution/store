import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import toast from 'react-hot-toast'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone.trim() || !password.trim()) {
      toast.error('برجاء إدخال رقم الهاتف وكلمة المرور')
      return
    }
    setSubmitting(true)
    try {
      const result = await login(phone.trim(), password)
      if (!result.success) {
        toast.error('بيانات الدخول غير صحيحة')
        setSubmitting(false)
        return
      }

      const state = useAuthStore.getState()
      if (state.user?.identity_type === 'employee') {
        navigate('/dashboard', { replace: true })
      } else {
        navigate('/storefront', { replace: true })
      }
    } catch {
      toast.error('حدث خطأ في الاتصال')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5" style={{ background: '#071B4D' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div
            className="w-20 h-20 mx-auto mb-4 rounded-3xl flex items-center justify-center shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.12) 0%, rgba(201, 162, 39, 0.04) 100%)',
              border: '1px solid rgba(201, 162, 39, 0.15)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
            }}
          >
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="8" fill="#C9A227" />
              <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white" style={{ letterSpacing: '0.02em' }}>شركة الأهرام</h1>
          <p className="text-sm mt-0.5 font-medium" style={{ color: '#E0B85A' }}>للتجارة والتوزيع</p>
        </div>

        {/* Glass Card */}
        <div className="glass-card p-6">
          {/* Title */}
          <h2 className="text-2xl font-bold text-white text-center mb-1">مرحباً بك</h2>
          <p className="text-sm text-center mb-7" style={{ color: 'rgba(255, 255, 255, 0.5)' }}>سجل الدخول للوصول إلى حسابك</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>رقم الهاتف</label>
              <input
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="gold-input"
                autoComplete="tel"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>كلمة المرور</label>
              <input
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="gold-input"
                autoComplete="current-password"
              />
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={submitting}
                className="btn-gold"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-[#071B4D] border-t-transparent rounded-full animate-spin" />
                    جاري تسجيل الدخول
                  </span>
                ) : (
                  'تسجيل الدخول'
                )}
              </button>

              <button
                type="button"
                onClick={() => navigate('/register')}
                className="btn-outline"
              >
                إنشاء حساب جديد
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
