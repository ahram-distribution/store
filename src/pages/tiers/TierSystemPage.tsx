import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tierService } from '../../services/tiers'
import { useCartStore } from '../../store/cart'
import { formatCurrencyShort } from '../../utils/format'
import type { TierRecord } from '../../types/storefront'

const TIER_BADGE_COLORS: Record<string, string> = {
  '0': '#CD7F32',
  '1': '#A8A8A8',
  '2': '#D4AF37',
}

function BadgeIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill={color} stroke={color} strokeWidth="1" />
    </svg>
  )
}

function marketingDiscount(pct: number): number {
  return Math.ceil(pct)
}

export function TierSystemPage() {
  const navigate = useNavigate()
  const [tiers, setTiers] = useState<TierRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { selectTier, selectedTierId, getTotals } = useCartStore()
  const totals = getTotals()

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await tierService.getTiers()
        setTiers(data)
      } catch (err: any) {
        if (err?.code === 'PGRST116' || err?.message?.includes('relation') || err?.message?.includes('does not exist')) {
          setTiers([])
        } else {
          setError(err.message || 'فشل تحميل الشرائح')
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

  const selectedTier = tiers.find(t => t.id === selectedTierId) ?? null

  return (
    <div className="space-y-4">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">مركز الشرائح</h1>
      </div>

      {/* Current Tier Header */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="text-sm text-text-secondary mb-1">الشريحة الحالية:</div>
        <div className="text-base font-bold text-text">
          {selectedTier ? selectedTier.name : 'السعر الرسمي'}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-sm text-text-secondary">إجمالي مشترياتك الحالية</div>
          <div className="text-lg font-bold text-text mt-0.5">{formatCurrencyShort(totals.productSubtotal)}</div>
        </div>
      </div>

      {tiers.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-sm text-blue-700 font-semibold mb-1">قريباً</p>
          <p className="text-xs text-blue-600">سيتم تفعيل الشرائح السعرية قريباً. تابعنا لتصلك العروض.</p>
        </div>
      )}

      {/* Tier Cards */}
      <div className="space-y-3">
        {tiers.map((tier, index) => {
          const isSelected = selectedTierId === tier.id
          const badgeColor = tier.color || TIER_BADGE_COLORS[String(index)] || '#9CA3AF'
          const mktPct = marketingDiscount(tier.discountPercent)

          return (
            <div
              key={tier.id}
              className={`bg-white rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-[#C9A227] shadow-sm'
                  : 'border-border'
              }`}
            >
              <div className="p-4 space-y-3">
                {/* Badge + Name */}
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `${badgeColor}20` }}
                  >
                    <BadgeIcon color={badgeColor} />
                  </div>
                  <div>
                    <div className="text-base font-bold text-text">{tier.name}</div>
                  </div>
                </div>

                {/* Marketing Discount */}
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-bold px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: `${badgeColor}15`,
                      color: badgeColor,
                    }}
                  >
                    خصم يصل إلى {mktPct}%
                  </span>
                </div>

                {/* Minimum */}
                {tier.minimumOrderAmount > 0 && (
                  <div className="text-sm text-text-secondary">
                    الحد الأدنى للمشتريات: {formatCurrencyShort(tier.minimumOrderAmount)}
                  </div>
                )}

                {/* Action Buttons */}
                {!isSelected && (
                  <button
                    onClick={() => selectTier(tier.id)}
                    className="w-full text-sm py-2.5 rounded-lg bg-primary text-white active:bg-primary-dark transition-colors"
                  >
                    اختيار الشريحة
                  </button>
                )}
                {isSelected && (
                  <div className="space-y-2">
                    <button
                      disabled
                      className="w-full text-sm py-2.5 rounded-lg bg-success/10 text-success font-semibold cursor-default"
                    >
                      الشريحة الحالية
                    </button>
                    <button
                      onClick={() => selectTier(null)}
                      className="w-full text-sm py-2.5 rounded-lg bg-white text-text-secondary border border-border active:bg-surface transition-colors"
                    >
                      العودة للسعر الرسمي
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
