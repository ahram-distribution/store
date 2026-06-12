import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toEnglishDigits } from '../../utils/format'
import { useAuthStore } from '../../store/auth'
import { useCompanyProfile } from '../../hooks/useCompanyProfile'
import toast from 'react-hot-toast'

interface ContactEntry {
  label: string
  value: string
  href?: string
  external?: boolean
}

function buildContactEntries(p: NonNullable<ReturnType<typeof useCompanyProfile>['profile']>): ContactEntry[] {
  return [
    p.sales_phone_1 ? { label: 'هاتف المبيعات 1', value: p.sales_phone_1, href: `tel:${p.sales_phone_1}` } : { label: 'هاتف المبيعات 1', value: 'غير متوفر' },
    p.sales_phone_2 ? { label: 'هاتف المبيعات 2', value: p.sales_phone_2, href: `tel:${p.sales_phone_2}` } : { label: 'هاتف المبيعات 2', value: 'غير متوفر' },
    p.sales_whatsapp_1 ? { label: 'واتساب المبيعات 1', value: p.sales_whatsapp_1, href: `https://wa.me/${p.sales_whatsapp_1.replace(/^0+/, '20')}`, external: true } : { label: 'واتساب المبيعات 1', value: 'غير متوفر' },
    p.sales_whatsapp_2 ? { label: 'واتساب المبيعات 2', value: p.sales_whatsapp_2, href: `https://wa.me/${p.sales_whatsapp_2.replace(/^0+/, '20')}`, external: true } : { label: 'واتساب المبيعات 2', value: 'غير متوفر' },
    p.technical_support_phone ? { label: 'الدعم الفني', value: p.technical_support_phone, href: `https://wa.me/${p.technical_support_phone.replace(/^0+/, '20')}`, external: true } : { label: 'الدعم الفني', value: 'غير متوفر' },
    p.facebook_url ? { label: 'صفحة فيسبوك', value: 'فيسبوك', href: p.facebook_url, external: true } : { label: 'صفحة فيسبوك', value: 'غير متوفر' },
  ]
}

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const { profile } = useCompanyProfile()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null)
  const [showContactSheet, setShowContactSheet] = useState(false)
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const phoneRef = useRef<HTMLInputElement>(null)

  useEffect(() => { phoneRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const handler = () => setDeferredPrompt(null)
    window.addEventListener('appinstalled', handler)
    return () => window.removeEventListener('appinstalled', handler)
  }, [])

  const handleInstallClick = () => {
    if (deferredPrompt) {
      ;(deferredPrompt as any).prompt()
      ;(deferredPrompt as any).userChoice.then(() => setDeferredPrompt(null))
    } else {
      setShowInstallDialog(true)
    }
  }

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
      navigate(state.user?.identity_type === 'employee' ? '/dashboard' : '/storefront', { replace: true })
    } catch {
      toast.error('حدث خطأ في الاتصال')
      setSubmitting(false)
    }
  }

  const contactEntries = profile ? buildContactEntries(profile) : []
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const isAndroid = /android/.test(ua)
  const isIPhone = /iphone|ipad|ipod/.test(ua)

  return (
    <div style={{ background: '#071B4D', minHeight: '100vh' }}>
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '20px 20px 12px' }}>

        {/* ── HEADER ── */}
        <div style={{ textAlign: 'center' }}>
          <img
            src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`}
            alt="الأهرام"
            style={{ width: 72, height: 72, display: 'inline-block' }}
          />
          <div style={{ color: '#E0B85A', fontSize: 20, fontWeight: 700, marginTop: 8 }}>
            الأهرام للتجارة والتوزيع
          </div>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            منصة إدارة الطلبات والمبيعات والتوزيع
          </div>
        </div>

        {/* ── LOGIN CARD ── */}
        <div style={{
          background: '#0F2B5B',
          border: '1px solid #C9A227',
          borderRadius: 14,
          padding: 12,
          marginTop: 14,
        }}>
          <form onSubmit={handleSubmit}>
            <input
              ref={phoneRef}
              type="tel"
              inputMode="numeric"
              dir="ltr"
              placeholder="رقم الهاتف"
              value={phone}
              onChange={(e) => setPhone(toEnglishDigits(e.target.value))}
              autoComplete="tel"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                background: '#071B4D',
                border: '1px solid #C9A227',
                color: '#ffffff',
                fontSize: 14,
                outline: 'none',
                WebkitAppearance: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 8 }}>
              <input
                type="password"
                dir="ltr"
                placeholder="كلمة المرور"
                value={password}
                onChange={(e) => setPassword(toEnglishDigits(e.target.value))}
                autoComplete="current-password"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 10,
                  background: '#071B4D',
                  border: '1px solid #C9A227',
                  color: '#ffffff',
                  fontSize: 14,
                  outline: 'none',
                  WebkitAppearance: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: 13,
                borderRadius: 10,
                background: submitting ? '#a3851f' : '#C9A227',
                color: '#071B4D',
                fontSize: 15,
                fontWeight: 700,
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                marginTop: 12,
              }}
            >
              {submitting ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/register')}
              style={{
                width: '100%',
                padding: 13,
                borderRadius: 10,
                background: 'transparent',
                color: '#C9A227',
                fontSize: 15,
                fontWeight: 600,
                border: '1px solid #C9A227',
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              إنشاء حساب جديد
            </button>
          </form>
        </div>

        {/* ── CONTACT BUTTON ── */}
        <button
          type="button"
          onClick={() => setShowContactSheet(true)}
          style={{
            width: '100%',
            padding: 13,
            borderRadius: 10,
            background: '#0F2B5B',
            border: '1px solid #C9A227',
            color: '#C9A227',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            marginTop: 10,
          }}
        >
          {'\uD83D\uDCDE'} تواصل معنا
        </button>

        {/* ── INSTALL BUTTON ── */}
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            width: '100%',
            padding: 13,
            borderRadius: 10,
            background: '#0F2B5B',
            border: '1px solid #1a3a6e',
            color: '#C9A227',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            marginTop: 8,
          }}
        >
          {'\u2B07'} تثبيت التطبيق
        </button>

      </div>

      {/* ── CONTACT BOTTOM SHEET ── */}
      {showContactSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setShowContactSheet(false)} style={{ flex: 1 }} />
          <div style={{
            background: '#0F2B5B',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            border: '1px solid #C9A227',
            borderBottom: 'none',
            maxHeight: '75vh',
            overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #1a3a6e' }}>
              <span style={{ color: '#E0B85A', fontSize: 15, fontWeight: 700 }}>تواصل معنا</span>
              <button
                type="button"
                onClick={() => setShowContactSheet(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 20, cursor: 'pointer', padding: 4 }}
              >
                {'\u2716'}
              </button>
            </div>
            <div style={{ padding: '8px 0' }}>
              {contactEntries.length === 0 ? (
                <>
                  {[
                    { label: 'هاتف المبيعات 1', value: 'غير متوفر' },
                    { label: 'هاتف المبيعات 2', value: 'غير متوفر' },
                    { label: 'واتساب المبيعات 1', value: 'غير متوفر' },
                    { label: 'واتساب المبيعات 2', value: 'غير متوفر' },
                    { label: 'الدعم الفني', value: 'غير متوفر' },
                    { label: 'صفحة فيسبوك', value: 'غير متوفر' },
                  ].map((item, i) => (
                    <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid #1a3a6e' }}>
                      <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                      <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{item.value}</div>
                    </div>
                  ))}
                </>
              ) : (
                contactEntries.map((item, i) => {
                  const row = (
                    <div style={{ padding: '12px 16px', borderBottom: i < contactEntries.length - 1 ? '1px solid #1a3a6e' : 'none' }}>
                      <div style={{ color: '#E0B85A', fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                      <div style={{ color: item.href ? '#ffffff' : '#6b7280', fontSize: 13, marginTop: 4, direction: 'ltr' }}>{item.value}</div>
                    </div>
                  )
                  return item.href ? (
                    <a key={i} href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined} style={{ textDecoration: 'none', display: 'block' }}>
                      {row}
                    </a>
                  ) : (
                    <div key={i}>{row}</div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── INSTALL DIALOG ── */}
      {showInstallDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setShowInstallDialog(false)} style={{ position: 'fixed', inset: 0, background: '#000' }} />
          <div style={{
            position: 'relative',
            background: '#0F2B5B',
            border: '1px solid #C9A227',
            borderRadius: 16,
            padding: 24,
            margin: 20,
            maxWidth: 340,
            width: '100%',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#E0B85A', fontSize: 16, fontWeight: 700 }}>{'\u2B07'} تثبيت التطبيق</div>
              <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 16, lineHeight: 1.6 }}>
                {isAndroid && !deferredPrompt ? (
                  'افتح قائمة المتصفح ثم اختر\nإضافة إلى الشاشة الرئيسية'
                ) : isIPhone ? (
                  'اضغط مشاركة\nثم إضافة إلى الشاشة الرئيسية'
                ) : !deferredPrompt ? (
                  'استخدم خيار\nInstall App أو Add To Desktop\nحسب إمكانيات المتصفح'
                ) : (
                  'يمكنك تثبيت التطبيق\nللوصول السريع من الشاشة الرئيسية'
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowInstallDialog(false)}
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 10,
                  background: '#C9A227',
                  color: '#071B4D',
                  fontSize: 14,
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  marginTop: 20,
                }}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
