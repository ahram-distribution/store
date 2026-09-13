import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, CartDealItem, CartTotals, TierConfig, PaymentMethodOption, ShippingMethodOption, ProductWithPrice, UnitType, DailyDealRecord, FlashOfferRecord, TierExceptionLookup, CompanyAddGuardResult } from '../types/storefront'
import { computeProductPrices, getFinalUnitPrice, getUnitBasePrice, computePieceQuantity, computeCartTotals, round2, evaluateCompanyMaxAdd } from '../engine/pricing'
import { computeBonusModeTotals, computeBonusSummary } from '../engine/bonusPricing'
import { resolveExceptionLookup, discountOptionsService, buildDiscountPricingContext, type DiscountPricingContext } from '../services/discountOptions'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import toast from 'react-hot-toast'
import { currentGeoEpoch, getGeographicAdjustmentsForProducts, invalidateGeographicResolutions } from '../services/geographicPricing'
import { readBonusMode, currentBonusModeEpoch, invalidateBonusModeCache, subscribeToBonusModeChanges } from '../services/bonusConfig'

let geoRulesChannel: RealtimeChannel | null = null
let bonusModeUnsubscribe: (() => void) | null = null
let _geoResolveVersion = 0
let discountOptionsChannel: RealtimeChannel | null = null
let _discountRefreshVersion = 0
let _discountRefreshTimer: ReturnType<typeof setTimeout> | null = null

interface CartCustomer {
  id: string
  name: string
  phone: string
  code?: string
  address?: string
  governorateId?: string
}

interface GeographicContext {
  governorateId: string | null
  adjustmentPercent: number
  ruleName: string | null
}

interface CartState {
  items: CartItem[]
  dealItems: CartDealItem[]
  flashOfferItems: CartDealItem[]
  selectedTierId: string | null
  selectedPaymentMethodId: string | null
  selectedShippingMethodId: string | null
  tiers: TierConfig[]
  paymentMethods: PaymentMethodOption[]
  shippingMethods: ShippingMethodOption[]
  products: ProductWithPrice[]
  selectedCustomer: CartCustomer | null
  editingOrderId: string | null
  orderType: string
  geographicContext: GeographicContext | null
  geoItemAdjustments: Record<string, number>
  geoItemEpoch: number
  geoResolveEpoch: number

  bonusMode: boolean
  bonusEpoch: number
  bonusItems: CartItem[]
  bonusCredit: number
  bonusOverflow: number
  bonusOverflowApproved: boolean

  setTiers: (tiers: TierConfig[]) => void
  setPaymentMethods: (paymentMethods: PaymentMethodOption[]) => void
  setShippingMethods: (shippingMethods: ShippingMethodOption[]) => void
  discountContext: DiscountPricingContext | null
  setDiscountContext: (context: DiscountPricingContext | null) => void
  setProducts: (products: ProductWithPrice[]) => void
  syncProduct: (product: ProductWithPrice) => void
  mergeProducts: (products: ProductWithPrice[]) => void
  selectTier: (tierId: string | null) => void
  selectPaymentMethod: (paymentMethodId: string | null) => void
  selectShippingMethod: (shippingMethodId: string | null) => void
  addItem: (product: ProductWithPrice, unitType: UnitType, unitQuantity: number) => void
  removeItem: (productId: string, unitType: UnitType) => void
  updateQuantity: (productId: string, unitType: UnitType, unitQuantity: number) => void
  addBonusItem: (product: ProductWithPrice, unitType: UnitType, unitQuantity: number) => void
  removeBonusItem: (productId: string, unitType: UnitType) => void
  updateBonusQuantity: (productId: string, unitType: UnitType, unitQuantity: number) => void
  clearBonusItems: () => void
  setBonusOverflowApproved: (approved: boolean) => void
  addDeal: (deal: DailyDealRecord) => void
  removeDeal: (dealId: string) => void
  addFlashOffer: (offer: FlashOfferRecord) => void
  removeFlashOffer: (offerId: string) => void
  getDealItems: () => CartDealItem[]
  getFlashOfferItems: () => CartDealItem[]
  clearCart: () => void
  resetOrderContext: () => void
  getTotals: () => CartTotals
  getSelectedTier: () => TierConfig | null
  getSelectedPaymentMethod: () => PaymentMethodOption | null
  getSelectedShippingMethod: () => ShippingMethodOption | null
  getEffectivePrice: (product: ProductWithPrice, unitType: UnitType) => number
  recalculateAll: () => void
  recomputeBonus: () => void
  setSelectedCustomer: (customer: CartCustomer | null) => void
  setEditingOrder: (orderId: string | null) => void
  setOrderType: (orderType: string) => void
  refreshBonusMode: () => Promise<void>
  subscribeToBonusMode: () => void
  refreshDiscountOptions: () => Promise<void>
  subscribeToDiscountOptions: () => void
  restoreCart: (items: CartItem[], editingOrderId: string, restoreOrderType?: string, restoreTierId?: string | null, restorePaymentMethodId?: string | null, restoreShippingMethodId?: string | null) => void
  resolveGeographicPricing: (governorateId: string | null, companyId?: string, productId?: string) => Promise<void>
  resolveEmployeeGeographicContext: (employeeId: string) => Promise<void>
  setGeographicContext: (ctx: GeographicContext | null) => void
  subscribeToGeoRules: (governorateId: string) => void
  ensureGeoItemAdjustments: (products: Array<{ id: string; companyId: string }>) => Promise<void>
}

export const useCartStore = create(
  persist(
    (set, get) => {
      /**
       * Cart Invariant (enforced after every mutation that can empty the cart):
       * If the effective cart is empty (items + dealItems + flashOfferItems === 0),
       * then selectedCustomer, orderType, and selectedTierId must be cleared.
       * Called from: removeItem, removeDeal, removeFlashOffer, clearCart.
       */
      const enforceCartInvariant = () => {
        const s = get()
        const cartEmpty = s.items.length === 0 && s.dealItems.length === 0 && s.flashOfferItems.length === 0 && s.bonusItems.length === 0
        if (cartEmpty && (s.selectedCustomer || s.orderType || s.selectedTierId || s.selectedPaymentMethodId || s.selectedShippingMethodId)) {
          set({ selectedCustomer: null, orderType: '', selectedTierId: null, selectedPaymentMethodId: null, selectedShippingMethodId: null, editingOrderId: null })
        }
      }

      const getAdjForProduct = (s: ReturnType<typeof get>, productId: string): number => {
        const v = s.geoItemAdjustments[productId]
        if (typeof v === 'number') return v
        return s.geographicContext?.adjustmentPercent ?? 0
      }

      const buildLookup = (
        s: ReturnType<typeof get>,
        product: { id?: string; productId?: string; companyId?: string } | null | undefined
      ): TierExceptionLookup | null | undefined => {
        if (!s.discountContext || !product) return undefined
        const pid = product.productId ?? product.id
        if (pid == null) return undefined
        return resolveExceptionLookup(
          s.discountContext,
          s.getSelectedTier(),
          s.getSelectedPaymentMethod(),
          s.getSelectedShippingMethod(),
          pid,
          product.companyId
        )
      }

      /**
       * Governed company-maximum guard for an ADD / QUANTITY-INCREASE. Never
       * blocks reductions or deletions (those only lower concentration). Evaluates
       * the CANDIDATE (resulting) state against the SELECTED tier's SAVED config:
       *
       *   maxCompanyValue = tier.minimumOrderAmount × maxCompanyPurchasePercent / 100
       *
       * A company's MAIN value must never exceed that fixed limit — the cart
       * subtotal plays no part. Bonus items are excluded. There is no
       * construction exemption: the limit applies at all times.
       */
      const companyCapGuard = (
        candidateItems: CartItem[],
        target?: { productId: string; unitType: UnitType } | null,
        currentItems?: CartItem[] | null
      ): CompanyAddGuardResult => {
        const s = get()
        return evaluateCompanyMaxAdd(candidateItems, s.getSelectedTier(), target, currentItems)
      }

      /** Short governed-toast for a blocked add/quantity-increase (same message
       *  shape for the Storefront add and the Cart "+"). */
      const companyCapToast = (guard: CompanyAddGuardResult): string => {
        const money = (v: number | undefined): string => `${Number((v ?? 0).toFixed(2)).toLocaleString('en-US')} ج.م`
        const detail =
          guard.maxCompanyValue != null && guard.currentCompanyValue != null && guard.room != null
            ? ` الحد الأقصى لهذه الشركة ${money(guard.maxCompanyValue)} — المشتريات الحالية ${money(guard.currentCompanyValue)} — المتاح ${money(guard.room)}`
            : ''
        return `لا يمكن الإضافة: قيمة مشتريات هذه الشركة ستتجاوز الحد الأقصى المسموح به لهذه الشريحة (${guard.maxPercent}%).${detail}`
      }

      /**
       * Reprices ONE bonus line at its geo-adjusted BASE price (D-O8): the only
       * price a Bonus/Gift product can ever carry. Tier/Payment/Shipping are
       * computed only for geo-base resolution — never applied to the stored price.
       */
      const priceBonusAtBase = (
        s: ReturnType<typeof get>,
        item: CartItem,
        tier: TierConfig | null,
        payment: PaymentMethodOption | null,
        shipping: ShippingMethodOption | null
      ): CartItem => {
        const product = s.products.find((p) => p.id === item.productId)
        if (!product) return item
        const geoAdj = getAdjForProduct(s, item.productId)
        const prices = computeProductPrices(product, tier, buildLookup(s, product), geoAdj || undefined, payment, shipping)
        const baseUnitPrice = getUnitBasePrice(prices, item.unitType)
        const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)
        return {
          ...item,
          baseUnitPrice: round2(baseUnitPrice),
          geoAdjustPercent: geoAdj,
          unitPrice: round2(baseUnitPrice),
          totalPrice: round2(baseUnitPrice * item.unitQuantity),
          pieceQuantity,
        }
      }

      return {
      items: [],
      dealItems: [],
      flashOfferItems: [],
      selectedTierId: null,
      selectedPaymentMethodId: null,
      selectedShippingMethodId: null,
      tiers: [],
      paymentMethods: [],
      shippingMethods: [],
      discountContext: null,
      products: [],
      selectedCustomer: null,
      editingOrderId: null,
      orderType: '',
      geographicContext: null,
      geoItemAdjustments: {},
      geoItemEpoch: -1,
      geoResolveEpoch: 0,
      bonusMode: false,
      bonusEpoch: -1,
      bonusItems: [],
      bonusCredit: 0,
      bonusOverflow: 0,
      bonusOverflowApproved: false,

      setTiers: (tiers) => set({ tiers }),

      setPaymentMethods: (paymentMethods) => set({ paymentMethods }),

      setShippingMethods: (shippingMethods) => set({ shippingMethods }),

      setDiscountContext: (discountContext) => {
        set({ discountContext })
        get().recalculateAll()
        get().recomputeBonus()
      },

      setProducts: (products) => set({ products }),

      syncProduct: (product) => {
        const state = get()
        const exists = state.products.some((p) => p.id === product.id)
        const products = exists
          ? state.products.map((p) => (p.id === product.id ? product : p))
          : [...state.products, product]
        set({ products })
        get().recalculateAll()
        get().recomputeBonus()
      },

      /** Same final result as looping syncProduct for every entry (existing ids
       *  replaced in place, new ids appended in order) but with a SINGLE store
       *  notify + a single recalculation. Identical observable state; one merge
       *  instead of N per-product merges. Used by the Bonus Store to load its
       *  catalog through the state pattern the normal Storefront uses. */
      mergeProducts: (products) => {
        const state = get()
        const existing = state.products
        const existingIds = existing.map((p) => p.id)
        const next = [...existing]
        for (const product of products) {
          const idx = existingIds.indexOf(product.id)
          if (idx >= 0) {
            next[idx] = product
          } else {
            existingIds.push(product.id)
            next.push(product)
          }
        }
        set({ products: next })
        get().recalculateAll()
        get().recomputeBonus()
      },

      selectTier: (tierId) => {
        set({ selectedTierId: tierId })
        get().recalculateAll()
        get().recomputeBonus()
      },

      selectPaymentMethod: (paymentMethodId) => {
        set({ selectedPaymentMethodId: paymentMethodId })
        get().recalculateAll()
        get().recomputeBonus()
      },

      selectShippingMethod: (shippingMethodId) => {
        set({ selectedShippingMethodId: shippingMethodId })
        get().recalculateAll()
        get().recomputeBonus()
      },

      addItem: (product, unitType, unitQuantity) => {
        if (!product.isActive || product.isOutOfStock) {
          toast.error('هذا المنتج غير متوفر حالياً')
          return
        }

        const hasUnit = product.unitPrices.some((u) => u.unitType === unitType)
        if (!hasUnit) {
          toast.error('وحدة القياس المحددة غير متوفرة لهذا المنتج')
          return
        }

        const state = get()
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const geoAdj = getAdjForProduct(state, product.id)
        const prices = computeProductPrices(product, tier, buildLookup(state, product), geoAdj || undefined, payment, shipping)
        const baseUnitPrice = getUnitBasePrice(prices, unitType)
        const finalUnitPrice = getFinalUnitPrice(prices, unitType)
        const useBase = state.bonusMode
        const unitPrice = useBase ? baseUnitPrice : finalUnitPrice
        const pieceQuantity = computePieceQuantity(unitQuantity, unitType, product.cartonQuantity)

        const existingIndex = state.items.findIndex(
          (i) => i.productId === product.id && i.unitType === unitType
        )

        if (existingIndex >= 0) {
          const existing = state.items[existingIndex]
          const newQuantity = existing.unitQuantity + unitQuantity
          const newItems = [...state.items]
          newItems[existingIndex] = {
            ...existing,
            unitQuantity: newQuantity,
            baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
            geoAdjustPercent: geoAdj,
            unitPrice: Math.round(unitPrice * 100) / 100,
            totalPrice: Math.round(unitPrice * newQuantity * 100) / 100,
            pieceQuantity: pieceQuantity + existing.pieceQuantity,
          }
          const guard = companyCapGuard(newItems, { productId: product.id, unitType }, state.items)
          if (guard.blocked) {
            toast.error(companyCapToast(guard))
            return
          }
          set({ items: newItems })
        } else {
          const newItem: CartItem = {
            productId: product.id,
            productName: product.productName,
            unitType,
            unitQuantity,
            pieceQuantity,
            baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
            unitPrice: Math.round(unitPrice * 100) / 100,
            totalPrice: Math.round(unitPrice * unitQuantity * 100) / 100,
            imageUrl: product.imageUrl,
            companyId: product.companyId,
            companyName: product.companyName,
            geoAdjustPercent: geoAdj,
          }
          const guard = companyCapGuard([...state.items, newItem], { productId: product.id, unitType }, state.items)
          if (guard.blocked) {
            toast.error(companyCapToast(guard))
            return
          }
          set({ items: [...state.items, newItem] })
        }
        get().recomputeBonus()
        toast.success('تمت الإضافة إلى السلة')
      },

      removeItem: (productId, unitType) => {
        set({ items: get().items.filter((i) => !(i.productId === productId && i.unitType === unitType)) })
        enforceCartInvariant()
        get().recomputeBonus()
        toast.success('تمت الإزالة من السلة')
      },

      updateQuantity: (productId, unitType, unitQuantity) => {
        if (unitQuantity <= 0) {
          get().removeItem(productId, unitType)
          return
        }
        const state = get()
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const product = state.products.find((p) => p.id === productId)
        if (!product) return

        const geoAdj = getAdjForProduct(state, product.id)
        const prices = computeProductPrices(product, tier, buildLookup(state, product), geoAdj || undefined, payment, shipping)
        const baseUnitPrice = getUnitBasePrice(prices, unitType)
        const finalUnitPrice = getFinalUnitPrice(prices, unitType)
        const useBase = state.bonusMode
        const unitPrice = useBase ? baseUnitPrice : finalUnitPrice
        const pieceQuantity = computePieceQuantity(unitQuantity, unitType, product.cartonQuantity)

        const existingLine = state.items.find((i) => i.productId === productId && i.unitType === unitType)
        const isIncrease = !!existingLine && unitQuantity > existingLine.unitQuantity
        if (isIncrease) {
          const candidate = state.items.map((item) =>
            item.productId === productId && item.unitType === unitType
              ? { ...item, unitQuantity, pieceQuantity }
              : item
          )
          const guard = companyCapGuard(candidate, { productId, unitType }, state.items)
          if (guard.blocked) {
            toast.error(companyCapToast(guard))
            return
          }
        }

        set({
          items: state.items.map((item) =>
            item.productId === productId && item.unitType === unitType
              ? {
                  ...item,
                  unitQuantity,
                  pieceQuantity,
                  baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
                  geoAdjustPercent: geoAdj,
                  unitPrice: Math.round(unitPrice * 100) / 100,
                  totalPrice: Math.round(unitPrice * unitQuantity * 100) / 100,
                }
              : item
          ),
        })
        get().recomputeBonus()
      },

      addBonusItem: (product, unitType, unitQuantity) => {
        const state = get()
        if (!state.bonusMode) return
        if (!product.isActive || product.isOutOfStock) {
          toast.error('هذا المنتج غير متوفر حالياً')
          return
        }

        const hasUnit = product.unitPrices.some((u) => u.unitType === unitType)
        if (!hasUnit) {
          toast.error('وحدة القياس المحددة غير متوفرة لهذا المنتج')
          return
        }

        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const prices = computeProductPrices(product, tier, buildLookup(state, product), getAdjForProduct(state, product.id) || undefined, payment, shipping)
        const baseUnitPrice = getUnitBasePrice(prices, unitType)
        const geoAdj = getAdjForProduct(state, product.id)
        const pieceQuantity = computePieceQuantity(unitQuantity, unitType, product.cartonQuantity)

        const existingIndex = state.bonusItems.findIndex(
          (i) => i.productId === product.id && i.unitType === unitType
        )

        if (existingIndex >= 0) {
          const existing = state.bonusItems[existingIndex]
          const newQuantity = existing.unitQuantity + unitQuantity
          const newBonus = [...state.bonusItems]
          newBonus[existingIndex] = {
            ...existing,
            unitQuantity: newQuantity,
            baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
            geoAdjustPercent: geoAdj,
            unitPrice: Math.round(baseUnitPrice * 100) / 100,
            totalPrice: Math.round(baseUnitPrice * newQuantity * 100) / 100,
            pieceQuantity: pieceQuantity + existing.pieceQuantity,
          }
          set({ bonusItems: newBonus, bonusOverflowApproved: false })
        } else {
          const newItem: CartItem = {
            productId: product.id,
            productName: product.productName,
            unitType,
            unitQuantity,
            pieceQuantity,
            baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
            unitPrice: Math.round(baseUnitPrice * 100) / 100,
            totalPrice: Math.round(baseUnitPrice * unitQuantity * 100) / 100,
            imageUrl: product.imageUrl,
            companyId: product.companyId,
            companyName: product.companyName,
            geoAdjustPercent: geoAdj,
            isBonus: true,
          }
          set({ bonusItems: [...state.bonusItems, newItem] })
        }
        get().recomputeBonus()
        toast.success('تمت إضافة منتج البونص إلى السلة')
      },

      removeBonusItem: (productId, unitType) => {
        const hadItem = get().bonusItems.some((i) => i.productId === productId && i.unitType === unitType)
        set({
          bonusItems: get().bonusItems.filter((i) => !(i.productId === productId && i.unitType === unitType)),
          ...(hadItem && get().bonusOverflowApproved ? { bonusOverflowApproved: false } : {}),
        })
        get().recomputeBonus()
      },

      updateBonusQuantity: (productId, unitType, unitQuantity) => {
        if (unitQuantity <= 0) {
          get().removeBonusItem(productId, unitType)
          return
        }
        const state = get()
        const item = state.bonusItems.find((i) => i.productId === productId && i.unitType === unitType)
        if (!item) return
        const product = state.products.find((p) => p.id === productId)
        if (!product) return

        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const prices = computeProductPrices(product, tier, buildLookup(state, product), getAdjForProduct(state, product.id) || undefined, payment, shipping)
        const baseUnitPrice = getUnitBasePrice(prices, unitType)
        const geoAdj = getAdjForProduct(state, product.id)
        const pieceQuantity = computePieceQuantity(unitQuantity, unitType, product.cartonQuantity)

        set({
          bonusItems: state.bonusItems.map((i) =>
            i.productId === productId && i.unitType === unitType
              ? {
                  ...i,
                  unitQuantity,
                  pieceQuantity,
                  baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
                  geoAdjustPercent: geoAdj,
                  unitPrice: Math.round(baseUnitPrice * 100) / 100,
                  totalPrice: Math.round(baseUnitPrice * unitQuantity * 100) / 100,
                }
              : i
          ),
          bonusOverflowApproved: false,
        })
        get().recomputeBonus()
      },

      clearBonusItems: () => {
        set({ bonusItems: [], bonusCredit: 0, bonusOverflow: 0, bonusOverflowApproved: false })
      },

      setBonusOverflowApproved: (approved) => {
        const state = get()
        if (!state.bonusMode) {
          if (state.bonusOverflowApproved) set({ bonusOverflowApproved: false })
          return
        }
        if (approved && (state.bonusOverflow ?? 0) <= 0) return
        if (state.bonusOverflowApproved === approved) return
        set({ bonusOverflowApproved: approved })
      },

      addDeal: (deal) => {
        const state = get()
        const existingIndex = state.dealItems.findIndex((d) => d.dealId === deal.id)
        if (existingIndex >= 0) {
          toast.error('هذا العرض مضاف بالفعل إلى السلة')
          return
        }
        const newDealItem: CartDealItem = {
          dealId: deal.id,
          dealTitle: deal.title,
          fixedPrice: deal.fixedPrice,
          totalPrice: deal.fixedPrice,
          quantity: 1,
          imageUrl: deal.imageUrl || undefined,
          description: deal.description || undefined,
        }
        set({ dealItems: [...state.dealItems, newDealItem] })
        toast.success('تمت إضافة العرض إلى السلة')
      },

      removeDeal: (dealId) => {
        set({ dealItems: get().dealItems.filter((d) => d.dealId !== dealId) })
        enforceCartInvariant()
      },

      addFlashOffer: (offer) => {
        const state = get()
        const existingIndex = state.flashOfferItems.findIndex((d) => d.dealId === offer.id)
        if (existingIndex >= 0) {
          toast.error('هذا العرض مضاف بالفعل إلى السلة')
          return
        }
        const newItem: CartDealItem = {
          dealId: offer.id,
          dealTitle: offer.title,
          fixedPrice: offer.fixedPrice,
          totalPrice: offer.fixedPrice,
          quantity: 1,
          imageUrl: offer.imageUrl || undefined,
          description: offer.description || undefined,
        }
        set({ flashOfferItems: [...state.flashOfferItems, newItem] })
        toast.success('تمت إضافة العرض إلى السلة')
      },

      removeFlashOffer: (offerId) => {
        set({ flashOfferItems: get().flashOfferItems.filter((d) => d.dealId !== offerId) })
        enforceCartInvariant()
      },

      /**
       * clearCart()
       * Purpose: Removes products from the current order.
       * Keeps the current order context (customer, order type, editing state, tier).
       * Used for recovery and continuing the same order after accidental refresh.
       */
      clearCart: () => {
        set({ items: [], dealItems: [], flashOfferItems: [], bonusItems: [] })
        enforceCartInvariant()
        get().recomputeBonus()
      },

      /**
       * resetOrderContext()
       * Purpose: Ends the current order session. Starts a brand new order.
       * Clears customer, order type, editing state, tier, and all cart items.
       * This is the ONLY official API that ends an order session.
       * Call after order submission or when explicitly starting a new order.
       */
      resetOrderContext: () => {
        if (geoRulesChannel) {
          supabase.removeChannel(geoRulesChannel)
          geoRulesChannel = null
        }
        invalidateGeographicResolutions()
        set({
          items: [],
          dealItems: [],
          flashOfferItems: [],
          bonusItems: [],
          bonusCredit: 0,
          bonusOverflow: 0,
          bonusOverflowApproved: false,
          selectedCustomer: null,
          orderType: '',
          selectedTierId: null,
          selectedPaymentMethodId: null,
          selectedShippingMethodId: null,
          editingOrderId: null,
          geographicContext: null,
          geoItemAdjustments: {},
          geoItemEpoch: -1,
          geoResolveEpoch: currentGeoEpoch(),
        })
      },

      getTotals: () => {
        const state = get()
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const exceptionsByProduct: Record<string, TierExceptionLookup | null> = {}
        if (state.discountContext) {
          for (const item of state.items) {
            const lookup = buildLookup(state, item)
            if (lookup !== undefined) exceptionsByProduct[item.productId] = lookup
          }
        }
        if (state.bonusMode) {
          return computeBonusModeTotals(
            [...state.items, ...state.bonusItems],
            tier,
            state.dealItems,
            state.flashOfferItems,
            undefined,
            payment,
            shipping,
            exceptionsByProduct
          )
        }
        return computeCartTotals(state.items, tier, state.dealItems, state.flashOfferItems, undefined, payment, shipping, exceptionsByProduct)
      },

      getSelectedTier: () => {
        const state = get()
        if (!state.selectedTierId) return null
        return state.tiers.find((t) => t.id === state.selectedTierId) ?? null
      },

      getSelectedPaymentMethod: () => {
        const state = get()
        if (!state.selectedPaymentMethodId) return null
        return state.paymentMethods.find((p) => p.id === state.selectedPaymentMethodId) ?? null
      },

      getSelectedShippingMethod: () => {
        const state = get()
        if (!state.selectedShippingMethodId) return null
        return state.shippingMethods.find((s) => s.id === state.selectedShippingMethodId) ?? null
      },

      getEffectivePrice: (product, unitType) => {
        const state = get()
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const geoAdj = getAdjForProduct(state, product.id)
        const prices = computeProductPrices(product, tier, buildLookup(state, product), geoAdj || undefined, payment, shipping)
        return state.bonusMode ? getUnitBasePrice(prices, unitType) : getFinalUnitPrice(prices, unitType)
      },

      recalculateAll: () => {
        const state = get()
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const useBase = state.bonusMode
        const newItems = state.items.map((item) => {
          const product = state.products.find((p) => p.id === item.productId)
          if (!product) return item
          const geoAdj = getAdjForProduct(state, item.productId)
          const prices = computeProductPrices(product, tier, buildLookup(state, product), geoAdj || undefined, payment, shipping)
          const baseUnitPrice = getUnitBasePrice(prices, item.unitType)
          const finalUnitPrice = getFinalUnitPrice(prices, item.unitType)
          const unitPrice = useBase ? baseUnitPrice : finalUnitPrice
          const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)
          return {
            ...item,
            baseUnitPrice: Math.round(baseUnitPrice * 100) / 100,
            geoAdjustPercent: geoAdj,
            unitPrice: Math.round(unitPrice * 100) / 100,
            totalPrice: Math.round(unitPrice * item.unitQuantity * 100) / 100,
            pieceQuantity,
          }
        })
        const newBonusItems = state.bonusItems.map((item) => priceBonusAtBase(state, item, tier, payment, shipping))
        set({ items: newItems, bonusItems: newBonusItems })
        get().recomputeBonus()
      },

      recomputeBonus: () => {
        const state = get()
        if (!state.bonusMode) {
          if (state.bonusCredit !== 0 || state.bonusOverflow !== 0) {
            set({ bonusCredit: 0, bonusOverflow: 0 })
          }
          return
        }
        const tier = state.getSelectedTier()
        const payment = state.getSelectedPaymentMethod()
        const shipping = state.getSelectedShippingMethod()
        const exceptionsByProduct: Record<string, TierExceptionLookup | null> = {}
        if (state.discountContext) {
          for (const item of state.items) {
            const lookup = buildLookup(state, item)
            if (lookup !== undefined) exceptionsByProduct[item.productId] = lookup
          }
        }
        const summary = computeBonusSummary(
          state.items,
          state.bonusItems,
          tier,
          payment,
          shipping,
          undefined,
          exceptionsByProduct
        )
        if (summary.bonusOverflow <= 0 && state.bonusOverflowApproved) {
          set({ bonusCredit: summary.totalBonusCredit, bonusOverflow: summary.bonusOverflow, bonusOverflowApproved: false })
        } else {
          set({ bonusCredit: summary.totalBonusCredit, bonusOverflow: summary.bonusOverflow })
        }
      },

      refreshBonusMode: async () => {
        const enabled = await readBonusMode()
        const state = get()
        const epochNow = currentBonusModeEpoch()
        const old = state.bonusMode
        if (old === enabled && state.bonusEpoch === epochNow) return
        set({ bonusMode: enabled, bonusEpoch: epochNow })
        if (old !== enabled) {
          if (!enabled) {
            set({ bonusItems: [], bonusCredit: 0, bonusOverflow: 0, bonusOverflowApproved: false })
          }
          get().recalculateAll()
          get().recomputeBonus()
        }
      },

      subscribeToBonusMode: () => {
        if (bonusModeUnsubscribe) return
        bonusModeUnsubscribe = subscribeToBonusModeChanges(() => {
          invalidateBonusModeCache()
          get().refreshBonusMode()
        })
      },

      refreshDiscountOptions: async () => {
        const myVersion = ++_discountRefreshVersion
        try {
          const bundle = await discountOptionsService.getAll()
          if (_discountRefreshVersion !== myVersion) return
          const now = new Date()
          const mappedTiers = bundle.tiers
            .filter((t) =>
              t.isActive &&
              t.isVisible &&
              (!t.startsAt || new Date(t.startsAt) <= now) &&
              (!t.endsAt || new Date(t.endsAt) >= now)
            )
            .sort((a, b) => (b.minimumOrderAmount ?? 0) - (a.minimumOrderAmount ?? 0))
          const mappedPayments = bundle.paymentMethods
            .filter((m) => m.isActive && m.isVisible)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          const mappedShipping = bundle.shippingMethods
            .filter((m) => m.isActive && m.isVisible)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          const context = buildDiscountPricingContext(bundle)
          const s = get()
          const unchanged =
            s.discountContext !== null &&
            JSON.stringify(context) === JSON.stringify(s.discountContext) &&
            JSON.stringify(mappedTiers) === JSON.stringify(s.tiers) &&
            JSON.stringify(mappedPayments) === JSON.stringify(s.paymentMethods) &&
            JSON.stringify(mappedShipping) === JSON.stringify(s.shippingMethods)
          if (unchanged) return
          set({ tiers: mappedTiers, paymentMethods: mappedPayments, shippingMethods: mappedShipping, discountContext: context })
          get().recalculateAll()
          get().recomputeBonus()
        } catch {
          // keep the current context; selectors degrade gracefully
        }
      },

      subscribeToDiscountOptions: () => {
        if (discountOptionsChannel) return
        const scheduleRefresh = () => {
          if (_discountRefreshTimer) clearTimeout(_discountRefreshTimer)
          _discountRefreshTimer = setTimeout(() => {
            _discountRefreshTimer = null
            get().refreshDiscountOptions()
          }, 200)
        }
        discountOptionsChannel = supabase
          .channel('discount-options-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tiers' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tier_product_exceptions' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tier_company_exceptions' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_method_options' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'product_payment_method_exceptions' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'company_payment_method_exceptions' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shipping_method_options' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'product_shipping_method_exceptions' }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'company_shipping_method_exceptions' }, scheduleRefresh)
          .subscribe()
      },

      setSelectedCustomer: (customer) => {
        set({ selectedCustomer: customer })
        get().recomputeBonus()
      },

      setEditingOrder: (orderId) => set({ editingOrderId: orderId }),

      setOrderType: (orderType) => set({ orderType }),

      setGeographicContext: (ctx) => {
        const prevGov = get().geographicContext?.governorateId
        if (ctx?.governorateId !== prevGov) {
          invalidateGeographicResolutions()
          const epochNow = currentGeoEpoch()
          set({
            geoResolveEpoch: epochNow,
            geoItemAdjustments: {},
            geoItemEpoch: -1,
          })
        }
        set({ geographicContext: ctx })
        get().recalculateAll()
      },

      resolveGeographicPricing: async (governorateId, companyId, productId) => {
        const myVersion = ++_geoResolveVersion

        if (!governorateId) {
          if (_geoResolveVersion !== myVersion) return
          invalidateGeographicResolutions()
          set({
            geographicContext: null,
            geoItemAdjustments: {},
            geoItemEpoch: -1,
            geoResolveEpoch: currentGeoEpoch(),
          })
          get().recalculateAll()
          return
        }

        let rpcData: any = null
        let rpcError: any = null
        try {
          const result = await supabase.rpc('get_effective_geographic_adjustment', {
            p_governorate_id: governorateId,
            p_company_id: companyId || null,
            p_product_id: productId || null,
          })
          rpcData = result.data
          rpcError = result.error
        } catch (e) {
          rpcError = e
        }

        if (_geoResolveVersion !== myVersion) return

        if (rpcError) {
          get().recalculateAll()
          return
        }

        if (rpcData && (Array.isArray(rpcData) ? rpcData.length > 0 : true)) {
          const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
          set({
            geographicContext: {
              governorateId,
              adjustmentPercent: Number(row.adjustment_percent) ?? 0,
              ruleName: row.rule_name || null,
            },
          })
        } else {
          set({ geographicContext: { governorateId, adjustmentPercent: 0, ruleName: null } })
        }

        if (_geoResolveVersion !== myVersion) return

        invalidateGeographicResolutions()
        set({
          geoResolveEpoch: currentGeoEpoch(),
          geoItemAdjustments: {},
          geoItemEpoch: -1,
        })

        get().recalculateAll()
        get().subscribeToGeoRules(governorateId)
      },

      subscribeToGeoRules: (governorateId: string) => {
        if (geoRulesChannel) {
          supabase.removeChannel(geoRulesChannel)
          geoRulesChannel = null
        }
        if (!governorateId) return
        geoRulesChannel = supabase
          .channel('geo-price-rules-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'geographic_price_rules' }, () => {
            const currentGovId = get().geographicContext?.governorateId
            if (currentGovId) {
              invalidateGeographicResolutions()
              const epochNow = currentGeoEpoch()
              set({
                geoResolveEpoch: epochNow,
                geoItemAdjustments: {},
                geoItemEpoch: -1,
              })
              get().resolveGeographicPricing(currentGovId)
              const snapshot = get().products
              if (snapshot.length > 0) get().ensureGeoItemAdjustments(snapshot)
            }
          })
          .subscribe()
      },

      ensureGeoItemAdjustments: async (targets) => {
        const state = get()
        const gov = state.geographicContext?.governorateId
        if (!gov || !targets || targets.length === 0) return
        const epochNow = currentGeoEpoch()
        const populateAll = epochNow !== state.geoItemEpoch || Object.keys(state.geoItemAdjustments).length === 0
        const toFetch = populateAll
          ? targets
          : targets.filter((t) => !(t.id in state.geoItemAdjustments))
        if (toFetch.length === 0) return

        try {
          const map = await getGeographicAdjustmentsForProducts(gov, toFetch)
          if (currentGeoEpoch() !== epochNow) return

          const latest = get()
          const merged = latest.geoItemEpoch === epochNow
            ? { ...latest.geoItemAdjustments, ...map }
            : map
          // Products the batch omitted have NO effective geographic adjustment
          // (0%). Record an explicit 0 so every requested product is marked as
          // resolved — this is what lets the bonus submit path keep its
          // governorate claim instead of dropping it. Dropping the claim while
          // prices were already geo-adjusted would re-trigger the server's
          // BONUS_PRICE_MISMATCH (client prices adhered to the rules, server
          // would re-check against un-adjusted list prices).
          for (const t of targets) {
            if (merged[t.id] === undefined) merged[t.id] = 0
          }
          set({ geoItemAdjustments: merged, geoItemEpoch: epochNow })
          get().recalculateAll()
        } catch {
          /* شبكة/خدمة - نترك التخفيض الأساسي الحالي */
        }
      },

      resolveEmployeeGeographicContext: async (employeeId) => {
        const myVersion = _geoResolveVersion
        try {
          const token = localStorage.getItem('session_token')
          if (!token) return
          const { data, error: rpcError } = await supabase.rpc('get_employee_geographic_assignments', {
            p_token: token, p_employee_id: employeeId,
          })
          if (_geoResolveVersion !== myVersion) return

          if (rpcError) {
            return
          }

          if (!Array.isArray(data) || data.length === 0) {
            set({ geographicContext: null })
            get().recalculateAll()
            return
          }

          const governorateAssign = data.find((a: any) => a.assignment_type === 'governorate' && a.governorate_id)
          if (governorateAssign) {
            await get().resolveGeographicPricing(governorateAssign.governorate_id)
            return
          }

          const sectorAssign = data.find((a: any) => a.assignment_type === 'sector' && a.sector_id)
          if (sectorAssign) {
            const { data: govRows, error: govError } = await supabase.from('sector_governorates').select('governorate_id').eq('sector_id', sectorAssign.sector_id).limit(1)
            if (_geoResolveVersion !== myVersion) return
            if (govError) {
              return
            }
            if (govRows && govRows.length > 0) {
              await get().resolveGeographicPricing(govRows[0].governorate_id)
              return
            }
          }

          set({ geographicContext: null })
          get().recalculateAll()
        } catch {
          if (_geoResolveVersion !== myVersion) return
        }
      },

      restoreCart: (orderItems, editingOrderId, restoreOrderType, restoreTierId, restorePaymentMethodId, restoreShippingMethodId) => {
        const state = get()
        const mapped: CartItem[] = orderItems.map((i: any) => {
          const product = state.products.find(p => p.id === i.product_id)
          return {
            productId: i.product_id,
            productName: i.product_name || '',
            unitType: i.unit_type,
            unitQuantity: i.unit_quantity,
            pieceQuantity: i.piece_quantity,
            baseUnitPrice: i.base_unit_price ?? undefined,
            unitPrice: i.unit_price,
            totalPrice: i.total_price,
            imageUrl: i.image_url || undefined,
            note: i.note || undefined,
            companyId: product?.companyId ?? i.company_id,
            companyName: product?.companyName ?? i.company_name,
            isBonus: i.is_bonus === true,
          }
        })
        const items = mapped.filter((i) => !i.isBonus)
        const bonusItems = state.bonusMode ? mapped.filter((i) => i.isBonus) : []
        set({
          items,
          bonusItems,
          editingOrderId,
          orderType: restoreOrderType || '',
          selectedTierId: restoreTierId !== undefined ? restoreTierId : state.selectedTierId,
          selectedPaymentMethodId: restorePaymentMethodId !== undefined ? restorePaymentMethodId : state.selectedPaymentMethodId,
          selectedShippingMethodId: restoreShippingMethodId !== undefined ? restoreShippingMethodId : state.selectedShippingMethodId,
        })
        get().recomputeBonus()
      },

      getDealItems: () => get().dealItems,
      getFlashOfferItems: () => get().flashOfferItems,
      }
    },
    {
      name: 'ahram-cart',
      partialize: (state) => {
        const { discountContext, ...rest } = state as any
        return rest
      },
    } as any
  )
)
