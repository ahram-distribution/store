import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo, useCallback, type ReactNode } from 'react'
import { useCartStore } from '../../store/cart'
import { useAuthStore } from '../../store/auth'
import { EmptyCart } from '../../components/storefront/EmptyCart'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import { CartSummaryBar } from '../../components/storefront/CartSummaryBar'
import { formatArabicAmountWithCurrency, formatTierName } from '../../utils/format'
import { formatSmartMoney } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import { BONUS_COPY } from '../../constants/bonusCopy'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import type { CartItem as CartItemType, CompanyAddGuardResult } from '../../types/storefront'
import { checkCartAvailability } from '../../utils/cart-availability'
import { evaluateCompanyMaxAdd, companyDiversificationSentence } from '../../engine/pricing'
import { resolveLinePrice } from '../../utils/cart-line-price-display'

/** Compact LTR money cell — thousands separators, no currency suffix, smart decimals. */
function Money({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span dir="ltr" className={`tabular-nums ${className}`}>
      {formatSmartMoney(Number(value) || 0)}
    </span>
  )
}

const percentText = (pct: number) => {
  const p = Number(pct)
  return p % 1 === 0 ? String(p) : Number(Number(p).toFixed(1)).toString()
}

function SectionTitle({ children }: { children: string }) {
  return <div className="text-xs font-bold text-text-secondary mb-1.5">{children}</div>
}

export function CartPage() {
  const navigate = useNavigate()
  const [hydrated, setHydrated] = useState(false)
  const { token: authToken, user } = useAuthStore()
  const isDirectCustomer = user?.identity_type === 'customer'
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [customers, setCustomers] = useState<any[]>([])
  /** Governed inventory cap, cached per productId:unitType after the availability RPC. */
  const [stockMax, setStockMax] = useState<Record<string, number | null>>({})
  /** Inline (non-toast) block notes shown under the +/- stepper, keyed per line. */
  const [inlineBlocks, setInlineBlocks] = useState<Record<string, ReactNode>>({})
  /** Lines currently awaiting the governed availability RPC (disable re-tap). */
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const s = useCartStore as unknown as { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }
    if (s.persist.hasHydrated()) {
      setHydrated(true)
    } else {
      const unsub = s.persist.onFinishHydration(() => setHydrated(true))
      return unsub
    }
  }, [])

  useEffect(() => {
    useCartStore.getState().refreshDiscountOptions()
    useCartStore.getState().subscribeToDiscountOptions()
  }, [])

  const fetchCustomers = useCallback(async () => {
    if (!authToken || customers.length > 0) return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: authToken })
    if (!Array.isArray(data)) return
    setCustomers(data)
    // Backfill the persisted selected customer's real address (registered_address /
    // location_address from the governed RPC) — fixes customers selected before the
    // address field was populated.
    const selected = useCartStore.getState().selectedCustomer
    if (selected && !selected.address) {
      const match = (data as any[]).find((c: any) => c.id === selected.id)
      const addr = String(match?.registered_address || match?.location_address || '') || undefined
      if (addr) {
        useCartStore.getState().setSelectedCustomer({ ...selected, address: addr })
      }
    }
  }, [authToken, customers.length])

  const {
    items,
    dealItems,
    flashOfferItems,
    products,
    tiers,
    selectedTierId,
    selectTier,
    paymentMethods,
    selectedPaymentMethodId,
    selectPaymentMethod,
    shippingMethods,
    selectedShippingMethodId,
    selectShippingMethod,
    updateQuantity,
    removeItem,
    removeDeal,
    removeFlashOffer,
    getSelectedTier,
    getSelectedPaymentMethod,
    getSelectedShippingMethod,
    getTotals,
    selectedCustomer,
    setSelectedCustomer,
    geographicContext,
    geoResolveEpoch,
    ensureGeoItemAdjustments,
    bonusMode,
    bonusItems,
    bonusOverflowApproved,
    setBonusOverflowApproved,
    removeBonusItem,
    refreshBonusMode,
    updateBonusQuantity,
  } = useCartStore()

  const selectedTier = getSelectedTier()
  const selectedPaymentMethod = getSelectedPaymentMethod()
  const selectedShippingMethod = getSelectedShippingMethod()
  const totals = getTotals()

  useEffect(() => {
    if (products.length > 0) {
      ensureGeoItemAdjustments(products)
    }
  }, [products, geographicContext?.governorateId, geoResolveEpoch, ensureGeoItemAdjustments])

  // Derived addability recomputes from the cart/totals on every render, so once
  // quantity, tier, or benefit inputs change, stale per-line block notes (stock
  // errors, availability RPC rejects) are dropped and re-derived. Decrementing a
  // previously-blocked line therefore re-enables its + automatically.
  useEffect(() => {
    setInlineBlocks({})
  }, [
    items,
    bonusItems,
    selectedTierId,
    selectedPaymentMethodId,
    selectedShippingMethodId,
    selectedCustomer?.id,
    bonusMode,
    geoResolveEpoch,
  ])

  useEffect(() => {
    if (hydrated) {
      refreshBonusMode()
      fetchCustomers()
    }
  }, [hydrated, refreshBonusMode, fetchCustomers])

  const productCompanyMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const p of products) {
      map.set(p.id, { id: p.companyId, name: p.companyName })
    }
    return map
  }, [products])

  if (!hydrated) return null

  if (items.length === 0 && dealItems.length === 0 && flashOfferItems.length === 0 && bonusItems.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-text">سلة التسوق</h1>
        <EmptyCart onBrowseProducts={() => navigate('/storefront')} />
      </div>
    )
  }

  const handleContinue = () => {
    const blockedItem = [...items, ...bonusItems].find((item) => {
      const product = products.find((p) => p.id === item.productId)
      if (!product) return false
      if (!product.isActive || product.isOutOfStock) return true
      if (!product.unitPrices.some((u) => u.unitType === item.unitType)) return true
      return false
    })
    if (blockedItem) {
      toast.error('السلة تحتوي على منتجات غير متوفرة حالياً. يرجى إزالتها للمتابعة.')
      return
    }

    // Targeted Cart eligibility rule (Bonus Tiers mode): the customer must finish
    // achieving the selected tier AND purchase bonus products worth >= the earned
    // Bonus Credit. Reuses only existing Cart state (totals/engine results).
    if (bonusMode) {
      const tierAchieved = !!selectedTier && !!totals.meetsTierMinimum && !!totals.meetsCompanyRules
      const bonusUsageComplete = (totals.bonusProductsTotal ?? 0) >= (totals.bonusCredit ?? 0)
      if (!tierAchieved && !bonusUsageComplete) {
        toast.error('لا يمكن متابعة الطلب. يجب تحقيق الشريحة والشراء بكامل رصيد البونص أولاً.')
        return
      }
      if (!bonusUsageComplete) {
        toast.error('لا يمكن متابعة الطلب. يجب الشراء بكامل رصيد البونص أولاً.')
        return
      }
    }

    if (selectedTier && !totals.meetsTierMinimum) {
      toast.error(`الحد الأدنى للشريحة ${formatArabicAmountWithCurrency(totals.tierMinimum)} — أضف منتجات بقيمة ${formatArabicAmountWithCurrency(totals.remainingForMinimum)}`)
      return
    }
    if (selectedTier && !totals.meetsCompanyRules) {
      if (totals.companyRule && !totals.companyRule.meetsMinimumCompanies) {
        const needed = (totals.companyRule.minimumCompanyCount ?? 0) - totals.companyRule.distinctCompanyCount
        toast.error(needed > 0 ? `تنوع الشركات غير كافٍ — أضف منتجات من ${needed} شركة أخرى` : 'تنوع الشركات غير محقق')
      } else {
        toast.error('لا بد من إعادة توزيع المشتريات بين الشركات بما لا يتجاوز الحد الأقصى لكل شركة')
      }
      return
    }
    if (bonusMode && (totals.bonusOverflow ?? 0) > 0 && !bonusOverflowApproved) {
      toast.error(BONUS_COPY.overflowRequired)
      return
    }
    if (items.length === 0 && bonusItems.length === 0 && (dealItems.length > 0 || flashOfferItems.length > 0)) {
      navigate('/order-review')
      return
    }
    navigate('/order-review')
  }

  /** Cancel overflow: reset approval and return the Bonus selection to a valid,
   *  non-overflow state using ONLY the existing governed store actions. */
  const handleBonusCancel = () => {
    setBonusOverflowApproved(false)
    let guard = 0
    while ((useCartStore.getState().bonusOverflow ?? 0) > 0 && guard < 200) {
      const state = useCartStore.getState()
      const all = [...state.bonusItems]
      if (all.length === 0) break
      const biggest = all.reduce((a, b) => (b.totalPrice > a.totalPrice ? b : a))
      removeBonusItem(biggest.productId, biggest.unitType)
      guard++
    }
    toast.success('تم إلغاء تجاوز البونص — أُزيلت المنتجات الزائدة عن الرصيد.')
  }

  const companyNameFor = (item: CartItemType) => {
    const company = productCompanyMap.get(item.productId)
    return company?.name || item.companyName || 'غير معروف'
  }

  const codeFor = (item: CartItemType) => {
    const product = products.find((p) => p.id === item.productId)
    return product?.legacyCode
  }

  const hasDiscount = (item: CartItemType) =>
    typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0 && Math.abs(item.baseUnitPrice - item.unitPrice) > 0.005

  const lineBaseValue = (item: CartItemType) =>
    Math.round((typeof item.baseUnitPrice === 'number' && item.baseUnitPrice >= 0 ? item.baseUnitPrice : item.unitPrice) * item.unitQuantity * 100) / 100

  /** Per-main-product-line governed Bonus credit (from totals.bonusSummary.items). */
  const bonusCreditFor = (item: CartItemType): number | null => {
    if (!bonusMode || item.isBonus) return null
    const lineBase = lineBaseValue(item)
    const ent = (totals.bonusSummary?.items ?? []).find(
      (e) => e.productId === item.productId && Math.abs(e.baseValue - lineBase) < 0.011
    )
    if (!ent || ent.credit <= 0) return null
    return ent.credit
  }

  /** Per-main-product-line actual monetary discount (Direct Discount mode only). */
  const discountFor = (item: CartItemType): number | null => {
    if (bonusMode || item.isBonus || !hasDiscount(item)) return null
    return Math.round((item.baseUnitPrice - item.unitPrice) * item.unitQuantity * 100) / 100
  }

  const benefitFor = (item: CartItemType): number | null => (bonusMode ? bonusCreditFor(item) : discountFor(item))
  const benefitWord = bonusMode ? 'بونص' : 'خصم'

  /** Company-cap state for a MAIN line AFTER a hypothetical +1 (matches the store
   *  guard exactly — evaluateCompanyMaxAdd derives the fixed per-company limit
   *  from the SELECTED tier value: tierValue × maxPercent / 100. The cart
   *  subtotal plays no part; currentItems = pre-increment state for display). */
  const companyGuardFor = (item: CartItemType) => {
    const candidate = items.map((i) =>
      i.productId === item.productId && i.unitType === item.unitType
        ? { ...i, unitQuantity: i.unitQuantity + 1 }
        : i
    )
    return evaluateCompanyMaxAdd(candidate, selectedTier, {
      productId: item.productId,
      unitType: item.unitType,
    }, items)
  }

  const companyBlockNote = (guard: CompanyAddGuardResult) => {
    return (
      <span>
        لا يمكن زيادة الكمية: قيمة مشتريات هذه الشركة ستتجاوز الحد الأقصى المسموح به لهذه الشريحة (
        {guard.maxPercent}%).
        <span className="mt-0.5 block text-text-secondary">
          الحد الأقصى لهذه الشركة {formatSmartMoney(guard.maxCompanyValue ?? 0)} ج.م · المشتريات الحالية{' '}
          {formatSmartMoney(guard.currentCompanyValue ?? 0)} ج.م
          {guard.room != null ? ` · المتاح ${formatSmartMoney(guard.room)} ج.م` : ''}
        </span>
      </span>
    )
  }

  const stockBlockNote = (max: number, unit: string) => (
    <span>
      لا يمكن زيادة الكمية: الكمية المتاحة بالمخزون تم الوصول إليها. (الحد الأقصى {max} {unit})
    </span>
  )

  /** Governed per-line addability for the + button (company cap, inventory cap,
   *  product availability, inflight-request). Company cap is always re-derived;
   *  inventory/product rejects are cached only until cart inputs change. */
  const plusStateFor = (item: CartItemType, isBonus: boolean): { disabled: boolean; note: ReactNode | null } => {
    const key = `${item.productId}:${item.unitType}`
    if (pendingKeys.has(key)) return { disabled: true, note: null }
    const existing = inlineBlocks[key]
    if (existing) return { disabled: true, note: existing }
    const product = products.find((p) => p.id === item.productId)
    if (product && (!product.isActive || product.isOutOfStock)) {
      return { disabled: true, note: 'لا يمكن زيادة الكمية: هذا الصنف غير متوفر حالياً.' }
    }
    if (!isBonus) {
      const guard = companyGuardFor(item)
      if (guard.blocked) return { disabled: true, note: companyBlockNote(guard) }
    }
    const mx = stockMax[key]
    if (mx != null && item.unitQuantity + 1 > mx) {
      return { disabled: true, note: stockBlockNote(mx, UNIT_LABELS[item.unitType] || 'قطعة') }
    }
    return { disabled: false, note: null }
  }

  /** Governed increment: hard COMPANY pre-check first, then a best-effort
   *  availability RPC BEFORE applying (never an optimistic invalid quantity);
   *  the stock cap is cached per line so subsequent taps are synchronous. The
   *  store re-runs the company guard synchronously on apply as the final gate. */
  const attemptIncrement = async (item: CartItemType, isBonus: boolean) => {
    const key = `${item.productId}:${item.unitType}`
    const next = item.unitQuantity + 1
    const apply = (qty: number) =>
      isBonus ? updateBonusQuantity(item.productId, item.unitType, qty) : updateQuantity(item.productId, item.unitType, qty)
    const clearBlock = () =>
      setInlineBlocks((prev) => {
        if (!prev[key]) return prev
        const { [key]: _drop, ...rest } = prev
        return rest
      })

    if (!isBonus) {
      const guard = companyGuardFor(item)
      if (guard.blocked) {
        setInlineBlocks((prev) => ({ ...prev, [key]: companyBlockNote(guard) }))
        return
      }
    }

    const product = products.find((p) => p.id === item.productId)
    if (product && (!product.isActive || product.isOutOfStock)) {
      setInlineBlocks((prev) => ({ ...prev, [key]: 'لا يمكن زيادة الكمية: هذا الصنف غير متوفر حالياً.' }))
      return
    }

    const mx = stockMax[key]
    if (mx != null && next > mx) {
      setInlineBlocks((prev) => ({ ...prev, [key]: stockBlockNote(mx, UNIT_LABELS[item.unitType] || 'قطعة') }))
      return
    }

    setPendingKeys((prev) => new Set(prev).add(key))
    try {
      const result = await checkCartAvailability(item.productId, next, item.unitType)
      const blocked = !result.available || (result.max_allowed_units != null && next > result.max_allowed_units)
      if (blocked) {
        if (result.max_allowed_units != null) {
          setStockMax((prev) => ({ ...prev, [key]: result.max_allowed_units }))
          setInlineBlocks((prev) => ({
            ...prev,
            [key]: stockBlockNote(result.max_allowed_units, UNIT_LABELS[result.unit_type] || 'قطعة'),
          }))
        } else {
          setInlineBlocks((prev) => ({ ...prev, [key]: result.error || 'الكمية المتاحة غير كافية لهذا الصنف' }))
        }
        return
      }
      if (result.max_allowed_units != null) {
        setStockMax((prev) => ({ ...prev, [key]: result.max_allowed_units }))
      }
      clearBlock()
      apply(next)
    } catch {
      // Advisory RPC unavailable — fall back to a governed increment (the store's
      // company guard still validates the change synchronously).
      clearBlock()
      apply(next)
    } finally {
      setPendingKeys((prev) => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
    }
  }

  const qtyControls = (item: CartItemType, isBonus: boolean) => {
    const plus = plusStateFor(item, isBonus)
    const minusDisabled = item.unitQuantity <= 1
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = item.unitQuantity - 1
              if (isBonus) updateBonusQuantity(item.productId, item.unitType, next)
              else updateQuantity(item.productId, item.unitType, next)
            }}
            disabled={minusDisabled}
            aria-label="تقليل الكمية"
            className={`w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-xl leading-none select-none transition-colors ${
              minusDisabled ? 'opacity-40 cursor-not-allowed' : 'active:bg-surface'
            }`}
          >
            −
          </button>
          <span className="text-sm font-semibold text-text w-8 text-center tabular-nums">{item.unitQuantity}</span>
          <button
            type="button"
            onClick={() => attemptIncrement(item, isBonus)}
            disabled={plus.disabled}
            aria-label="زيادة الكمية"
            className={`w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-border text-text-secondary text-xl leading-none select-none transition-colors ${
              plus.disabled ? 'opacity-40 cursor-not-allowed' : 'active:bg-surface'
            }`}
          >
            +
          </button>
        </div>
        {plus.note && (
          <p className="text-[10px] text-danger leading-snug text-center max-w-[240px] md:max-w-none">
            {plus.note}
          </p>
        )}
      </div>
    )
  }

  const unitPriceBlock = (item: CartItemType, isBonus: boolean) => {
    const rp = resolveLinePrice(item, totals)
    const showSale = rp.percent > 0
    return (
      <div className="text-xs space-y-0.5">
        <div className="text-text-secondary">سعر الوحدة</div>
        {showSale && (
          <div className="flex items-center gap-1.5">
            <div className="line-through text-text-secondary">
              <Money value={rp.originalUnit} />
            </div>
            <span className="text-[10px] text-success bg-success/10 px-1 py-0.5 rounded-md font-bold">
              خصم {percentText(rp.percent)}%
            </span>
          </div>
        )}
        <div className="font-bold text-primary">
          <Money value={rp.netUnit} />
        </div>
        {isBonus && <div className="text-[10px] text-text-secondary">سعر البونص (أساسي)</div>}
      </div>
    )
  }

  /** MOBILE — structured product block (primary layout). */
  const mobileRow = (item: CartItemType, isBonus: boolean, keyPrefix: string) => {
    const benefit = benefitFor(item)
    return (
      <div key={`${keyPrefix}${item.productId}-${item.unitType}`} className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text leading-tight break-words">{item.productName}</div>
            <div className="text-[11px] text-text-secondary mt-0.5 break-words">
              الكود: {codeFor(item) || '—'} · الشركة: {companyNameFor(item)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => (isBonus ? removeBonusItem(item.productId, item.unitType) : removeItem(item.productId, item.unitType))}
            className="text-[11px] text-danger font-semibold shrink-0"
          >
            حذف
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text">
            <span className="text-text-secondary">الكمية:</span>{' '}
            <b className="tabular-nums text-sm">{item.unitQuantity}</b> {UNIT_LABELS[item.unitType]}
          </span>
          {qtyControls(item, isBonus)}
        </div>
        {unitPriceBlock(item, isBonus)}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">إجمالي الصنف</span>
          <span className="flex flex-col items-end gap-0.5">
            {(() => {
              const rp = resolveLinePrice(item, totals)
              return rp.percent > 0 ? (
                <>
                  <span dir="ltr" className="text-xs text-text-secondary line-through">
                    <Money value={rp.originalLine} />
                  </span>
                  <b className="text-sm font-bold text-primary" dir="ltr">
                    <Money value={rp.netLine} />
                  </b>
                </>
              ) : (
                <b className="text-sm font-bold text-text" dir="ltr">
                  <Money value={rp.netLine} />
                </b>
              )
            })()}
          </span>
        </div>
        {benefit !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{benefitWord} الناتج عن هذا الصنف</span>
            <b className="text-xs font-bold text-success" dir="ltr">
              <Money value={benefit} />
            </b>
          </div>
        )}
      </div>
    )
  }

  /** DESKTOP / TABLET — aligned product table row (md+ only). */
  const desktopRow = (item: CartItemType, isBonus: boolean, idx: number) => {
    const benefit = benefitFor(item)
    return (
      <div
        key={`${isBonus ? 'bonus-' : ''}${item.productId}-${item.unitType}`}
        className="px-4 py-2.5 hidden md:grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_9rem_7rem_7rem_9rem] gap-x-3 items-center"
      >
        <span className="text-[11px] text-text-secondary tabular-nums">{idx + 1}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text break-words">{item.productName}</div>
          <div className="text-[11px] text-text-secondary">
            الكود: {codeFor(item) || '—'} · الشركة: {companyNameFor(item)}
          </div>
        </div>
        <div className="flex text-xs text-text items-center gap-1">
          <b className="tabular-nums">{item.unitQuantity}</b> {UNIT_LABELS[item.unitType]}
        </div>
        <div>{unitPriceBlock(item, isBonus)}</div>
        <div className="flex flex-col items-start gap-0.5">
          {(() => {
            const rp = resolveLinePrice(item, totals)
            return rp.percent > 0 ? (
              <>
                <span className="text-xs text-text-secondary line-through">
                  <Money value={rp.originalLine} />
                </span>
                <span className="text-sm font-bold text-primary">
                  <Money value={rp.netLine} />
                </span>
              </>
            ) : (
              <span className="text-sm font-bold text-text">
                <Money value={rp.netLine} />
              </span>
            )
          })()}
        </div>
        <div className="text-xs font-bold text-success">
          {benefit !== null ? (
            <>
              {benefitWord} <Money value={benefit} />
            </>
          ) : (
            <span className="text-text-secondary font-normal">—</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {qtyControls(item, isBonus)}
          <button
            type="button"
            onClick={() => (isBonus ? removeBonusItem(item.productId, item.unitType) : removeItem(item.productId, item.unitType))}
            className="text-[11px] text-danger font-semibold"
          >
            حذف
          </button>
        </div>
      </div>
    )
  }

  /** Desktop table header (md+ only). */
  const tableHead = (benefitTitle: string) => (
    <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_9rem_7rem_7rem_9rem] gap-x-3 items-center px-4 py-2 text-[11px] font-bold text-text-secondary bg-surface/70 border-b border-border">
      <span>#</span>
      <span>الصنف</span>
      <span>الكمية</span>
      <span>سعر الوحدة</span>
      <span>إجمالي الصنف</span>
      <span>{benefitTitle}</span>
      <span>إجراءات</span>
    </div>
  )

  const renderBenefitSelect = (
    label: string,
    currentId: string | null,
    rawOptions: { id: string; name: string; discountPercent: number }[],
    onSelect: (id: string | null) => void,
    noneLabel: string
  ) => {
    const inList = rawOptions.some((o) => o.id === currentId)
    return (
      <label className="block">
        <span className="text-[11px] font-semibold text-text-secondary block mb-1">{label}</span>
        <select
          value={inList ? currentId ?? '' : ''}
          onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
          className="w-full h-10 border border-border rounded-lg px-2.5 text-sm bg-white text-text outline-none focus:border-primary transition-colors"
        >
          <option value="">{noneLabel}</option>
          {rawOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {formatTierName(o.name)}
              {Number(o.discountPercent) > 0 ? ` — ${bonusMode ? 'بونص' : 'خصم'} ${percentText(o.discountPercent)}%` : ''}
            </option>
          ))}
        </select>
      </label>
    )
  }

  const visiblePaymentMethods = paymentMethods.filter((m) => m.isActive && m.isVisible)
  const visibleShippingMethods = shippingMethods.filter((m) => m.isActive && m.isVisible)

  const bonusCredit = totals.bonusCredit ?? 0
  const bonusProductsTotal = totals.bonusProductsTotal ?? 0
  const bonusApplied = totals.bonusApplied ?? 0
  const bonusUnused = totals.bonusUnused ?? 0
  const bonusOverflow = totals.bonusOverflow ?? 0

  const totalCount = items.length + bonusItems.length
  const mainProductsTotal = bonusMode ? totals.productBaseSubtotal : totals.productSubtotal
  const hasBenefitSelectors = tiers.length > 0 || visiblePaymentMethods.length > 0 || visibleShippingMethods.length > 0

  // Effective benefit rates come from the shared resolution (totals.benefitRates),
  // never from raw option defaults. A single order-wide % is shown ONLY when every
  // product resolves to the same effective rates (uniform); heterogeneous carts get
  // a money-derived realized % instead.
  const br = totals.benefitRates

  // Bonus Tiers eligibility for "متابعة الطلب" (presentation + click validation):
  // enabled ONLY when the selected tier is achieved AND selected Bonus Store value
  // covers the earned Bonus Credit. All values come from the existing Cart totals.
  const tierAchievedForContinue = selectedTier !== null && !!totals.meetsTierMinimum && !!totals.meetsCompanyRules
  const bonusUsageCompleteForContinue = bonusProductsTotal >= bonusCredit
  const continueBlocked =
    (selectedTier !== null && (!totals.meetsTierMinimum || !totals.meetsCompanyRules) && (items.length > 0 || bonusItems.length > 0)) ||
    (bonusMode && bonusOverflow > 0 && !bonusOverflowApproved && (items.length > 0 || bonusItems.length > 0)) ||
    (bonusMode && bonusCredit > 0 && bonusProductsTotal < bonusCredit && (items.length > 0 || bonusItems.length > 0))

  return (
    <div className="space-y-3 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/storefront')} aria-label="رجوع" className="text-text-secondary text-lg">
            &larr;
          </button>
          <h1 className="text-lg font-bold text-text">سلة التسوق</h1>
        </div>
        <span className="text-xs text-text-secondary">{totalCount} منتج</span>
      </div>

      {/* 1. Blue compact cart summary bar */}
      <CartSummaryBar />

      {/* 2. Tier status — directly under the summary bar */}
      {selectedTier && (
        <div
          className={`rounded-lg border text-xs ${
            totals.meetsTierMinimum ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
          }`}
        >
          <div className="px-3 py-2 font-semibold flex items-center justify-between gap-2">
            <span className={totals.meetsTierMinimum ? 'text-success' : 'text-warning'}>
              حالة الشريحة: {formatTierName(selectedTier.name)}
            </span>
            {totals.meetsTierMinimum ? (
              <span className="text-success">تم تحقيق الشريحة ✓</span>
            ) : (
              <span className="text-warning">
                متبقي <span dir="ltr" className="tabular-nums font-bold">{formatSmartMoney(totals.remainingForMinimum)}</span>{' '}
                لتحقيق الشريحة
              </span>
            )}
          </div>
          {/* Total discount value + percentage breakdown */}
          <div className="px-3 pb-2 pt-1.5 border-t border-border space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary font-medium">{bonusMode ? 'إجمالي قيمة البونص' : 'إجمالي قيمة الخصم'}</span>
              <span className={`font-bold ${bonusMode ? 'text-violet-700' : 'text-success'}`} dir="ltr">
                {bonusMode ? <Money value={bonusCredit} /> : <>−<Money value={totals.totalDiscount} /></>}
              </span>
            </div>
            </div>
        </div>
      )}

      {/* 3. Customer information */}
      {items.length > 0 && (
        <div className="bg-primary/[0.03] rounded-xl border border-primary/15 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-primary">بيانات العميل</div>
            {!editingCustomer && !isDirectCustomer && (
              <button type="button" onClick={() => { setEditingCustomer(true); fetchCustomers() }} className="text-xs font-semibold text-primary">
                تغيير العميل
              </button>
            )}
          </div>
          {editingCustomer ? (
            <SearchableSelect
              items={customers.map((c: any) => ({ id: c.id, name: c.company_name || '' }))}
              value={selectedCustomer?.id || ''}
              onChange={(id) => {
                const c = customers.find((c: any) => c.id === id)
                if (c) {
                  setSelectedCustomer({
                    id: c.id,
                    name: c.company_name || '',
                    phone: c.phone || '',
                    code: c.code || '',
                    address: String(c.registered_address || c.location_address || '') || undefined,
                  })
                }
                setEditingCustomer(false)
              }}
              placeholder="اختر العميل"
            />
          ) : (
            <div className="space-y-1">
              <div className="text-base font-bold text-text break-words">{selectedCustomer?.name || 'غير محدد'}</div>
              <div className="flex items-start gap-1.5 text-xs text-text-secondary">
                <span className="font-semibold shrink-0">الاسم:</span>
                <span className="break-words">{selectedCustomer?.name || 'غير محدد'}</span>
              </div>
              <div className="flex items-start gap-1.5 text-xs text-text-secondary">
                <span className="font-semibold shrink-0">الهاتف:</span>
                <span dir="ltr" className="break-all">{selectedCustomer?.phone || 'غير مسجل'}</span>
              </div>
              <div className="flex items-start gap-1.5 text-xs text-text-secondary">
                <span className="font-semibold shrink-0">العنوان:</span>
                <span className="break-words">{selectedCustomer?.address || 'لا يوجد عنوان مسجل'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Benefit selectors */}
      {hasBenefitSelectors && (
        <div className="bg-amber-50/40 rounded-xl border border-amber-200/70 p-3">
          <SectionTitle>الخصومات والمزايا</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {tiers.length > 0 &&
              renderBenefitSelect(
                'شريحتك',
                selectedTierId,
                tiers.map((t) => ({ id: t.id, name: t.name, discountPercent: t.discountPercent })),
                selectTier,
                'السعر الأساسي'
              )}
            {visiblePaymentMethods.length > 0 &&
              renderBenefitSelect('طريقة الدفع', selectedPaymentMethodId, visiblePaymentMethods, selectPaymentMethod, 'نقدي / بدون طريقة')}
            {visibleShippingMethods.length > 0 &&
              renderBenefitSelect('طريقة الشحن', selectedShippingMethodId, visibleShippingMethods, selectShippingMethod, 'بدون طريقة شحن')}
          </div>
          {selectedTier && !totals.meetsTierMinimum && (
            <p className="text-[11px] text-warning mt-1.5">
              الحد الأدنى للشريحة {formatArabicAmountWithCurrency(totals.tierMinimum)} — المتبقي {formatArabicAmountWithCurrency(totals.remainingForMinimum)}
            </p>
          )}
          {selectedTier &&
            totals.companyRule?.maxCompanyPurchasePercent != null &&
            totals.companyRule?.minimumCompanyCount != null &&
            totals.companyRule?.maxCompanyValue != null && (
              <p className="text-[11px] text-text-secondary mt-1.5">
                {companyDiversificationSentence(
                  totals.companyRule.minimumCompanyCount,
                  totals.companyRule.maxCompanyPurchasePercent
                )}
              </p>
            )}
          {selectedTier && totals.companyRule && !totals.meetsCompanyRules && (
            <p className="text-[11px] text-danger mt-1.5">
              {totals.companyRule && !totals.companyRule.meetsMinimumCompanies
                ? `تنوع الشركات غير كافٍ — أضف منتجات من ${(totals.companyRule.minimumCompanyCount ?? 0) - totals.companyRule.distinctCompanyCount} شركة أخرى`
                : (() => {
                    const offenders = (totals.companyRule?.companies ?? []).filter((c) => c.exceedsCap)
                    return offenders.length > 0
                      ? `أعد توزيع المشتريات — ${offenders.map((c) => c.companyName).join('، ')} ${offenders.length === 1 ? 'تجاوزت' : 'تجاوزوا'} الحد الأقصى ${formatSmartMoney(offenders[0]?.maxCompanyValue ?? 0)} ج.م لكل شركة`
                      : 'أعد توزيع المشتريات بين الشركات بما لا يتجاوز الحد الأقصى لكل شركة'
                  })()}
            </p>
          )}
        </div>
      )}

      {/* Flash offers + daily deals — compact */}
      {flashOfferItems.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-300 overflow-hidden">
          <div className="px-3 py-2 bg-amber-500 text-white text-xs font-bold">عروض الساعة</div>
          <div className="divide-y divide-amber-100">
            {flashOfferItems.map((offer) => (
              <div key={offer.dealId} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text truncate">{offer.dealTitle}</div>
                  <div className="text-[11px] text-text-secondary">الكمية: {offer.quantity}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-danger" dir="ltr">
                    <Money value={offer.totalPrice} />
                  </span>
                  <button type="button" onClick={() => removeFlashOffer(offer.dealId)} className="text-xs text-danger font-semibold">
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {dealItems.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-300 overflow-hidden">
          <div className="px-3 py-2 bg-amber-500 text-white text-xs font-bold">العروض اليومية</div>
          <div className="divide-y divide-amber-100">
            {dealItems.map((deal) => (
              <div key={deal.dealId} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text truncate">{deal.dealTitle}</div>
                  <div className="text-[11px] text-text-secondary">الكمية: {deal.quantity}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-danger" dir="ltr">
                    <Money value={deal.totalPrice} />
                  </span>
                  <button type="button" onClick={() => removeDeal(deal.dealId)} className="text-xs text-danger font-semibold">
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. MAIN PRODUCTS — BLUE group identity */}
      {items.length > 0 && (
        <div className="rounded-xl border border-blue-200 overflow-hidden">
          <div className="px-3 py-2 bg-primary text-white flex items-center justify-between">
            <h2 className="text-sm font-bold">المنتجات الرئيسية</h2>
            <span className="text-[11px] text-white/80">{items.length} صنف</span>
          </div>
          {/* Desktop table (md+) */}
          <div className="hidden md:block bg-white">
            {tableHead(benefitWord)}
            <div className="divide-y divide-blue-100">
              {items.map((item, i) => desktopRow(item, false, i))}
            </div>
          </div>
          {/* Mobile structured blocks */}
          <div className="md:hidden bg-white divide-y divide-blue-100">
            {items.map((item) => mobileRow(item, false, ''))}
          </div>
          {/* Total main products */}
          <div className="px-3 py-2 bg-blue-50/70 border-t border-blue-100 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">إجمالي المنتجات الرئيسية</span>
              <span className="text-lg font-extrabold text-primary" dir="ltr">
                <Money value={mainProductsTotal} />
              </span>
            </div>
            {bonusMode && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-secondary">إجمالي البونص</span>
                <span className="text-sm font-bold text-violet-700" dir="ltr">
                  <Money value={bonusCredit} />
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Savings explanation — Direct Discount mode only */}
      {!bonusMode && items.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-3 space-y-1.5 text-sm">
          <SectionTitle>التوفير</SectionTitle>
          <div className="flex justify-between items-center text-text">
            <span className="text-text-secondary">إجمالي المنتجات قبل الخصم</span>
            <span className="text-text-secondary" dir="ltr">
              <Money value={totals.productBaseSubtotal} />
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">إجمالي الخصم</span>
            <span className="font-bold text-success" dir="ltr">
              −<Money value={totals.totalDiscount} />
            </span>
          </div>
          <div className="flex justify-between items-center border-t border-border pt-1.5">
            <span className="font-semibold">الإجمالي بعد الخصم</span>
            <span className="font-bold text-primary text-base" dir="ltr">
              <Money value={totals.productSubtotal} />
            </span>
          </div>
        </div>
      )}

      {/* 6. BONUS SECTION — PURPLE group identity */}
      {bonusMode && (bonusItems.length > 0 || bonusCredit > 0) && (
        <div className="rounded-xl border border-violet-300 overflow-hidden">
          {/* Customer-facing benefit banner */}
          <div className="px-3 py-3 bg-violet-600 text-white">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">🎁 منتجات البونص</h2>
              <button
                type="button"
                onClick={() => navigate('/storefront/bonus')}
                className="text-[11px] font-bold bg-white text-violet-700 rounded-lg px-2.5 py-1.5 transition-colors active:bg-violet-100 shrink-0"
              >
                🎁 متجر منتجات البونص
              </button>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-[11px] text-white/80">إجمالي البونص</span>
              <span className="text-2xl font-extrabold" dir="ltr">
                <Money value={bonusCredit} />
              </span>
            </div>
            <p className="text-[11px] mt-1.5 leading-relaxed text-white/95">
              لقد حصلت على بونص بقيمة <b className="tabular-nums">{formatSmartMoney(bonusCredit)}</b>
              <br />
              يمكنك الحصول على منتجات بهذه القيمة مجانًا من متجر البونص
            </p>
          </div>

          {bonusItems.length > 0 ? (
            <>
              {/* Desktop table (md+) */}
              <div className="hidden md:block bg-white">
                {tableHead('إجمالي الصنف')}
                <div className="divide-y divide-violet-100">
                  {bonusItems.map((item, i) => desktopRow(item, true, i))}
                </div>
              </div>
              {/* Mobile structured blocks */}
              <div className="md:hidden bg-white divide-y divide-violet-100">
                {bonusItems.map((item) => mobileRow(item, true, 'bonus-'))}
              </div>
              {/* Total bonus products */}
              <div className="px-3 py-2 bg-violet-50/70 border-t border-violet-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-text">إجمالي منتجات البونص</span>
                <span className="text-lg font-extrabold text-violet-700" dir="ltr">
                  <Money value={bonusProductsTotal} />
                </span>
              </div>
            </>
          ) : (
            <div className="px-3 py-3 text-xs text-violet-700">أضف منتجات البونص لاستخدام رصيدك.</div>
          )}

          {/* Secondary bonus balance */}
          <div className="px-3 py-2 border-t border-violet-200 space-y-1 text-xs bg-violet-50/40">
            <div className="flex justify-between">
              <span className="text-text-secondary">رصيد البونص</span>
              <span dir="ltr">
                <Money value={bonusCredit} />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">قيمة منتجات البونص</span>
              <span dir="ltr">
                <Money value={bonusProductsTotal} />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">المستخدم من البونص</span>
              <span dir="ltr">
                <Money value={bonusApplied} />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">المتبقي من البونص</span>
              <span dir="ltr">
                <Money value={bonusUnused} />
              </span>
            </div>
            {bonusOverflow > 0 && (
              <div className="flex justify-between">
                <span className="text-text-secondary">الزيادة المطلوب دفعها</span>
                <span className="font-bold text-warning" dir="ltr">
                  <Money value={bonusOverflow} />
                </span>
              </div>
            )}
          </div>

          {/* Overflow approval */}
          {bonusOverflow > 0 && (
            <div className="px-3 py-2.5 border-t border-violet-200 bg-warning/5 space-y-2">
              <div className="text-xs font-bold text-warning">⚠️ {BONUS_COPY.overflowTitle}</div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {bonusOverflowApproved ? (
                  <>
                    {BONUS_COPY.overflowApprovedNote} <Money value={bonusOverflow} /> جنيه إلى إجمالي الفاتورة
                  </>
                ) : (
                  `${BONUS_COPY.overflowWillAddPrefix} ${formatSmartMoney(bonusOverflow)} ${BONUS_COPY.overflowWillAddSuffix}`
                )}
              </p>
              {bonusOverflowApproved ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-success">{BONUS_COPY.overflowApprovedLabel} — {formatSmartMoney(bonusOverflow)} ج.م</span>
                  <button type="button" onClick={handleBonusCancel} className="text-xs font-semibold text-danger">
                    {BONUS_COPY.overflowDecline}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBonusOverflowApproved(true)}
                    className="py-2.5 rounded-lg bg-success text-white text-xs font-bold hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    {BONUS_COPY.overflowApprove}
                  </button>
                  <button
                    type="button"
                    onClick={handleBonusCancel}
                    className="py-2.5 rounded-lg bg-white border border-border text-text-secondary text-xs font-bold hover:bg-surface transition-colors active:scale-[0.98]"
                  >
                    {BONUS_COPY.overflowDecline}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 7. FINAL ORDER SUMMARY — orange/neutral identity */}
      <div className="rounded-xl border border-amber-300 overflow-hidden">
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200">
          <h2 className="text-xs font-bold text-amber-800">ملخص الطلب</h2>
        </div>
        <div className="p-3 space-y-1.5 text-sm bg-white">
          {bonusMode ? (
            <>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">إجمالي المنتجات الرئيسية</span>
                <span dir="ltr">
                  <Money value={totals.productBaseSubtotal} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">إجمالي البونص</span>
                <span className="font-semibold text-violet-700" dir="ltr">
                  <Money value={bonusCredit} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">قيمة منتجات البونص</span>
                <span dir="ltr">
                  <Money value={bonusProductsTotal} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">المستخدم من البونص</span>
                <span dir="ltr">
                  <Money value={bonusApplied} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">المتبقي من البونص</span>
                <span dir="ltr">
                  <Money value={bonusUnused} />
                </span>
              </div>
              {bonusOverflow > 0 && bonusOverflowApproved && (
                <div className="flex justify-between items-center text-text">
                  <span className="text-text-secondary">الزيادة المطلوب دفعها</span>
                  <span className="font-bold text-warning" dir="ltr">
                    <Money value={bonusOverflow} />
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">إجمالي المنتجات قبل الخصم</span>
                <span dir="ltr">
                  <Money value={totals.productBaseSubtotal} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">إجمالي الخصم</span>
                <span className="font-bold text-success" dir="ltr">
                  −<Money value={totals.totalDiscount} />
                </span>
              </div>
              <div className="flex justify-between items-center text-text">
                <span className="text-text-secondary">الإجمالي بعد الخصم</span>
                <span className="font-semibold" dir="ltr">
                  <Money value={totals.productSubtotal} />
                </span>
              </div>
            </>
          )}
          {totals.dealTotal > 0 && (
            <div className="flex justify-between items-center text-text">
              <span className="text-text-secondary">العروض اليومية والساعة</span>
              <span className="font-semibold" dir="ltr">
                <Money value={totals.dealTotal} />
              </span>
            </div>
          )}

          <hr className="border-border" />
          <div className="flex justify-between items-baseline pt-1">
            <span className="text-sm font-bold text-text">الإجمالي المستحق</span>
            <span className="text-xl font-extrabold text-primary" dir="ltr">
              <Money value={totals.netTotal} />
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {bonusMode && (
          <div className="rounded-lg border border-border bg-surface/60 px-3 py-2 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text font-medium">تحقيق الشريحة</span>
              {selectedTier && totals.meetsTierMinimum && totals.meetsCompanyRules ? (
                <span className="text-success font-bold">
                  <span aria-hidden="true">✓</span> مكتمل
                </span>
              ) : (
                <span className="text-text-secondary font-bold">
                  <span aria-hidden="true">○</span> غير مكتمل
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text font-medium">الشراء بكامل رصيد البونص</span>
              {bonusProductsTotal >= bonusCredit ? (
                <span className="text-success font-bold">
                  <span aria-hidden="true">✓</span> مكتمل
                </span>
              ) : (
                <span className="text-text-secondary font-bold">
                  <span aria-hidden="true">○</span> غير مكتمل
                </span>
              )}
            </div>
          </div>
        )}
        {bonusMode && (
          <button
            type="button"
            onClick={() => navigate('/storefront/bonus')}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-violet-700 border border-violet-300 bg-white rounded-lg py-2 transition-colors active:bg-violet-50"
          >
            <span aria-hidden="true">🎁</span> متجر منتجات البونص
          </button>
        )}
        <button
          type="button"
          onClick={handleContinue}
          aria-disabled={continueBlocked}
          className={`w-full bg-primary text-white text-sm py-3 rounded-lg transition-colors ${continueBlocked ? 'opacity-40 cursor-not-allowed' : 'active:bg-primary-dark'}`}
        >
          متابعة الطلب
        </button>
        <button
          type="button"
          onClick={() => navigate('/storefront')}
          className="w-full bg-white text-primary text-sm py-3 rounded-lg border border-primary active:bg-surface transition-colors"
        >
          إضافة المزيد من المنتجات
        </button>
      </div>
    </div>
  )
}