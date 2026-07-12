import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { toEnglishDigits } from '../../utils/format'
import { formatAccuracy } from '../../domain/location'
import { getCurrentLocation } from '../../services/gpsService'
import { lifeSignalService } from '../../services/lifeSignalService'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
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

interface Governorate { id: string; name_ar: string }
interface City { id: string; governorate_id: string; name_ar: string }

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
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [addressDetail, setAddressDetail] = useState('')
  const [location, setLocation] = useState<LocationState>({ latitude: null, longitude: null, accuracyMeters: null })
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

  const [governorates, setGovernorates] = useState<Governorate[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [selectedGov, setSelectedGov] = useState('')
  const [selectedCity, setSelectedCity] = useState('')
  const [street, setStreet] = useState('')
  const [landmark, setLandmark] = useState('')

  useEffect(() => {
    supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }).then(({ data }) => {
      if (data) setGovernorates(data as Governorate[])
    })
  }, [])

  useEffect(() => {
    if (!selectedGov) { setCities([]); setSelectedCity(''); return }
    supabase.from('reference_cities').select('id, governorate_id, name_ar').eq('governorate_id', selectedGov).order('name_ar', { ascending: true }).then(({ data }) => {
      if (data) setCities(data as City[])
    })
    setSelectedCity('')
  }, [selectedGov])

  const addressPreview = useMemo(() => {
    const parts: string[] = []
    const gov = governorates.find(g => g.id === selectedGov)
    const city = cities.find(c => c.id === selectedCity)
    if (gov) parts.push(gov.name_ar)
    if (city) parts.push(city.name_ar)
    if (street.trim()) parts.push(street.trim())
    if (landmark.trim()) parts.push(landmark.trim())
    return parts.join(' - ')
  }, [selectedGov, selectedCity, street, landmark, governorates, cities])

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
      const acc = result.location.accuracy
      if (acc > 50) {
        toast('⚠️ دقة الموقع الحالية ضعيفة (' + acc + 'م) — يفضل إعادة المحاولة للحصول على موقع أدق', { duration: 5000 })
      } else {
        toast.success('تم تحديد الموقع (' + acc + 'م)')
      }
    } else {
      toast.error(result.error?.message || 'فشل تحديد الموقع')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getToken()
    if (!token) { toast.error('جلسة منتهية'); return }
    if (!companyName.trim()) { toast.error('يرجى إدخال اسم النشاط التجاري'); return }
    if (!responsibleName.trim()) { toast.error('يرجى إدخال اسم المسؤول'); return }
    if (!businessType) { toast.error('يرجى اختيار نوع النشاط'); return }
    if (!phone.trim()) { toast.error('يرجى إدخال رقم الهاتف'); return }
    if (!/^01[0-9]{9}$/.test(phone.trim())) { toast.error('رقم الهاتف غير صالح (يجب أن يبدأ 01 ويتكون من 11 رقم)'); return }
    if (!password) { toast.error('يرجى إدخال كلمة المرور'); return }
    if (!/^\d{6}$/.test(password)) { toast.error('كلمة المرور يجب أن تكون 6 أرقام بالضبط'); return }
    if (password !== confirmPassword) { toast.error('كلمة المرور غير متطابقة'); return }
    if (!location.latitude || !location.longitude) { toast('⚠️ لم يتم تحديد الموقع الجغرافي — يمكنك إكمال التسجيل وسيتم تحديث الموقع لاحقاً', { duration: 6000 }) }

    setSaving(true)

    const args: Record<string, unknown> = {
      p_token: token,
      p_company_name: companyName.trim(),
      p_phone: phone.trim() || null,
      p_contact_name: responsibleName.trim() || null,
      p_contact_phone: phone.trim() || null,
      p_business_type: businessType || null,
      p_responsible_name: responsibleName.trim() || null,
      p_password: password || null,
      p_formatted_address: addressDetail.trim() || null,
      p_latitude: location.latitude,
      p_longitude: location.longitude,
      p_accuracy_meters: location.accuracyMeters,
      p_governorate_id: selectedGov || null,
      p_city_id: selectedCity || null,
      p_street_address: street.trim() || null,
      p_landmark: landmark.trim() || null,
    }

    const { data, error } = await supabase.rpc('governed_create_customer', args)
    setSaving(false)
    if (error) {
      if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
        toast.error('رقم الهاتف موجود مسبقاً')
      } else {
        toast.error('فشل إنشاء العميل: ' + error.message)
      }
      return
    }
    const res = data as any
    if (res?.error) { toast.error(res.error); return }
    lifeSignalService.notifyBusiness('customer_created')
    toast.success('تم إنشاء العميل بنجاح')
    navigate('/customers')
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/customers')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">إضافة عميل جديد</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-border p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text mb-1">اسم النشاط التجاري *</label>
          <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="اسم الشركة" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">رقم الهاتف *</label>
          <input type="tel" dir="ltr" placeholder="01xxxxxxxxx" value={phone} onChange={(e) => setPhone(toEnglishDigits(e.target.value))}
            maxLength={11} autoComplete="tel"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">اسم المسؤول *</label>
          <input type="text" value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" placeholder="الاسم الكامل" />
        </div>

        {/* Structured Address */}
        <div className="border-t border-border/50 pt-3 mt-1">
          <p className="text-xs font-semibold text-text mb-2">العنوان</p>
          <div className="space-y-2">
            <SearchableSelect
              label="المحافظة"
              options={governorates.map(g => ({ value: g.id, label: g.name_ar }))}
              value={selectedGov}
              onChange={setSelectedGov}
              placeholder="اختر المحافظة..."
            />
            <SearchableSelect
              label="المدينة"
              options={cities.map(c => ({ value: c.id, label: c.name_ar }))}
              value={selectedCity}
              onChange={setSelectedCity}
              placeholder={selectedGov ? 'اختر المدينة...' : 'اختر المحافظة أولاً'}
              disabled={!selectedGov}
            />
            <input type="text" value={street} onChange={(e) => setStreet(e.target.value)}
              placeholder="الشارع (اختياري)"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
            <input type="text" value={landmark} onChange={(e) => setLandmark(e.target.value)}
              placeholder="علامة مميزة (اختياري)"
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
            {addressPreview && (
              <div className="bg-surface rounded-lg px-3 py-2 text-xs text-text border border-border/50">
                <span className="text-text-secondary text-[10px]">📍 معاينة العنوان: </span>
                {addressPreview}
              </div>
            )}
          </div>
          {/* الوصف الإضافي مخفي حسب طلب العميل */}
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">نوع النشاط *</label>
          <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text">
            <option value="">-- اختر --</option>
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>{bt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">كلمة المرور *</label>
          <input type="password" dir="ltr" placeholder="••••••" value={password} onChange={(e) => setPassword(toEnglishDigits(e.target.value))}
            maxLength={6} autoComplete="new-password"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">تأكيد كلمة المرور *</label>
          <input type="password" dir="ltr" placeholder="••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(toEnglishDigits(e.target.value))}
            maxLength={6} autoComplete="new-password"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text mb-1">الموقع الجغرافي *</label>
          {location.latitude ? (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-green-700">✓ تم ({formatAccuracy(location.accuracyMeters).label})</span>
                <button type="button" onClick={() => setLocation({ latitude: null, longitude: null, accuracyMeters: null })}
                  className="text-xs text-primary font-semibold">تغيير</button>
              </div>
              <a href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-primary underline block">
                خريطة
              </a>
            </div>
          ) : (
            <button type="button" onClick={handleCaptureLocation} disabled={locating}
              className="w-full py-2 rounded-lg border-2 border-dashed border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              {locating ? (
                <span className="flex items-center justify-center gap-1">
                  جاري التحديد...
                </span>
              ) : '📍 الموقع الحالي'}
            </button>
          )}
          {location.latitude && (
            <button type="button" onClick={() => setLocation({ latitude: null, longitude: null, accuracyMeters: null })}
              className="text-[10px] text-text-secondary mt-1 block">
              إعادة تحديد الموقع
            </button>
          )}
        </div>

        <button type="submit" disabled={saving || !companyName.trim()}
          className="w-full bg-primary text-white text-sm py-3 rounded-lg font-semibold active:opacity-90 transition-colors disabled:opacity-40"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </form>
      </div>
    </div>
  )
}
