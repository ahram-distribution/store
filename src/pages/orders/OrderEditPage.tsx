import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { sendWhatsAppFromDisplay } from '../../lib/whatsapp'
import { buildOrderDisplayData, UNIT_LABELS, ORDER_STATUS_LABELS } from '../../types/order-display'
import { ProductCard } from '../../components/storefront/ProductCard'
import { computeProductPrices, computePieceQuantity, computeCartTotals } from '../../engine/pricing'
import { formatCurrencyShort } from '../../utils/format'
import { dailyDealService } from '../../services/dailyDeals'
import { flashOfferService } from '../../services/flashOffers'
import type { ProductWithPrice, ProductUnitPrice, UnitType, DailyDealRecord, FlashOfferRecord, CartTotals, TierConfig } from '../../types/storefront'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CartItem {
  productId: string
  productName: string
  imageUrl: string | null
  companyName: string
  unitType: UnitType
  unitQuantity: number
  pieceQuantity: number
  unitPrice: number
  totalPrice: number
}

interface CartDealItem {
  dealId: string
  dealTitle: string
  fixedPrice: number
  totalPrice: number
  quantity: number
  imageUrl?: string
  description?: string
}

function mapProduct(row: any): ProductWithPrice {
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
  const activeUnitTypes = activeUnits.map((u: any) => u.unit_type)
  const hasCarton = activeUnitTypes.includes('carton')
  const rawPrices: ProductUnitPrice[] = []
  if (hasCarton) {
    if (cartonPrice > 0) {
      if (cartonQuantity >= 24) rawPrices.push({ unitType: 'dozen', price: (cartonPrice / cartonQuantity) * 12 })
      rawPrices.push({ unitType: 'carton', price: cartonPrice })
    }
  } else {
    const piecePrice = cartonPrice > 0 && cartonQuantity > 0 ? cartonPrice / cartonQuantity : 0
    if (piecePrice > 0) {
      rawPrices.push({ unitType: 'piece', price: piecePrice })
      rawPrices.push({ unitType: 'dozen', price: piecePrice * 12 })
    }
  }
  const unitPrices = rawPrices.filter(up => activeUnitTypes.includes(up.unitType))
  return {
    id: row.id,
    productName: row.product_name,
    legacyCode: row.legacy_code,
    cartonPrice,
    cartonQuantity,
    isActive: row.is_active ?? true,
    salesBlocked: unitPrices.length === 0,
    outOfStock: false,
    imageUrl: row.image_url || undefined,
    companyId: row.company_id,
    companyName: row.company_name ?? '',
    unitPrices,
  }
}

export function OrderEditPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const token = getToken()

  // Order data
  const [order, setOrder] = useState<any>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerCode, setCustomerCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Products & companies
  const [companies, setCompanies] = useState<any[]>([])
  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Cart
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [dealItems, setDealItems] = useState<CartDealItem[]>([])
  const [flashOfferItems, setFlashOfferItems] = useState<CartDealItem[]>([])

  // Tiers
  const [tiers, setTiers] = useState<TierConfig[]>([])
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)

  // Daily deals & flash offers
  const [dailyDeals, setDailyDeals] = useState<DailyDealRecord[]>([])
  const [flashOffers, setFlashOffers] = useState<FlashOfferRecord[]>([])

  // Notes & Order Type
  const [notes, setNotes] = useState('')
  const [orderType, setOrderType] = useState<string>('cash')
  const [showReview, setShowReview] = useState(false)

  // Fetch all data on mount
  useEffect(() => {
    if (!id || !token) { setLoading(false); return }

    Promise.all([
      supabase.rpc('get_unified_order', { p_token: token, p_id: id }),
      supabase.rpc('get_governed_products', { p_token: token }),
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
      dailyDealService.getActive().catch(() => [] as DailyDealRecord[]),
      flashOfferService.getActive().catch(() => [] as FlashOfferRecord[]),
    ]).then(([orderRes, prodRes, compRes, tiersRes, deals, offers]) => {
      const raw = (orderRes.data as any)
      if (raw?.error) { setLoading(false); return }

      const ord = raw.order || raw
      setOrder(ord)
      setNotes(ord.notes || '')
      setOrderType(ord.order_type || 'cash')
      if (ord.tier_id) setSelectedTierId(ord.tier_id)

      // Customer info
      setCustomerName(ord.snapshot_customer_name || '')
      setCustomerCode(ord.snapshot_customer_code || '')

      // Products
      const allProds = prodRes.data ? prodRes.data.map(mapProduct) : []
      setProducts(allProds)

      // Companies
      if (compRes.data && allProds.length > 0) {
        const companyHasSellable = new Set(allProds.filter(p => !p.salesBlocked).map(p => p.companyId))
        setCompanies(compRes.data.filter((c: any) => c.is_visible !== false && companyHasSellable.has(c.id)))
      } else if (compRes.data) {
        setCompanies(compRes.data)
      }

      // Tiers
      if (tiersRes.data) {
        const mapped: TierConfig[] = tiersRes.data.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          discountPercent: Number(t.discount_percent || 0),
          minimumOrderAmount: Number(t.minimum_order_amount || 0),
          iconUrl: t.icon_url,
          color: t.color,
          sortOrder: t.sort_order || 0,
          isActive: t.is_active ?? true,
          isVisible: t.is_visible ?? true,
          startsAt: t.starts_at,
          endsAt: t.ends_at,
        }))
        setTiers(mapped)
      }

      // Daily deals & flash offers
      setDailyDeals(deals)
      setFlashOffers(offers)

      // Restore cart from order items
      const items: CartItem[] = (raw.items || raw.order_items || []).map((item: any) => ({
        productId: item.product_id,
        productName: item.product_name || '',
        imageUrl: item.image_url || null,
        companyName: item.company_name || '',
        unitType: item.unit_type as UnitType,
        unitQuantity: item.unit_quantity || 1,
        pieceQuantity: item.piece_quantity || 0,
        unitPrice: item.unit_price || 0,
        totalPrice: item.total_price || (item.unit_price || 0) * (item.unit_quantity || 1),
      }))
      setCartItems(items)

      setLoading(false)
    })
  }, [id, token])

  const filteredProducts = useMemo(() => {
    let list = selectedCompanyId ? products.filter((p) => p.companyId === selectedCompanyId) : []
    if (searchQuery.trim()) list = list.filter((p) => p.productName.includes(searchQuery))
    return [...list].sort((a, b) => {
      const aAvail = !a.salesBlocked ? 0 : 1
      const bAvail = !b.salesBlocked ? 0 : 1
      if (aAvail !== bAvail) return aAvail - bAvail
      return a.productName.localeCompare(b.productName, 'ar')
    })
  }, [products, selectedCompanyId, searchQuery])

  const cartTotal = useMemo(() => {
    const itemCount = cartItems.length + dealItems.length + flashOfferItems.length
    const subtotal = cartItems.reduce((s, i) => s + i.totalPrice, 0) +
      dealItems.reduce((s, d) => s + d.totalPrice, 0) +
      flashOfferItems.reduce((s, f) => s + f.totalPrice, 0)
    return { itemCount, subtotal }
  }, [cartItems, dealItems, flashOfferItems])

  const cartItemKeys = useMemo(() => new Set(cartItems.map(i => `${i.productId}:${i.unitType}`)), [cartItems])

  const selectedTier = useMemo(() => {
    if (!selectedTierId) return null
    return tiers.find(t => t.id === selectedTierId) ?? null
  }, [tiers, selectedTierId])

  const totals: CartTotals = useMemo(() => {
    const mappedItems = cartItems.map(i => ({
      productId: i.productId,
      productName: i.productName,
      unitType: i.unitType,
      unitQuantity: i.unitQuantity,
      pieceQuantity: i.pieceQuantity,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
      imageUrl: i.imageUrl || undefined,
    }))
    const mappedDeals = dealItems.map(d => ({
      dealId: d.dealId,
      dealTitle: d.dealTitle,
      fixedPrice: d.fixedPrice,
      totalPrice: d.totalPrice,
      quantity: d.quantity,
      imageUrl: d.imageUrl,
      description: d.description,
    }))
    const mappedOffers = flashOfferItems.map(f => ({
      dealId: f.dealId,
      dealTitle: f.dealTitle,
      fixedPrice: f.fixedPrice,
      totalPrice: f.totalPrice,
      quantity: f.quantity,
      imageUrl: f.imageUrl,
      description: f.description,
    }))
    return computeCartTotals(mappedItems, selectedTier, mappedDeals, mappedOffers)
  }, [cartItems, dealItems, flashOfferItems, selectedTier])

  const handleAddToCart = useCallback((product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.unitType === unitType)
      const pieceQuantity = computePieceQuantity(quantity, unitType, product.cartonQuantity)
      const prices = computeProductPrices(product, null)
      const unitPrice = unitType === 'piece' ? prices.piecePrice : unitType === 'dozen' ? prices.dozenPrice : prices.cartonPrice
      const totalPrice = unitPrice * quantity
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id && i.unitType === unitType
            ? { ...i, unitQuantity: i.unitQuantity + quantity, pieceQuantity: i.pieceQuantity + pieceQuantity, totalPrice: i.totalPrice + totalPrice }
            : i
        )
      }
      return [...prev, {
        productId: product.id,
        productName: product.productName,
        imageUrl: product.imageUrl || null,
        companyName: product.companyName,
        unitType,
        unitQuantity: quantity,
        pieceQuantity,
        unitPrice,
        totalPrice,
      }]
    })
    toast.success('تمت الإضافة إلى السلة')
  }, [])

  const handleRemoveItem = useCallback((productId: string, unitType: UnitType) => {
    setCartItems((prev) => prev.filter((i) => !(i.productId === productId && i.unitType === unitType)))
  }, [])

  const handleUpdateQty = useCallback((productId: string, unitType: UnitType, delta: number) => {
    setCartItems((prev) => prev.map((i) => {
      if (i.productId !== productId || i.unitType !== unitType) return i
      const newQty = Math.max(1, i.unitQuantity + delta)
      const newTotal = (i.totalPrice / i.unitQuantity) * newQty
      const newPiece = (i.pieceQuantity / i.unitQuantity) * newQty
      return { ...i, unitQuantity: newQty, totalPrice: newTotal, pieceQuantity: Math.round(newPiece) }
    }))
  }, [])

  const handleAddDeal = useCallback((deal: DailyDealRecord) => {
    setDealItems((prev) => {
      if (prev.some(d => d.dealId === deal.id)) {
        toast.error('هذا العرض مضاف بالفعل')
        return prev
      }
      toast.success('تمت إضافة العرض')
      return [...prev, {
        dealId: deal.id,
        dealTitle: deal.title,
        fixedPrice: deal.fixedPrice,
        totalPrice: deal.fixedPrice,
        quantity: 1,
        imageUrl: deal.imageUrl || undefined,
        description: deal.description || undefined,
      }]
    })
  }, [])

  const handleRemoveDeal = useCallback((dealId: string) => {
    setDealItems((prev) => prev.filter(d => d.dealId !== dealId))
  }, [])

  const handleAddFlashOffer = useCallback((offer: FlashOfferRecord) => {
    setFlashOfferItems((prev) => {
      if (prev.some(f => f.dealId === offer.id)) {
        toast.error('هذا العرض مضاف بالفعل')
        return prev
      }
      toast.success('تمت إضافة العرض')
      return [...prev, {
        dealId: offer.id,
        dealTitle: offer.title,
        fixedPrice: offer.fixedPrice,
        totalPrice: offer.fixedPrice,
        quantity: 1,
        imageUrl: offer.imageUrl || undefined,
        description: offer.description || undefined,
      }]
    })
  }, [])

  const handleRemoveFlashOffer = useCallback((offerId: string) => {
    setFlashOfferItems((prev) => prev.filter(f => f.dealId !== offerId))
  }, [])

  const handleSubmit = async () => {
    if (!token || !id) return
    if (cartItems.length === 0 && dealItems.length === 0 && flashOfferItems.length === 0) {
      toast.error('السلة فارغة')
      return
    }

    setSubmitting(true)

    try {
      // 1. Replace order contents
      const itemsPayload = cartItems.map((i) => ({
        product_id: i.productId,
        unit_type: i.unitType,
        unit_quantity: i.unitQuantity,
        piece_quantity: i.pieceQuantity,
        unit_price: Math.round(i.unitPrice * 100) / 100,
        total_price: Math.round(i.totalPrice * 100) / 100,
      }))
      const dealsPayload = dealItems.map((d) => ({ deal_id: d.dealId }))
      const offersPayload = flashOfferItems.map((f) => ({ offer_id: f.dealId }))

      const { data: replaceResult, error: replaceError } = await supabase.rpc('governed_replace_order_contents', {
        p_token: token,
        p_id: id,
        p_items: itemsPayload,
        p_tier_id: selectedTierId || null,
        p_notes: notes || null,
        p_daily_deals: dealsPayload,
        p_flash_offers: offersPayload,
        p_order_type: orderType,
      })

      if (replaceError) { toast.error('فشل حفظ التعديلات: ' + replaceError.message); setSubmitting(false); return }
      if (replaceResult && typeof replaceResult === 'object' && 'error' in replaceResult && replaceResult.error) {
        toast.error(String(replaceResult.error)); setSubmitting(false); return
      }

      // 2. Submit order
      const { data: submitData, error: submitError } = await supabase.rpc('governed_submit_order', {
        p_token: token,
        p_id: id,
      })
      if (submitError) { toast.error('فشل إرسال الطلب: ' + submitError.message); setSubmitting(false); return }
      if (submitData && typeof submitData === 'object' && 'error' in submitData && submitData.error) {
        toast.error(String(submitData.error)); setSubmitting(false); return
      }

      toast.success('تم إرسال التعديلات بنجاح')

      // 3. Open WhatsApp (best-effort) — Source of Truth = get_unified_order
      try {
        const orderRes = await supabase.rpc('get_unified_order', { p_token: token, p_id: id })
        if (!orderRes.error && orderRes.data && !orderRes.data?.error) {
          const fullOrder = orderRes.data
          sendWhatsAppFromDisplay(buildOrderDisplayData({ order: fullOrder.order, items: fullOrder.items }))
        }
      } catch (e) { /* best-effort */ }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء حفظ التعديلات')
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    navigate(`/orders/${id}`)
  }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري تحميل المنتجات...</div>
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-text-secondary">الطلب غير موجود</p>
        <button onClick={() => navigate('/orders')} className="text-xs text-primary mt-2">العودة للقائمة</button>
      </div>
    )
  }

  const q = searchQuery.trim().toLowerCase()
  const filteredCompanies = q
    ? companies.filter((c) => {
        if (c.company_name.toLowerCase().includes(q)) return true
        return products.some(
          (p) =>
            p.companyId === c.id &&
            (p.productName.toLowerCase().includes(q) ||
              (p.legacyCode && p.legacyCode.toLowerCase().includes(q)))
        )
      })
    : companies

  return (
    <div className="space-y-4 pb-4 max-w-4xl mx-auto">
      {/* Back & Title */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/orders/${id}`)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تعديل الطلب</h1>
      </div>

      {/* Revision Banner */}
      {order.revision_number > 1 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          <p className="text-xs text-amber-700 font-medium">
            تعديل رقم #{order.revision_number} — تم إعادة الطلب إلى المسودة للتعديل الكامل
          </p>
          <p className="text-[10px] text-amber-600">
            الحالة السابقة: {ORDER_STATUS_LABELS[order.status] || order.status}
            <span className="mx-1 text-text-secondary">|</span> رقم الطلب: {order.order_number}
          </p>
        </div>
      )}

      {/* Customer Header */}
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] opacity-80">تعديل طلب</p>
            <h1 className="text-lg font-bold mt-0.5">{customerName}</h1>
            {customerCode && <p className="text-[11px] opacity-70 font-mono mt-0.5" dir="ltr">{customerCode}</p>}
          </div>
        </div>
        <div className="text-[11px] opacity-80 mt-2">{products.filter(p => !p.salesBlocked).length} منتج متاح</div>
      </div>

      {/* Cart summary inline */}
      {!showReview && cartTotal.itemCount > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className="w-full bg-primary text-white rounded-xl p-3 flex items-center justify-between shadow-sm active:opacity-90 transition-opacity"
        >
          <span className="text-xs font-semibold">
            {cartTotal.itemCount} صنف · {formatCurrencyShort(cartTotal.subtotal)}
          </span>
          <span className="text-xs bg-white/20 px-3 py-1 rounded-full">مراجعة الطلب</span>
        </button>
      )}

      {!showReview ? (
        <>
          {/* Company/Product Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن شركة أو منتج..."
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
          />

          {/* Daily Deals Section */}
          {dailyDeals.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text mb-2">العروض اليومية</h3>
              <div className="space-y-2">
                {dailyDeals.filter(d => d.status === 'active' && d.isPurchasable).map((deal) => {
                  const inCart = dealItems.some(d => d.dealId === deal.id)
                  return (
                    <div key={deal.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-text block truncate">{deal.title}</span>
                        <span className="text-xs text-text-secondary">{formatCurrencyShort(deal.fixedPrice)}</span>
                      </div>
                      <button
                        onClick={() => inCart ? handleRemoveDeal(deal.id) : handleAddDeal(deal)}
                        className={`text-xs px-3 py-1.5 rounded-lg shrink-0 ${inCart ? 'bg-danger/10 text-danger' : 'bg-amber-500 text-white'}`}
                      >
                        {inCart ? 'إزالة' : 'أضف'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Flash Offers Section */}
          {flashOffers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text mb-2">عروض الساعة</h3>
              <div className="space-y-2">
                {flashOffers.filter(o => o.status === 'active' && o.isPurchasable).map((offer) => {
                  const inCart = flashOfferItems.some(f => f.dealId === offer.id)
                  return (
                    <div key={offer.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-text block truncate">{offer.title}</span>
                        <span className="text-xs text-text-secondary">{formatCurrencyShort(offer.fixedPrice)}</span>
                      </div>
                      <button
                        onClick={() => inCart ? handleRemoveFlashOffer(offer.id) : handleAddFlashOffer(offer)}
                        className={`text-xs px-3 py-1.5 rounded-lg shrink-0 ${inCart ? 'bg-danger/10 text-danger' : 'bg-amber-500 text-white'}`}
                      >
                        {inCart ? 'إزالة' : 'أضف'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Companies grid */}
          {!selectedCompanyId ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {filteredCompanies.map((c) => {
                  const count = products.filter(p => p.companyId === c.id && !p.salesBlocked).length
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedCompanyId(c.id); setSearchQuery('') }}
                      className="bg-white rounded-xl border border-border p-3 flex flex-col items-center gap-2 active:bg-surface transition-colors"
                    >
                      {c.logo_url ? (
                        <img src={c.logo_url} alt="" className="w-14 h-14 rounded-xl object-contain" />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-primary/5 flex items-center justify-center">
                          <span className="text-xl font-bold text-primary">{c.company_name.charAt(0)}</span>
                        </div>
                      )}
                      <span className="text-xs font-semibold text-text text-center leading-tight">{c.company_name}</span>
                      <span className="text-[10px] text-text-secondary">{count} منتج</span>
                    </button>
                  )
                })}
              </div>
              {companies.length === 0 && (
                <div className="text-center py-12 text-text-secondary text-sm">لا توجد شركات متاحة</div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => { setSelectedCompanyId(null); setSearchQuery('') }}
                className="flex items-center gap-1 text-xs text-primary font-semibold"
              >
                <span>&rarr;</span> جميع الشركات
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    prices={computeProductPrices(product, null)}
                    hasTier={false}
                    tierName={null}
                    onAddToCart={handleAddToCart}
                    onRemoveFromCart={handleRemoveItem}
                    cartItemKeys={cartItemKeys}
                  />
                ))}
              </div>
              {filteredProducts.length === 0 && (
                <div className="text-center py-12 text-text-secondary text-sm">لا توجد منتجات متطابقة</div>
              )}
            </>
          )}
        </>
      ) : (
        /* Review Section */
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text">مراجعة الطلب</h2>

          {/* Flash Offer Items */}
          {flashOfferItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-800 mb-2">عروض الساعة</h3>
              {flashOfferItems.map((offer) => (
                <div key={offer.dealId} className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-text truncate">{offer.dealTitle}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-danger">{formatCurrencyShort(offer.totalPrice)}</span>
                    <button onClick={() => handleRemoveFlashOffer(offer.dealId)} className="text-xs text-danger">حذف</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deal Items */}
          {dealItems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-800 mb-2">العروض اليومية</h3>
              {dealItems.map((deal) => (
                <div key={deal.dealId} className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-text truncate">{deal.dealTitle}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-danger">{formatCurrencyShort(deal.totalPrice)}</span>
                    <button onClick={() => handleRemoveDeal(deal.dealId)} className="text-xs text-danger">حذف</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cart Items */}
          {cartItems.map((item) => (
            <div key={item.productId + item.unitType} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                {item.imageUrl && (
                  <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-text truncate">{item.productName}</p>
                  <p className="text-[10px] text-text-secondary">{item.companyName}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <button onClick={() => handleUpdateQty(item.productId, item.unitType, -1)}
                    className="w-6 h-6 rounded-full bg-surface text-text-secondary text-xs flex items-center justify-center active:bg-border transition-colors">−</button>
                  <span className="text-xs font-semibold text-text min-w-[20px] text-center">{item.unitQuantity}</span>
                  <button onClick={() => handleUpdateQty(item.productId, item.unitType, 1)}
                    className="w-6 h-6 rounded-full bg-surface text-text-secondary text-xs flex items-center justify-center active:bg-border transition-colors">+</button>
                  <span className="text-[10px] text-text-secondary mr-1">{UNIT_LABELS[item.unitType]}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text">{formatCurrencyShort(item.totalPrice)}</span>
                  <button onClick={() => handleRemoveItem(item.productId, item.unitType)}
                    className="text-[10px] text-danger">حذف</button>
                </div>
              </div>
            </div>
          ))}

          {/* Tier Selector */}
          {tiers.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold text-text mb-2">الشريحة السعرية</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedTierId(null)}
                  className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                    selectedTierId === null
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-secondary border-border'
                  }`}
                >
                  السعر الأساسي
                </button>
                {tiers.map((tier) => {
                  const isSelected = selectedTierId === tier.id
                  return (
                    <button
                      key={tier.id}
                      onClick={() => setSelectedTierId(tier.id)}
                      className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                        isSelected ? 'bg-accent text-white border-accent' : 'bg-white text-text-secondary border-border'
                      }`}
                    >
                      <span>{tier.name}</span>
                      <span className="text-[10px] opacity-75 block">خصم يصل إلى {Math.ceil(tier.discountPercent)}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Minimum notice */}
          {selectedTier && !totals.meetsTierMinimum && cartItems.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">
                الحد الأدنى للشريحة: {formatCurrencyShort(totals.tierMinimum)}. المتبقي: {formatCurrencyShort(totals.remainingForMinimum)}
              </p>
            </div>
          )}

          {/* Order Type */}
          <div className="bg-white rounded-xl border border-border p-3">
            <h3 className="text-sm font-semibold text-text mb-2">نوع الطلب</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setOrderType('cash')}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                  orderType === 'cash'
                    ? 'bg-success text-white border-success'
                    : 'bg-white text-text-secondary border-border'
                }`}
              >
                نقدي
              </button>
              <button
                onClick={() => setOrderType('credit')}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                  orderType === 'credit'
                    ? 'bg-accent text-white border-accent'
                    : 'bg-white text-text-secondary border-border'
                }`}
              >
                آجل
              </button>
            </div>
          </div>

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات (اختياري)..."
            rows={2}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary resize-none"
          />

          {/* Summary */}
          <div className="bg-white rounded-xl border border-border p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">عدد الأصناف</span>
              <span className="font-semibold">{cartItems.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">إجمالي المنتجات</span>
              <span className="font-semibold">{formatCurrencyShort(totals.productSubtotal)}</span>
            </div>
            {totals.dealTotal > 0 && (
              <div className="flex justify-between text-sm text-amber-600">
                <span>العروض</span>
                <span className="font-semibold">{formatCurrencyShort(totals.dealTotal)}</span>
              </div>
            )}
            {totals.tierDiscount > 0 && (
              <div className="flex justify-between text-sm text-success">
                <span>خصم الشريحة ({selectedTier?.name})</span>
                <span>-{formatCurrencyShort(totals.tierDiscount)}</span>
              </div>
            )}
            <hr className="border-border" />
            <div className="flex justify-between text-base font-bold">
              <span className="text-text">الإجمالي النهائي</span>
              <span className="text-primary">{formatCurrencyShort(totals.netTotal)}</span>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || cartItems.length === 0}
            className="w-full bg-accent text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
          >
            {submitting ? 'جارِ حفظ التعديلات وإرسال الطلب...' : 'حفظ التعديلات وإرسال الطلب'}
          </button>

          {submitting && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
              <div className="bg-white rounded-2xl p-6 text-center shadow-xl max-w-[240px]">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-text-secondary font-medium">جارِ حفظ التعديلات...</p>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowReview(false)}
            className="w-full bg-white text-primary text-sm py-3 rounded-lg border border-primary active:bg-surface transition-colors"
          >
            العودة للمنتجات
          </button>
        </div>
      )}
    </div>
  )
}
