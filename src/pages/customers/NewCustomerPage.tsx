import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
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

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function NewCustomerPage() {
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [city, setCity] = useState('القاهرة')
  const [creditLimit, setCreditLimit] = useState('')
  const [creditDays, setCreditDays] = useState('')
  const [location, setLocation] = useState<LocationState>({ latitude: null, longitude: null, accuracyMeters: null })
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

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
      toast.success('تم تحديد الموقع (' + result.location.accuracy + 'م)')
    } else {
      toast.error(result.error?.message || 'فشل تحديد الموقع')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }
    if (!companyName.trim()) { toast.error('يرجى إدخال اسم العميل'); return }
    if (password && password !== confirmPassword) { toast.error('كلمة المرور غير متطابقة'); return }

    setSaving(true)

    const args: Record<string, unknown> = {
      p_token: token,
      p_company_name: companyName.trim(),
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
      p_contact_name: contactName.trim() || null,
      p_contact_phone: contactPhone.trim() || null,
      p_address_line1: addressLine1.trim() || null,
      p_city: city || 'القاهرة',
      p_region: null,
      p_business_type: businessType || null,
      p_responsible_name: responsibleName.trim() || null,
      p_password: password || null,
      p_credit_limit: creditLimit ? parseFloat(creditLimit) : null,
      p_credit_days: creditDays ? parseInt(creditDays) : null,
    }

    if (location.latitude && location.longitude) {
      args.p_latitude = location.latitude
      args.p_longitude = location.longitude
      args.p_accuracy_meters = location.accuracyMeters
    }

    const { data, error } = await supabase.rpc('governed_create_customer', args)
    setSaving(false)
    if (error) { toast.error('فشل إنشاء العميل: ' + error.message); return }
    const res = data as any
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم إنشاء العميل بنجاح')
    navigate('/customers')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/customers')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إضافة عميل جديد</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-border p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">اسم العميل *</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="اسم الشركة" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">اسم المسؤول</label>
            <input type="text" value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="اسم المسؤول" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">نوع النشاط</label>
          <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text">
            <option value="">-- اختر --</option>
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>{bt.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">رقم الهاتف</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="01xxxxxxxxx" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">البريد الإلكتروني</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="email@example.com" dir="ltr" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">كلمة المرور</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="كلمة المرور" maxLength={6} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">تأكيد كلمة المرور</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="تأكيد كلمة المرور" maxLength={6} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">جهة اتصال</label>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="اسم جهة الاتصال" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">هاتف جهة الاتصال</label>
            <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="رقم الهاتف" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">الموقع الجغرافي</label>
          {location.latitude ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <span className="text-xs text-green-700">✓ تم — {locationService.formatAccuracy(location.accuracyMeters).label} ({location.accuracyMeters}م)</span>
                <button type="button" onClick={() => setLocation({ latitude: null, longitude: null, accuracyMeters: null })}
                  className="text-xs text-primary font-semibold">تغيير</button>
              </div>
          ) : (
            <button type="button" onClick={handleCaptureLocation} disabled={locating}
              className="w-full py-2 rounded-lg border-2 border-dashed border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              {locating ? 'جاري...' : '📍 التقاط موقع العميل'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">العنوان</label>
            <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="العنوان (اختياري)" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">المدينة</label>
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">الحد الائتماني</label>
            <input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="0" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">فترة الائتمان (أيام)</label>
            <input type="number" value={creditDays} onChange={(e) => setCreditDays(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="0" />
          </div>
        </div>

        <button type="submit" disabled={saving || !companyName.trim()}
          className="w-full bg-primary text-white text-sm py-3 rounded-lg font-semibold active:opacity-90 transition-colors disabled:opacity-40"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </form>
    </div>
  )
}
