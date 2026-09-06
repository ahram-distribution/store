import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { discountOptionsService, type DiscountOptionsBundle } from '../../services/discountOptions'
import { useCartStore } from '../../store/cart'
import { DiscountOptionSelector, type SelectableDiscountOption } from '../../components/storefront/DiscountOptionSelector'
import { formatCurrencyShort, formatArabicAmountWithCurrency, formatTierName } from '../../utils/format'

const TIER_BADGE_COLORS: string[] = ['#CD7F32', '#A8A8A8', '#D4AF37', '#C9A227', '#8B5CF6', '#10B981', '#3B82F6', '#EC4899']

function BadgeIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill={color} stroke={color} strokeWidth="1" />
    </svg>
  )
}

function formatPercent(pct: number): string {
  return pct % 1 === 0 ? String(pct) : Number(pct.toFixed(1)).toString()
}

function actualDiscountValue(base: number, pct: number): number {
  return Math.round(base * (pct / 100) * 100) / 100
}

export function TierSystemPage() {
  const navigate = useNavigate()
  const [bundle, setBundle] = useState<DiscountOptionsBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const {
    selectTier,
    selectedTierId,
    selectedPaymentMethodId,
    selectPaymentMethod,
    selectedShippingMethodId,
    selectShippingMethod,
    getTotals,
  } = useCartStore()
  const totals = getTotals()

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await discountOptionsService.getAll()
        setBundle(data)
      } catch (err: any) {
        if (err?.code === 'PGRST116' || err?.message?.includes('relation') || err?.message?.includes('does not exist')) {
          setBundle(null)
        } else {
          setError(err.message || 'فشل تحميل الخيارات')
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="text-center text-text-secondary text-sm py-8">جاري التحميل...</div>

  if (error) return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
      <p className="text-sm text-danger">{error}</p>
    </div>
  )

  const visibleTiers = (bundle?.tiers ?? [])
    .filter((x) => x.isActive && x.isVisible)
    .sort((a, b) => (b.minimumOrderAmount ?? 0) - (a.minimumOrderAmount ?? 0))
  const visiblePayments = reachableSorter(bundle?.paymentMethods ?? [])
  const visibleShipping = reachableSorter(bundle?.shippingMethods ?? [])

  function reachableSorter<T extends { isActive: boolean; isVisible: boolean; sortOrder: number }>(list: T[]): T[] {
    return list.filter((x) => x.isActive && x.isVisible).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const tierOptions: SelectableDiscountOption[] = visibleTiers.map((t) => ({
    id: t.id,
    name: t.name,
    discountPercent: t.discountPercent,
    minimumOrderAmount: t.minimumOrderAmount,
    color: t.color,
    iconUrl: t.iconUrl,
  }))

  const paymentOptions: SelectableDiscountOption[] = visiblePayments.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const shippingOptions: SelectableDiscountOption[] = visibleShipping.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const selectedTier = bundle?.tiers.find((t) => t.id === selectedTierId) ?? null
  const selectedPayment = bundle?.paymentMethods.find((m) => m.id === selectedPaymentMethodId) ?? null
  const selectedShipping = bundle?.shippingMethods.find((m) => m.id === selectedShippingMethodId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">مركز الخصومات</h1>
      </div>

      {/* Current selections header */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="text-sm text-text-secondary mb-1">اختياراتك الحالية:</div>
        <div className="text-base font-bold text-text">
          {selectedTier ? selectedTier.name : 'السعر الرسمي'}
          {selectedPayment && <span> · {selectedPayment.name}</span>}
          {selectedShipping && <span> · {selectedShipping.name}</span>}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-sm text-text-secondary">إجمالي المشتريات (الأساسي)</div>
          <div className="text-lg font-bold text-text mt-0.5">{formatCurrencyShort(totals.productBaseSubtotal)}</div>
          {totals.productBaseSubtotal > 0 && totals.totalDiscount > 0 && (
            <div className="text-xs font-semibold text-success mt-1">
              قيمة الخصم الفعلية: -{formatCurrencyShort(totals.totalDiscount)}
            </div>
          )}
        </div>
      </div>

      {totals.totalDiscount > 0 && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-3">
          <div className="flex justify-between text-sm">
            <span className="text-success font-semibold">إجمالي الخصم ({totals.totalDiscountPercent}%)</span>
            <span className="text-success font-semibold">-{formatCurrencyShort(totals.totalDiscount)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-text-secondary">الإجمالي النهائي</span>
            <span className="font-bold text-text">{formatCurrencyShort(totals.netTotal)}</span>
          </div>
        </div>
      )}

      {/* Tier cards */}
      {visibleTiers.length > 0 && (
        <div className="space-y-3">
          {visibleTiers.map((tier, index) => {
            const isSelected = selectedTierId === tier.id
            const badgeColor = tier.color || TIER_BADGE_COLORS[index % TIER_BADGE_COLORS.length]
            const actualValue = actualDiscountValue(totals.productBaseSubtotal, tier.discountPercent)

            return (
              <div
                key={tier.id}
                className={`bg-white rounded-xl border-2 transition-all ${
                  isSelected ? 'border-primary bg-primary/[0.03] shadow-sm' : 'border-border'
                }`}
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${badgeColor}20` }}>
                      <BadgeIcon color={badgeColor} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-text">{formatTierName(tier.name)}</div>
                      {tier.description && <div className="text-xs text-text-secondary truncate">{tier.description}</div>}
                    </div>
                    {isSelected && (
                      <span className="shrink-0 text-[11px] font-bold px-2 py-1 rounded-full bg-primary text-white">✓ محددة</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold px-3 py-1 rounded-full bg-success/10 text-success">
                      خصم {formatPercent(tier.discountPercent)}%
                    </span>
                    {totals.productBaseSubtotal > 0 && tier.discountPercent > 0 && (
                      <span className="text-xs font-semibold text-success">
                        قيمة الخصم الفعلية: ≈ {formatCurrencyShort(actualValue)}
                      </span>
                    )}
                  </div>

                  {tier.minimumOrderAmount > 0 && (
                    <div className="text-xs text-text-secondary">
                      الحد الأدنى: <span className="font-semibold text-text">{formatArabicAmountWithCurrency(tier.minimumOrderAmount)}</span>
                    </div>
                  )}

                  {!isSelected && (
                    <button
                      onClick={() => selectTier(tier.id)}
                      className="w-full text-sm py-2.5 rounded-lg bg-primary text-white active:bg-primary-dark transition-colors"
                    >
                      اختيار الشريحة
                    </button>
                  )}
                  {isSelected && (
                    <button
                      onClick={() => selectTier(null)}
                      className="w-full text-sm py-2.5 rounded-lg bg-white text-text-secondary border border-border active:bg-surface transition-colors"
                    >
                      العودة للسعر الأساسي
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {visibleTiers.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-sm text-blue-700 font-semibold mb-1">قريباً</p>
          <p className="text-xs text-blue-600">سيتم تفعيل الشرائح السعرية قريباً. تابعنا لتصلك العروض.</p>
        </div>
      )}

      {/* Payment + shipping groups */}
      <DiscountOptionSelector
        groupLabel="طريقة الدفع"
        noneLabel="نقدي / بدون طريقة"
        options={paymentOptions}
        selectedId={visiblePayments.some((m) => m.id === selectedPaymentMethodId) ? selectedPaymentMethodId : null}
        onSelect={selectPaymentMethod}
        baseAmount={totals.productBaseSubtotal}
      />

      <DiscountOptionSelector
        groupLabel="طريقة الشحن"
        noneLabel="بدون طريقة شحن"
        options={shippingOptions}
        selectedId={visibleShipping.some((m) => m.id === selectedShippingMethodId) ? selectedShippingMethodId : null}
        onSelect={selectShippingMethod}
        baseAmount={totals.productBaseSubtotal}
      />

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          الخصم من كل مجموعة يُجمع ويُطبق مرة واحدة على السعر الأساسي. مثال: شريحة 2.5% + دفع 1% + شحن 1% = خصم إجمالي 4.5% على إجمالي المشتريات.
        </p>
      </div>
    </div>
  )
}