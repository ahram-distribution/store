import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCartStore } from '../../store/cart'
import { useCompaniesStore, type CompanyItem } from '../../store/companies'
import { ProductCard } from '../../components/storefront/ProductCard'
import { StorefrontBanner, StorefrontFooter } from '../../components/storefront/CompanyInfoSection'
import { CartSummaryBar } from '../../components/storefront/CartSummaryBar'
import { computeProductPrices } from '../../engine/pricing'
import { discountOptionsService, buildDiscountPricingContext, resolveExceptionLookup } from '../../services/discountOptions'
import { DiscountOptionSelector, type SelectableDiscountOption } from '../../components/storefront/DiscountOptionSelector'
import { buildSearchIndex, searchProducts, type ProductSearchIndex } from '../../utils/smartSearch'
import type { ProductWithPrice, ProductUnitPrice, TierConfig, UnitType } from '../../types/storefront'
import { DYNAMIC_COLLECTIONS, loadCollection, type CollectionStrategy } from '../../config/dynamicCollections'
import { resolveConfiguredUnitTypes } from '../../utils/catalog'
import { useGeographicVisibility } from '../../hooks/useGeographicVisibility'

const UNIT_PRIORITY: UnitType[] = ['carton', 'dozen', 'piece']

export function StorefrontPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const companyId = searchParams.get('companyId')
  const editOrderId = searchParams.get('editOrder')
  const customerParam = searchParams.get('customer')
  const highlightId = searchParams.get('highlight')
  const { token: authToken, user } = useAuthStore()
  const fetchCompanyById = useCompaniesStore((s) => s.fetchCompanyById)
  const [companyContext, setCompanyContext] = useState<CompanyItem | null>(null)

  const {
    items,
    products,
    tiers,
    paymentMethods,
    shippingMethods,
    setProducts,
    setTiers,
    setPaymentMethods,
    setShippingMethods,
    setDiscountContext,
    discountContext,
    selectedTierId,
    selectTier,
    selectedPaymentMethodId,
    selectPaymentMethod,
    selectedShippingMethodId,
    selectShippingMethod,
    addItem,
    removeItem,
    getSelectedTier,
    getSelectedPaymentMethod,
    getSelectedShippingMethod,
    selectedCustomer,
    editingOrderId,
    orderType,
    setSelectedCustomer,
    setEditingOrder,
    setOrderType,
    restoreCart,
    geographicContext,
    resolveEmployeeGeographicContext,
    resolveGeographicPricing,
    geoItemAdjustments,
    geoResolveEpoch,
    ensureGeoItemAdjustments,
    refreshBonusMode,
    bonusMode,
  } = useCartStore()

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [customers, setCustomers] = useState<any[]>([])
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showInitModal, setShowInitModal] = useState(false)
  const [initStep, setInitStep] = useState<'tier' | 'payment' | 'shipping' | 'customer'>('tier')
  const pendingAddRef = useRef<{ product: ProductWithPrice; unitType: UnitType; quantity: number; scrollY: number } | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedUnit, setExpandedUnit] = useState<UnitType>('piece')
  const [expandedQty, setExpandedQty] = useState(0)

  useEffect(() => {
    if (!companyId) { setCompanyContext(null); return }
    fetchCompanyById(companyId).then(setCompanyContext)
  }, [companyId, fetchCompanyById])

  useEffect(() => {
    if (products.length > 0) {
      ensureGeoItemAdjustments(products)
    }
  }, [products, geographicContext?.governorateId, geoResolveEpoch, ensureGeoItemAdjustments])

  const geoAdjustForProduct = (productId: string) =>
    geoItemAdjustments[productId] ?? geographicContext?.adjustmentPercent ?? undefined

  const { hiddenProductIds } = useGeographicVisibility()

  const collectionConfig = useMemo<{ type: 'static' } | { type: 'dynamic'; strategy: CollectionStrategy } | null>(() => {
    if (!companyId || !companyContext) return null
    const config = DYNAMIC_COLLECTIONS[companyContext.legacyCode]
    return config ? { type: 'dynamic', strategy: config.strategy } : { type: 'static' }
  }, [companyId, companyContext])

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true)
    if (!authToken) {
      setProducts([])
      setLoadingProducts(false)
      return
    }

    let data: any[] | null = null
    let error: any = null

    if (collectionConfig?.type === 'dynamic') {
      const result = await loadCollection(collectionConfig.strategy, authToken)
      data = result.data
      error = result.error
    } else if (collectionConfig?.type === 'static') {
      const result = await supabase.rpc('get_governed_products', {
        p_token: authToken, p_company_id: companyId || null, p_active_only: true, p_visible_only: true,
      })
      data = result.data
      error = result.error
    }

    if (!error && data) {
      const arr = Array.isArray(data) ? data : []
      const mapped: ProductWithPrice[] = arr.map((row: any) => {
        const cartonPrice = Number(row.carton_price) || 0
        const cartonQuantity = Number(row.carton_quantity) || 0
        const piecePrice = Number(row.piece_price) || 0
        const dozenPrice = Number(row.dozen_price) || 0
        const activeUnits = resolveConfiguredUnitTypes(row)
        const availableUnitTypes: UnitType[] = activeUnits
        const allUnitPrices: ProductUnitPrice[] = [
          { unitType: 'piece', price: piecePrice },
          { unitType: 'dozen', price: dozenPrice },
          { unitType: 'carton', price: cartonPrice },
        ]
        const unitPrices = allUnitPrices.filter((up) => up.unitType === 'piece' || up.unitType === 'carton' || availableUnitTypes.includes(up.unitType))
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
          recentlyAvailableAt: row.recently_available_at || undefined,
        }
      })
      setProducts(mapped)
    }
    setLoadingProducts(false)
  }, [setProducts, companyId, authToken, collectionConfig])

  const fetchDiscountOptions = useCallback(async () => {
    if (!authToken) return
    try {
      const bundle = await discountOptionsService.getAll()
      const now = new Date()
      const mappedTiers: TierConfig[] = bundle.tiers
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
      setTiers(mappedTiers)
      setPaymentMethods(mappedPayments)
      setShippingMethods(mappedShipping)
      setDiscountContext(buildDiscountPricingContext(bundle))
    } catch {
      // fall back to nothing; selectors render accordingly
    }
  }, [authToken, setTiers, setPaymentMethods, setShippingMethods, setDiscountContext])

  const fetchCustomers = useCallback(async () => {
    if (!authToken || user?.identity_type !== 'employee') return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: authToken })
    if (Array.isArray(data)) setCustomers(data)
  }, [authToken, user])

  useEffect(() => {
    fetchProducts()
    fetchDiscountOptions()
    fetchCustomers()
    refreshBonusMode()
  }, [fetchProducts, fetchDiscountOptions, fetchCustomers, refreshBonusMode])

  useEffect(() => {
    if (!editOrderId || !authToken) return
    supabase.rpc('get_unified_order', { p_token: authToken, p_id: editOrderId }).then(async ({ data }) => {
      if (!data || data.error) return
      const order = data.order
      const items = data.items || []
      if (order.customer_id) {
        supabase.rpc('get_governed_customer', { p_token: authToken, p_id: order.customer_id }).then(({ data }) => {
          if (data?.id) {
            setSelectedCustomer({ id: data.id, name: data.company_name || '', phone: data.phone || '', code: data.code || '', governorateId: data.governorate_id || undefined })
          } else {
            setSelectedCustomer({ id: order.customer_id, name: order.customer_name || '', phone: order.customer_phone || '', code: order.customer_code || '' })
          }
        }).catch(() => {
          setSelectedCustomer({ id: order.customer_id, name: order.customer_name || '', phone: order.customer_phone || '', code: order.customer_code || '' })
        })
      }
      let restores: { tierId?: string | null; paymentMethodId?: string | null; shippingMethodId?: string | null } = {}
      try {
        const snaps = await discountOptionsService.getOrderDiscountSnapshots([editOrderId])
        const snap = snaps[0]
        if (snap) {
          restores = {
            tierId: snap.tierId,
            paymentMethodId: snap.paymentMethodOptionId,
            shippingMethodId: snap.shippingMethodOptionId,
          }
        }
      } catch {
        // fall back to restoring nothing
      }
      restoreCart(items, editOrderId, order.order_type, restores.tierId, restores.paymentMethodId, restores.shippingMethodId)
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
      supabase.from('customer_addresses').select('governorate_id').eq('customer_id', c.id).eq('is_default', true).limit(1).maybeSingle().then(({ data: addr }) => {
        setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', governorateId: addr?.governorate_id || undefined })
      }).catch(() => {
        setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '' })
      })
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

  useEffect(() => {
    if (user?.identity_type !== 'employee' || !user.employee_id) return
    if (selectedCustomer?.governorateId) return
    resolveEmployeeGeographicContext(user.employee_id)
  }, [user?.employee_id, user?.identity_type, selectedCustomer?.governorateId, resolveEmployeeGeographicContext])

  useEffect(() => {
    if (!selectedCustomer?.governorateId) return
    resolveGeographicPricing(selectedCustomer.governorateId, undefined, undefined)
  }, [selectedCustomer?.governorateId, resolveGeographicPricing])

  // Auto-set selectedCustomer for customer users (self-purchase).
  // Always (re)resolve the direct customer's default governorate. A persisted
  // selectedCustomer.id must NOT short-circuit this: a prior session may have
  // persisted a matching id with a missing/stale governorateId, which would
  // otherwise skip the lookup and leave geographic pricing at base.
  useEffect(() => {
    if (user?.identity_type !== 'customer' || !user?.customer_id || !authToken) return
    const base = {
      id: user.customer_id,
      name: user.company_name || user.full_name || '',
      phone: '',
      code: user.code || '',
    }
    supabase.rpc('get_governed_customer', { p_token: authToken, p_id: user.customer_id })
      .then(({ data }) => {
        if (data?.id) {
          setSelectedCustomer({ id: data.id, name: data.company_name || base.name, phone: data.phone || '', code: data.code || '', governorateId: data.governorate_id || undefined })
        } else {
          setSelectedCustomer({ ...base, governorateId: undefined })
        }
      })
      .catch(() => {
        setSelectedCustomer({ ...base, governorateId: undefined })
      })
  }, [user?.identity_type, user?.customer_id, user?.company_name, user?.full_name, user?.code, authToken, setSelectedCustomer])

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
  const isDirectCustomer = user?.identity_type === 'customer'
  const needsCustomer = isEmployee && !selectedCustomer

  const selectedTier = getSelectedTier()
  const selectedPaymentMethod = getSelectedPaymentMethod()
  const selectedShippingMethod = getSelectedShippingMethod()
  const cartItemCount = items.length

  const resolveLookupFor = useCallback((product: { id: string; companyId?: string }) => {
    return discountContext
      ? resolveExceptionLookup(discountContext, selectedTier, selectedPaymentMethod, selectedShippingMethod, product.id, product.companyId)
      : undefined
  }, [discountContext, selectedTier, selectedPaymentMethod, selectedShippingMethod])

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
    let list = products.filter((p) => p.isActive && p.isVisible && !hiddenProductIds.has(p.id))
    if (searchQuery.trim()) {
      const indices = searchIndices.filter((si) => list.includes(si.product))
      const matched = new Set(searchProducts(searchQuery, indices, (si) => si.index).map((si) => si.product.id))
      list = list.filter((p) => matched.has(p.id))
    } else {
      if (companyId && collectionConfig?.type !== 'dynamic') {
        list = list.filter((p) => p.companyId === companyId)
      }
      if (collectionConfig?.type !== 'dynamic') {
        list = [...list].sort((a, b) => a.productName.localeCompare(b.productName, 'ar'))
      }
    }
    return list
  }, [products, searchQuery, companyId, collectionConfig, searchIndices, hiddenProductIds])

  const expandedProduct = expandedId ? filteredProducts.find((p) => p.id === expandedId) ?? null : null

  const handleAddToCart = (product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    // Direct customer (self-purchase): establish CASH order context automatically
    // and add the product immediately — never open order-type/customer dialogs.
    // Skip the order-type assignment while editing a returned-for-revision order
    // so its restored type is preserved.
    if (isDirectCustomer) {
      if (!editingOrderId && orderType !== 'cash') setOrderType('cash')
      addItem(product, unitType, quantity)
      return
    }
    if (!isEmployee && !orderType && !editingOrderId) {
      pendingAddRef.current = { product, unitType, quantity, scrollY: window.scrollY }
      setInitStep('tier')
      setShowInitModal(true)
      return
    }
    if (!selectedCustomer && !editingOrderId) {
      pendingAddRef.current = { product, unitType, quantity, scrollY: window.scrollY }
      setInitStep('tier')
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

  const moveToNextInitStep = () => {
    if (initStep === 'tier') setInitStep('payment')
    else if (initStep === 'payment') setInitStep('shipping')
    else if (initStep === 'shipping') {
      if (isEmployee) setInitStep('customer')
      else setTimeout(() => handleInitComplete(), 0)
    }
  }

  const tierSelectorOptions: SelectableDiscountOption[] = tiers.map((t) => ({
    id: t.id,
    name: t.name,
    discountPercent: t.discountPercent,
    minimumOrderAmount: t.minimumOrderAmount,
    color: t.color,
    iconUrl: t.iconUrl,
  }))

  const paymentSelectorOptions: SelectableDiscountOption[] = paymentMethods.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const shippingSelectorOptions: SelectableDiscountOption[] = shippingMethods.map((m) => ({
    id: m.id,
    name: m.name,
    discountPercent: m.discountPercent,
  }))

  const selectedCompanyName = companyContext?.companyName ?? null

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

      {/* Customer Self-Purchase Indicator */}
      {!isEmployee && selectedCustomer && (
        <div className="bg-primary/5 rounded-xl border border-primary/20 p-3">
          <div className="text-xs text-text-secondary">الشراء لحساب</div>
          <div className="text-sm font-semibold text-text">{selectedCustomer.name}</div>
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
                      const govPromise = supabase.from('customer_addresses').select('governorate_id').eq('customer_id', c.id).eq('is_default', true).limit(1).maybeSingle()
                      govPromise.then(({ data: addr }) => {
                        setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '', governorateId: addr?.governorate_id || undefined })
                      }).catch(() => {
                        setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '' })
                      })
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
      {showInitModal && (() => {
        const initSteps: ('tier' | 'payment' | 'shipping' | 'customer')[] = isEmployee
          ? ['tier', 'payment', 'shipping', 'customer']
          : ['tier', 'payment', 'shipping']
        const initStepIndex = initSteps.indexOf(initStep)
        const stepTitle =
          initStep === 'tier' ? 'اختر شريحتك السعرية'
          : initStep === 'payment' ? 'طريقة الدفع'
          : initStep === 'shipping' ? 'طريقة الشحن'
          : 'اختر العميل'
        return (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white w-full max-w-lg max-h-[min(92dvh,720px)] rounded-2xl overflow-hidden flex flex-col animate-zoom-in">
              {/* Header */}
              <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {initStepIndex > 0 && (
                      <button
                        onClick={() => setInitStep(initSteps[initStepIndex - 1])}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-surface text-text active:bg-border transition-colors"
                        aria-label="رجوع"
                      >
                        &rarr;
                      </button>
                    )}
                    <h3 className="text-base font-bold text-text truncate">{stepTitle}</h3>
                  </div>
                  <button
                    onClick={() => { setShowInitModal(false); pendingAddRef.current = null }}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-surface text-text-secondary active:bg-border transition-colors"
                    aria-label="إغلاق"
                  >
                    &times;
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <div className="flex items-center gap-1.5">
                    {initSteps.map((step, i) => (
                      <span
                        key={step}
                        className={`h-1.5 rounded-full transition-all ${i === initStepIndex ? 'w-6 bg-primary' : i < initStepIndex ? 'w-3 bg-primary/40' : 'w-3 bg-border'}`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-text-secondary">الخطوة {initStepIndex + 1} من {initSteps.length}</span>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {initStep === 'tier' ? (
                  <DiscountOptionSelector
                    hideTitle
                    groupLabel="اختر شريحتك السعرية"
                    noneLabel="السعر الأساسي"
                    options={tierSelectorOptions}
                    selectedId={selectedTierId}
                    onSelect={selectTier}
                    showMinimum
                  />
                ) : initStep === 'payment' ? (
                  <DiscountOptionSelector
                    hideTitle
                    groupLabel="طريقة الدفع"
                    noneLabel="نقدي / بدون طريقة"
                    options={paymentSelectorOptions}
                    selectedId={selectedPaymentMethodId}
                    onSelect={selectPaymentMethod}
                  />
                ) : initStep === 'shipping' ? (
                  <DiscountOptionSelector
                    hideTitle
                    groupLabel="طريقة الشحن"
                    noneLabel="بدون طريقة شحن"
                    options={shippingSelectorOptions}
                    selectedId={selectedShippingMethodId}
                    onSelect={selectShippingMethod}
                  />
                ) : (
                  <>
                    <div>
                      <input
                        type="text"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="ابحث عن عميل..."
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-secondary"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
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
                              const govPromise = supabase.from('customer_addresses').select('governorate_id').eq('customer_id', c.id).eq('is_default', true).limit(1).maybeSingle()
                              govPromise.then(({ data: addr }) => {
                                setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '', governorateId: addr?.governorate_id || undefined })
                              }).catch(() => {
                                setSelectedCustomer({ id: c.id, name: c.company_name || '', phone: c.phone || '', code: c.code || '', address: '' })
                              })
                              setCustomerSearch('')
                              setTimeout(() => handleInitComplete(), 0)
                            }}
                            className="w-full text-right px-3 py-3 rounded-xl border border-border bg-white hover:bg-surface transition-colors"
                          >
                            <div className="text-sm font-semibold text-text">{c.company_name || ''}</div>
                            <div className="text-xs text-text-secondary ltr">{c.phone || ''}</div>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              {initStep !== 'customer' && (
                <div className="px-4 py-3 border-t border-border shrink-0">
                  <button
                    onClick={moveToNextInitStep}
                    className="w-full bg-primary text-white text-sm font-bold py-3 rounded-xl active:bg-primary-dark transition-colors"
                  >
                    التالي
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

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
          <button onClick={() => navigate('/orders')}
            className="flex-1 bg-primary text-white text-sm py-2 rounded-lg active:opacity-90 transition-opacity"
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

      {/* Cart Summary Bar — shared component (also used on Storefront Home),
          placed directly above the Search bar. */}
      <CartSummaryBar />

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
                prices={computeProductPrices(product, selectedTier, resolveLookupFor(product), geoAdjustForProduct(product.id), selectedPaymentMethod, selectedShippingMethod)}
                hasTier={selectedTier !== null}
                tierName={selectedTier?.name ?? null}
                onAddToCart={handleAddToCart}
                onRemoveFromCart={handleRemoveFromCart}
                cartItemKeys={cartItemKeys}
                searchQuery={searchQuery}
                onImageClick={() => handleImageClick(product)}
                bonusMode={bonusMode}
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
              prices={computeProductPrices(expandedProduct, selectedTier, resolveLookupFor(expandedProduct), geoAdjustForProduct(expandedProduct.id), selectedPaymentMethod, selectedShippingMethod)}
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
              bonusMode={bonusMode}
            />
          </div>
        </div>
      )}
    </div>
  )
}
