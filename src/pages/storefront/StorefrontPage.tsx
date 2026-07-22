import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCartStore } from '../../store/cart'
import { ProductCard } from '../../components/storefront/ProductCard'
import { StorefrontBanner, StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { computeProductPrices } from '../../engine/pricing'
import { formatCurrencyShort } from '../../utils/format'
import { buildSearchIndex, searchProducts, type ProductSearchIndex } from '../../utils/smartSearch'
import type { ProductWithPrice, ProductUnitPrice, TierConfig, UnitType } from '../../types/storefront'

const UNIT_PRIORITY: UnitType[] = ['carton', 'dozen', 'piece']

export function StorefrontPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const companyId = searchParams.get('companyId')
  const editOrderId = searchParams.get('editOrder')
  const customerParam = searchParams.get('customer')
  const highlightId = searchParams.get('highlight')
  const { token: authToken, user } = useAuthStore()

  const {
    items,
    products,
    tiers,
    setProducts,
    setTiers,
    selectedTierId,
    selectTier,
    addItem,
    removeItem,
    getSelectedTier,
    getTotals,
    selectedCustomer,
    editingOrderId,
    setSelectedCustomer,
    setEditingOrder,
    setOrderType,
    restoreCart,
  } = useCartStore()

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [customers, setCustomers] = useState<any[]>([])
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showInitModal, setShowInitModal] = useState(false)
  const [initStep, setInitStep] = useState<'type' | 'customer'>('type')
  const pendingAddRef = useRef<{ product: ProductWithPrice; unitType: UnitType; quantity: number; scrollY: number } | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedUnit, setExpandedUnit] = useState<UnitType>('piece')
  const [expandedQty, setExpandedQty] = useState(0)

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true)
    if (!authToken) {
      setProducts([])
      setLoadingProducts(false)
      return
    }
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: authToken, p_company_id: companyId || null, p_active_only: true, p_visible_only: true,
    })
    if (!error && data) {
      const arr = Array.isArray(data) ? data : []
      const mapped: ProductWithPrice[] = arr.map((row: any) => {
        const cartonPrice = Number(row.carton_price) || 0
        const cartonQuantity = Number(row.carton_quantity) || 0
        const piecePrice = Number(row.piece_price) || 0
        const dozenPrice = Number(row.dozen_price) || 0
        const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
        const availableUnitTypes: UnitType[] = activeUnits.map((u: any) => u.unit_type)
        const allUnitPrices: ProductUnitPrice[] = [
          { unitType: 'piece', price: piecePrice },
          { unitType: 'dozen', price: dozenPrice },
          { unitType: 'carton', price: cartonPrice },
        ]
        const unitPrices = allUnitPrices.filter((up) => availableUnitTypes.includes(up.unitType))
        return {
          id: row.id,
          productName: row.product_name,
          legacyCode: row.legacy_code || '',
          cartonPrice,
          cartonQuantity,
          piecePrice,
          dozenPrice,
          isActive: row.is_active ?? true,
          isOutOfStock: row.is_out_of_stock === true,
          isVisible: row.is_visible ?? true,
          imageUrl: row.image_url || undefined,
          companyId: row.company_id,
          companyName: row.company_name ?? '',
          unitPrices,
          availableUnitTypes,
        }
      })
      setProducts(mapped)
    }
    setLoadingProducts(false)
  }, [setProducts, companyId, authToken])

  const fetchTiers = useCallback(async () => {
    if (!authToken) return
    const { data } = await supabase.rpc('get_governed_tiers', { p_token: authToken })

    if (Array.isArray(data)) {
      const now = new Date()
      const mapped: TierConfig[] = data
        .filter((t: any) =>
          t.is_active &&
          t.is_visible &&
          (!t.starts_at || new Date(t.starts_at) <= now) &&
          (!t.ends_at || new Date(t.ends_at) >= now)
        )
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          discountPercent: Number(t.discount_percent),
          minimumOrderAmount: Number(t.minimum_order_amount),
          iconUrl: t.icon_url,
          color: t.color,
          sortOrder: t.sort_order,
          isActive: t.is_active,
          isVisible: t.is_visible,
          startsAt: t.starts_at,
          endsAt: t.ends_at,
        }))
      setTiers(mapped)
    }
  }, [setTiers, authToken])

  const fetchCustomers = useCallback(async () => {
    if (!authToken || user?.identity_type !== 'employee') return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: authToken })
    if (Array.isArray(data)) setCustomers(data)
  }, [authToken, user])

  useEffect(() => {
    fetchProducts()
    fetchTiers()
    fetchCustomers()
  }, [fetchProducts, fetchTiers, fetchCustomers])

  useEffect(() => {
    if (!editOrderId || !authToken) return
    supabase.rpc('get_unified_order', { p_token: authToken, p_id: editOrderId }).then(({ data }) => {
      if (!data || data.error) return
      const order = data.order
      const items = data.items || []
      if (order.customer_id) {
        setSelectedCustomer({ id: order.customer_id, name: order.customer_name || '', phone: order.customer_phone || '', code: order.customer_code || '' })
      }
      restoreCart(items, editOrderId, order.order_type)
    })
  }, [editOrderId, authToken])

  useEffect(() => {
    const urlOrderType = searchParams.get('order_type')
    if (urlOrderType) setOrderType(urlOrderType)
  }, [searchParams, setOrderType])

  useEffect(() => {
    if (!customerParam || !authToken) return
    if (!editingOrderId && items.length === 0) return
    supabase.rpc('get_governed_customer', { p_token: authToken, p_id: customerParam }).then(({ data }) => {
      if (!data) return
      const c = Array.isArray(data) ? data[0] : data
      setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '' })
    })
  }, [customerParam, authToken, editingOrderId, items.length])

  useEffect(() => {
    if (!companyId) {
      const params = new URLSearchParams()
      if (customerParam) params.set('customer', customerParam)
      const qs = params.toString()
      navigate('/storefront' + (qs ? '?' + qs : ''), { replace: true })
    }
  }, [companyId, customerParam, navigate])

  useEffect(() => {
    if (!highlightId || loadingProducts) return
    const el = document.getElementById('product-' + highlightId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('highlight-flash')
    const timer = setTimeout(() => el.classList.remove('highlight-flash'), 2000)
    return () => clearTimeout(timer)
  }, [highlightId, loadingProducts])

  // ── Expanded card: Escape key + scroll lock ──
  useEffect(() => {
    if (!expandedId) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedId(null) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [expandedId])

  useEffect(() => {
    if (!expandedId) return
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [expandedId])

  const isEmployee = user?.identity_type === 'employee'
  const needsCustomer = isEmployee && !selectedCustomer

  const selectedTier = getSelectedTier()
  const totals = getTotals()
  const cartItemCount = items.length

  const cartItemKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const item of items) {
      keys.add(`${item.productId}:${item.unitType}`)
    }
    return keys
  }, [items])

  const searchIndices = useMemo(() => {
    return products.map((p) => ({
      id: p.id,
      product: p,
      index: buildSearchIndex({
        id: p.id,
        legacyCode: p.legacyCode,
        productName: p.productName,
        companyName: p.companyName,
      }),
    }))
  }, [products])

  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => p.isActive && p.isVisible)
    if (searchQuery.trim()) {
      const indices = searchIndices.filter((si) => list.includes(si.product))
      list = searchProducts(searchQuery, indices, (si) => si.index).map((si) => si.product)
    } else {
      if (companyId) {
        list = list.filter((p) => p.companyId === companyId)
      }
      list = [...list].sort((a, b) => a.productName.localeCompare(b.productName, 'ar'))
    }
    return list
  }, [products, searchQuery, companyId, searchIndices])

  const expandedProduct = expandedId ? filteredProducts.find((p) => p.id === expandedId) ?? null : null

  const handleAddToCart = (product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    if (!selectedCustomer && !editingOrderId) {
      pendingAddRef.current = { product, unitType, quantity, scrollY: window.scrollY }
      setInitStep('type')
      setShowInitModal(true)
      return
    }
    if (needsCustomer) {
      setCustomerPickerOpen(true)
      return
    }
    addItem(product, unitType, quantity)
  }

  const handleRemoveFromCart = (productId: string, unitType: UnitType) => {
    removeItem(productId, unitType)
  }

  const handleImageClick = (product: ProductWithPrice) => {
    const defaultUnit = UNIT_PRIORITY.find((u) => product.availableUnitTypes.includes(u)) ?? product.availableUnitTypes[0] ?? 'piece'
    setExpandedUnit(defaultUnit)
    setExpandedQty(0)
    setExpandedId(product.id)
  }

  const handleInitComplete = () => {
    const pending = pendingAddRef.current
    if (!pending) return
    requestAnimationFrame(() => {
      window.scrollTo(0, pending.scrollY)
    })
    addItem(pending.product, pending.unitType, pending.quantity)
    pendingAddRef.current = null
    setShowInitModal(false)
  }

  const selectedCompanyName = companyId ? filteredProducts[0]?.companyName : null

  return (
    <div className="space-y-4">
      <style>{`.highlight-flash { animation: flashPulse 1.5s ease-out; } @keyframes flashPulse { 0% { box-shadow: 0 0 0 0 rgba(59,130,246,.5); } 70% { box-shadow: 0 0 0 12px rgba(59,130,246,0); } 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); } }`}</style>
      {/* Public Auth Actions */}
      {!authToken && (
        <div className="flex gap-2">
          <button onClick={() => navigate('/login')}
            className="flex-1 bg-primary text-white text-sm py-2.5 rounded-lg active:opacity-90 transition-opacity"
          >
            تسجيل الدخول
          </button>
          <button onClick={() => navigate('/register')}
            className="flex-1 bg-white text-text text-sm py-2.5 rounded-lg border border-border active:bg-surface transition-colors"
          >
            إنشاء حساب جديد
          </button>
        </div>
      )}

      {/* Employee Customer Selection */}
      {isEmployee && (
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              {selectedCustomer ? (
                <div>
                  <div className="text-xs text-text-secondary">العميل الحالي:</div>
                  <div className="text-sm font-semibold text-text">{selectedCustomer.name}</div>
                  <div className="text-xs text-text-secondary ltr">{selectedCustomer.phone}</div>
                </div>
              ) : (
                <div className="text-sm text-danger font-semibold">اختر العميل أولاً</div>
              )}
            </div>
            <button
              onClick={() => setCustomerPickerOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white active:bg-primary-dark transition-colors shrink-0"
            >
              {selectedCustomer ? 'تغيير' : 'اختيار عميل'}
            </button>
          </div>
        </div>
      )}

      {/* Customer Picker Modal */}
      {customerPickerOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center">
          <div className="bg-white w-full max-h-[calc(100dvh-6rem)] rounded-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-base font-bold text-text">اختر العميل أولاً</h3>
              <button
                onClick={() => { setCustomerPickerOpen(false); setCustomerSearch('') }}
                className="text-text-secondary text-lg"
              >
                &times;
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="ابحث عن عميل..."
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-secondary"
                autoFocus
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {customers.length === 0 && (
                <div className="text-center text-text-secondary text-sm py-8">لا يوجد عملاء</div>
              )}
              {customers
                .filter((c: any) => {
                  if (!customerSearch.trim()) return true
                  const q = customerSearch.trim().toLowerCase()
                  return (c.company_name?.toLowerCase().includes(q) || c.phone?.includes(q))
                })
                .map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '' })
                      setCustomerPickerOpen(false)
                      setCustomerSearch('')
                    }}
                    className={`w-full text-right px-3 py-3 rounded-lg transition-colors flex items-center justify-between ${
                      selectedCustomer?.id === c.id ? 'bg-primary/5' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text">{c.company_name || ''}</div>
                      <div className="text-xs text-text-secondary ltr">{c.phone || ''}</div>
                    </div>
                    {selectedCustomer?.id === c.id && (
                      <span className="text-xs text-primary font-semibold shrink-0 mr-2">✓</span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Order Initialization Modal */}
      {showInitModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center">
          <div className="bg-white w-full max-h-[calc(100dvh-6rem)] rounded-2xl overflow-hidden flex flex-col mx-4">
            {initStep === 'type' ? (
              <>
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="text-base font-bold text-text">نوع الطلب</h3>
                </div>
                <div className="p-4 space-y-2">
                  <button
                    onClick={() => { setOrderType('cash'); setInitStep('customer') }}
                    className="w-full text-right px-4 py-3 rounded-lg border border-border hover:bg-surface transition-colors"
                  >
                    <span className="text-sm font-semibold text-text">نقداً</span>
                  </button>
                  <button
                    onClick={() => { setOrderType('credit'); setInitStep('customer') }}
                    className="w-full text-right px-4 py-3 rounded-lg border border-border hover:bg-surface transition-colors"
                  >
                    <span className="text-sm font-semibold text-text">آجل</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setInitStep('type')} className="text-text-secondary text-lg">&rarr;</button>
                    <h3 className="text-base font-bold text-text">اختر العميل</h3>
                  </div>
                  <button onClick={() => { setShowInitModal(false); pendingAddRef.current = null }} className="text-text-secondary text-lg">&times;</button>
                </div>
                <div className="px-4 py-2">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="ابحث عن عميل..."
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-secondary"
                    autoFocus
                  />
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                  {customers.length === 0 && (
                    <div className="text-center text-text-secondary text-sm py-8">لا يوجد عملاء</div>
                  )}
                  {customers
                    .filter((c: any) => {
                      if (!customerSearch.trim()) return true
                      const q = customerSearch.trim().toLowerCase()
                      return (c.company_name?.toLowerCase().includes(q) || c.phone?.includes(q))
                    })
                    .map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '' })
                          setCustomerSearch('')
                          setTimeout(() => handleInitComplete(), 0)
                        }}
                        className="w-full text-right px-3 py-3 rounded-lg transition-colors hover:bg-surface"
                      >
                        <div className="text-sm font-semibold text-text">{c.company_name || ''}</div>
                        <div className="text-xs text-text-secondary ltr">{c.phone || ''}</div>
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <StorefrontBanner />

      {/* Dual Nav for logged-in users */}
      {authToken && user?.identity_type === 'employee' && (
        <div className="flex gap-2">
          <button onClick={() => navigate('/dashboard')}
            className="flex-1 bg-primary text-white text-sm py-2 rounded-lg active:opacity-90 transition-opacity"
          >
            لوحة التحكم
          </button>
        </div>
      )}
      {authToken && user?.identity_type === 'customer' && (
        <div className="flex gap-2">
          <button onClick={() => navigate('/account')}
            className="flex-1 bg-primary text-white text-sm py-2 rounded-lg active:opacity-90 transition-opacity"
          >
            حسابي
          </button>
          <button onClick={() => navigate('/orders')}
            className="flex-1 bg-white text-text text-sm py-2 rounded-lg border border-border active:bg-surface transition-colors"
          >
            طلباتي
          </button>
          <button onClick={() => navigate('/returns')}
            className="flex-1 bg-white text-text text-sm py-2 rounded-lg border border-border active:bg-surface transition-colors"
          >
            مرتجعاتي
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text">
          {selectedCompanyName || 'المنتجات'}
        </h1>
        <div className="flex items-center gap-2">
          {companyId && (
            <button
              onClick={() => navigate(customerParam ? `/storefront?customer=${customerParam}` : '/storefront')}
              className="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg active:bg-primary-dark transition-colors"
            >
              الرجوع للشركات
            </button>
          )}
          <button
            onClick={() => navigate('/cart')}
            className="relative bg-white border border-border rounded-lg px-3 py-2 text-sm"
          >
            🛒 السلة
            {cartItemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث عن منتج..."
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
        />
        {searchQuery.trim() && !loadingProducts && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary">
            {filteredProducts.length} نتيجة
          </span>
        )}
      </div>

      {/* Product Grid */}
      {loadingProducts && (
        <div className="text-center py-12 text-text-secondary text-sm">
          جاري تحميل المنتجات...
        </div>
      )}

      {!loadingProducts && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-stretch">
          {filteredProducts.map((product) => (
            <div key={product.id} id={'product-' + product.id} className="rounded-xl transition-all duration-500">
              <ProductCard
                product={product}
                prices={computeProductPrices(product, selectedTier)}
                hasTier={selectedTier !== null}
                tierName={selectedTier?.name ?? null}
                onAddToCart={handleAddToCart}
                onRemoveFromCart={handleRemoveFromCart}
                cartItemKeys={cartItemKeys}
                searchQuery={searchQuery}
                onImageClick={() => handleImageClick(product)}
              />
            </div>
          ))}
        </div>
      )}

      {!loadingProducts && filteredProducts.length === 0 && (
        <div className="text-center py-12 text-text-secondary text-sm">
          لا توجد منتجات متطابقة مع البحث
        </div>
      )}

      <StorefrontFooter />

      {/* Expanded Product Card Modal */}
      {expandedProduct && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedId(null) }}
        >
          <div className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl animate-zoom-in">
            <ProductCard
              product={expandedProduct}
              prices={computeProductPrices(expandedProduct, selectedTier)}
              hasTier={selectedTier !== null}
              tierName={selectedTier?.name ?? null}
              onAddToCart={handleAddToCart}
              onRemoveFromCart={handleRemoveFromCart}
              cartItemKeys={cartItemKeys}
              searchQuery={searchQuery}
              expanded
              onClose={() => setExpandedId(null)}
              selectedUnit={expandedUnit}
              onUnitChange={setExpandedUnit}
              quantity={expandedQty}
              onQuantityChange={setExpandedQty}
            />
          </div>
        </div>
      )}

      {/* Sticky Cart Bar */}
      {cartItemCount > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-border p-3 -mx-4 -mb-24 mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-secondary">
              {cartItemCount} منتج &middot; {items.reduce((s, i) => s + i.pieceQuantity, 0).toLocaleString('ar-EG-u-nu-latn')} قطعة
            </span>
            <span className="text-sm font-bold text-text">{formatCurrencyShort(totals.netTotal)}</span>
          </div>
          <button
            onClick={() => navigate('/cart')}
            className="w-full bg-primary text-white text-sm py-2.5 rounded-lg active:bg-primary-dark transition-colors"
          >
            عرض السلة
          </button>
        </div>
      )}
    </div>
  )
}
