import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, X, Loader2, AlertTriangle, Trash2, Power, Image, Upload, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { useAuthStore } from '../../store/auth'
import { isExecutiveDirectorUser } from '../../utils/roleNormalization'
import { ProductCard } from '../../components/products/ProductCard'
import { formatCurrencyShort, toEnglishDigits } from '../../utils/format'
import { UNIT_LABELS } from '../../types/order-display'
import { buildSearchIndex, searchProducts } from '../../utils/smartSearch'
import { SearchHighlight } from '../../components/shared/SearchHighlight'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import toast from 'react-hot-toast'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useCatalogStore } from '../../store/catalog'
import { useCartStore } from '../../store/cart'
import { toProductWithPrice } from '../../utils/catalog'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const DEDUCTION_STATUS_LABELS: Record<string, string> = {
  submitted: 'عند التسليم (مقدم)',
  reviewing: 'عند المراجعة',
  approved: 'عند الاعتماد (معتمد)',
  preparing: 'عند التجهيز',
  prepared: 'بعد التجهيز',
  ready_for_dispatch: 'عند التسليم للشحن',
  sent_to_delivery: 'عند الإرسال للتوصيل',
  dispatched: 'عند الشحن',
  delivered: 'عند التسليم',
}

// =============================================================================
// ProductManagerPage — Full product management dashboard
// =============================================================================
export function ProductManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('products.manage') && !isExecutiveDirectorUser(useAuthStore.getState().user)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editImageInputRef = useRef<HTMLInputElement>(null)

  // ── Data ──
  const products = useCatalogStore((s) => s.products)
  const [companies, setCompanies] = useState<any[]>([])
  const [allTiers, setAllTiers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Global Inventory Policies ──
  const [globalPolicies, setGlobalPolicies] = useState<{ negative_selling_allowed: boolean; inventory_deduction_status: string }>({
    negative_selling_allowed: true,
    inventory_deduction_status: 'approved',
  })
  const [scopeDialogTarget, setScopeDialogTarget] = useState<'negative_selling' | 'deduction_status' | null>(null)
  const [pendingPolicyValue, setPendingPolicyValue] = useState<any>(null)
  const [policySaving, setPolicySaving] = useState(false)
  const [inventorySettingsOpen, setInventorySettingsOpen] = useState(false)

  // ── Filters ──
  const [viewState, setViewState, resetViewState] = usePersistentViewState('products-manage', {
    searchQuery: '',
    companyFilter: '',
    statusFilter: 'all' as 'all' | 'active' | 'out_of_stock' | 'inactive' | 'no_price',
  })
  const { searchQuery, companyFilter, statusFilter } = viewState
  const [searchInput, setSearchInput] = useState(searchQuery)

  // Debounce search: sync searchInput to viewState after 200ms of no typing
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setViewState({ searchQuery: searchInput })
    }, 200)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchInput])

  // Derived company names (from products list)
  const companyNames = useMemo(() => {
    return Array.from(new Set(products.map((p: any) => p.company_name))).sort()
  }, [products])

  // Filtered products
  const searchIndices = useMemo(() => {
    return products.map((p: any) => ({
      id: p.id,
      product: p,
      index: buildSearchIndex({
        id: p.id,
        legacyCode: p.legacy_code,
        productName: p.product_name,
        companyName: p.company_name,
      }),
    }))
  }, [products])

  const filtered = useMemo(() => {
    let list = products
    if (statusFilter === 'active') list = list.filter((p: any) => p.is_active && !(p.is_out_of_stock === true))
    if (statusFilter === 'out_of_stock') list = list.filter((p: any) => p.is_out_of_stock === true && p.is_active !== false)
    if (statusFilter === 'inactive') list = list.filter((p: any) => (!p.is_active || !p.is_visible) && (p.carton_price && Number(p.carton_price) > 0))
    if (statusFilter === 'no_price') list = list.filter((p: any) => !p.carton_price || Number(p.carton_price) <= 0)
    if (companyFilter) list = list.filter((p: any) => p.company_name === companyFilter)
    const q = searchQuery.trim()
    if (q) {
      const filteredIds = new Set(list.map((p: any) => p.id))
      const indices = searchIndices.filter((si) => filteredIds.has(si.product.id))
      list = searchProducts(q, indices, (si) => si.index).map((si) => si.product)
    } else {
      list = [...list].sort((a: any, b: any) => (a.product_name || '').localeCompare(b.product_name || ''))
    }
    return list
  }, [products, searchQuery, companyFilter, statusFilter, searchIndices])

  // ── Load data ──
  async function loadData() {
    const token = getToken()
    if (!token) { setLoading(false); return }
    const [prodRes, compRes, tiersRes, policyRes] = await Promise.all([
      supabase.rpc('get_governed_products', { p_token: token, p_active_only: false, p_visible_only: false }),
      supabase.rpc('get_governed_companies', { p_token: token }),
      supabase.rpc('get_governed_tiers', { p_token: token }),
      supabase.rpc('get_inventory_policies', { p_token: token }),
    ])
    if (prodRes.data) useCatalogStore.getState().setProducts(Array.isArray(prodRes.data) ? prodRes.data : [])
    if (compRes.data) setCompanies(Array.isArray(compRes.data) ? compRes.data : [])
    if (tiersRes.data) setAllTiers(Array.isArray(tiersRes.data) ? tiersRes.data : [])
    if (policyRes.data && !policyRes.error) setGlobalPolicies(policyRes.data)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  // ── Global Policy Change Handlers ──
  function handleNegativeSellingChange(newValue: boolean) {
    if (newValue === globalPolicies.negative_selling_allowed) return
    setPendingPolicyValue(newValue)
    setScopeDialogTarget('negative_selling')
  }

  function handleDeductionStatusChange(newValue: string) {
    if (newValue === globalPolicies.inventory_deduction_status) return
    setPendingPolicyValue(newValue)
    setScopeDialogTarget('deduction_status')
  }

  async function confirmPolicyChange(scope: 'new_orders' | 'previous_and_new') {
    if (!scopeDialogTarget || pendingPolicyValue === null) return
    setPolicySaving(true)
    const token = getToken()
    if (!token) { setPolicySaving(false); return }
    try {
      if (scopeDialogTarget === 'negative_selling') {
        const { data, error } = await supabase.rpc('set_global_negative_selling_policy', {
          p_token: token, p_value: pendingPolicyValue, p_scope: scope,
        })
        if (error) { toast.error(error.message); setPolicySaving(false); return }
        const result = data as any
        if (result?.error) { toast.error(result.error); setPolicySaving(false); return }
        setGlobalPolicies(prev => ({ ...prev, negative_selling_allowed: pendingPolicyValue }))
        if (result?.moved_to_stock_review > 0) {
          toast.success(`تم تغيير السياسة. تم نقل ${result.moved_to_stock_review} طلب لمراجعة المخزون`)
        } else {
          toast.success('تم تغيير سياسة البيع بالسالب')
        }
      } else {
        const { data, error } = await supabase.rpc('set_global_inventory_deduction_status', {
          p_token: token, p_value: pendingPolicyValue, p_scope: scope,
        })
        if (error) { toast.error(error.message); setPolicySaving(false); return }
        const result = data as any
        if (result?.error) { toast.error(result.error); setPolicySaving(false); return }
        setGlobalPolicies(prev => ({ ...prev, inventory_deduction_status: pendingPolicyValue }))
        toast.success('تم تغيير حالة خصم المخزون')
      }
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setPolicySaving(false)
    setScopeDialogTarget(null)
    setPendingPolicyValue(null)
  }

  // ── Toggle active ──
  const handleToggleActive = useCallback(async (product: any) => {
    const token = getToken()
    if (!token) return
    const isOutOfStock = product.is_out_of_stock === true && product.is_active !== false
    let newState: Partial<any> = {}
    if (product.is_active && !isOutOfStock) {
      const { error } = await supabase.rpc('governed_set_product_out_of_stock', { p_token: token, p_id: product.id, p_is_out_of_stock: true })
      if (error) { toast.error(error.message); return }
      newState = { is_out_of_stock: true, is_active: true }
      toast.success('تم تعيين المنتج كمنتهي الكمية')
    } else if (isOutOfStock) {
      const { error } = await supabase.rpc('governed_set_product_out_of_stock', { p_token: token, p_id: product.id, p_is_out_of_stock: false })
      if (error) { toast.error(error.message); return }
      newState = { is_out_of_stock: false, is_active: true }
      toast.success('تم تفعيل المنتج')
    } else {
      const { error } = await supabase.rpc('governed_activate_product', { p_token: token, p_id: product.id })
      if (error) { toast.error(error.message); return }
      newState = { is_out_of_stock: false, is_active: true }
      toast.success('تم تفعيل المنتج')
    }
    useCatalogStore.getState().updateProduct(product.id, newState)
    const updatedRow = useCatalogStore.getState().products.find((p: any) => p.id === product.id)
    if (updatedRow) useCartStore.getState().syncProduct(toProductWithPrice(updatedRow))
  }, [])

  // ── Hard delete ──
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [deletePreview, setDeletePreview] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDeletePreview = useCallback(async (product: any) => {
    const token = getToken()
    if (!token) return
    setDeleteTarget(product)
    setDeletePreview(null)
    const { data, error } = await supabase.rpc('governed_deletion_execute_products', {
      p_token: token,
      p_ids: [product.id],
      p_dry_run: true,
    })
    if (error) { toast.error(error.message); setDeleteTarget(null); return }
    const result = data as any
    if (result?.error === 'FORBIDDEN') { toast.error('ليس لديك صلاحية حذف المنتجات'); setDeleteTarget(null); return }
    if (result?.error) { toast.error(result.error); setDeleteTarget(null); return }
    setDeletePreview(result as any)
  }, [])

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    const token = getToken()
    if (!token) { setDeleting(false); return }
    const { data, error } = await supabase.rpc('governed_deletion_execute_products', {
      p_token: token,
      p_ids: [deleteTarget.id],
      p_dry_run: false,
    })
    if (error) { toast.error(error.message); setDeleting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setDeleting(false); return }
    toast.success('تم حذف المنتج نهائياً')
    useCatalogStore.getState().removeProduct(deleteTarget.id)
    setDeleteTarget(null)
    setDeletePreview(null)
    setDeleting(false)
  }

  // ── Add product ──
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCode, setAddCode] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addCompanyId, setAddCompanyId] = useState('')
  const [addCartonQty, setAddCartonQty] = useState('')
  const [addCartonPrice, setAddCartonPrice] = useState('')
  const [addUnits, setAddUnits] = useState<string[]>(['piece', 'dozen', 'carton'])
  const [addImageUrl, setAddImageUrl] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)

  function resetAddForm() {
    setAddName(''); setAddCode(''); setAddDesc(''); setAddCompanyId('')
    setAddCartonQty(''); setAddCartonPrice(''); setAddUnits(['piece', 'dozen', 'carton'])
    setAddImageUrl('')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName || !addCode || !addCompanyId) { toast.error('الاسم والكود والشركة مطلوبون'); return }
    setAddSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_product', {
      p_token: token,
      p_company_id: addCompanyId,
      p_product_name: addName,
      p_legacy_code: addCode,
      p_description: addDesc || null,
      p_carton_quantity: addCartonQty ? parseInt(addCartonQty) : null,
      p_carton_price: addCartonPrice ? parseFloat(addCartonPrice) : null,
      p_units: addUnits,
      p_image_url: addImageUrl || null,
    })
    if (error) { toast.error(error.message); setAddSubmitting(false); return }
    const result = data as any
    if (result?.error) { toast.error(result.error); setAddSubmitting(false); return }
    toast.success('تم إضافة المنتج')
    setShowAdd(false)
    resetAddForm()
    setAddSubmitting(false)
    await loadData()
  }

  function handleAddImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setAddImageUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ── Edit product ──
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({
    product_name: '', legacy_code: '', description: '', company_id: '',
    image_url: '',
    inventory_cartons: '', inventory_remainder: '',
    carton_quantity: '', carton_price: '',
    units: ['piece', 'dozen', 'carton'], is_active: true, is_out_of_stock: false,
  })
  const [editTierDiscounts, setEditTierDiscounts] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [discountsOpen, setDiscountsOpen] = useState(false)

  const openEdit = useCallback((product: any) => {
    const currentStock = product.inventory?.quantity ?? ''
    const cartonQty = Number(product.carton_quantity) || 0
    setEditTarget(product)
    setEditForm({
      product_name: product.product_name || '',
      legacy_code: product.legacy_code || '',
      description: product.description || '',
      company_id: product.company_id || '',
      image_url: product.image_url || '',
      inventory_cartons: cartonQty > 0 && Number(currentStock) >= 0 ? String(Math.floor(Number(currentStock) / cartonQty)) : '',
      inventory_remainder: cartonQty > 0 && Number(currentStock) >= 0 ? String(Number(currentStock) % cartonQty) : '',
      carton_quantity: String(product.carton_quantity ?? ''),
      carton_price: String(product.carton_price ?? ''),
      units: (product.product_units || []).filter((u: any) => u.is_active !== false).map((u: any) => u.unit_type),
      is_active: product.is_active !== false,
      is_out_of_stock: product.is_out_of_stock === true && product.is_active !== false,
    })
    // Build tier discounts from product exceptions
    const discounts: Record<string, string> = {}
    for (const tier of allTiers) {
      const exs = (tier.product_exceptions || []).filter(
        (ex: any) => ex.product_id === product.id && ex.applies_to_all_tiers === false
      )
      if (exs.length > 0) discounts[tier.id] = String(exs[0].discount_percent)
    }
    setEditTierDiscounts(discounts)
  }, [allTiers])

  const handleViewDetails = useCallback((product: any) => {
    nav(`/products/${product.id}`)
  }, [nav])

  const computedPiecePrice = editForm.carton_quantity && editForm.carton_price
    ? parseFloat(editForm.carton_price) / parseInt(editForm.carton_quantity)
    : null
  const computedDozenPrice = computedPiecePrice !== null ? computedPiecePrice * 12 : null

  // ── Smart inventory input: cartons + remainder → auto total pieces ──
  const invCartonQty = parseInt(editForm.carton_quantity) || 0
  const invCartons = parseInt(editForm.inventory_cartons) || 0
  const invRemainder = parseInt(editForm.inventory_remainder) || 0
  const hasStockInput = (editForm.inventory_cartons ?? '') !== '' || (editForm.inventory_remainder ?? '') !== ''
  const stockTotal: number | null = hasStockInput ? invCartons * invCartonQty + invRemainder : null
  const stockError: string | null = !hasStockInput ? null
    : invCartons > 0 && invCartonQty <= 0
      ? 'حدد عدد القطع في الكرتونة أولاً'
      : null
  const totalCartons = stockTotal !== null && invCartonQty > 0 ? Math.trunc(stockTotal / invCartonQty) : 0
  const totalCartonRemainder = stockTotal !== null && invCartonQty > 0 ? stockTotal % invCartonQty : 0

  function handleEditImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setEditForm((p: any) => ({ ...p, image_url: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  async function handleEditSave() {
    if (!editTarget) return
    setEditSaving(true)
    const token = getToken()
    if (!token) { setEditSaving(false); return }

    // Governed RPCs return business failures inside data.error (jsonb) while the
    // supabase-level error stays null — check both before claiming success.
    const rpcError = (res: any): string | null => {
      if (res?.error) return res.error.message || String(res.error)
      const d = res?.data
      if (d && typeof d === 'object' && d.error) return String(d.error)
      return null
    }

    // Empty numeric inputs commit as 0 (cleared); invalid text is rejected.
    const parseNumberOrFail = (v: string, label: string): number | null => {
      if (v === undefined || v === null || v.trim() === '') return 0
      const n = Number(v)
      if (Number.isNaN(n)) { toast.error(`${label} يجب أن يكون رقماً`); return null }
      return n
    }

    const cartonPriceNum = parseNumberOrFail(editForm.carton_price, 'سعر الكرتونة')
    if (cartonPriceNum === null) { setEditSaving(false); return }
    const cartonQtyNum = parseNumberOrFail(editForm.carton_quantity, 'عدد القطع في الكرتونة')
    if (cartonQtyNum === null) { setEditSaving(false); return }

    try {
      // Steps 1-6 are independent column updates — run in parallel
      const promises: Promise<any>[] = []

      // 1. Update basic fields
      promises.push(
        supabase.rpc('governed_update_product', {
          p_token: token, p_id: editTarget.id,
          p_product_name: editForm.product_name,
          p_legacy_code: editForm.legacy_code,
          p_description: editForm.description,
          p_image_url: editForm.image_url,
        })
      )

      // 2. Change company if different
      if (editForm.company_id && editForm.company_id !== editTarget.company_id) {
        promises.push(
          supabase.rpc('governed_change_product_company', {
            p_token: token, p_product_id: editTarget.id, p_new_company_id: editForm.company_id,
          })
        )
      }

      // 3. Update pricing
      promises.push(
        supabase.rpc('governed_update_product_pricing', {
          p_token: token, p_id: editTarget.id,
          p_carton_price: cartonPriceNum,
          p_carton_quantity: cartonQtyNum,
        })
      )

      // 4. Update units
      promises.push(
        supabase.rpc('governed_update_product_units', {
          p_token: token, p_id: editTarget.id,
          p_units: editForm.units.map((u: string) => ({ unit_type: u })),
        })
      )

      // 5. Update visibility
      promises.push(
        supabase.rpc('governed_update_product_visibility', {
          p_token: token, p_id: editTarget.id, p_is_visible: editForm.is_active,
        })
      )

      // 6. Update inventory using governed_set_product_stock (SET/REPLACE, pieces only)
      if (hasStockInput) {
        if (stockError) {
          toast.error(stockError)
          setEditSaving(false)
          return
        }
        if (stockTotal !== null) {
          promises.push(
            supabase.rpc('governed_set_product_stock', {
              p_token: token, p_product_id: editTarget.id,
              p_quantity: stockTotal, p_unit: 'piece',
            })
          )
        }
      }

      const results = await Promise.all(promises)
      const failed = results.map(rpcError).find(Boolean)
      if (failed) { toast.error(failed); setEditSaving(false); return }

      // 7. Handle status changes (3-state) — must run after basic updates
      const wasOutOfStock = editTarget.is_out_of_stock === true && editTarget.is_active !== false
      let statusErr: string | null = null
      if (editForm.is_active && editForm.is_out_of_stock && !wasOutOfStock) {
        if (!editTarget.is_active) {
          statusErr = rpcError(await supabase.rpc('governed_activate_product', { p_token: token, p_id: editTarget.id }))
          if (statusErr) { toast.error(statusErr); setEditSaving(false); return }
        }
        statusErr = rpcError(await supabase.rpc('governed_set_product_out_of_stock', { p_token: token, p_id: editTarget.id, p_is_out_of_stock: true }))
        if (statusErr) { toast.error(statusErr); setEditSaving(false); return }
      } else if (editForm.is_active && !editForm.is_out_of_stock && (wasOutOfStock || !editTarget.is_active)) {
        statusErr = rpcError(await supabase.rpc('governed_activate_product', { p_token: token, p_id: editTarget.id }))
        if (statusErr) { toast.error(statusErr); setEditSaving(false); return }
      } else if (!editForm.is_active && editTarget.is_active) {
        statusErr = rpcError(await supabase.rpc('governed_deactivate_product', { p_token: token, p_id: editTarget.id }))
        if (statusErr) { toast.error(statusErr); setEditSaving(false); return }
      }

      // 8. Tier discounts — serialize remove→set per tier. The set RPC uses
      // ON CONFLICT DO NOTHING, so running remove+set in parallel could leave the
      // exception removed without being re-added (silent data loss).
      for (const tier of allTiers) {
        const newDiscount = editTierDiscounts[tier.id]
        const existingEx = (tier.product_exceptions || []).find(
          (ex: any) => ex.product_id === editTarget.id && ex.applies_to_all_tiers === false
        )
        const keepExisting = existingEx && parseFloat(newDiscount) === Number(existingEx.discount_percent)
        if (newDiscount === undefined || newDiscount === '' || keepExisting) {
          if (newDiscount === '' && existingEx) {
            const err = rpcError(await supabase.rpc('governed_remove_tier_product_exception', {
              p_token: token, p_exception_id: existingEx.id,
            }))
            if (err) { toast.error(err); setEditSaving(false); return }
          }
          continue
        }
        const parsed = parseFloat(newDiscount)
        if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
        if (existingEx) {
          const err = rpcError(await supabase.rpc('governed_remove_tier_product_exception', {
            p_token: token, p_exception_id: existingEx.id,
          }))
          if (err) { toast.error(err); setEditSaving(false); return }
        }
        const err = rpcError(await supabase.rpc('governed_set_tier_product_exception', {
          p_token: token, p_product_id: editTarget.id,
          p_discount_percent: parsed, p_tier_id: tier.id,
          p_applies_to_all_tiers: false,
        }))
        if (err) { toast.error(err); setEditSaving(false); return }
      }

      // Reload from DB (single source of truth) so the manager list reflects the save
      await loadData()

      // Push the updated product into the shared cart catalog so already-open
      // storefront / cart / order-review / checkout screens update immediately.
      const savedRow = useCatalogStore.getState().products.find((p: any) => p.id === editTarget.id)
      if (savedRow) {
        useCartStore.getState().syncProduct(toProductWithPrice(savedRow))
      }

      toast.success('تم حفظ التغييرات')
      setEditTarget(null)
      setEditSaving(false)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
      setEditSaving(false)
    }
  }

  // ── Render ──
  return (
    <div id="product-manager-page" className="min-h-screen bg-surface pb-24" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary to-primary/80 text-white px-4 py-4 flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-white/80 hover:text-white">&larr;</button>
        <h1 className="text-lg font-bold flex-1">إدارة المنتجات</h1>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-white/20 text-white text-xs px-3 py-2 rounded-full font-semibold hover:bg-white/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            إضافة منتج
          </button>
        )}
      </div>

      {/* ── Global Inventory Settings ── */}
      {canManage && (
        <div className="mx-4 mt-4 bg-white rounded-xl border border-border p-3 space-y-3">
          <button
            type="button"
            onClick={() => setInventorySettingsOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <h3 className="text-xs font-bold text-text">إعدادات المخزون</h3>
            </span>
            <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${inventorySettingsOpen ? 'rotate-180' : ''}`} />
          </button>
          {inventorySettingsOpen && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Negative Selling */}
            <div className="flex items-center justify-between bg-surface rounded-lg px-3 py-2.5">
              <div>
                <span className="text-xs font-semibold text-text block">البيع بالسالب</span>
                <span className="text-[10px] text-text-secondary">
                  {globalPolicies.negative_selling_allowed ? 'مسموح — يمكن للمخزون أن يصبح بالسالب' : 'غير مسموح — لا يجوز تجاوز المخزون المتاح'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleNegativeSellingChange(!globalPolicies.negative_selling_allowed)}
                disabled={policySaving}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${globalPolicies.negative_selling_allowed ? 'bg-success' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${globalPolicies.negative_selling_allowed ? 'right-0.5' : 'right-[22px]'}`} />
              </button>
            </div>
            {/* Deduction Status */}
            <div className="flex items-center justify-between bg-surface rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-text block">خصم المخزون عند</span>
                <span className="text-[10px] text-text-secondary truncate block">
                  {DEDUCTION_STATUS_LABELS[globalPolicies.inventory_deduction_status] || globalPolicies.inventory_deduction_status}
                </span>
              </div>
              <select
                value={globalPolicies.inventory_deduction_status}
                onChange={(e) => handleDeductionStatusChange(e.target.value)}
                disabled={policySaving}
                className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white shrink-0 ml-2"
              >
                <option value="submitted">عند التسليم (مقدم)</option>
                <option value="reviewing">عند المراجعة</option>
                <option value="approved">عند الاعتماد (معتمد)</option>
                <option value="preparing">عند التجهيز</option>
                <option value="prepared">بعد التجهيز</option>
                <option value="ready_for_dispatch">عند التسليم للشحن</option>
                <option value="sent_to_delivery">عند الإرسال للتوصيل</option>
                <option value="dispatched">عند الشحن</option>
                <option value="delivered">عند التسليم</option>
              </select>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      <div className="px-4 py-4 space-y-4">
        {/* ── Filters (always visible) ── */}
        <div className="bg-white rounded-xl border border-border p-3 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="بحث باسم المنتج أو الكود أو الشركة..."
                className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
            <select
              value={statusFilter}
              onChange={(e) => setViewState({ statusFilter: e.target.value as any })}
              className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="out_of_stock">نفذت الكمية</option>
              <option value="inactive">مخفي</option>
              <option value="no_price">موقوف - السعر غير محدد</option>
            </select>
            <select
              value={companyFilter}
              onChange={(e) => setViewState({ companyFilter: e.target.value })}
              className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
            >
              <option value="">كل الشركات</option>
              {companyNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="flex gap-2 text-[11px] text-text-secondary pt-0.5">
            <span>{filtered.length} من {products.length} منتج</span>
            {(searchQuery || companyFilter || statusFilter !== 'all') && (
              <button
                onClick={resetViewState}
                className="text-primary font-semibold"
              >
                إعادة تعيين
              </button>
            )}
          </div>
        </div>

        {/* ── Product Cards Grid ── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-text-secondary">لا توجد منتجات</p>
            {!searchQuery && !companyFilter && statusFilter === 'all' && canManage && (
              <button onClick={() => setShowAdd(true)} className="mt-3 text-xs text-primary font-semibold">
                + إضافة أول منتج
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((product: any) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={openEdit}
                onToggleActive={handleToggleActive}
                onDelete={handleDeletePreview}
                onViewDetails={handleViewDetails}
                searchQuery={searchQuery}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Add Product Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full sm:max-w-lg max-h-[calc(100dvh-6rem)] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-text">إضافة منتج جديد</h3>
              <button onClick={() => { setShowAdd(false); resetAddForm() }} className="text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-3">
              <input
                type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                placeholder="اسم المنتج *" required
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
              />
              <input
                type="text" value={addCode} onChange={(e) => setAddCode(e.target.value)}
                placeholder="الكود القديم *" required dir="ltr"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
              />
              <textarea
                value={addDesc} onChange={(e) => setAddDesc(e.target.value)}
                placeholder="الوصف" rows={2}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface resize-none"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-text-secondary block mb-0.5">صورة المنتج</label>
                  <div className="flex gap-2">
                    <input
                      type="text" value={addImageUrl} onChange={(e) => setAddImageUrl(e.target.value)}
                      placeholder="رابط الصورة..."
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-xs bg-surface" dir="ltr"
                    />
                    <button type="button" onClick={() => imageInputRef.current?.click()}
                      className="px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-surface">
                      <Upload className="w-4 h-4" />
                    </button>
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddImageFile} />
                  </div>
                </div>
              </div>
              {addImageUrl && (
                <div className="relative w-full h-28 rounded-lg overflow-hidden border border-border bg-surface">
                  <img src={addImageUrl} alt="" className="w-full h-full object-contain" />
                  <button type="button" onClick={() => setAddImageUrl('')}
                    className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <SearchableSelect
                items={companies.map((c: any) => ({ id: c.id, name: c.company_name }))}
                value={addCompanyId}
                onChange={setAddCompanyId}
                placeholder="اختر الشركة *"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text" inputMode="numeric" dir="ltr" value={addCartonQty} onChange={(e) => setAddCartonQty(toEnglishDigits(e.target.value))}
                  placeholder="قطع في الكرتونة" className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface text-right"
                />
                <input
                  type="text" inputMode="decimal" dir="ltr" value={addCartonPrice} onChange={(e) => setAddCartonPrice(toEnglishDigits(e.target.value))}
                  placeholder="سعر الكرتونة" className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-surface text-right"
                />
              </div>
              <div>
                <p className="text-xs text-text-secondary mb-1.5">وحدات البيع:</p>
                <div className="flex gap-4">
                  {['piece', 'dozen', 'carton'].map((u) => (
                    <label key={u} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox" checked={addUnits.includes(u)}
                        onChange={() => setAddUnits((prev) => prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u])}
                        className="accent-primary"
                      />
                      <span className={addUnits.includes(u) ? 'font-semibold text-text' : 'text-text-secondary'}>
                        {UNIT_LABELS[u]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={addSubmitting}
                  className="flex-1 bg-primary text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {addSubmitting ? <><Loader2 className="w-4 h-4 animate-spin inline" /> جاري...</> : 'إضافة المنتج'}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); resetAddForm() }}
                  className="px-6 border border-border rounded-lg text-sm text-text-secondary"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Product Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full sm:max-w-2xl max-h-[calc(100dvh-6rem)] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between z-10">
              <h3 className="font-bold text-text">تعديل: {editTarget.product_name}</h3>
              <button onClick={() => setEditTarget(null)} className="text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-5">

              {/* ── Product Information ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">بيانات المنتج</h3>
                <div className="grid grid-cols-10 gap-2">
                  <div className="col-span-6 space-y-1 min-w-0">
                    <label className="block text-xs font-medium text-text-secondary">اسم المنتج</label>
                    <input type="text" value={editForm.product_name}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, product_name: e.target.value }))}
                      readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
                  </div>
                  <div className="col-span-2 space-y-1 min-w-0">
                    <label className="block text-xs font-medium text-text-secondary">الكود القديم</label>
                    <input type="text" value={editForm.legacy_code}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, legacy_code: e.target.value }))}
                      readOnly={!canManage} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir="ltr" />
                  </div>
                  <div className="col-span-2 space-y-1 min-w-0">
                    <label className="block text-xs font-medium text-text-secondary">الشركة</label>
                    <SearchableSelect
                      items={companies.map((c: any) => ({ id: c.id, name: c.company_name }))}
                      value={editForm.company_id}
                      onChange={(val) => setEditForm((p: any) => ({ ...p, company_id: val }))}
                      placeholder="اختر شركة..."
                      disabled={!canManage}
                    />
                  </div>
                </div>
              </section>

              {/* ── Inventory ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">المخزون</h3>

                {/* Cartons + remaining pieces + packaging — total is auto-calculated below */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">عدد الكراتين</span>
                    <input type="text" inputMode="numeric" dir="ltr" value={editForm.inventory_cartons}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, inventory_cartons: toEnglishDigits(e.target.value) }))}
                      readOnly={!canManage} placeholder="0"
                      className="w-full text-sm bg-transparent text-right outline-none placeholder:text-text-secondary/50" />
                  </div>
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">قطع متبقية</span>
                    <input type="text" inputMode="numeric" dir="ltr" value={editForm.inventory_remainder}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, inventory_remainder: toEnglishDigits(e.target.value) }))}
                      readOnly={!canManage} placeholder="0"
                      className="w-full text-sm bg-transparent text-right outline-none placeholder:text-text-secondary/50" />
                  </div>
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">عدد القطع في الكرتونة</span>
                    <input type="text" inputMode="numeric" dir="ltr" value={editForm.carton_quantity}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, carton_quantity: toEnglishDigits(e.target.value) }))}
                      readOnly={!canManage} placeholder="0"
                      className="w-full text-sm bg-transparent text-right outline-none placeholder:text-text-secondary/50" />
                  </div>
                </div>

                {/* Auto-calculated total on one line */}
                {!stockError && stockTotal !== null && (
                  <p className="bg-success/10 border border-success/40 rounded-lg px-3 py-2 text-sm font-semibold text-text leading-snug">
                    الإجمالي: بالقطع = {stockTotal} قطعة - بالكرتونه والقطع = {totalCartons} كرتونة + {totalCartonRemainder} قطعة
                  </p>
                )}

                {/* Validation message */}
                {stockError && (
                  <p className="text-xs font-semibold text-danger">⚠️ {stockError}</p>
                )}
              </section>

              {/* ── Pricing ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">التسعير</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">سعر الكرتونة</span>
                    <input type="text" inputMode="decimal" dir="ltr" value={editForm.carton_price}
                      onChange={(e) => setEditForm((p: any) => ({ ...p, carton_price: toEnglishDigits(e.target.value) }))}
                      readOnly={!canManage} placeholder="0.00"
                      className="w-full text-sm bg-transparent text-right outline-none placeholder:text-text-secondary/50" />
                  </div>
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">سعر القطعة</span>
                    <span className="text-sm font-extrabold text-text">{computedPiecePrice !== null ? formatCurrencyShort(computedPiecePrice) : '—'}</span>
                  </div>
                  <div className="bg-white rounded-lg border border-border p-2 min-w-0 flex flex-col justify-between gap-1">
                    <span className="block text-[10px] font-medium text-text-secondary">سعر الدستة</span>
                    <span className="text-sm font-extrabold text-text">{computedPiecePrice !== null ? formatCurrencyShort(computedDozenPrice!) : '—'}</span>
                  </div>
                </div>
              </section>

              {/* ── Selling Units ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">وحدات البيع النشطة</h3>
                <div className="flex gap-2">
                  {['piece', 'dozen', 'carton'].map((u) => {
                    const checked = editForm.units.includes(u)
                    return (
                      <button key={u} type="button"
                        disabled={!canManage}
                        onClick={() => setEditForm((p: any) => ({
                          ...p, units: p.units.includes(u) ? p.units.filter((x: string) => x !== u) : [...p.units, u]
                        }))}
                        className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                          checked ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:bg-white/60'
                        } disabled:opacity-50`}
                      >
                        {UNIT_LABELS[u]}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ── Product Status ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">حالة المنتج</h3>
                <div className="flex gap-2">
                  {[
                    { value: 'active', label: 'نشط', color: 'text-success border-success/30 bg-success/5' },
                    { value: 'out_of_stock', label: 'نفذت الكمية', color: 'text-warning border-warning/30 bg-warning/5' },
                    { value: 'inactive', label: 'مخفي', color: 'text-danger border-danger/30 bg-danger/5' },
                  ].map((opt) => {
                    const isActive = opt.value === 'active' ? (editForm.is_active && !editForm.is_out_of_stock)
                      : opt.value === 'out_of_stock' ? (editForm.is_active && editForm.is_out_of_stock)
                      : !editForm.is_active
                    return (
                      <button key={opt.value} type="button"
                        disabled={!canManage}
                        onClick={() => {
                          if (opt.value === 'active') setEditForm((p: any) => ({ ...p, is_active: true, is_out_of_stock: false }))
                          else if (opt.value === 'out_of_stock') setEditForm((p: any) => ({ ...p, is_active: true, is_out_of_stock: true }))
                          else setEditForm((p: any) => ({ ...p, is_active: false, is_out_of_stock: false }))
                        }}
                        className={`flex-1 rounded-xl border p-2 text-center transition-all ${
                          isActive ? opt.color + ' border-2 shadow-sm' : 'border-border text-text-secondary hover:bg-surface'
                        } disabled:opacity-50`}
                      >
                        <div className="text-xs font-bold">{opt.label}</div>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ── Discounts ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setDiscountsOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2"
                >
                  <span className="text-sm font-extrabold text-text">خصم الشرائح</span>
                  <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${discountsOpen ? 'rotate-180' : ''}`} />
                </button>
                {discountsOpen && (
                  allTiers.length === 0 ? (
                  <p className="text-xs text-text-secondary">لا توجد شرائح</p>
                ) : (
                  allTiers.map((tier: any) => {
                    const exDiscount = editTierDiscounts[tier.id]
                    const hasException = exDiscount !== undefined && exDiscount !== ''
                    const effectiveDiscount = hasException ? parseFloat(exDiscount) : (tier.discount_percent ?? 0)
                    return (
                      <div key={tier.id} className="flex items-center gap-3 border border-border rounded-lg bg-white px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold text-text block truncate">{tier.name}</span>
                          <span className="text-[10px] text-text-secondary">الافتراضي: {tier.discount_percent}%</span>
                        </div>
                        {canManage ? (
                          <div className="flex items-center gap-1.5">
                            <input type="text" inputMode="decimal"
                              value={exDiscount ?? ''}
                              onChange={(e) => setEditTierDiscounts((prev) => ({ ...prev, [tier.id]: toEnglishDigits(e.target.value) }))}
                              placeholder="نسبة" className="w-16 border border-border rounded-md px-2 py-1 text-xs text-center bg-white" dir="ltr" />
                            <span className="text-[10px] text-text-secondary">%</span>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold">{effectiveDiscount}%</span>
                        )}
                      </div>
                    )
                  })
                )
              )}
              </section>

              {/* ── Product Image ── */}
              <section className="bg-surface/40 border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-sm font-extrabold text-text">صورة المنتج</h3>
                <div className="flex items-start gap-2">
                  {editForm.image_url ? (
                    <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border bg-white shrink-0">
                      <img src={editForm.image_url} alt="" className="w-full h-full object-contain" />
                      {canManage && (
                        <button onClick={() => setEditForm((p: any) => ({ ...p, image_url: '' }))}
                          className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="w-24 h-24 bg-white rounded-lg border border-border flex items-center justify-center shrink-0">
                      <Image className="w-6 h-6 text-text-secondary/30" />
                    </div>
                  )}
                  {canManage && (
                    <div className="flex-1 min-w-0 space-y-2">
                      <input type="text" value={editForm.image_url}
                        onChange={(e) => setEditForm((p: any) => ({ ...p, image_url: e.target.value }))}
                        placeholder="رابط الصورة..." className="w-full border border-border rounded-lg px-3 py-2.5 text-xs bg-white" dir="ltr" />
                      <button type="button" onClick={() => editImageInputRef.current?.click()}
                        className="w-full px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-surface flex items-center justify-center gap-1.5 text-xs font-semibold">
                        <Upload className="w-4 h-4" /> رفع صورة
                      </button>
                      <input ref={editImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditImageFile} />
                    </div>
                  )}
                </div>
              </section>

              {/* ── Save ── */}
              {canManage && (
                <button onClick={handleEditSave} disabled={editSaving}
                  className="w-full bg-primary text-white rounded-xl py-3.5 text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {editSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</> : 'حفظ التغييرات'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full max-w-sm mx-3 shadow-xl">
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <h3 className="font-bold text-text">حذف المنتج</h3>
                  <p className="text-xs text-text-secondary">{deleteTarget.product_name}</p>
                </div>
              </div>

              {deletePreview && (
                <div className="bg-surface rounded-lg p-3 text-xs space-y-1">
                  <p className="text-text-secondary">
                    سيتم حذف <span className="font-bold text-danger">{deletePreview.direct_count}</span> منتج
                    {deletePreview.related && Object.keys(deletePreview.related).filter((k) => deletePreview.related[k] > 0).length > 0 && (
                      <> و <span className="font-bold text-danger">
                        {Object.values(deletePreview.related as Record<string, number>).reduce((a, b) => a + b, 0)}
                      </span> سجل مرتبط</>
                    )}
                  </p>
                  {deletePreview.related && Object.entries(deletePreview.related as Record<string, number>)
                    .filter(([, v]) => v > 0).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(deletePreview.related as Record<string, number>)
                        .filter(([, v]) => v > 0)
                        .slice(0, 5)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between text-text-secondary">
                            <span>{k}</span>
                            <span className="font-semibold text-danger">{v}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-danger/80 bg-danger/5 rounded-lg p-3">
                هذا الإجراء لا يمكن التراجع عنه. سيتم حذف المنتج نهائياً من قاعدة البيانات.
              </p>

              <div className="flex gap-3">
                <button onClick={() => { setDeleteTarget(null); setDeletePreview(null) }}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm font-semibold text-text-secondary">
                  إلغاء
                </button>
                <button onClick={handleDeleteConfirm} disabled={deleting}
                  className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold hover:bg-danger/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري...</> : <><Trash2 className="w-4 h-4" /> حذف</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scope Dialog ── */}
      {scopeDialogTarget && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full max-w-sm mx-3 shadow-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-text">
                  {scopeDialogTarget === 'negative_selling' ? 'تغيير سياسة البيع بالسالب' : 'تغيير حالة خصم المخزون'}
                </h3>
                <p className="text-xs text-text-secondary">اختر نطاق تطبيق التغيير</p>
              </div>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => confirmPolicyChange('new_orders')}
                disabled={policySaving}
                className="w-full text-right px-4 py-3 rounded-lg border border-border hover:bg-surface transition-colors disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-text block">طلبات جديدة فقط</span>
                <span className="text-[10px] text-text-secondary">سيتم تطبيق التغيير على الطلبات الجديدة من الآن فصاعداً</span>
              </button>
              <button
                onClick={() => confirmPolicyChange('previous_and_new')}
                disabled={policySaving}
                className="w-full text-right px-4 py-3 rounded-lg border border-border hover:bg-surface transition-colors disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-text block">الطلبات السابقة والحديثة</span>
                <span className="text-[10px] text-text-secondary">سيتم تطبيق التغيير على جميع الطلبات الحالية والجديدة</span>
              </button>
            </div>
            <button
              onClick={() => { setScopeDialogTarget(null); setPendingPolicyValue(null) }}
              disabled={policySaving}
              className="w-full py-2.5 rounded-lg border border-border text-sm text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
