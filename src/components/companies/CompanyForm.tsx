import { useState } from 'react'

export interface CompanyFormData {
  company_name: string
  legacy_code: string
  logo_url: string
  is_visible: boolean
  display_order: number
  tierDiscounts: Record<string, string>
}

interface CompanyFormProps {
  mode: 'create' | 'edit'
  initialCompanyName?: string
  initialLegacyCode?: string
  initialDisplayOrder?: number
  initialLogoUrl?: string
  initialIsVisible?: boolean
  tiers: any[]
  initialTierDiscounts?: Record<string, string>
  saving: boolean
  canManage: boolean
  onSubmit: (data: CompanyFormData) => void
  onCancel: () => void
}

export function CompanyForm({
  mode,
  initialCompanyName = '',
  initialLegacyCode = '',
  initialDisplayOrder = 1,
  initialLogoUrl = '',
  initialIsVisible = true,
  tiers,
  initialTierDiscounts = {},
  saving,
  canManage,
  onSubmit,
  onCancel,
}: CompanyFormProps) {
  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [legacyCode, setLegacyCode] = useState(initialLegacyCode)
  const [displayOrder, setDisplayOrder] = useState<string>(String(initialDisplayOrder))
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [isVisible, setIsVisible] = useState(initialIsVisible)
  const [tierDiscounts, setTierDiscounts] = useState<Record<string, string>>(initialTierDiscounts)

  const parsedOrder = displayOrder !== '' ? parseInt(displayOrder, 10) : NaN
  const canSave = canManage && companyName.trim() !== '' && legacyCode.trim() !== '' && !isNaN(parsedOrder) && parsedOrder >= 1 && !saving

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setLogoUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleSubmit() {
    if (!canSave) return
    onSubmit({
      company_name: companyName.trim(),
      legacy_code: legacyCode.trim(),
      logo_url: logoUrl,
      is_visible: isVisible,
      display_order: parsedOrder,
      tierDiscounts,
    })
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[900px] mx-auto px-4 py-5 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-extrabold text-text tracking-tight">
            {mode === 'create' ? 'إضافة شركة' : 'تعديل شركة'}
          </h1>
          <button onClick={onCancel}
            className="text-text-secondary text-xs font-semibold hover:text-danger transition-colors px-3 py-1.5 rounded-lg hover:bg-danger/5">
            إلغاء
          </button>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-border p-5 space-y-5">

          {/* Row 1: Name + Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-text-secondary font-bold block mb-1">اسم الشركة *</label>
              <input type="text" value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="اسم الشركة..."
                className="w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary font-bold block mb-1">الكود القديم *</label>
              <input type="text" value={legacyCode}
                onChange={(e) => setLegacyCode(e.target.value)}
                placeholder="الكود..."
                className="w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" dir="ltr" />
            </div>
          </div>

          {/* Row 2: Display Order */}
          <div>
            <label className="text-[10px] text-text-secondary font-bold block mb-1">ترتيب العرض *</label>
            <input type="number" min="1" step="1" value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              placeholder="رقم الترتيب..."
              className="w-full sm:w-48 border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all" dir="ltr" />
          </div>

          {/* Row 3: Logo */}
          <div>
            <label className="text-[10px] text-text-secondary font-bold block mb-1">الشعار</label>
            {logoUrl ? (
              <div className="relative inline-block">
                <img src={logoUrl} alt="logo" className="w-28 h-28 object-contain rounded-xl border border-border bg-surface" />
                <button onClick={() => setLogoUrl('')}
                  className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-danger text-white text-[10px] flex items-center justify-center shadow-sm">×</button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <button onClick={() => document.getElementById('company-form-logo-input')?.click()}
                  className="bg-primary/10 text-primary text-[11px] px-4 py-2.5 rounded-xl font-bold hover:bg-primary/15 transition-colors">رفع صورة</button>
                <input id="company-form-logo-input" type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                <input type="text" value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="أو الصق الرابط..."
                  className="flex-1 border border-border rounded-xl px-3.5 py-2.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" dir="ltr" />
              </div>
            )}
          </div>

          {/* Row 4: Visibility */}
          <div>
            <label className="text-[10px] text-text-secondary font-bold block mb-1">الظهور</label>
            <label className="flex items-center gap-2.5 cursor-pointer select-none bg-surface/50 rounded-xl px-4 py-3 w-fit">
              <div className={`relative w-10 h-5 rounded-full transition-colors ${isVisible ? 'bg-success' : 'bg-border'}`}
                onClick={() => setIsVisible((v) => !v)}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${isVisible ? 'right-0.5' : 'left-0.5'}`} />
              </div>
              <span className="text-xs font-bold text-text">{isVisible ? 'ظاهر للعملاء' : 'مخفي عن العملاء'}</span>
            </label>
          </div>

          {/* Row 5: Tier Discounts */}
          <div>
            <label className="text-[10px] text-text-secondary font-bold block mb-2">خصم الشرائح</label>
            {tiers.length === 0 ? (
              <p className="text-xs text-text-secondary">لا توجد شرائح</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tiers.map((tier: any) => {
                  const val = tierDiscounts[tier.id] ?? ''
                  return (
                    <div key={tier.id} className="flex items-center gap-3 border border-border rounded-xl px-3 py-2.5 bg-surface/30">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold text-text block truncate">{tier.name}</span>
                        <span className="text-[10px] text-text-secondary">الافتراضي: {tier.discount_percent}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" max="100" step="0.01"
                          value={val}
                          onChange={(e) => setTierDiscounts((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                          placeholder="—"
                          className="w-14 border border-border rounded-lg px-2 py-1 text-[11px] text-center bg-white focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all" dir="ltr" />
                        <span className="text-[10px] text-text-secondary">%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {canManage && (
          <div className="flex gap-3">
            <button onClick={onCancel}
              className="px-6 py-2.5 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-surface transition-colors active:scale-[0.97]">
              إلغاء
            </button>
            <button onClick={handleSubmit} disabled={!canSave}
              className="flex-1 sm:flex-none px-8 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-colors active:scale-[0.97] disabled:opacity-40 shadow-sm shadow-primary/20">
              {saving ? 'جاري الحفظ...' : mode === 'create' ? 'إنشاء الشركة' : 'حفظ التغييرات'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
