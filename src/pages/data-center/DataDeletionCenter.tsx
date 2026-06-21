import { useState, useEffect, useCallback } from 'react'
import { Search, Trash2, AlertTriangle, X, ChevronDown, Calendar, Loader2, CheckSquare, Square } from 'lucide-react'
import toast from 'react-hot-toast'
import { searchEntity, previewDeletion, executeDeletion, type SearchFilters, type DeletionRecord, type PreviewResult, type ExecuteResult } from '../../services/dataDeletion'

const ENTITIES = [
  { key: 'employees', label: 'الموظفين', icon: '👤' },
  { key: 'customers', label: 'العملاء', icon: '🏢' },
  { key: 'products', label: 'المنتجات', icon: '📦' },
  { key: 'companies', label: 'الشركات', icon: '🏭' },
  { key: 'orders', label: 'الطلبات', icon: '📋' },
  { key: 'collections', label: 'التحصيلات', icon: '💰' },
  { key: 'visits', label: 'الزيارات', icon: '👣' },
  { key: 'workdays', label: 'أيام العمل', icon: '📅' },
  { key: 'tracking', label: 'نقاط التتبع', icon: '📍' },
]

const STATUS_FILTERS: Record<string, { value: string; label: string }[]> = {
  employees: [
    { value: '', label: 'الكل' },
    { value: 'active', label: 'نشط' },
    { value: 'inactive', label: 'غير نشط' },
  ],
  customers: [
    { value: '', label: 'الكل' },
    { value: 'active', label: 'نشط' },
    { value: 'inactive', label: 'غير نشط' },
  ],
  products: [
    { value: '', label: 'الكل' },
    { value: 'active', label: 'نشط' },
    { value: 'inactive', label: 'غير نشط' },
  ],
  companies: [
    { value: '', label: 'الكل' },
    { value: 'active', label: 'نشط' },
    { value: 'inactive', label: 'غير نشط' },
  ],
  orders: [
    { value: '', label: 'الكل' },
    { value: 'draft', label: 'مسودة' },
    { value: 'submitted', label: 'مقدم' },
    { value: 'approved', label: 'معتمد' },
    { value: 'preparing', label: 'قيد التجهيز' },
    { value: 'prepared', label: 'تم التجهيز' },
    { value: 'dispatched', label: 'تم الشحن' },
    { value: 'delivered', label: 'تم التوصيل' },
    { value: 'cancelled', label: 'ملغي' },
  ],
  collections: [
    { value: '', label: 'الكل' },
    { value: 'pending', label: 'معلق' },
    { value: 'approved', label: 'معتمد' },
    { value: 'cancelled', label: 'ملغي' },
  ],
  visits: [
    { value: '', label: 'الكل' },
    { value: 'completed', label: 'مكتملة' },
    { value: 'cancelled', label: 'ملغية' },
    { value: 'no_answer', label: 'لا رد' },
  ],
  workdays: [
    { value: '', label: 'الكل' },
    { value: 'active', label: 'نشط' },
    { value: 'closed', label: 'مغلق' },
  ],
  tracking: [
    { value: '', label: 'الكل' },
  ],
}

export function DataDeletionCenter() {
  const [activeEntity, setActiveEntity] = useState('employees')
  const [filters, setFilters] = useState<SearchFilters>({})
  const [results, setResults] = useState<DeletionRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [showFilters, setShowFilters] = useState(false)

  const doSearch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await searchEntity(activeEntity, filters)
      setResults(res.data || [])
      setTotal(res.total || 0)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل البحث')
      setResults([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeEntity, filters])

  useEffect(() => {
    setSelectedIds(new Set())
    setSelectAll(false)
    setPreview(null)
    doSearch()
  }, [activeEntity, doSearch])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelectedIds(new Set())
      setSelectAll(false)
    } else {
      setSelectedIds(new Set(results.map((r) => r.id)))
      setSelectAll(true)
    }
  }

  async function handlePreviewDelete() {
    if (selectedIds.size === 0) {
      toast.error('اختر سجلاً على الأقل')
      return
    }
    try {
      const res = await previewDeletion(activeEntity, Array.from(selectedIds))
      setPreview(res as PreviewResult)
      setShowPreview(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل معاينة الحذف')
    }
  }

  async function handleConfirmDelete() {
    if (!preview) return
    setDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await executeDeletion(activeEntity, ids, false) as ExecuteResult
      toast.success(`تم حذف ${res.deleted_count} سجل بنجاح`)
      setShowPreview(false)
      setPreview(null)
      setSelectedIds(new Set())
      setSelectAll(false)
      doSearch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل الحذف'
      if (msg.includes('HAS_CRITICAL_RELATIONS') || msg.includes('HAS_ORDERS') || msg.includes('HAS_PRODUCTS') || msg.includes('HAS_ORDER_ITEMS')) {
        toast.error('لا يمكن حذف سجل له علاقات حرجة (طلبات/منتجات مرتبطة)')
      } else {
        toast.error(msg)
      }
    } finally {
      setDeleting(false)
    }
  }

  function renderStatusBadge(status: string) {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-gray-100 text-gray-500',
      draft: 'bg-gray-100 text-gray-600',
      submitted: 'bg-blue-100 text-blue-700',
      approved: 'bg-green-100 text-green-700',
      preparing: 'bg-amber-100 text-amber-700',
      prepared: 'bg-teal-100 text-teal-700',
      dispatched: 'bg-purple-100 text-purple-700',
      delivered: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-red-100 text-red-700',
      pending: 'bg-yellow-100 text-yellow-700',
      completed: 'bg-green-100 text-green-700',
      closed: 'bg-slate-100 text-slate-700',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    )
  }

  const relatedLabelMap: Record<string, string> = {
    orders: 'الطلبات',
    customers: 'العملاء',
    visits: 'الزيارات',
    collections: 'التحصيلات',
    returns: 'المرتجعات',
    addresses: 'العناوين',
    contacts: 'جهات الاتصال',
    credit_accounts: 'حسابات الائتمان',
    credit_ledger: 'دفتر الائتمان',
    credit_invoices: 'فواتير الائتمان',
    order_items: 'بنود الطلب',
    inventory: 'المخزون',
    product_units: 'وحدات المنتج',
    return_items: 'بنود المرتجع',
    daily_deal_items: 'بنود العرض اليومي',
    flash_offer_items: 'بنود العرض الخاص',
    auction_items: 'بنود المزاد',
    workday_sessions: 'أيام العمل',
    tracking_points: 'نقاط التتبع',
    workday_breaks: 'استراحات',
    visit_links: 'روابط الزيارات',
    delivery_tracking: 'تتبع التوصيل',
    preparation_records: 'سجلات التجهيز',
    treasury_transactions: 'معاملات الخزينة',
    order_status_history: 'تاريخ حالة الطلب',
    order_modification_history: 'تاريخ تعديل الطلب',
    order_daily_deals: 'عروض الطلب اليومية',
    order_flash_offers: 'عروض الطلب الخاصة',
    app_sessions: 'جلسات التطبيق',
    attendance_audit_log: 'سجل الحضور',
    session_recovery_log: 'سجل استرداد الجلسة',
    employee_roles: 'الأدوار',
    employee_capabilities: 'الصلاحيات',
    employee_monthly_targets: 'الأهداف الشهرية',
    employee_weight_overrides: 'تجاوز الأوزان',
    employee_work_policies: 'سياسات العمل',
    employee_advances: 'السلف',
    expenses: 'المصروفات',
    tier_exceptions: 'استثناءات المستوى',
    customers_owner: 'العملاء (مالك)',
    collections_created_by: 'تحصيلات (منشئ)',
    collections_approved_by: 'تحصيلات (معتمد)',
    customer_credit_accounts: 'حسابات الائتمان',
    customer_credit_ledger: 'دفتر الائتمان',
    delivery_tracking_assigned_to: 'تتبع التوصيل (مسند إلى)',
    delivery_tracking_assigned_by: 'تتبع التوصيل (مسند من)',
    preparation_records_started_by: 'تجهيز (بادىء)',
    preparation_records_completed_by: 'تجهيز (مكمل)',
    preparation_records_cancelled_by: 'تجهيز (ملغي)',
    preparation_records_reviewed_by: 'تجهيز (مراجع)',
    return_inspection: 'فحص المرتجع',
    products: 'المنتجات',

    // Employee cascade keys (not already in main map)
    tracking_cleanup_log: 'سجل تنظيف التتبع',
    credit_applications: 'طلبات الائتمان',
    credit_contracts: 'عقود الائتمان',
    credit_invoice_cheques: 'شيكات الفواتير',
    daily_deals: 'العروض اليومية',
    flash_offers: 'العروض الخاصة',
    packages: 'الباقات',
    auctions: 'المزادات',
    auction_participants: 'مشاركو المزاد',
    auction_awards: 'جوائز المزاد',
    customer_ownership_history: 'سجل ملكية العميل',
    managed_employees: 'موظفين تابعين',
    customer_addresses: 'العناوين',
    customer_contacts: 'جهات الاتصال',
    identities: 'الهوية',
    deletion_audit_log: 'سجل الحذف',
  }

  return (
    <div className="min-h-screen bg-surface" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white px-4 py-5">
        <h1 className="text-xl font-bold">مركز الحذف</h1>
        <p className="text-xs opacity-80 mt-1">حذف نهائى مباشر من قاعدة البيانات</p>
      </div>

      <div className="px-3 py-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {ENTITIES.map((ent) => (
            <button
              key={ent.key}
              onClick={() => setActiveEntity(ent.key)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                activeEntity === ent.key
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white border border-border text-text-secondary'
              }`}
            >
              {ent.icon} {ent.label}
            </button>
          ))}
        </div>

        {/* Search & Filters */}
        <div className="bg-white rounded-xl border border-border p-3 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder={`بحث عن ${ENTITIES.find((e) => e.key === activeEntity)?.label || ''}...`}
                value={filters.search || ''}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                className="w-full pr-9 pl-3 py-2 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-red-400/40"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
                showFilters ? 'bg-red-50 border-red-300 text-red-700' : 'border-border text-text-secondary'
              }`}
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={doSearch}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              بحث
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-border">
              {/* Status */}
              {STATUS_FILTERS[activeEntity] && (
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
                  className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
                >
                  {STATUS_FILTERS[activeEntity].map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}

              {/* Date from */}
              <div className="relative">
                <input
                  type="date"
                  value={filters.date_from || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value || undefined }))}
                  className="w-full px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
                  placeholder="من تاريخ"
                />
              </div>

              {/* Date to */}
              <div className="relative">
                <input
                  type="date"
                  value={filters.date_to || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value || undefined }))}
                  className="w-full px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
                  placeholder="إلى تاريخ"
                />
              </div>

              {activeEntity === 'workdays' && (
                <input
                  type="text"
                  placeholder="اسم الموظف"
                  value={filters.search || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  className="px-2 py-1.5 rounded-lg border border-border text-xs bg-surface"
                />
              )}
            </div>
          )}
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary">
            إجمالي النتائج: <span className="font-bold text-text">{total}</span>
          </p>
          {results.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1 text-xs text-red-600 font-semibold"
            >
              {selectAll ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {selectAll ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد نتائج</div>
        ) : (
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="px-2 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="rounded border-border accent-red-600"
                    />
                  </th>
                  <th className="px-2 py-2 font-semibold text-text-secondary">ID</th>
                  <th className="px-2 py-2 font-semibold text-text-secondary">الاسم</th>
                  <th className="px-2 py-2 font-semibold text-text-secondary">الحالة</th>
                  <th className="px-2 py-2 font-semibold text-text-secondary">تاريخ الإنشاء</th>
                  <th className="px-2 py-2 font-semibold text-text-secondary">العلاقات</th>
                </tr>
              </thead>
              <tbody>
                {results.map((rec) => (
                  <tr key={rec.id} className="border-b border-border last:border-0 hover:bg-red-50/30">
                    <td className="px-2 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(rec.id)}
                        onChange={() => toggleSelect(rec.id)}
                        className="rounded border-border accent-red-600"
                      />
                    </td>
                    <td className="px-2 py-2.5 font-mono text-[10px] text-text-secondary max-w-[60px] truncate">
                      {rec.id.substring(0, 8)}...
                    </td>
                    <td className="px-2 py-2.5 font-semibold text-text">{rec.name}</td>
                    <td className="px-2 py-2.5">{renderStatusBadge(rec.status)}</td>
                    <td className="px-2 py-2.5 text-text-secondary">
                      {new Date(rec.created_at).toLocaleDateString('ar-EG')}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(rec.related_counts || {})
                          .filter(([, count]) => count > 0)
                          .map(([key, count]) => (
                            <span
                              key={key}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                count > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'
                              }`}
                            >
                              {relatedLabelMap[key] || key}: {count}
                            </span>
                          ))}
                        {Object.values(rec.related_counts || {}).every((c) => c === 0) && (
                          <span className="text-[9px] text-text-secondary">لا يوجد</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete Button */}
        {selectedIds.size > 0 && (
          <div className="sticky bottom-4 bg-white rounded-xl border border-red-200 shadow-lg p-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-text">
              تم اختيار <span className="text-red-600">{selectedIds.size}</span> سجل
            </p>
            <button
              onClick={handlePreviewDelete}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              حذف نهائى
            </button>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-border px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-text">تأكيد الحذف النهائى</h3>
              <button onClick={() => setShowPreview(false)} className="text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded-lg p-3 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p>هذا الإجراء لا يمكن التراجع عنه. سيتم حذف السجلات نهائياً من قاعدة البيانات.</p>
              </div>

              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-sm font-bold text-text">
                  السجلات المحددة: <span className="text-red-600">{preview.direct_count}</span>
                </p>
              </div>

              {Object.keys(preview.related).length > 0 && (
                <div>
                  <p className="text-sm font-bold text-text mb-2">السجلات المرتبطة التى سيتم حذفها:</p>
                  <div className="space-y-1.5">
                    {Object.entries(preview.related)
                      .filter(([, count]) => count > 0)
                      .sort(([, a], [, b]) => b - a)
                      .map(([key, count]) => (
                        <div key={key} className="flex items-center justify-between bg-surface rounded-lg px-3 py-2">
                          <span className="text-xs text-text-secondary">{relatedLabelMap[key] || key}</span>
                          <span className="text-sm font-bold text-red-600">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPreview(false)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm font-semibold text-text-secondary"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> جارى الحذف...</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> تأكيد الحذف النهائى</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
