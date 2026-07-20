import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { UNIT_LABELS } from '../../types/order-display'
import { computeProductPrices, computePieceQuantity } from '../../engine/pricing'
import { formatCurrencyShort } from '../../utils/format'
import { buildSearchIndex, searchProducts } from '../../utils/smartSearch'
import { SearchHighlight } from '../shared/SearchHighlight'
import type { UnitType, ProductWithPrice } from '../../types/storefront'
import type { UnifiedOrderItem } from '../../types/unified-order'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function mapProduct(row: any): ProductWithPrice {
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
  const activeUnitTypes = activeUnits.map((u: any) => u.unit_type)
  const hasCarton = activeUnitTypes.includes('carton')
  const rawPrices: any[] = []
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
  const unitPrices = rawPrices.filter((up: any) => activeUnitTypes.includes(up.unitType))
  return {
    id: row.id,
    productName: row.product_name,
    legacyCode: row.legacy_code,
    cartonPrice,
    cartonQuantity,
    isActive: row.is_active ?? true,
    salesBlocked: unitPrices.length === 0,
    outOfStock: row.is_out_of_stock === true && row.is_active !== false,
    imageUrl: row.image_url || undefined,
    companyId: row.company_id,
    companyName: row.company_name ?? '',
    unitPrices,
  }
}

interface EditableItem {
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

interface SupremeOrderEditorProps {
  orderId: string
  initialItems: UnifiedOrderItem[]
  initialNotes: string | null
  initialOrderType: string | null
  customerId: string
  onSaved: () => void
  onCancel: () => void
}

export function SupremeOrderEditor({ orderId, initialItems, initialNotes, initialOrderType, customerId, onSaved, onCancel }: SupremeOrderEditorProps) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    initialItems.map(i => ({
      productId: i.product_id,
      productName: i.product_name,
      imageUrl: i.image_url,
      companyName: i.company_name || '',
      unitType: i.unit_type as UnitType,
      unitQuantity: i.unit_quantity,
      pieceQuantity: i.piece_quantity,
      unitPrice: i.unit_price,
      totalPrice: i.total_price,
    }))
  )
  const [notes, setNotes] = useState(initialNotes || '')
  const [orderType, setOrderType] = useState<string>(initialOrderType || 'cash')
  const [submitting, setSubmitting] = useState(false)
  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingProducts, setLoadingProducts] = useState(true)
  const token = getToken()

  useEffect(() => {
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_products', { p_token: token }),
      supabase.rpc('get_governed_companies', { p_token: token }),
    ]).then(([prodRes, compRes]) => {
      if (prodRes.data) {
        const allProds = prodRes.data.map(mapProduct)
        setProducts(allProds)
        if (compRes.data) {
          setCompanies(compRes.data.filter((c: any) => c.is_visible !== false))
        }
      }
      setLoadingProducts(false)
    })
  }, [token])

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
    if (searchQuery.trim()) {
      const indices = searchIndices.filter((si) => si.product.isActive !== false)
      return searchProducts(searchQuery, indices, (si) => si.index).map((si) => si.product)
    }
    let list = selectedCompanyId ? products.filter(p => p.companyId === selectedCompanyId) : []
    return [...list].sort((a, b) => {
      const aAvail = !a.salesBlocked ? 0 : 1
      const bAvail = !b.salesBlocked ? 0 : 1
      if (aAvail !== bAvail) return aAvail - bAvail
      return a.productName.localeCompare(b.productName, 'ar')
    })
  }, [products, selectedCompanyId, searchQuery, searchIndices])

  const [showProductSearch, setShowProductSearch] = useState(false)

  const handleRemoveItem = useCallback((productId: string, unitType: UnitType) => {
    setItems(prev => prev.filter(i => !(i.productId === productId && i.unitType === unitType)))
  }, [])

  const handleUpdateQty = useCallback((productId: string, unitType: UnitType, delta: number) => {
    setItems(prev => prev.map(i => {
      if (i.productId !== productId || i.unitType !== unitType) return i
      const newQty = Math.max(1, i.unitQuantity + delta)
      const newTotal = (i.totalPrice / i.unitQuantity) * newQty
      const newPiece = (i.pieceQuantity / i.unitQuantity) * newQty
      return { ...i, unitQuantity: newQty, totalPrice: Math.round(newTotal * 100) / 100, pieceQuantity: Math.round(newPiece) }
    }))
  }, [])

  const handleUpdateUnit = useCallback((productId: string, oldUnitType: UnitType, newUnitType: UnitType) => {
    setItems(prev => prev.map(i => {
      if (i.productId !== productId || i.unitType !== oldUnitType) return i
      const product = products.find(p => p.id === productId)
      if (!product) return i
      const prices = computeProductPrices(product, null)
      const newUnitPrice = newUnitType === 'piece' ? prices.piecePrice : newUnitType === 'dozen' ? prices.dozenPrice : prices.cartonPrice
      if (newUnitPrice <= 0) {
        toast.error('لا يوجد سعر لهذه الوحدة')
        return i
      }
      const pieceQty = computePieceQuantity(i.unitQuantity, newUnitType, product.cartonQuantity)
      return {
        ...i,
        unitType: newUnitType,
        unitPrice: newUnitPrice,
        totalPrice: Math.round(newUnitPrice * i.unitQuantity * 100) / 100,
        pieceQuantity: pieceQty,
      }
    }))
  }, [products])

  const handleUpdatePrice = useCallback((productId: string, unitType: UnitType, newPrice: number) => {
    if (newPrice < 0) return
    setItems(prev => prev.map(i => {
      if (i.productId !== productId || i.unitType !== unitType) return i
      return {
        ...i,
        unitPrice: newPrice,
        totalPrice: Math.round(newPrice * i.unitQuantity * 100) / 100,
      }
    }))
  }, [])

  const handleAddProduct = useCallback((product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id && i.unitType === unitType)
      const pieceQuantity = computePieceQuantity(quantity, unitType, product.cartonQuantity)
      const prices = computeProductPrices(product, null)
      const unitPrice = unitType === 'piece' ? prices.piecePrice : unitType === 'dozen' ? prices.dozenPrice : prices.cartonPrice
      const totalPrice = Math.round(unitPrice * quantity * 100) / 100
      if (existing) {
        return prev.map(i =>
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
    setShowProductSearch(false)
    toast.success('تمت إضافة المنتج')
  }, [])

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.totalPrice, 0), [items])

  const handleSave = async () => {
    if (!token || items.length === 0) {
      toast.error('يجب إضافة منتج واحد على الأقل')
      return
    }
    setSubmitting(true)
    const payload = items.map(i => ({
      product_id: i.productId,
      unit_type: i.unitType,
      unit_quantity: i.unitQuantity,
      piece_quantity: i.pieceQuantity,
      unit_price: Math.round(i.unitPrice * 100) / 100,
      total_price: Math.round(i.totalPrice * 100) / 100,
    }))
    const { data, error } = await supabase.rpc('governed_supreme_edit_order', {
      p_token: token,
      p_order_id: orderId,
      p_items: payload,
      p_notes: notes || null,
      p_discount_amount: null,
      p_reason: 'تعديل بواسطة الإدارة العليا',
      p_order_type: orderType,
    })
    setSubmitting(false)
    if (error) {
      toast.error('فشل حفظ التعديلات: ' + error.message)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      toast.error(String((data as any).detail || (data as any).error))
      return
    }
    toast.success('تم حفظ التعديلات بنجاح')
    onSaved()
  }

  const availableUnits = useCallback((productId: string): UnitType[] => {
    const product = products.find(p => p.id === productId)
    if (!product) return ['piece', 'dozen', 'carton'] as UnitType[]
    return product.unitPrices.map(u => u.unitType)
  }, [products])

  return (
    <div className="space-y-4 pb-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">تحرير الطلب</h1>
        </div>
      </div>

      {!showProductSearch ? (
        <div className="space-y-3">
          <button
            onClick={() => setShowProductSearch(true)}
            className="w-full bg-accent text-white text-xs py-2.5 rounded-lg active:opacity-90"
          >
            + إضافة منتجات
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowProductSearch(false)} className="text-xs text-primary font-semibold">&rarr; رجوع</button>
            <span className="text-xs text-text-secondary">إضافة منتجات</span>
          </div>
          {!selectedCompanyId ? (
            <>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ابحث عن شركة أو منتج..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
              />
              <div className="grid grid-cols-2 gap-3">
                {companies.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCompanyId(c.id); setSearchQuery('') }}
                    className="bg-white rounded-xl border border-border p-3 flex flex-col items-center gap-2 active:bg-surface transition-colors"
                  >
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-14 h-14 rounded-xl object-contain" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-primary/5 flex items-center justify-center">
                        <span className="text-xl font-bold text-primary">{c.company_name?.charAt(0)}</span>
                      </div>
                    )}
                    <span className="text-xs font-semibold text-text text-center leading-tight">{c.company_name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => { setSelectedCompanyId(null); setSearchQuery('') }}
                className="flex items-center gap-1 text-xs text-primary font-semibold"
              >
                <span>&rarr;</span> جميع الشركات
              </button>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text placeholder:text-text-secondary"
              />
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredProducts.map(product => (
                  <div key={product.id} className="bg-white rounded-xl border border-border p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {product.imageUrl && (
                        <img src={product.imageUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text truncate">
                          <SearchHighlight text={product.productName} query={searchQuery} />
                        </p>
                        <p className="text-[10px] text-text-secondary">{product.companyName}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {product.unitPrices.map(up => {
                        const alreadyInCart = items.some(i => i.productId === product.id && i.unitType === up.unitType)
                        return (
                          <button
                            key={up.unitType}
                            onClick={() => handleAddProduct(product, up.unitType, alreadyInCart ? 0 : 1)}
                            className={`text-[10px] px-2 py-1 rounded-lg ${alreadyInCart ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}
                          >
                            {UNIT_LABELS[up.unitType]} {formatCurrencyShort(up.price)}
                            {alreadyInCart ? ' ✓' : ''}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {filteredProducts.length === 0 && !loadingProducts && (
                  <p className="text-center text-sm text-text-secondary py-4">لا توجد منتجات متطابقة</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text">المنتجات ({items.length})</h2>
        {items.map((item, idx) => (
          <div key={`${item.productId}-${item.unitType}-${idx}`} className="bg-white rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              {item.imageUrl && (
                <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-text truncate">{item.productName}</p>
                <p className="text-[10px] text-text-secondary">{item.companyName}</p>
              </div>
              <button
                onClick={() => handleRemoveItem(item.productId, item.unitType)}
                className="text-[10px] text-danger shrink-0"
              >
                حذف الصنف
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                <button onClick={() => handleUpdateQty(item.productId, item.unitType, -1)}
                  className="w-6 h-6 rounded-full bg-surface text-text-secondary text-xs flex items-center justify-center active:bg-border">−</button>
                <span className="text-xs font-semibold text-text min-w-[20px] text-center">{item.unitQuantity}</span>
                <button onClick={() => handleUpdateQty(item.productId, item.unitType, 1)}
                  className="w-6 h-6 rounded-full bg-surface text-text-secondary text-xs flex items-center justify-center active:bg-border">+</button>
                <select
                  value={item.unitType}
                  onChange={e => handleUpdateUnit(item.productId, item.unitType, e.target.value as UnitType)}
                  className="text-[10px] border border-border rounded px-1 py-0.5 bg-white text-text mr-1"
                >
                  {availableUnits(item.productId).map(u => (
                    <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-left">
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={e => handleUpdatePrice(item.productId, item.unitType, Number(e.target.value))}
                    className="w-16 text-xs border border-border rounded px-1 py-0.5 text-left"
                    step="0.01"
                    min="0"
                  />
                  <p className="text-[9px] text-text-secondary text-left">{formatCurrencyShort(item.totalPrice)}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

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

      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="ملاحظات (اختياري)..."
        rows={2}
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary resize-none"
      />

      <div className="bg-white rounded-xl border border-border p-3">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">عدد الأصناف</span>
          <span className="font-semibold">{items.length}</span>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-text-secondary">الإجمالي</span>
          <span className="font-semibold text-primary">{formatCurrencyShort(subtotal)}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={submitting || items.length === 0}
          className="flex-1 bg-accent text-white text-sm py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed active:opacity-90 transition-colors"
        >
          {submitting ? 'جارِ حفظ التغييرات...' : 'حفظ التغييرات'}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 bg-white text-primary text-sm py-3 rounded-lg border border-primary active:bg-surface transition-colors"
        >
          إلغاء
        </button>
      </div>

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-2xl p-6 text-center shadow-xl max-w-[240px]">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-text-secondary font-medium">جارِ حفظ التغييرات...</p>
          </div>
        </div>
      )}
    </div>
  )
}
