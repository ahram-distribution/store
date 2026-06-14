import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { toEnglishDigits } from '../../utils/format'
import { locationService } from '../../services/location'
import { getCurrentLocation } from '../../services/gpsService'
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
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [addressDetail, setAddressDetail] = useState('')
  const [location, setLocation] = useState<LocationState>({ latitude: null, longitude: null, accuracyMeters: null })
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleCaptureLocation = async () => {
    setLocating(true)
    const result = await getCurrentLocation()
    setLocating(false)
    if (result.success && result.location) {
      setLocation({
        latitude: result.location.latitude,
        longitude: result.location.longitude,
        accuracyMeters: result.location.accuracy,
      })
    } else {
      toast.error(result.error?.message || 'تعذر الحصول على الموقع')
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
      })
      if (!result.success) {
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
    <div className="min-h-screen" style={{ background: '#071B4D', padding: '16px 16px 24px' }}>

      {/* ── HEADER ── */}
      <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
        <img
          src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`}
          alt="الأهرام"
          style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }}
        />
        <div className="flex-1 min-w-0">
          <div style={{ color: '#C9A227', fontWeight: 700, fontSize: 24, lineHeight: 1.2 }}>
            شركة الأهرام للتجارة والتوزيع
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            سجل نشاطك التجاري للانضمام إلى شبكة التوزيع
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── SECTION 1 — بيانات النشاط ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#C9A227', fontWeight: 700, fontSize: 16 }}>بيانات النشاط</div>
          <div style={{ height: 1, background: 'rgba(201,162,39,.25)', marginTop: 8, marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>اسم النشاط التجاري *</label>
              <input
                type="text"
                placeholder="اسم الشركة"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="gold-input input-capsule"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>نوع النشاط *</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="gold-input input-capsule"
                style={{ color: businessType ? '#ffffff' : 'rgba(255,255,255,0.35)' }}
              >
                <option value="" style={{ background: '#0B3D91', color: 'rgba(255,255,255,0.5)' }}>-- اختر --</option>
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value} style={{ background: '#0B3D91', color: '#ffffff' }}>{bt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── SECTION 2 — بيانات المسؤول ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#C9A227', fontWeight: 700, fontSize: 16 }}>بيانات المسؤول</div>
          <div style={{ height: 1, background: 'rgba(201,162,39,.25)', marginTop: 8, marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>اسم المسؤول *</label>
              <input
                type="text"
                placeholder="الاسم الكامل"
                value={responsibleName}
                onChange={(e) => setResponsibleName(e.target.value)}
                className="gold-input input-capsule"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>رقم الهاتف *</label>
              <input
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(toEnglishDigits(e.target.value))}
                maxLength={11}
                className="gold-input input-capsule"
                autoComplete="tel"
              />
            </div>
          </div>
        </div>

        {/* ── SECTION 3 — بيانات الموقع والحساب ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#C9A227', fontWeight: 700, fontSize: 16 }}>بيانات الموقع والحساب</div>
          <div style={{ height: 1, background: 'rgba(201,162,39,.25)', marginTop: 8, marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>العنوان</label>
              <textarea
                placeholder="العنوان بالتفصيل"
                value={addressDetail}
                onChange={(e) => setAddressDetail(e.target.value)}
                rows={1}
                className="gold-input input-capsule"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>📍 الموقع الجغرافي *</label>
              {location.latitude ? (
                <div
                  className="flex items-center justify-between"
                  style={{
                    height: 52,
                    padding: '0 20px',
                    borderRadius: 999,
                    background: '#173872',
                    border: '1px solid rgba(201, 162, 39, 0.2)',
                    fontSize: 13,
                  }}
                >
                  <div>
                    <span style={{ color: '#E0B85A', fontWeight: 600 }}>✓ تم تحديد الموقع بنجاح</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 6 }}>
                      ({locationService.formatAccuracy(location.accuracyMeters).label})
                    </span>
                  </div>
                  <a
                    href={locationService.buildGoogleMapsUrl(location.latitude!, location.longitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#C9A227', fontSize: 12, fontWeight: 600, flexShrink: 0 }}
                  >
                    خريطة
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCaptureLocation}
                  disabled={locating}
                  className="gold-input input-capsule"
                  style={{
                    height: 52,
                    borderRadius: 999,
                    background: '#173872',
                    border: '1px solid rgba(201, 162, 39, 0.2)',
                    color: '#C9A227',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: locating ? 'not-allowed' : 'pointer',
                    textAlign: 'center',
                    WebkitAppearance: 'none',
                  }}
                >
                  {locating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="gold-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      جاري التحديد...
                    </span>
                  ) : (
                    '📍 تحديد الموقع الحالي'
                  )}
                </button>
              )}
              {location.latitude && (
                <button
                  type="button"
                  onClick={() => setLocation({ latitude: null, longitude: null, accuracyMeters: null })}
                  style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', display: 'block', marginTop: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                >
                  إعادة تحديد الموقع
                </button>
              )}
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>كلمة المرور *</label>
              <input
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(toEnglishDigits(e.target.value))}
                maxLength={6}
                className="gold-input input-capsule"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'block', marginBottom: 6 }}>تأكيد كلمة المرور *</label>
              <input
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(toEnglishDigits(e.target.value))}
                maxLength={6}
                className="gold-input input-capsule"
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {/* ── SUBMIT ── */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #C9A227 0%, #E0B85A 100%)',
            color: '#071B4D',
            fontSize: 17,
            fontWeight: 700,
            border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.5 : 1,
            WebkitAppearance: 'none',
          }}
        >
          {submitting ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
          <Link to="/login" style={{ color: '#C9A227', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            لديك حساب بالفعل؟ سجل دخولك
          </Link>
        </div>

      </form>
    </div>
  )
}
