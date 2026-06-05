import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { locationService } from '../../services/location'
import toast from 'react-hot-toast'

const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: 'wholesaler', label: 'تاجر جملة' },
  { value: 'distributor', label: 'موزع' },
  { value: 'cosmetics_store', label: 'متجر مستحضرات تجميل' },
  { value: 'supermarket', label: 'سوبر ماركت' },
  { value: 'hypermarket', label: 'هايبر ماركت' },
  { value: 'perfume_store', label: 'متجر عطور / عطار' },
  { value: 'pharmacy', label: 'صيدلية' },
  { value: 'warehouse', label: 'مخزن' },
  { value: 'other', label: 'أخرى' },
]

interface LocationState {
  latitude: number | null
  longitude: number | null
  accuracyMeters: number | null
}

export function RegistrationPage() {
  const navigate = useNavigate()
  const { register } = useAuthStore()

  const [companyName, setCompanyName] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [addressDetail, setAddressDetail] = useState('')
  const [location, setLocation] = useState<LocationState>({ latitude: null, longitude: null, accuracyMeters: null })
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleCaptureLocation = async () => {
    setLocating(true)
    const result = await locationService.captureFreshLocation()
    setLocating(false)
    if (result.success && result.location) {
      setLocation({
        latitude: result.location.latitude,
        longitude: result.location.longitude,
        accuracyMeters: result.location.accuracy,
      })
      toast.success('تم تحديد الموقع بدقة ' + result.location.accuracy + 'م')
    } else {
      toast.error(result.error?.message || 'فشل تحديد الموقع')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!companyName.trim()) { toast.error('يرجى إدخال اسم النشاط التجاري'); return }
    if (!responsibleName.trim()) { toast.error('يرجى إدخال اسم المسؤول'); return }
    if (!businessType) { toast.error('يرجى اختيار نوع النشاط'); return }
    if (!phone.trim()) { toast.error('يرجى إدخال رقم الهاتف'); return }
    if (!/^01[0-9]{9}$/.test(phone.trim())) { toast.error('رقم الهاتف غير صالح (يجب أن يبدأ 01 ويتكون من 11 رقم)'); return }
    if (!password) { toast.error('يرجى إدخال كلمة المرور'); return }
    if (!/^\d{6}$/.test(password)) { toast.error('كلمة المرور يجب أن تكون 6 أرقام بالضبط'); return }
    if (password !== confirmPassword) { toast.error('كلمة المرور غير متطابقة'); return }
    if (!location.latitude || !location.longitude) { toast.error('يرجى تحديد الموقع الجغرافي'); return }

    setSubmitting(true)
    try {
      const result = await register({
        phone: phone.trim(),
        password,
        companyName: companyName.trim(),
        responsibleName: responsibleName.trim(),
        businessType,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters ?? 0,
        formattedAddress: addressDetail.trim() || undefined,
        email: email.trim() || undefined,
      })
      if (!result.success) {
        console.log('REGISTRATION FAILED — raw RPC error:', JSON.stringify(result.error))
        console.log('REGISTRATION FAILED — char codes:', Array.from(result.error || '').map(c => c.codePointAt(0)))
        toast.error(result.error || 'حدث خطأ في التسجيل')
        setSubmitting(false)
        return
      }
      toast.success('تم إنشاء الحساب بنجاح!')
      navigate('/storefront', { replace: true })
    } catch (err) {
      console.error('REGISTRATION EXCEPTION — raw error:', err)
      toast.error('حدث خطأ في الاتصال')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#071B4D' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 mx-auto mb-3 rounded-3xl flex items-center justify-center shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.12) 0%, rgba(201, 162, 39, 0.04) 100%)',
              border: '1px solid rgba(201, 162, 39, 0.15)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
            }}
          >
            <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="8" fill="#C9A227" />
              <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
            </svg>
          </div>
          <h1 className="text-lg font-bold text-white" style={{ letterSpacing: '0.02em' }}>شركة الأهرام</h1>
          <p className="text-xs mt-0.5 font-medium" style={{ color: '#E0B85A' }}>للتجارة والتوزيع</p>
        </div>

        {/* Glass Card */}
        <div className="glass-card p-5">
          <h2 className="text-lg font-bold text-white text-center mb-5">إنشاء حساب جديد</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>اسم النشاط التجاري *</label>
              <input
                type="text"
                placeholder="اسم الشركة أو النشاط"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="gold-input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>اسم المسؤول *</label>
              <input
                type="text"
                placeholder="الاسم الكامل للمسؤول"
                value={responsibleName}
                onChange={(e) => setResponsibleName(e.target.value)}
                className="gold-input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>نوع النشاط *</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="gold-input"
                style={{ color: businessType ? '#ffffff' : 'rgba(255,255,255,0.35)' }}
              >
                <option value="" style={{ background: '#0B3D91', color: 'rgba(255,255,255,0.5)' }}>-- اختر نوع النشاط --</option>
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value} style={{ background: '#0B3D91', color: '#ffffff' }}>{bt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>رقم الهاتف *</label>
              <input
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={11}
                className="gold-input"
                autoComplete="tel"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>البريد الإلكتروني (اختياري)</label>
              <input
                type="email"
                dir="ltr"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="gold-input"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>كلمة المرور *</label>
              <input
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={6}
                className="gold-input"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>تأكيد كلمة المرور *</label>
              <input
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                maxLength={6}
                className="gold-input"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>الموقع الجغرافي *</label>
              {location.latitude ? (
                <div
                  className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{
                    background: 'rgba(201, 162, 39, 0.08)',
                    border: '1px solid rgba(201, 162, 39, 0.15)',
                  }}
                >
                  <div className="text-xs">
                    <span style={{ color: '#E0B85A' }}>✓ تم تحديد الموقع</span>
                    <span className="mr-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      ({locationService.formatAccuracy(location.accuracyMeters).detail} - {locationService.formatAccuracy(location.accuracyMeters).label})
                    </span>
                  </div>
                  <a
                    href={locationService.buildGoogleMapsUrl(location.latitude!, location.longitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold hover:underline" style={{ color: '#C9A227' }}
                  >
                    فتح الخريطة
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCaptureLocation}
                  disabled={locating}
                  className="btn-outline"
                  style={{ padding: '14px' }}
                >
                  {locating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="gold-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                      جاري تحديد الموقع...
                    </span>
                  ) : (
                    '📍 استخدم الموقع الحالي'
                  )}
                </button>
              )}
              {location.latitude && (
                <button
                  type="button"
                  onClick={() => setLocation({ latitude: null, longitude: null, accuracyMeters: null })}
                  className="text-xs mt-1.5 hover:underline"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  إعادة تحديد الموقع
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>العنوان التفصيلي (اختياري)</label>
              <textarea
                placeholder="عنوان إضافي مثل اسم الشارع أو المبنى"
                value={addressDetail}
                onChange={(e) => setAddressDetail(e.target.value)}
                rows={2}
                className="gold-input resize-none"
              />
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={submitting}
                className="btn-gold"
              >
                {submitting ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
              </button>

              <Link to="/login" className="block text-center text-xs font-semibold hover:underline pt-1" style={{ color: '#C9A227' }}>
                لديك حساب بالفعل؟ سجل دخولك
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
