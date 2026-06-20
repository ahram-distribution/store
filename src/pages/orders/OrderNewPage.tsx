import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { sendWhatsAppFromDisplay } from '../../lib/whatsapp'
import { buildOrderDisplayData, UNIT_LABELS } from '../../types/order-display'
import { ProductCard } from '../../components/storefront/ProductCard'
import { computeProductPrices, computePieceQuantity } from '../../engine/pricing'
import { formatCurrencyShort } from '../../utils/format'
import type { ProductWithPrice, ProductUnitPrice, UnitType } from '../../types/storefront'
import toast from 'react-hot-toast'
import { creditService } from '../../services/credit'

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

export function OrderNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preselectedCustomerId = searchParams.get('customer')
  const preselectedVisitId = searchParams.get('visit')
  const [customerId, setCustomerId] = useState<string | null>(preselectedCustomerId)
  const [customer, setCustomer] = useState<any>(null)
  const [allCustomers, setAllCustomers] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try { const saved = localStorage.getItem('order_cart'); return saved ? JSON.parse(saved) : [] } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('order_cart', JSON.stringify(cartItems)) }, [cartItems])
  useEffect(() => {
    if (customerId && customer) {
      localStorage.setItem('order_cart_meta', JSON.stringify({ customerId, customerName: customer.company_name }))
    }
  }, [customerId, customer])
  const [showReview, setShowReview] = useState(false)
  const [notes, setNotes] = useState(() => {
    try { return localStorage.getItem('order_notes') || '' } catch { return '' }
  })
  useEffect(() => { localStorage.setItem('order_notes', notes) }, [notes])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const token = getToken()

  useEffect(() => {
    if (!token) { setLoading(false); return }
    if (!customerId) {
      supabase.rpc('get_governed_customers', { p_token: token }).then(({ data }) => {
        if (data) setAllCustomers(Array.isArray(data) ? data : [data])
        setLoading(false)
      })
      return
    }
    setLoading(true)
    setCustomer(null)
    Promise.all([
      supabase.rpc('get_governed_customer', { p_token: token, p_id: customerId }),
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_products', { p_token: token }),
    ]).then(([custRes, compRes, prodRes]) => {
      if (custRes.data) setCustomer(Array.isArray(custRes.data) ? custRes.data[0] : custRes.data)
      const allProds = prodRes.data ? prodRes.data.map(mapProduct) : []
      setProducts(allProds)
      if (compRes.data && allProds.length > 0) {
        const companyHasSellable = new Set(allProds.filter(p => !p.salesBlocked).map(p => p.companyId))
        setCompanies(compRes.data.filter((c: any) => c.is_visible !== false && companyHasSellable.has(c.id)))
      } else if (compRes.data) {
        setCompanies(compRes.data)
      }
      setLoading(false)
    })
  }, [customerId, token])

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

  const cartTotals = useMemo(() => {
    const itemCount = cartItems.length
    const subtotal = cartItems.reduce((s, i) => s + i.totalPrice, 0)
    return { itemCount, subtotal }
  }, [cartItems])

  const cartItemKeys = useMemo(() => new Set(cartItems.map(i => `${i.productId}:${i.unitType}`)), [cartItems])

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

  const handleRemoveItem = (productId: string, unitType: UnitType) => {
    setCartItems((prev) => prev.filter((i) => !(i.productId === productId && i.unitType === unitType)))
  }

  const handleUpdateQty = (productId: string, unitType: UnitType, delta: number) => {
    setCartItems((prev) => prev.map((i) => {
      if (i.productId !== productId || i.unitType !== unitType) return i
      const newQty = Math.max(1, i.unitQuantity + delta)
      const newTotal = (i.totalPrice / i.unitQuantity) * newQty
      const newPiece = (i.pieceQuantity / i.unitQuantity) * newQty
      return { ...i, unitQuantity: newQty, totalPrice: newTotal, pieceQuantity: Math.round(newPiece) }
    }))
  }

  const handleSubmit = async () => {
    if (!token || !customerId || cartItems.length === 0) return
    setSubmitting(true)

    let order: any = null
    try {
      const items = cartItems.map((i) => ({
        product_id: i.productId,
        unit_type: i.unitType,
        unit_quantity: i.unitQuantity,
        piece_quantity: i.pieceQuantity,
        unit_price: Math.round(i.unitPrice * 100) / 100,
        total_price: Math.round(i.totalPrice * 100) / 100,
      }))
      const { data: created, error: createError } = await supabase.rpc('governed_create_order', {
        p_token: token,
        p_customer_id: customerId,
        p_notes: notes || null,
        p_items: items,
        p_execution_location_id: null,
        p_execution_latitude: null,
        p_execution_longitude: null,
        p_execution_accuracy_meters: null,
        p_execution_captured_at: null,
      })
      if (createError) { toast.error('فشل إنشاء الطلب: ' + createError.message); setSubmitting(false); return }
      if (!created) { toast.error('فشل إنشاء الطلب'); setSubmitting(false); return }
      order = created
      const { error: submitError } = await supabase.rpc('governed_submit_order', {
        p_token: token, p_id: order.id,
      })
      if (submitError) {
        toast.error('تم إنشاء الطلب ولكن فشل الإرسال: ' + submitError.message)
        setSubmitting(false); return
      }
      toast.success('تم إرسال الطلب بنجاح')

      // ── CREDIT RESERVE — best-effort, only for customers with active credit ──
      const creditResult = await creditService.reserveCreditForOrder(order.id).catch(() => null)
      if (creditResult?.over_limit) {
        toast('الطلب يتجاوز الحد الائتماني وسيتم مراجعته من الإدارة العليا', { icon: '⚠️', duration: 5000 })
      }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء إنشاء الطلب')
      setSubmitting(false); return
    }

    // ── OPEN WHATSAPP — uses snapshot data from RPC ──
    try {
      const orderRes = await supabase.rpc('get_unified_order', { p_token: token, p_id: order.id })
      if (!orderRes.error && orderRes.data && !orderRes.data?.error) {
        const fullOrder = orderRes.data
        const orderItems = (fullOrder?.items && Array.isArray(fullOrder.items))
          ? fullOrder.items.map((i: any) => ({ ...i, products: { product_name: i.product_name, legacy_code: i.legacy_code, image_url: i.image_url, companies: { company_name: i.company_name } } }))
          : []
        sendWhatsAppFromDisplay(buildOrderDisplayData({ order: fullOrder, items: orderItems }))
      }
    } catch (e) { console.error('WHATSAPP_OPEN_FAILED', e) }

    // Link order to active visit (best-effort)
    let linkedVisitId: string | null = preselectedVisitId
    try {
      const visitsRes = await supabase.rpc('get_governed_visits', { p_token: token })
      if (Array.isArray(visitsRes.data)) {
        const active = visitsRes.data.find((v: any) => v.customer_id === customerId && v.status === 'active')
        if (active) {
          linkedVisitId = active.id
          await supabase.rpc('governed_update_visit', {
            p_token: token, p_id: active.id,
            p_notes: `طلب:${order.id}|تم إنشاء طلب رقم ${order.order_number}`,
          })
        }
      }
    } catch (_e) { /* best-effort */ }

    localStorage.removeItem('order_cart'); localStorage.removeItem('order_cart_meta'); localStorage.removeItem('order_notes')
    setCartItems([]); setShowReview(false); setSubmitting(false)
    navigate(linkedVisitId ? '/visits/screen' : `/orders?customer=${customerId}`)
  }



  if (!customerId) {
    const filteredCustomers = customerSearchQuery.trim()
      ? allCustomers.filter((c: any) => (c.company_name || '').includes(customerSearchQuery))
      : allCustomers
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">طلب جديد</h1>
        </div>
        <input
          type="text"
          value={customerSearchQuery}
          onChange={(e) => setCustomerSearchQuery(e.target.value)}
          placeholder="ابحث عن عميل..."
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
        />
        <div className="space-y-2">
          {filteredCustomers.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setCustomerId(c.id)}
              className="w-full bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors"
            >
              <p className="text-sm font-semibold text-text">{c.company_name}</p>
              <p className="text-[10px] text-text-secondary">{c.code}</p>
            </button>
          ))}
          {filteredCustomers.length === 0 && (
            <p className="text-center text-sm text-text-secondary py-8">لا يوجد عملاء</p>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-text-secondary">العميل غير موجود</p>
        <button onClick={() => navigate('/customers')} className="text-xs text-primary mt-2">العودة للقائمة</button>
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
    <div className="space-y-4 pb-4">
      {/* Customer Header */}
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-2xl p-4 -mx-4 px-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] opacity-80">طلب جديد لـ</p>
            <h1 className="text-lg font-bold mt-0.5">{customer.company_name}</h1>
            {customer.code && <p className="text-[11px] opacity-70 font-mono mt-0.5" dir="ltr">{customer.code}</p>}
          </div>
          <button onClick={() => navigate(-1)} className="text-white/80 text-sm">رجوع</button>
        </div>
        {products.length > 0 && <div className="text-[11px] opacity-80 mt-2">{products.filter(p => !p.salesBlocked).length} منتج متاح</div>}
      </div>

      {/* Cart summary inline */}
      {!showReview && cartTotals.itemCount > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className="w-full bg-primary text-white rounded-xl p-3 flex items-center justify-between shadow-sm active:opacity-90 transition-opacity"
        >
          <span className="text-xs font-semibold">
            {cartTotals.itemCount} صنف · {formatCurrencyShort(cartTotals.subtotal)}
          </span>
          <span className="text-xs bg-white/20 px-3 py-1 rounded-full">مراجعة الطلب</span>
        </button>
      )}

      {!showReview ? (
        <>
          {!selectedCompanyId ? (
            <>
              {/* Company search */}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن شركة أو منتج..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
              />

              {/* Company grid */}
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
              {/* Back to companies */}
              <button
                onClick={() => { setSelectedCompanyId(null); setSearchQuery('') }}
                className="flex items-center gap-1 text-xs text-primary font-semibold"
              >
                <span>&rarr;</span> جميع الشركات
              </button>

              {/* Product search */}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
              />

              {/* Products */}
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
          <div className="space-y-2">
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
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات (اختياري)..."
            rows={2}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary resize-none"
          />

          <div className="bg-white rounded-xl border border-border p-3">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">عدد الأصناف</span>
              <span className="font-semibold">{cartTotals.itemCount}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-text-secondary">الإجمالي</span>
              <span className="font-semibold text-primary">{formatCurrencyShort(cartTotals.subtotal)}</span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || cartItems.length === 0}
            className="w-full bg-primary text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:bg-primary-dark transition-colors"
          >
            {submitting ? 'جارِ إرسال الطلب...' : 'إرسال الطلب'}
          </button>

          {submitting && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
              <div className="bg-white rounded-2xl p-6 text-center shadow-xl max-w-[240px]">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-text-secondary font-medium">جارِ إرسال الطلب...</p>
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
