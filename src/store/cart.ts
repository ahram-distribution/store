import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, CartDealItem, CartTotals, TierConfig, ProductWithPrice, UnitType, DailyDealRecord, FlashOfferRecord } from '../types/storefront'
import { computeProductPrices, getEffectiveUnitPrice, computePieceQuantity, computeCartTotals } from '../engine/pricing'
import toast from 'react-hot-toast'

interface CartCustomer {
  id: string
  name: string
  phone: string
  code?: string
  address?: string
}

interface CartState {
  items: CartItem[]
  dealItems: CartDealItem[]
  flashOfferItems: CartDealItem[]
  selectedTierId: string | null
  tiers: TierConfig[]
  products: ProductWithPrice[]
  selectedCustomer: CartCustomer | null
  editingOrderId: string | null

  setTiers: (tiers: TierConfig[]) => void
  setProducts: (products: ProductWithPrice[]) => void
  selectTier: (tierId: string | null) => void
  addItem: (product: ProductWithPrice, unitType: UnitType, unitQuantity: number) => void
  removeItem: (productId: string, unitType: UnitType) => void
  updateQuantity: (productId: string, unitType: UnitType, unitQuantity: number) => void
  addDeal: (deal: DailyDealRecord) => void
  removeDeal: (dealId: string) => void
  addFlashOffer: (offer: FlashOfferRecord) => void
  removeFlashOffer: (offerId: string) => void
  getDealItems: () => CartDealItem[]
  getFlashOfferItems: () => CartDealItem[]
  clearCart: () => void
  getTotals: () => CartTotals
  getSelectedTier: () => TierConfig | null
  getEffectivePrice: (product: ProductWithPrice, unitType: UnitType) => number
  recalculateAll: () => void
  setSelectedCustomer: (customer: CartCustomer | null) => void
  setEditingOrder: (orderId: string | null) => void
  restoreCart: (items: CartItem[], editingOrderId: string) => void
}

export const useCartStore = create(
  persist(
    (set, get) => ({
      items: [],
      dealItems: [],
      flashOfferItems: [],
      selectedTierId: null,
      tiers: [],
      products: [],
      selectedCustomer: null,
      editingOrderId: null,

      setTiers: (tiers) => set({ tiers }),

      setProducts: (products) => set({ products }),

      selectTier: (tierId) => {
        set({ selectedTierId: tierId })
        get().recalculateAll()
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
        const prices = computeProductPrices(product, tier)
        const hasTier = tier !== null
        const unitPrice = getEffectiveUnitPrice(prices, unitType, hasTier)
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
            totalPrice: Math.round(unitPrice * newQuantity * 100) / 100,
            pieceQuantity: pieceQuantity + existing.pieceQuantity,
          }
          set({ items: newItems })
        } else {
          const newItem: CartItem = {
            productId: product.id,
            productName: product.productName,
            unitType,
            unitQuantity,
            pieceQuantity,
            unitPrice: Math.round(unitPrice * 100) / 100,
            totalPrice: Math.round(unitPrice * unitQuantity * 100) / 100,
            imageUrl: product.imageUrl,
            companyId: product.companyId,
            companyName: product.companyName,
          }
          set({ items: [...state.items, newItem] })
        }
        toast.success('تمت الإضافة إلى السلة')
      },

      removeItem: (productId, unitType) => {
        set({ items: get().items.filter((i) => !(i.productId === productId && i.unitType === unitType)) })
        toast.success('تمت الإزالة من السلة')
      },

      updateQuantity: (productId, unitType, unitQuantity) => {
        if (unitQuantity <= 0) {
          get().removeItem(productId, unitType)
          return
        }
        const state = get()
        const tier = state.getSelectedTier()
        const product = state.products.find((p) => p.id === productId)
        if (!product) return

        const prices = computeProductPrices(product, tier)
        const hasTier = tier !== null
        const unitPrice = getEffectiveUnitPrice(prices, unitType, hasTier)
        const pieceQuantity = computePieceQuantity(unitQuantity, unitType, product.cartonQuantity)

        set({
          items: state.items.map((item) =>
            item.productId === productId && item.unitType === unitType
              ? {
                  ...item,
                  unitQuantity,
                  pieceQuantity,
                  unitPrice: Math.round(unitPrice * 100) / 100,
                  totalPrice: Math.round(unitPrice * unitQuantity * 100) / 100,
                }
              : item
          ),
        })
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
      },

      clearCart: () => set({ items: [], dealItems: [], flashOfferItems: [] }),

      getTotals: () => {
        const state = get()
        const tier = state.getSelectedTier()
        return computeCartTotals(state.items, tier, state.dealItems, state.flashOfferItems)
      },

      getSelectedTier: () => {
        const state = get()
        if (!state.selectedTierId) return null
        return state.tiers.find((t) => t.id === state.selectedTierId) ?? null
      },

      getEffectivePrice: (product, unitType) => {
        const state = get()
        const tier = state.getSelectedTier()
        const prices = computeProductPrices(product, tier)
        const hasTier = tier !== null
        return getEffectiveUnitPrice(prices, unitType, hasTier)
      },

      recalculateAll: () => {
        const state = get()
        const tier = state.getSelectedTier()
        const newItems = state.items.map((item) => {
          const product = state.products.find((p) => p.id === item.productId)
          if (!product) return item
          const prices = computeProductPrices(product, tier)
          const hasTier = tier !== null
          const unitPrice = getEffectiveUnitPrice(prices, item.unitType, hasTier)
          const pieceQuantity = computePieceQuantity(item.unitQuantity, item.unitType, product.cartonQuantity)
          return {
            ...item,
            unitPrice: Math.round(unitPrice * 100) / 100,
            totalPrice: Math.round(unitPrice * item.unitQuantity * 100) / 100,
            pieceQuantity,
          }
        })
        set({ items: newItems })
      },

      setSelectedCustomer: (customer) => set({ selectedCustomer: customer }),

      setEditingOrder: (orderId) => set({ editingOrderId: orderId }),

      restoreCart: (orderItems, editingOrderId) => {
        const state = get()
        const items: CartItem[] = orderItems.map((i: any) => {
          const product = state.products.find(p => p.id === i.product_id)
          return {
            productId: i.product_id,
            productName: i.product_name || '',
            unitType: i.unit_type,
            unitQuantity: i.unit_quantity,
            pieceQuantity: i.piece_quantity,
            unitPrice: i.unit_price,
            totalPrice: i.total_price,
            imageUrl: i.image_url || undefined,
            note: i.note || undefined,
            companyId: product?.companyId,
            companyName: product?.companyName,
          }
        })
        set({ items, editingOrderId })
      },

      getDealItems: () => get().dealItems,
      getFlashOfferItems: () => get().flashOfferItems,
    }),
    { name: 'ahram-cart' }
  )
)
