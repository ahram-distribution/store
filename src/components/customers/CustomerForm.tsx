import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { toEnglishDigits } from '../../utils/format'
import { getCurrentLocation } from '../../services/gpsService'
import { SearchableSelect } from '../shared/SearchableSelect'
import { CUSTOMER_BUSINESS_TYPES, validateCustomerPhone } from '../../lib/customerConstants'
import toast from 'react-hot-toast'

interface Governorate { id: string; name_ar: string }

export interface CustomerFormData {
  companyName: string
  phone: string
  contactName: string
  businessType: string
  governorateId: string
  city: string
  streetAddress: string
  latitude: number | null
  longitude: number | null
  accuracyMeters: number | null
  password?: string
}

export interface CustomerFormProps {
  mode: 'internal' | 'registration' | 'modal'
  onSubmit: (data: CustomerFormData) => Promise<void>
  onCancel?: () => void
  initialData?: Partial<CustomerFormData>
  ownerId?: string
  teamMembers?: Array<{ employee_id: string; employee_name: string }>
  onOwnerChange?: (ownerId: string) => void
  compact?: boolean
  editMode?: boolean
}

const EMPTY: CustomerFormData = {
  companyName: '',
  phone: '',
  contactName: '',
  businessType: '',
  governorateId: '',
  city: '',
  streetAddress: '',
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  password: '',
}

export function CustomerForm({
  mode,
  onSubmit,
  onCancel,
  initialData,
  ownerId,
  teamMembers,
  onOwnerChange,
  compact = false,
  editMode = false,
}: CustomerFormProps) {
  const [form, setForm] = useState<CustomerFormData>({ ...EMPTY, ...initialData })
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [governorates, setGovernorates] = useState<Governorate[]>([])

  const set = useCallback(<K extends keyof CustomerFormData>(key: K, val: CustomerFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: val }))
  }, [])

  useEffect(() => {
    supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }).then(({ data }) => {
      if (data) setGovernorates(data as Governorate[])
    })
  }, [])

  const handleCaptureLocation = async () => {
    setLocating(true)
    const result = await getCurrentLocation()
    setLocating(false)
    if (result.success && result.location) {
      set('latitude', result.location.latitude)
      set('longitude', result.location.longitude)
      set('accuracyMeters', result.location.accuracy)
      const acc = result.location.accuracy
      if (acc > 50) {
        toast('⚠️ دقة الموقع الحالية ضعيفة (' + acc + 'م) — يفضل إعادة المحاولة', { duration: 5000 })
      } else {
        toast.success('تم تحديد الموقع (' + acc + 'م)')
      }
    } else {
      toast.error(result.error?.message || 'فشل تحديد الموقع')
    }
  }

  const validate = (): string | null => {
    if (!form.companyName.trim()) return 'يرجى إدخال اسم النشاط التجاري'
    if (!form.contactName.trim()) return 'يرجى إدخال اسم المسؤول'
    if (!form.businessType) return 'يرجى اختيار نوع النشاط'
    const phoneErr = validateCustomerPhone(form.phone)
    if (phoneErr) return phoneErr
    if (!form.governorateId) return 'يرجى اختيار المحافظة'
    if (!form.city.trim()) return 'يرجى إدخال المدينة'
    if (!form.streetAddress.trim()) return 'يرجى إدخال الشارع'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) { toast.error(err); return }
    if (!form.latitude || !form.longitude) {
      toast('⚠️ لم يتم تحديد الموقع — يمكنك إكمال التسجيل وسيتم تحديث الموقع لاحقاً', { duration: 6000 })
    }
    setSubmitting(true)
    try {
      await onSubmit({ ...form })
    } catch {
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = compact
    ? 'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'
    : 'w-full border border-border rounded-xl px-4 py-3 text-sm bg-white text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'

  const labelClass = compact ? 'block text-[11px] font-semibold text-text-secondary mb-1' : 'block text-xs font-semibold text-text mb-1.5'

  const sectionTitle = compact ? 'text-xs font-bold text-primary mb-2' : 'text-sm font-bold text-primary mb-3'

  if (mode === 'registration') {
    return (
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <div className={sectionTitle}>بيانات النشاط</div>
          <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">اسم النشاط التجاري *</label>
              <input type="text" placeholder="اسم الشركة" value={form.companyName}
                onChange={e => set('companyName', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">نوع النشاط *</label>
              <select value={form.businessType} onChange={e => set('businessType', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors"
                style={{ color: form.businessType ? '#fff' : 'rgba(255,255,255,0.35)' }}>
                <option value="" style={{ background: '#0B3D91' }}>-- اختر --</option>
                {CUSTOMER_BUSINESS_TYPES.map(bt => (
                  <option key={bt.value} value={bt.value} style={{ background: '#0B3D91', color: '#fff' }}>{bt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <div className={sectionTitle}>بيانات المسؤول</div>
          <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">اسم المسؤول *</label>
              <input type="text" placeholder="الاسم الكامل" value={form.contactName}
                onChange={e => set('contactName', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">رقم الهاتف *</label>
              <input type="tel" dir="ltr" placeholder="01xxxxxxxxx" value={form.phone}
                onChange={e => set('phone', toEnglishDigits(e.target.value))}
                maxLength={11} autoComplete="tel"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors" />
            </div>
          </div>
        </div>

        <div>
          <div className={sectionTitle}>العنوان</div>
          <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">المحافظة *</label>
              <select value={form.governorateId} onChange={e => { set('governorateId', e.target.value); set('city', '') }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors"
                style={{ color: form.governorateId ? '#fff' : 'rgba(255,255,255,0.35)' }}>
                <option value="" style={{ background: '#0B3D91' }}>اختر المحافظة...</option>
                {governorates.map(g => (
                  <option key={g.id} value={g.id} style={{ background: '#0B3D91', color: '#fff' }}>{g.name_ar}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">المدينة *</label>
              <input type="text" placeholder="اسم المدينة" value={form.city}
                onChange={e => set('city', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-white/50 mb-1.5 block">الشارع *</label>
              <input type="text" placeholder="الشارع والمنطقة" value={form.streetAddress}
                onChange={e => set('streetAddress', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-colors" />
            </div>
          </div>
        </div>

        <div>
          <div className={sectionTitle}>الموقع الجغرافي</div>
          <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />
          {form.latitude ? (
            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <span className="text-xs text-green-400 font-semibold">✓ تم تحديد الموقع</span>
              <button type="button" onClick={() => { set('latitude', null); set('longitude', null); set('accuracyMeters', null) }}
                className="text-xs text-primary font-semibold">تغيير</button>
            </div>
          ) : (
            <button type="button" onClick={handleCaptureLocation} disabled={locating}
              className="w-full py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {locating ? (
                <><span className="gold-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> جاري التحديد...</>
              ) : (
                <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> تحديد الموقع الحالي</>
              )}
            </button>
          )}
        </div>

        <button type="submit" disabled={submitting}
          className="w-full py-3.5 rounded-xl font-bold text-sm border-none cursor-pointer transition-all disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #C9A227 0%, #E0B85A 100%)',
            color: '#071B4D',
            fontSize: 15,
          }}>
          {submitting ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
        </button>
      </form>
    )
  }

  // Internal, Modal & Edit modes
  return (
    <form onSubmit={handleSubmit} className={compact ? 'space-y-3' : 'space-y-5'}>
      {/* Business Information */}
      <div>
        <div className={sectionTitle}>بيانات النشاط</div>
        {!compact && <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />}
        <div className={compact ? 'space-y-2' : 'space-y-3'}>
          <div>
            <label className={labelClass}>اسم النشاط التجاري *</label>
            <input type="text" placeholder="اسم الشركة" value={form.companyName}
              onChange={e => set('companyName', e.target.value)}
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>اسم المسؤول *</label>
            <input type="text" placeholder="الاسم الكامل" value={form.contactName}
              onChange={e => set('contactName', e.target.value)}
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>رقم الهاتف *</label>
            <input type="tel" dir="ltr" placeholder="01xxxxxxxxx" value={form.phone}
              onChange={e => set('phone', toEnglishDigits(e.target.value))}
              maxLength={11} autoComplete="tel"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>نوع النشاط *</label>
            <select value={form.businessType} onChange={e => set('businessType', e.target.value)}
              className={`${inputClass} bg-white`}>
              <option value="">-- اختر --</option>
              {CUSTOMER_BUSINESS_TYPES.map(bt => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Address */}
      <div>
        <div className={sectionTitle}>العنوان</div>
        {!compact && <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />}
        <div className={compact ? 'space-y-2' : 'space-y-3'}>
          <div>
            <label className={labelClass}>المحافظة *</label>
            <SearchableSelect
              options={governorates.map(g => ({ value: g.id, label: g.name_ar }))}
              value={form.governorateId}
              onChange={v => set('governorateId', v)}
              placeholder="اختر المحافظة..."
            />
          </div>
          <div>
            <label className={labelClass}>المدينة *</label>
            <input type="text" placeholder="اسم المدينة" value={form.city}
              onChange={e => set('city', e.target.value)}
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>الشارع *</label>
            <input type="text" placeholder="الشارع والمنطقة" value={form.streetAddress}
              onChange={e => set('streetAddress', e.target.value)}
              className={inputClass} />
          </div>
        </div>
      </div>

      {/* Location */}
      <div>
        <div className={sectionTitle}>الموقع الجغرافي</div>
        {!compact && <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />}
        {form.latitude ? (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs text-green-700 font-semibold">✓ تم تحديد الموقع</span>
              {form.accuracyMeters && <span className="text-[10px] text-green-600 mr-2">({form.accuracyMeters.toFixed(0)}م)</span>}
            </div>
            <button type="button" onClick={() => { set('latitude', null); set('longitude', null); set('accuracyMeters', null) }}
              className="text-xs text-primary font-semibold hover:underline">تغيير</button>
          </div>
        ) : (
          <button type="button" onClick={handleCaptureLocation} disabled={locating}
            className="w-full py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {locating ? (
              <><span className="gold-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> جاري التحديد...</>
            ) : (
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> تحديد الموقع الحالي</>
            )}
          </button>
        )}
      </div>

      {/* Password — Edit mode ONLY */}
      {editMode && (
        <div>
          <div className={sectionTitle}>كلمة المرور</div>
          {!compact && <div className="h-px bg-gradient-to-r from-primary/30 to-transparent mb-3" />}
          <div>
            <label className={labelClass}>كلمة المرور الجديدة (اتركها فارغة للإبقاء)</label>
            <input type="password" placeholder="اتركها فارغة nếu لا تريد التغيير" value={form.password || ''}
              onChange={e => set('password', e.target.value)}
              maxLength={6} className={inputClass} />
          </div>
        </div>
      )}

      {/* Owner Assignment (modal mode only) */}
      {mode === 'modal' && teamMembers && teamMembers.length > 0 && (
        <div>
          <div className={sectionTitle}>ownership</div>
          <select value={ownerId || ''} onChange={e => onOwnerChange?.(e.target.value)}
            className={`${inputClass} bg-white`}>
            <option value="">نفسي (المدير)</option>
            {teamMembers.map(m => (
              <option key={m.employee_id} value={m.employee_id}>{m.employee_name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Submit */}
      <div className={compact ? 'pt-1' : 'pt-2'}>
        <button type="submit" disabled={submitting || !form.companyName.trim()}
          className="w-full bg-primary text-white text-sm py-3 rounded-xl font-bold active:scale-[0.98] transition-all disabled:opacity-40 shadow-lg shadow-primary/20">
          {submitting ? 'جاري الحفظ...' : (editMode ? 'حفظ التعديلات' : 'حفظ')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="w-full mt-2 text-text-secondary text-xs py-2 rounded-xl font-medium hover:bg-surface transition-colors">
            إلغاء
          </button>
        )}
      </div>
    </form>
  )
}
