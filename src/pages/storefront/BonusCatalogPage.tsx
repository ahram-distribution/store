import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gift, Loader2, Minus, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/auth'
import { useCartStore } from '../../store/cart'
import { fetchBonusCatalogRows } from '../../services/bonus'
import { toProductWithPrice } from '../../utils/catalog'
import { computeBonusCatalogBasePrices } from '../../engine/bonusEligibility'
import { bonusAddDecision, bonusAvailabilityStatus } from '../../engine/bonusInventory'
import { checkCartAvailability, buildBusinessStatusCard } from '../../utils/cart-availability'
import type { AvailabilityResult } from '../../utils/cart-availability'
import { BusinessStatusCard } from '../../components/storefront/BusinessStatusCard'
import { BONUS_COPY } from '../../constants/bonusCopy'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import type { ProductWithPrice, UnitType } from '../../types/storefront'

const UNIT_PRIORITY: UnitType[] = ['carton', 'dozen', 'piece']

/**
 * Bonus / Gifts catalog (Phase 4). Shows ONLY active + visible + Bonus-eligible
 * products at their geo-adjusted BASE price (never discounted). Adding a product
 * uses the existing addBonusItem store action (base-only, assertBonusBasePrice).
 */
export function BonusCatalogPage() {
  const navigate = useNavigate()
  const { token } = useAuthStore()
  const bonusMode = useCartStore((s) => s.bonusMode)
  const bonusItems = useCartStore((s) => s.bonusItems)
  const bonusCredit = useCartStore((s) => s.bonusCredit)
  const geographicContext = useCartStore((s) => s.geographicContext)
  const addBonusItem = useCartStore((s) => s.addBonusItem)

  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [geoPct, setGeoPct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [units, setUnits] = useState<Record<string, UnitType>>({})
  const [availability, setAvailability] = useState<Record<string, AvailabilityResult>>({})
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const governorateId = geographicContext?.governorateId ?? null

  const availKey = (p: ProductWithPrice, unit: UnitType): string => `${p.id}:${unit}`

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!token) { setLoading(false); return }
      const { rows, error } = await fetchBonusCatalogRows(token, { governorateId })
      if (!active) return
      if (error) { setError(error); setLoading(false); return }
      const mapped = (rows as any[]).map((r: any) => toProductWithPrice(r))
      const pct: Record<string, number> = {}
      for (const r of rows as any[]) {
        const n = Number(r.geo_adjustment_percent ?? 0)
        pct[r.id] = Number.isFinite(n) ? n : 0
      }
      setProducts(mapped)
      setGeoPct(pct)
      setLoading(false)
      setQuantities((prev) => Object.fromEntries(mapped.map((p) => [p.id, prev[p.id] ?? 1])))
      if (mapped.length > 0) {
        const store = useCartStore.getState()
        mapped.forEach((p) => store.syncProduct(p))
        store.ensureGeoItemAdjustments(mapped)
      }
    })()
    return () => { active = false }
  }, [token, governorateId])

  // Bonus inventory compliance: live availability in the SAME selling unit, using
  // the existing governed_check_product_availability_v2 engine (no Bonus bypass).
  useEffect(() => {
    if (loading) return
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(() => {
      for (const p of products) {
        const qty = quantities[p.id] ?? 1
        const unit = unitOf(p)
        if (!p.isActive || p.isOutOfStock || qty <= 0) continue
        checkCartAvailability(p.id, qty, unit).then((result) => {
          setAvailability((prev) => ({ ...prev, [availKey(p, unit)]: result }))
        })
      }
    }, 400)
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [products, quantities, units, loading])

  const priceMap = useMemo(() => {
    const list = computeBonusCatalogBasePrices(
      products.map((p) => ({
        id: p.id,
        piecePrice: p.piecePrice,
        dozenPrice: p.dozenPrice,
        cartonPrice: p.cartonPrice,
        geoAdjustPercent: geoPct[p.id] ?? 0,
      }))
    )
    return new Map(list.map((e) => [e.productId, e]))
  }, [products, geoPct])

  const bonusItemCount = bonusItems.reduce((s, i) => s + i.unitQuantity, 0)

  const unitOf = (p: ProductWithPrice): UnitType => {
    const saved = units[p.id]
    if (saved && p.unitPrices.some((u) => u.unitType === saved)) return saved
    const first = UNIT_PRIORITY.find((u) => p.unitPrices.some((x) => x.unitType === u))
    return first ?? p.unitPrices[0]?.unitType ?? 'piece'
  }

  const unitPriceOf = (p: ProductWithPrice): number => {
    const bp = priceMap.get(p.id)
    const unit = unitOf(p)
    if (!bp) return p.unitPrices.find((u) => u.unitType === unit)?.price ?? 0
    return unit === 'piece' ? bp.piecePrice : unit === 'dozen' ? bp.dozenPrice : bp.cartonPrice
  }

  const inCartQty = (p: ProductWithPrice): number => {
    const unit = unitOf(p)
    return bonusItems.filter((i) => i.productId === p.id && i.unitType === unit).reduce((s, i) => s + i.unitQuantity, 0)
  }

  const handleAdd = async (p: ProductWithPrice) => {
    const qty = quantities[p.id] ?? 1
    if (qty <= 0 || !p.isActive || p.isOutOfStock) return
    const unit = unitOf(p)
    const result = await checkCartAvailability(p.id, qty, unit)
    setAvailability((prev) => ({ ...prev, [availKey(p, unit)]: result }))
    const { allowed } = bonusAddDecision(qty, result)
    if (!allowed) {
      toast.error('الكمية المطلوبة تتجاوز المتاح من هذا الصنف — لا يمكن إضافتها لبونص الشرائح.')
      return
    }
    addBonusItem(p, unit, qty)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/cart')} className="text-text-secondary text-lg">
            &larr;
          </button>
          <h1 className="text-lg font-bold text-text">{BONUS_COPY.catalogTitle}</h1>
        </div>
        <button
          onClick={() => navigate('/cart')}
          className="relative bg-white border border-border rounded-lg px-3 py-2 text-sm"
        >
          🛒 السلة
          {bonusItemCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-violet-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
              {bonusItemCount}
            </span>
          )}
        </button>
      </div>

      {/* Bonus mode notice */}
      {!bonusMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800">{BONUS_COPY.catalogNotActive}</p>
          <button
            onClick={() => navigate('/cart')}
            className="w-full bg-primary text-white text-sm py-2.5 rounded-lg active:opacity-90 transition-opacity"
          >
            الرجوع إلى سلة التسوق
          </button>
        </div>
      )}

      {bonusMode && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-semibold text-violet-700">رصيد البونص المتاح</span>
          </div>
          <span className="text-sm font-extrabold text-violet-700">{formatCurrencyShort(bonusCredit)} جنيه</span>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-12 bg-white rounded-xl border border-border">
          <p className="text-sm text-danger font-semibold">تعذر تحميل منتجات البونص — {error}</p>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-border">
          <Gift className="w-10 h-10 text-violet-300 mx-auto mb-3" />
          <p className="text-sm text-text-secondary font-semibold">{BONUS_COPY.catalogEmpty}</p>
        </div>
      )}

      {/* Catalog grid */}
      {!loading && !error && products.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-stretch">
          {products.map((p) => {
            const unit = unitOf(p)
            const disabled = !p.isActive || p.isOutOfStock
            const inCart = inCartQty(p)
            return (
              <div key={p.id} className="bg-white rounded-xl border border-border overflow-hidden transition-all hover:shadow-sm flex flex-col">
                {/* Image */}
                <div className="relative h-28 bg-surface overflow-hidden">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.productName} className="w-full h-full object-contain p-2" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gift className="w-8 h-8 text-violet-300" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
                    {BONUS_COPY.catalogBadge}
                  </div>
                  {disabled && (
                    <div className="absolute bottom-2 right-2 bg-warning/90 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
                      نفذت الكمية
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-3 flex-1 space-y-1.5">
                  <h3 className="text-[13px] font-extrabold text-text leading-tight line-clamp-2 min-h-[2.2em]">{p.productName}</h3>
                  <p className="text-[11px] text-text-secondary truncate">{p.companyName}</p>

                  {/* Price (geo-adjusted BASE only) */}
                  <div className="flex items-center gap-1 text-[13px] text-text-secondary">
                    <span>السعر الأصلي:</span>
                    <span className="font-extrabold text-text">{formatCurrencyShort(unitPriceOf(p))} جنيه</span>
                    <span className="text-[11px]">للـ {UNIT_LABELS[unit]}</span>
                  </div>

                  {/* Unit selector */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {p.unitPrices.map((u) => (
                      <button
                        key={u.unitType}
                        onClick={() => setUnits((prev) => ({ ...prev, [p.id]: u.unitType }))}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                          unit === u.unitType
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white text-text-secondary border-border hover:bg-violet-50'
                        }`}
                      >
                        {UNIT_LABELS[u.unitType]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quantity + Add */}
                <div className="p-3 pt-0 space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => setQuantities((prev) => ({ ...prev, [p.id]: Math.max(1, (prev[p.id] ?? 1) - 1) }))}
                      disabled={disabled}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-semibold text-text w-8 text-center">{quantities[p.id] ?? 1}</span>
                    <button
                      onClick={async () => {
                        const prevQty = quantities[p.id] ?? 1
                        const proposed = prevQty + 1
                        const result = await checkCartAvailability(p.id, proposed, unit)
                        setAvailability((prev) => ({ ...prev, [availKey(p, unit)]: result }))
                        const { allowed, boundedQty } = bonusAddDecision(proposed, result)
                        if (allowed) {
                          setQuantities((prev) => ({ ...prev, [p.id]: proposed }))
                        } else {
                          setQuantities((prev) => ({ ...prev, [p.id]: Math.max(1, boundedQty) }))
                          toast.error('الحد الأقصى المتاح من هذا الصنف تم الوصول إليه.')
                        }
                      }}
                      disabled={disabled}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleAdd(p)}
                    disabled={disabled}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-colors active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Gift className="w-3.5 h-3.5" />
                    {BONUS_COPY.addToBonusCart}
                  </button>
                  {(() => {
                    const av = availability[availKey(p, unit)]
                    const status = bonusAvailabilityStatus(av)
                    if (!av || !status || status === 'green' || !p.isActive || p.isOutOfStock) return null
                    return <BusinessStatusCard data={buildBusinessStatusCard(av)} compact />
                  })()}
                  {inCart > 0 && (
                    <p className="text-center text-[10px] font-semibold text-violet-600">
                      في سلة البونص: {inCart} {UNIT_LABELS[unit]}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}