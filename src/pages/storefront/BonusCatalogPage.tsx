import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
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
import { supabase } from '../../lib/supabase'

const UNIT_PRIORITY: UnitType[] = ['carton', 'dozen', 'piece']

/** Base value of a Bonus cart line + selection-total derivation, mirroring the
 *  engine so the live status bar never needs the full bonus-totals recompute. */
const bonusItemBaseValue = (item: { baseUnitPrice?: number; totalPrice: number; unitQuantity: number }): number => {
  if (typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0) {
    return Math.round(item.baseUnitPrice * item.unitQuantity * 100) / 100
  }
  return Math.round(item.totalPrice * 100) / 100
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Isolated, memoized card in the proven Normal Storefront pattern: in-cart state
 *  is passed DOWN as a prop (like ProductCard's cartItemKeys) instead of each card
 *  subscribing to the store, and the availability check runs only on user-driven
 *  unit/quantity changes with the same 400ms debounce as ProductCard — never on
 *  mount. Changing one Bonus product never forces the sibling cards to re-render. */
const BonusProductCard = memo(function BonusProductCard({
  product,
  activeUnits,
  unitPrices,
  stepperValue,
  inCartQtyByUnit,
  onAdd,
  onStep,
  onRemove,
}: {
  product: ProductWithPrice
  activeUnits: UnitType[]
  unitPrices: ProductWithPrice['unitPrices']
  stepperValue: number
  inCartQtyByUnit?: Record<UnitType, number>
  onAdd: (p: ProductWithPrice, unit: UnitType, qty: number) => Promise<void>
  onStep: (p: ProductWithPrice, unit: UnitType, qty: number) => Promise<void>
  onRemove: (p: ProductWithPrice, unit: UnitType) => void
}) {
  const [unit, setUnit] = useState<UnitType | null>(null)
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResult | null>(null)
  const [qtyText, setQtyText] = useState('1')
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qtyInputFocused = useRef(false)

  const availableUnits = useMemo(() => {
    const strict = activeUnits.filter((u) => unitPrices.some((x) => x.unitType === u))
    if (strict.length > 0) return strict
    return (product.availableUnitTypes ?? []).filter((u) => unitPrices.some((x) => x.unitType === u))
  }, [activeUnits, unitPrices, product.availableUnitTypes])

  const selectedUnit = useMemo<UnitType>(() => {
    if (availableUnits.length === 0) return unitPrices[0]?.unitType ?? 'piece'
    if (unit && availableUnits.includes(unit)) return unit
    return UNIT_PRIORITY.find((u) => availableUnits.includes(u)) ?? availableUnits[0]
  }, [unit, availableUnits, unitPrices])

  const unitPrice = useMemo(() => {
    const found = unitPrices.find((u) => u.unitType === selectedUnit)
    return round2(found ? found.price : 0)
  }, [unitPrices, selectedUnit])

  // Availability check is LAZY, exactly like the normal Storefront ProductCard:
  // no catalog-wide prefetch on load and NO mount-time read. It runs with a
  // 400ms debounce only when the user interacts with THIS card's unit/stepper/
  // add/remove controls. The governing add/step handlers enforce availability
  // themselves via checkCartAvailability + bonusAddDecision.
  const inCart = inCartQtyByUnit?.[selectedUnit] ?? 0
  const effectiveQty = inCart > 0 ? inCart : stepperValue
  const scheduleAvailabilityCheck = (qty?: number) => {
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(() => {
      if (product.isActive && !product.isOutOfStock) {
        checkCartAvailability(product.id, Math.max(1, qty ?? effectiveQty), selectedUnit).then((result) => {
          setAvailabilityResult(result)
        })
      }
    }, 400)
  }
  useEffect(() => () => {
    if (checkTimer.current) clearTimeout(checkTimer.current)
    if (commitTimer.current) clearTimeout(commitTimer.current)
  }, [])

  const disabled = !product.isActive || product.isOutOfStock
  const added = inCart > 0
  const displayQty = added ? inCart : stepperValue

  // Manual quantity entry: the quantity is a text field the user can type into
  // directly. It commits through the SAME governed onStep path (checkCartAvailability +
  // bonusAddDecision) the +/− steppers use, debounced 500ms so typing never fires
  // one availability RPC per keystroke. External displayQty changes (from steppers,
  // add, or cart restore) are mirrored while the field is not being edited.
  useEffect(() => {
    if (!qtyInputFocused.current) setQtyText(String(displayQty))
  }, [displayQty])

  const parseQtyText = (raw: string): number => {
    const t = raw.trim()
    if (t === '') return displayQty
    const n = Math.floor(Number(t))
    return Number.isFinite(n) ? Math.max(0, n) : displayQty
  }

  const commitQty = (qty: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    setQtyText(String(qty))
    onStep(product, selectedUnit, qty)
    scheduleAvailabilityCheck(qty)
  }

  const handleQtyInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setQtyText(raw)
    const n = Math.floor(Number(raw))
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(() => commitQty(n), 500)
    }
  }

  const handleQtyBlur = () => {
    qtyInputFocused.current = false
    const qty = parseQtyText(qtyText)
    setQtyText(String(qty))
    if (qty !== displayQty) commitQty(qty)
  }

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition-all hover:shadow-sm flex flex-col ${
      added ? 'border-violet-500/40 bg-violet-50/40' : 'border-border'
    }`}>
      {/* Image */}
      <div className="relative h-28 bg-surface overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.productName} className="w-full h-full object-contain p-2" loading="lazy" />
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
        <h3 className="text-[13px] font-extrabold text-text leading-tight line-clamp-2 min-h-[2.2em]">{product.productName}</h3>
        <p className="text-[11px] text-text-secondary truncate">{product.companyName}</p>

        {/* Price (geo-adjusted BASE only) */}
        <div className="flex items-center gap-1 text-[13px] text-text-secondary">
          <span>السعر الأصلي:</span>
          <span className="font-extrabold text-text text-[14.3px]">{formatCurrencyShort(unitPrice).replace(' ج.م', '').trim()}</span>
          <span className="text-[11px]">للـ {UNIT_LABELS[selectedUnit]}</span>
        </div>

        {/* Unit selector — card-local state, sibling cards stay untouched */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-text-secondary font-semibold">الوحدة:</span>
          {availableUnits.map((ut) => (
            <button
              key={ut}
              onClick={() => { setUnit(ut); scheduleAvailabilityCheck() }}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                selectedUnit === ut
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
            onClick={() => { if (commitTimer.current) clearTimeout(commitTimer.current); onStep(product, selectedUnit, displayQty - 1); scheduleAvailabilityCheck(displayQty - 1) }}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40 shrink-0"
            aria-label="تقليل الكمية"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={qtyText}
            disabled={disabled}
            onFocus={() => { qtyInputFocused.current = true }}
            onChange={handleQtyInput}
            onBlur={handleQtyBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="flex-1 min-w-0 text-center text-sm font-semibold text-text bg-transparent outline-none disabled:opacity-40 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="الكمية المطلوبة"
          />
          <span className="text-[10px] text-text-secondary mr-1 shrink-0">{UNIT_LABELS[selectedUnit]}</span>
          <button
            onClick={() => { if (commitTimer.current) clearTimeout(commitTimer.current); onStep(product, selectedUnit, displayQty + 1); scheduleAvailabilityCheck(displayQty + 1) }}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-sm disabled:opacity-40 shrink-0"
            aria-label="زيادة الكمية"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {added ? (
          <div className="space-y-1">
            <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold">
              <Check className="w-3.5 h-3.5" />
              تمت الإضافة للسلة
            </div>
            <p className="text-center text-[10px] font-semibold text-violet-600">
              الكمية: {inCart} {UNIT_LABELS[selectedUnit]}
            </p>
            <button
              onClick={() => { onRemove(product, selectedUnit); scheduleAvailabilityCheck(1) }}
              className="w-full text-center text-[10px] text-text-secondary hover:text-danger underline"
            >
              إزالة من السلة
            </button>
          </div>
        ) : (
          <button
            onClick={() => { onAdd(product, selectedUnit, stepperValue); scheduleAvailabilityCheck(stepperValue) }}
            disabled={disabled}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-colors active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Gift className="w-3.5 h-3.5" />
            {BONUS_COPY.addToBonusCart}
          </button>
        )}

        {(() => {
          const status = bonusAvailabilityStatus(availabilityResult)
          if (!availabilityResult || !status || status === 'green' || !product.isActive || product.isOutOfStock) return null
          return <BusinessStatusCard data={buildBusinessStatusCard(availabilityResult)} compact />
        })()}
      </div>
    </div>
  )
})

/** Header basket badge — isolated subscription so Bonus catalog cards never
 *  re-render when an item is added/removed/stepped in the Bonus Cart. */
const BonusCartBadge = () => {
  const count = useCartStore((s) => s.bonusItems.reduce((sum, i) => sum + i.unitQuantity, 0))
  if (count <= 0) return null
  return (
    <span className="absolute -top-1.5 -right-1.5 bg-violet-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
      {count}
    </span>
  )
}

/** Sticky Bonus status bar. Subscribes ONLY to bonusCredit + bonusItems and
 *  derives the selection total from the items array (sum of base values —
 *  numerically identical to the engine's bonusProductsTotal) instead of
 *  running the full bonus-totals engine inside the render path. */
const BonusStatusBar = ({
  onBackToCompanies,
  onGoToCart,
}: {
  onBackToCompanies: () => void
  onGoToCart: () => void
}) => {
  const bonusCredit = useCartStore((s) => s.bonusCredit)
  const bonusItems = useCartStore((s) => s.bonusItems)
  const selectionTotal = useMemo(() => round2(bonusItems.reduce((sum, item) => sum + bonusItemBaseValue(item), 0)), [bonusItems])
  return (
    <div className="sticky top-14 z-40 bg-white/95 backdrop-blur rounded-xl border border-violet-200 shadow-sm px-3 py-2 space-y-2">
      <div className="flex items-stretch gap-1 text-center">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-text-secondary">رصيد البونص</div>
          <div className="text-xs sm:text-sm font-bold text-violet-700 truncate" dir="ltr">{formatCurrencyShort(bonusCredit).replace(' ج.م', '').trim()}</div>
        </div>
        <div className="flex-1 min-w-0 border-s border-violet-200">
          <div className="text-[10px] text-text-secondary">إجمالي مشتريات البونص</div>
          <div className="text-xs sm:text-sm font-bold text-text truncate" dir="ltr">{formatCurrencyShort(selectionTotal).replace(' ج.م', '').trim()}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBackToCompanies}
          className="flex-1 bg-violet-50 border border-violet-300 text-violet-700 text-xs font-bold rounded-lg py-2 active:bg-violet-100 transition-colors"
        >
          رجوع لشركات البونص
        </button>
        <button
          type="button"
          onClick={onGoToCart}
          className="flex-1 bg-primary text-white text-xs font-bold rounded-lg py-2 active:opacity-90 transition-opacity"
        >
          العودة لإتمام الطلب
        </button>
      </div>
    </div>
  )
}

/**
 * Bonus / Gifts catalog (Phase 4). Two-level browsing:
 *   Level 1 — Bonus Companies: company cards (logo + name + available count) for
 *             every company that has currently available Bonus products.
 *   Level 2 — Company Bonus Products: that company's Bonus products only, with a
 *             sticky status bar (live Bonus Credit + Bonus selection value) and
 *             controls back to the companies level and back to the cart.
 * Shows ONLY active + visible + Bonus-eligible products at their geo-adjusted
 * BASE price (never discounted). Adding a product uses the existing
 * addBonusItem store action (base-only, assertBonusBasePrice).
 */
export function BonusCatalogPage() {
  const navigate = useNavigate()
  const { token } = useAuthStore()
  const bonusMode = useCartStore((s) => s.bonusMode)
  const bonusCredit = useCartStore((s) => s.bonusCredit)
  const bonusItems = useCartStore((s) => s.bonusItems)
  const geographicContext = useCartStore((s) => s.geographicContext)
  const addBonusItem = useCartStore((s) => s.addBonusItem)
  const updateBonusQuantity = useCartStore((s) => s.updateBonusQuantity)
  const removeBonusItem = useCartStore((s) => s.removeBonusItem)

  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [geoPct, setGeoPct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [activeUnits, setActiveUnits] = useState<Record<string, UnitType[]>>({})
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)
  const [companyLogos, setCompanyLogos] = useState<Record<string, string | null>>({})
  const quantitiesRef = useRef<Record<string, number>>(quantities)

  const governorateId = geographicContext?.governorateId ?? null

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
        // Same store pattern as the normal Storefront: the catalog is merged into
        // the cart store ONCE (a single notify + single recalculation) instead of
        // one per-product syncProduct merge followed by a full recompute each.
        const store = useCartStore.getState()
        store.mergeProducts(mapped)
        store.ensureGeoItemAdjustments(mapped)
      }
    })()
    return () => { active = false }
  }, [token, governorateId])

  // Company logos for the Level-1 cards: read-only lookup of companies.logo_url
  // for the companies that actually have Bonus products (same pattern used by the
  // main storefront CompaniesPage). Purely presentational — no business logic.
  useEffect(() => {
    let active = true
    const ids = Array.from(new Set(products.map((p) => p.companyId).filter((id): id is string => Boolean(id))))
    if (ids.length === 0) return
    supabase
      .from('companies')
      .select('id, logo_url')
      .in('id', ids)
      .then(({ data }) => {
        if (!active) return
        const logos: Record<string, string | null> = {}
        for (const c of data ?? []) logos[c.id] = c.logo_url || null
        setCompanyLogos(logos)
      })
      .catch(() => { /* logos are optional — cards fall back to the initial */}
      )
    return () => { active = false }
  }, [products])

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

  /** Selling units per product, derived ONCE for the whole page and reused by
   *  every card instead of being recomputed inside each card render. */
  const activeUnitsByProduct = useMemo(() => {
    const result: Record<string, UnitType[]> = {}
    for (const p of products) {
      let unitsList = (activeUnits[p.id] ?? []).filter((u) => p.unitPrices.some((x) => x.unitType === u))
      if (unitsList.length === 0) {
        unitsList = (p.availableUnitTypes ?? []).filter((u) => p.unitPrices.some((x) => x.unitType === u))
      }
      result[p.id] = unitsList
    }
    return result
  }, [products, activeUnits])

  /** Level-1 companies (only companies that have available Bonus products).
   *  First-appearance order of the existing catalog query is preserved. */
  const companies = useMemo(() => {
    const order: string[] = []
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const p of products) {
      const id = p.companyId
      const name = String(p.companyName ?? '').trim()
      const display = name.length > 0 ? name : 'شركة غير محددة'
      const key = id || display
      if (!byId.has(key)) {
        byId.set(key, { id: key, name: display, count: 0 })
        order.push(key)
      }
      byId.get(key)!.count += 1
    }
    return order.map((key) => byId.get(key)!)
  }, [products])

  /** Level-2 products: the selected company's Bonus products only. */
  const selectedProducts = useMemo(() => {
    if (!selectedCompany) return []
    return products.filter((p) => (p.companyId || String(p.companyName ?? '').trim() || 'شركة غير محددة') === selectedCompany)
  }, [products, selectedCompany])

  const selectedCompanyName = selectedCompany ? (companies.find((c) => c.id === selectedCompany)?.name ?? null) : null

  /** In-cart Bonus quantities by product+unit, derived ONCE from the single
   *  bonusItems subscription (the only catalog-coupling subscription). Cards not
   *  in the Bonus Cart receive a stable `undefined` prop, so the memoized cards
   *  never re-render on cart changes — only the affected card does. */
  const bonusQtyByProduct = useMemo(() => {
    const map: Record<string, Record<UnitType, number>> = {}
    for (const item of bonusItems) {
      const entry: Record<UnitType, number> = map[item.productId] ?? (map[item.productId] = {} as Record<UnitType, number>)
      entry[item.unitType] = (entry[item.unitType] ?? 0) + item.unitQuantity
    }
    return map
  }, [bonusItems])

  // Opening a company starts at the top of its products.
  const openCompany = (id: string) => {
    setSelectedCompany(id)
    window.scrollTo({ top: 0 })
  }

  /** Shared pending-quantity record for cards not yet in the Bonus Cart (the
   *  ± steppers accumulate locally until the card is added). Mirrored in a ref
   *  so the memoized card handlers stay referentially stable. */
  const setQty = (id: string, qty: number) => {
    const next = { ...quantitiesRef.current, [id]: qty }
    quantitiesRef.current = next
    setQuantities(next)
  }

  const handleAdd = useCallback(async (p: ProductWithPrice, unit: UnitType, qty: number) => {
    if (qty <= 0 || !p.isActive || p.isOutOfStock) return
    const result = await checkCartAvailability(p.id, qty, unit)
    const { allowed } = bonusAddDecision(qty, result)
    if (!allowed) {
      toast.error('الكمية المطلوبة تتجاوز المتاح من هذا الصنف — لا يمكن إضافتها لبونص الشرائح.')
      return
    }
    addBonusItem(p, unit, qty)
  }, [addBonusItem])

  /** Shared stepper: once a product is in the Bonus Cart the ± buttons drive the
   *  GOVERNED Bonus Cart state directly (updateBonusQuantity/removeBonusItem),
   *  so credit/remaining/overflow recompute immediately — no duplicate local cart.
   *  `proposed` is the absolute target quantity (computed inside the card) so this
   *  stays referentially stable for the memoized cards. */
  const handleStep = useCallback(async (p: ProductWithPrice, unit: UnitType, proposed: number) => {
    const inCart = useCartStore.getState().bonusItems
      .filter((i) => i.productId === p.id && i.unitType === unit)
      .reduce((s, i) => s + i.unitQuantity, 0)
    if (proposed <= 0) {
      if (inCart > 0) {
        updateBonusQuantity(p.id, unit, 0)
      } else {
        setQty(p.id, 1)
      }
      return
    }
    if (!p.isActive || p.isOutOfStock) return
    const result = await checkCartAvailability(p.id, proposed, unit)
    const { allowed, boundedQty } = bonusAddDecision(proposed, result)
    if (allowed) {
      if (inCart > 0) {
        updateBonusQuantity(p.id, unit, proposed)
      } else {
        setQty(p.id, proposed)
      }
    } else {
      if (inCart <= 0) setQty(p.id, Math.max(1, boundedQty))
      toast.error('الحد الأقصى المتاح من هذا الصنف تم الوصول إليه.')
    }
  }, [updateBonusQuantity])

  const handleRemove = useCallback((p: ProductWithPrice, unit: UnitType) => {
    removeBonusItem(p.id, unit)
  }, [removeBonusItem])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/cart')} className="text-text-secondary text-lg">
            &larr;
          </button>
          <h1 className="text-lg font-bold text-text">
            {selectedCompanyName ? selectedCompanyName : 'متجر منتجات البونص'}
          </h1>
        </div>
        <button
          onClick={() => navigate('/cart')}
          className="relative bg-white border border-border rounded-lg px-3 py-2 text-sm"
        >
          🛒 السلة
          <BonusCartBadge />
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

      {bonusMode && !selectedCompany && (
        <BonusStatusBar onBackToCompanies={() => {}} onGoToCart={() => navigate('/cart')} />
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

      {!loading && !error && products.length > 0 && bonusMode && !selectedCompany && (
        <>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-bold text-text">اختر شركة البونص</h2>
            </div>
            <p className="text-xs text-text-secondary">
              اختر الشركة للاطلاع على منتجات البونص المتاحة لها
            </p>
          </div>
          {/* Level 1 — company cards (same visual family as #/storefront company selection) */}
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {companies.map((company) => {
              const logoUrl = companyLogos[company.id] ?? null
              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => openCompany(company.id)}
                  className="bg-white border border-border rounded-2xl overflow-hidden active:scale-[0.97] active:border-violet-300 transition-all"
                >
                  <div className="w-full aspect-square bg-surface flex items-center justify-center overflow-hidden">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={company.name}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      <span className="text-3xl font-extrabold text-text-secondary">
                        {company.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="px-2 py-2 text-center">
                    <div className="text-[13px] font-bold text-text leading-snug truncate">{company.name}</div>
                    <div className="text-[10px] font-semibold text-violet-600 mt-0.5">
                      {company.count} {company.count === 1 ? 'منتج' : 'منتجات'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="text-center text-xs text-text-secondary">
            {bonusCredit > 0 ? (
              <>لديك رصيد بونص بقيمة <b className="text-violet-700">{fmtAmount(bonusCredit)}</b> — اختر المنتجات التي تغطيه</>
            ) : (
              'اختر الشركة ثم منتجات البونص المتاحة لها'
            )}
          </div>
        </>
      )}

      {!loading && !error && products.length > 0 && bonusMode && selectedCompany && (
        <>
          {/* Level 2 — sticky status bar (isolated subscription: catalog cards
              do NOT re-render when its values update). */}
          <BonusStatusBar
            onBackToCompanies={() => setSelectedCompany(null)}
            onGoToCart={() => navigate('/cart')}
          />

          {/* Level 2 — selected company's Bonus products only. Cards are memoized
              and prop-driven in the normal Storefront ProductCard pattern: the
              page owns a single bonusItems subscription and passes each card's
              in-cart quantity down as a prop; each card performs its own lazy,
              debounced availability check on user interaction only. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-stretch">
            {selectedProducts.map((p) => (
              <BonusProductCard
                key={p.id}
                product={p}
                activeUnits={activeUnitsByProduct[p.id] ?? []}
                unitPrices={p.unitPrices}
                stepperValue={quantities[p.id] ?? 1}
                inCartQtyByUnit={bonusQtyByProduct[p.id]}
                onAdd={handleAdd}
                onStep={handleStep}
                onRemove={handleRemove}
              />
            ))}
          </div>
          {selectedProducts.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-border">
              <p className="text-sm text-text-secondary font-semibold">لا توجد منتجات بونص متاحة لهذه الشركة</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}