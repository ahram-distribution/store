import { useMemo, useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCartStore } from '../../store/cart'
import { ProductCard } from '../../components/storefront/ProductCard'
import { StorefrontBanner, StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { TierSelector } from '../../components/storefront/TierSelector'
import { computeProductPrices } from '../../engine/pricing'
import { formatCurrencyShort } from '../../utils/format'
import type { ProductWithPrice, ProductUnitPrice, TierConfig, UnitType } from '../../types/storefront'

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

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true)
    if (!authToken) {
      setProducts([])
      setLoadingProducts(false)
      return
    }
    const { data, error } = await supabase.rpc('get_governed_products', {
      p_token: authToken, p_company_id: companyId || null,
    })
    if (!error && data) {
      const arr = Array.isArray(data) ? data : []
      const mapped: ProductWithPrice[] = arr.map((row: any) => {
        const cartonPrice = Number(row.carton_price) || 0
        const cartonQuantity = Number(row.carton_quantity) || 0
        const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
        const activeUnitTypes = activeUnits.map((u: any) => u.unit_type)
        const hasCarton = activeUnitTypes.includes('carton')
        const rawPrices: ProductUnitPrice[] = []
        if (hasCarton) {
          if (cartonPrice > 0) {
            if (cartonQuantity >= 24) {
              rawPrices.push({ unitType: 'dozen', price: (cartonPrice / cartonQuantity) * 12 })
            }
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
          legacyCode: row.legacy_code || '',
          cartonPrice,
          cartonQuantity,
          isActive: row.is_active ?? true,
          isOutOfStock: row.is_out_of_stock === true,
          isVisible: row.is_visible ?? true,
          imageUrl: row.image_url || undefined,
          companyId: row.company_id,
          companyName: row.companies?.company_name ?? '',
          unitPrices,
        }
      })
      setProducts(mapped)
    }
    setLoadingProducts(false)
  }, [setProducts, companyId, authToken])

  const fetchTiers = useCallback(async () => {
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('tiers')
      .select('*')
      .eq('is_active', true)
      .eq('is_visible', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('sort_order', { ascending: true })

    if (data) {
      const mapped: TierConfig[] = data.map((t: any) => ({
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
  }, [setTiers])

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
      restoreCart(items, editOrderId)
    })
  }, [editOrderId, authToken])

  useEffect(() => {
    const urlOrderType = searchParams.get('order_type')
    if (urlOrderType) setOrderType(urlOrderType)
  }, [searchParams, setOrderType])

  useEffect(() => {
    if (!customerParam || !authToken) return
    supabase.rpc('get_governed_customer', { p_token: authToken, p_id: customerParam }).then(({ data }) => {
      if (!data) return
      const c = Array.isArray(data) ? data[0] : data
      setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '' })
    })
  }, [customerParam, authToken])

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

  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => p.isActive && p.isVisible)
    if (companyId) {
      list = list.filter((p) => p.companyId === companyId)
    }
    if (searchQuery.trim()) {
      list = list.filter((p) => p.productName.includes(searchQuery))
    }
    return [...list].sort((a, b) =>
      a.productName.localeCompare(b.productName, 'ar')
    )
  }, [products, searchQuery, companyId])

  const handleAddToCart = (product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    if (needsCustomer) {
      setCustomerPickerOpen(true)
      return
    }
    addItem(product, unitType, quantity)
  }

  const handleRemoveFromCart = (productId: string, unitType: UnitType) => {
    removeItem(productId, unitType)
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
                  return (c.customer_name?.toLowerCase().includes(q) || c.phone?.includes(q))
                })
                .map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer({ id: c.id, name: c.customer_name || 'غير متوفر', phone: c.phone || '', code: c.code || '', address: '' })
                      setCustomerPickerOpen(false)
                      setCustomerSearch('')
                    }}
                    className={`w-full text-right px-3 py-3 rounded-lg transition-colors flex items-center justify-between ${
                      selectedCustomer?.id === c.id ? 'bg-primary/5' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text">{c.customer_name || 'غير متوفر'}</div>
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
        <div className="flex items-center gap-2">
          {companyId && (
            <button
              onClick={() => navigate(customerParam ? `/storefront?customer=${customerParam}` : '/storefront')}
              className="text-sm text-primary"
            >
              ← الشركات
            </button>
          )}
          <h1 className="text-lg font-bold text-text">
            {selectedCompanyName || 'المنتجات'}
          </h1>
        </div>
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

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="ابحث عن منتج..."
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
      />

      {/* Tier Selector */}
      <TierSelector
        tiers={tiers}
        selectedTierId={selectedTierId}
        onSelect={selectTier}
        cartTotal={totals.netTotal}
      />

      {selectedTier && (
        <div className="text-xs text-text-secondary bg-blue-50 rounded-lg px-3 py-2">
          يتم عرض أسعار شريحة <strong>{selectedTier.name}</strong> — خصم يصل إلى {Math.ceil(selectedTier.discountPercent)}%
        </div>
      )}

      {/* Product Grid */}
      {loadingProducts && (
        <div className="text-center py-12 text-text-secondary text-sm">
          جاري تحميل المنتجات...
        </div>
      )}

      {!loadingProducts && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
