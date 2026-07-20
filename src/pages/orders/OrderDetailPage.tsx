import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { OrderDetailView } from '../../components/orders/OrderDetailView'
import { OrderStatusManager } from '../../components/orders/OrderStatusManager'
import { useCapability } from '../../hooks/useCapability'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import { formatCurrencyShort } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import { computeProductPrices, computePieceQuantity } from '../../engine/pricing'
import { buildSearchIndex, searchProducts } from '../../utils/smartSearch'
import { SearchHighlight } from '../../components/shared/SearchHighlight'
import toast from 'react-hot-toast'
import type { UnifiedOrder, UnifiedOrderItem } from '../../types/unified-order'
import type { ProductWithPrice, ProductUnitPrice, UnitType } from '../../types/storefront'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function isSupremeManagementUser(): boolean {
  const user = useAuthStore.getState().user
  if (!user?.roles) return false
  return user.roles.some((r: any) => {
    const name = typeof r === 'string' ? r : r?.name
    return name === 'الإدارة العليا'
  })
}

function mapProduct(row: any): ProductWithPrice {
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const piecePrice = Number(row.piece_price) || 0
  const dozenPrice = Number(row.dozen_price) || 0
  const activeUnits = (row.product_units ?? []).filter((u: any) => u.is_active !== false)
  const activeUnitTypes = activeUnits.map((u: any) => u.unit_type)
  const unitPrices: ProductUnitPrice[] = [
    { unitType: 'piece', price: piecePrice },
    { unitType: 'dozen', price: dozenPrice },
    { unitType: 'carton', price: cartonPrice },
  ]
  return {
    id: row.id,
    productName: row.product_name,
    legacyCode: row.legacy_code,
    cartonPrice,
    cartonQuantity,
    piecePrice,
    dozenPrice,
    isActive: row.is_active ?? true,
    salesBlocked: unitPrices.length === 0,
    outOfStock: row.is_out_of_stock === true && row.is_active !== false,
    imageUrl: row.image_url || undefined,
    companyId: row.company_id,
    companyName: row.company_name ?? '',
    unitPrices,
    availableUnitTypes: activeUnitTypes,
  }
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [data, setData] = useState<UnifiedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canReview = useCapability('orders.review')
  const canCompletePreparation = useCapability('warehouse.complete_preparation')
  const canSendToDelivery = useCapability('transportation.send_to_delivery')
  const canManage = useCapability('orders.manage')

  const isSupreme = isSupremeManagementUser()

  const [editItems, setEditItems] = useState<UnifiedOrderItem[]>([])
  const [editNotes, setEditNotes] = useState<string>('')
  const [editOrderType, setEditOrderType] = useState<string>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [products, setProducts] = useState<ProductWithPrice[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [showProductSearch, setShowProductSearch] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  function loadOrder() {
    if (!id) return
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }

    supabase.rpc('get_unified_order', { p_token: token, p_id: id }).then((res) => {
      if (res.error || !res.data) { setLoading(false); return }
      const raw = res.data
      if (raw?.error) { setLoading(false); return }
      setData(raw as UnifiedOrder)
      setLoading(false)
    })
  }

  useEffect(() => { loadOrder() }, [id])

  useEffect(() => {
    if (!editMode || !id) return
    const token = getToken()
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
    })
  }, [editMode, id])

  function handleStatusSuccess(newStatus: string) {
    toast.success(`تم تغيير الحالة إلى ${newStatus}`)
    loadOrder()
  }

  function handleStatusError(error: string) {
    toast.error(error)
  }

  function handleEditSaved() {
    setEditMode(false)
    setShowProductSearch(false)
    setSelectedCompanyId(null)
    setSearchQuery('')
    loadOrder()
  }

  function handleDeleteOrder() {
    if (!id) return
    setDeleting(true)
    const token = getToken()
    if (!token) { setDeleting(false); return }

    supabase.rpc('governed_supreme_delete_cancelled_order', {
      p_token: token,
      p_order_id: id,
      p_reason: 'حذف بواسطة الإدارة العليا',
    }).then(({ data, error }) => {
      setDeleting(false)
      if (error) { toast.error('فشل حذف الطلب: ' + error.message); return }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        toast.error(String((data as any).detail || (data as any).error)); return
      }
      toast.success('تم حذف الطلب نهائياً')
      navigate('/orders')
    })
  }

  function startEdit() {
    if (!data) return
    setEditItems(data.items.map(i => ({ ...i })))
    setEditNotes(data.order.notes || '')
    setEditOrderType((data.order as any).order_type || 'cash')
    setEditMode(true)
  }

  const handleQuantityChange = useCallback((productId: string, unitType: string, newQty: number) => {
    setEditItems(prev => prev.map(i => {
      if (i.product_id !== productId || i.unit_type !== unitType) return i
      const qty = Math.max(1, newQty)
      const total = (i.total_price / i.unit_quantity) * qty
      const pieces = Math.round((i.piece_quantity / i.unit_quantity) * qty)
      return { ...i, unit_quantity: qty, total_price: Math.round(total * 100) / 100, piece_quantity: pieces }
    }))
  }, [])

  const handleRemoveItem = useCallback((productId: string, unitType: string) => {
    setEditItems(prev => prev.filter(i => !(i.product_id === productId && i.unit_type === unitType)))
  }, [])

  const handlePriceChange = useCallback((productId: string, unitType: string, newPrice: number) => {
    setEditItems(prev => prev.map(i => {
      if (i.product_id !== productId || i.unit_type !== unitType) return i
      const total = newPrice * i.unit_quantity
      return { ...i, unit_price: newPrice, total_price: Math.round(total * 100) / 100 }
    }))
  }, [])

  const handleAddProduct = useCallback((product: ProductWithPrice, unitType: UnitType, quantity: number) => {
    setEditItems(prev => {
      const existing = prev.find(i => i.product_id === product.id && i.unit_type === unitType)
      const pieceQuantity = computePieceQuantity(quantity, unitType, product.cartonQuantity)
      const prices = computeProductPrices(product, null)
      const unitPrice = unitType === 'piece' ? prices.piecePrice : unitType === 'dozen' ? prices.dozenPrice : prices.cartonPrice
      const totalPrice = Math.round(unitPrice * quantity * 100) / 100
      if (existing) {
        return prev.map(i =>
          i.product_id === product.id && i.unit_type === unitType
            ? { ...i, unit_quantity: i.unit_quantity + quantity, piece_quantity: i.piece_quantity + pieceQuantity, total_price: i.total_price + totalPrice }
            : i
        )
      }
      const newItem: UnifiedOrderItem = {
        id: '',
        product_id: product.id,
        product_name: product.productName,
        legacy_code: product.legacyCode || null,
        image_url: product.imageUrl || null,
        company_id: product.companyId || null,
        company_name: product.companyName,
        unit_type: unitType,
        unit_quantity: quantity,
        piece_quantity: pieceQuantity,
        unit_price: unitPrice,
        total_price: totalPrice,
      }
      return [...prev, newItem]
    })
    setShowProductSearch(false)
    toast.success('تمت إضافة المنتج')
  }, [])

  const handleSave = async () => {
    if (!id) return
    const token = getToken()
    if (!token) return
    if (editItems.length === 0) { toast.error('يجب إضافة منتج واحد على الأقل'); return }
    setSubmitting(true)

    const payload = editItems.map(i => ({
      product_id: i.product_id,
      unit_type: i.unit_type,
      unit_quantity: i.unit_quantity,
      piece_quantity: i.piece_quantity,
      unit_price: Math.round(i.unit_price * 100) / 100,
      total_price: Math.round(i.total_price * 100) / 100,
    }))

    const { data: result, error } = await supabase.rpc('governed_supreme_edit_order', {
      p_token: token,
      p_order_id: id,
      p_items: payload,
      p_notes: editNotes || null,
      p_discount_amount: null,
      p_reason: 'تعديل بواسطة الإدارة العليا',
      p_order_type: editOrderType,
    })

    setSubmitting(false)
    if (error) { toast.error('فشل حفظ التعديلات: ' + error.message); return }
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      toast.error(String((result as any).detail || (result as any).error)); return
    }
    toast.success('تم حفظ التعديلات بنجاح')
    handleEditSaved()
  }

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

  const editTotal = useMemo(() => editItems.reduce((s, i) => s + i.total_price, 0), [editItems])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">الطلب غير موجود</div>

  const canEdit = data.order.status === 'returned_for_revision' || (data.order.status === 'draft' && (data.order.revision_number || 0) >= 1)
  const isCancelled = data.order.status === 'cancelled'

  if (editMode && showProductSearch) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 pb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#111827]">إضافة منتجات</h3>
            <button onClick={() => setShowProductSearch(false)} className="text-xs text-primary font-semibold">&larr; رجوع</button>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ابحث عن شركة أو منتج..."
            className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm bg-white text-[#111827] placeholder:text-[#9CA3AF]"
          />
          {!selectedCompanyId ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {companies
                .filter(c => searchQuery ? c.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) : true)
                .map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCompanyId(c.id); setSearchQuery('') }}
                  className="bg-white rounded-xl border border-[#E5E7EB] p-4 flex flex-col items-center gap-2 active:bg-[#F9FAFB] transition-colors"
                >
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-16 h-16 rounded-xl object-contain" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-primary/5 flex items-center justify-center">
                      <span className="text-2xl font-bold text-primary">{c.company_name?.charAt(0)}</span>
                    </div>
                  )}
                  <span className="text-xs font-semibold text-[#111827] text-center leading-tight">{c.company_name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredProducts.map(product => (
                <div key={product.id} className="bg-white rounded-xl border border-[#E5E7EB] p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {product.imageUrl && (
                      <img src={product.imageUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-[#F9FAFB] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#111827] truncate">
                        <SearchHighlight text={product.productName} query={searchQuery} />
                      </p>
                      <p className="text-[10px] text-[#6B7280]">{product.companyName}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {product.unitPrices.map(up => {
                      const alreadyInCart = editItems.some(i => i.product_id === product.id && i.unit_type === up.unitType)
                      return (
                        <button
                          key={up.unitType}
                          onClick={() => handleAddProduct(product, up.unitType, alreadyInCart ? 0 : 1)}
                          className={`text-[10px] px-2 py-1 rounded-lg ${alreadyInCart ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#EFF6FF] text-[#2563EB]'}`}
                        >
                          {UNIT_LABELS[up.unitType]} {formatCurrencyShort(up.price)}
                          {alreadyInCart ? ' ✓' : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredProducts.length === 0 && !searchQuery && (
                <p className="text-center text-sm text-[#6B7280] py-4">اختر شركة لعرض المنتجات</p>
              )}
              {filteredProducts.length === 0 && searchQuery && (
                <p className="text-center text-sm text-[#6B7280] py-4">لا توجد منتجات متطابقة</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (editMode) {
    return (
      <OrderDetailView
        data={data}
        onBack={() => navigate('/orders')}
        editMode={true}
        editItems={editItems}
        onQuantityChange={handleQuantityChange}
        onRemoveItem={handleRemoveItem}
        onPriceChange={handlePriceChange}
        onAddProduct={() => { setShowProductSearch(true); setSelectedCompanyId(null); setSearchQuery('') }}
        editActions={
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-3">
              <h3 className="text-sm font-semibold text-[#111827] mb-2">نوع الطلب</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditOrderType('cash')}
                  className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${editOrderType === 'cash' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-[#6B7280] border-[#E5E7EB]'}`}
                >
                  نقدي
                </button>
                <button
                  onClick={() => setEditOrderType('credit')}
                  className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${editOrderType === 'credit' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-[#6B7280] border-[#E5E7EB]'}`}
                >
                  آجل
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-xs text-[#6B7280]">
                <span className="font-semibold text-[#111827]">{editItems.length}</span> صنف · <span className="font-semibold text-[#059669]">{formatCurrencyShort(editTotal)}</span>
              </div>
              <button
                onClick={() => { setEditMode(false); setShowProductSearch(false); }}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleSave}
                disabled={submitting || editItems.length === 0}
                className="px-5 py-2 text-xs font-semibold text-white bg-accent rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'جارِ الحفظ...' : 'حفظ التغييرات'}
              </button>
            </div>
          </div>
        }
      />
    )
  }

  return (
    <OrderDetailView
      data={data}
      onBack={() => navigate('/orders')}
      actions={
        <div className="flex items-stretch gap-2 flex-wrap">
          {canEdit && (
            <button onClick={() => navigate(`/storefront/products?editOrder=${id}`)}
              className="inline-flex items-center gap-1 bg-accent text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 shrink-0">
              تعديل الطلب
            </button>
          )}
          {isSupreme && (
            <button onClick={startEdit}
              className="inline-flex items-center gap-1 bg-accent text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 shrink-0">
              تحرير الطلب
            </button>
          )}
          {isSupreme && isCancelled && !deleteConfirm && (
            <button onClick={() => setDeleteConfirm(true)}
              className="inline-flex items-center gap-1 bg-danger text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 shrink-0">
              حذف الطلب
            </button>
          )}
          {isSupreme && isCancelled && deleteConfirm && (
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-text-secondary shrink-0">حذف نهائياً؟</p>
              <button onClick={handleDeleteOrder} disabled={deleting}
                className="bg-danger text-white text-xs px-3 py-2 rounded-lg active:opacity-90 disabled:opacity-40">
                {deleting ? 'جاري...' : 'تأكيد'}
              </button>
              <button onClick={() => setDeleteConfirm(false)}
                className="bg-surface text-text-secondary text-xs px-3 py-2 rounded-lg active:opacity-90">
                إلغاء
              </button>
            </div>
          )}
          {data?.order?.status && (
            <OrderStatusManager
              orderId={data!.order.id}
              currentStatus={data!.order.status}
              canReview={canReview}
              canCompletePreparation={canCompletePreparation}
              canSendToDelivery={canSendToDelivery}
              canManage={canManage}
              onSuccess={handleStatusSuccess}
              onError={handleStatusError}
            />
          )}
        </div>
      }
    />
  )
}
