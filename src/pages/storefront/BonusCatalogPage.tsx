import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Gift, Loader2, Minus, Plus } from 'lucide-react'
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
  const updateBonusQuantity = useCartStore((s) => s.updateBonusQuantity)
  const removeBonusItem = useCartStore((s) => s.removeBonusItem)

  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [geoPct, setGeoPct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [units, setUnits] = useState<Record<string, UnitType>>({})
  const [activeUnits, setActiveUnits] = useState<Record<string, UnitType[]>>({})
  const [availability, setAvailability] = useState<Record<string, AvailabilityResult>>({})
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const governorateId = geographicContext?.governorateId ?? null

  const availKey = (p: ProductWithPrice, unit: UnitType): string => `${p.id}:${unit}`

  /** Amount WITHOUT the " ج.م" suffix (already implied by the screen). */
  const fmtAmount = (n: number): string => formatCurrencyShort(n).replace(' ج.م', '').trim()

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!token) { setLoading(false); return }
      const { rows, error } = await fetchBonusCatalogRows(token, { governorateId })
      if (!active) return
      if (error) { setError(error); setLoading(false); return }
      const mapped = (rows as any[]).map((r: any) => toProductWithPrice(r))
      // Units available for sale are defined by the admin in Products Management
      // (product_units.is_active). Read that flag DIRECTLY from the raw rows so the
      // Bonus Store always honors it — even for upper-management accounts, where
      // resolveConfiguredUnitTypes returns ALL configured units for editing.
      const activeMap: Record<string, UnitType[]> = {}
      for (const r of rows as any[]) {
        const arr: any[] = Array.isArray(r.product_units) ? r.product_units : []
        activeMap[r.id] = arr.filter((u: any) => u.is_active !== false).map((u: any) => u.unit_type) as UnitType[]
      }
      setActiveUnits(activeMap)
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

  /** Selling units for a Bonus product. Source of truth = the units the admin
   *  enabled for the item in Products Management (product_units.is_active),
   *  read directly from the catalog rows. Available in the BONUS store ONLY —
   *  the normal Storefront keeps its existing behavior. */
  const sellingUnitsOf = (p: ProductWithPrice): UnitType[] => {
    const strict = (activeUnits[p.id] ?? []).filter((u) => p.unitPrices.some((x) => x.unitType === u))
    if (strict.length > 0) return strict
    return (p.availableUnitTypes ?? []).filter((u) => p.unitPrices.some((x) => x.unitType === u))
  }

  const unitOf = (p: ProductWithPrice): UnitType => {
    const selling = sellingUnitsOf(p)
    if (selling.length === 0) return p.unitPrices[0]?.unitType ?? 'piece'
    const saved = units[p.id]
    if (saved && selling.includes(saved)) return saved
    return UNIT_PRIORITY.find((u) => selling.includes(u)) ?? selling[0]
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

  /** Shared stepper: once a product is in the Bonus Cart the ± buttons drive the
   *  GOVERNED Bonus Cart state directly (updateBonusQuantity/removeBonusItem),
   *  so credit/remaining/overflow recompute immediately — no duplicate local cart. */
  const handleStep = async (p: ProductWithPrice, delta: number) => {
    const unit = unitOf(p)
    const inCart = inCartQty(p)
    const base = inCart > 0 ? inCart : (quantities[p.id] ?? 1)
    const proposed = base + delta
    if (proposed <= 0) {
      if (inCart > 0) {
        updateBonusQuantity(p.id, unit, 0)
      } else {
        setQuantities((prev) => ({ ...prev, [p.id]: 1 }))
      }
      return
    }
    if (!p.isActive || p.isOutOfStock) return
    const result = await checkCartAvailability(p.id, proposed, unit)
    setAvailability((prev) => ({ ...prev, [availKey(p, unit)]: result }))
    const { allowed, boundedQty } = bonusAddDecision(proposed, result)
    if (allowed) {
      if (inCart > 0) {
        updateBonusQuantity(p.id, unit, proposed)
      } else {
        setQuantities((prev) => ({ ...prev, [p.id]: proposed }))
      }
    } else {
      if (inCart <= 0) setQuantities((prev) => ({ ...prev, [p.id]: Math.max(1, boundedQty) }))
      toast.error('الحد الأقصى المتاح من هذا الصنف تم الوصول إليه.')
    }
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
          <span className="text-sm font-extrabold text-violet-700">{fmtAmount(bonusCredit)}</span>
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
              <div key={p.id} className={`bg-white rounded-xl border overflow-hidden transition-all hover:shadow-sm flex flex-col ${
                inCart > 0 ? 'border-violet-500/40 bg-violet-50/40' : 'border-border'
              }`}>
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
                    <span className="font-extrabold text-text text-[14.3px]">{fmtAmount(unitPriceOf(p))}</span>
                    <span className="text-[11px]">للـ {UNIT_LABELS[unit]}</span>
                  </div>

                  {/* Unit selector — the SAME selling units as the normal Storefront */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-text-secondary font-semibold">الوحدة:</span>
                    {sellingUnitsOf(p).map((ut) => (
                      <button
                        key={ut}
                        onClick={() => setUnits((prev) => ({ ...prev, [p.id]: ut }))}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                          unit === ut
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white text-text-secondary border-border hover:bg-violet-50'
                        }`}
                      >
                        {UNIT_LABELS[ut]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quantity + Add */}
                <div className="p-3 pt-0 space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <button
                      onClick={() => handleStep(p, -1)}
                      disabled={disabled}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40 shrink-0"
                      aria-label="تقليل الكمية"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1 min-w-0 text-center text-sm font-semibold text-text truncate">
                      {inCart > 0 ? inCart : (quantities[p.id] ?? 1)}
                      <span className="text-[10px] text-text-secondary mr-1">{UNIT_LABELS[unit]}</span>
                    </div>
                    <button
                      onClick={() => handleStep(p, 1)}
                      disabled={disabled}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40 shrink-0"
                      aria-label="زيادة الكمية"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {inCart > 0 ? (
                    <div className="space-y-1">
                      <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold">
                        <Check className="w-3.5 h-3.5" />
                        تمت الإضافة للسلة
                      </div>
                      <p className="text-center text-[10px] font-semibold text-violet-600">
                        الكمية: {inCart} {UNIT_LABELS[unit]}
                      </p>
                      <button
                        onClick={() => removeBonusItem(p.id, unit)}
                        className="w-full text-center text-[10px] text-text-secondary hover:text-danger underline"
                      >
                        إزالة من السلة
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleAdd(p)}
                      disabled={disabled}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-colors active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Gift className="w-3.5 h-3.5" />
                      {BONUS_COPY.addToBonusCart}
                    </button>
                  )}

                  {(() => {
                    const av = availability[availKey(p, unit)]
                    const status = bonusAvailabilityStatus(av)
                    if (!av || !status || status === 'green' || !p.isActive || p.isOutOfStock) return null
                    return <BusinessStatusCard data={buildBusinessStatusCard(av)} compact />
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}