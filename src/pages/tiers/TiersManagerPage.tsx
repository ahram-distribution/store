import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, TIER_COLUMNS, PAYMENT_METHOD_COLUMNS, SHIPPING_METHOD_COLUMNS, type ColumnDef } from '../../utils/schemaEditor'
import { discountOptionsService } from '../../services/discountOptions'
import { formatCurrencyShort } from '../../utils/format'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

function rowVal(row: any, snake: string): any {
  if (row == null) return null
  if (snake in row) return row[snake]
  const camel = snake.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())
  if (camel in row) return row[camel]
  return null
}

function formatPercent(pct: number): string {
  return pct % 1 === 0 ? String(pct) : Number(pct.toFixed(1)).toString()
}

function toLocalISO(v: any): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type SectionKey = 'tiers' | 'payments' | 'shipping'

interface RowSpec {
  rows: any[]
  columns: ColumnDef[]
  nameOf: (r: any) => string
  createRpc: string
  updateRpc: string
  deleteRpc: string
  createLabel: string
  listLabel: (r: any) => string
}

export function TiersManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('tiers.manage')

  const [section, setSection] = useState<SectionKey>('tiers')
  const [tiers, setTiers] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [shipping, setShipping] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})

  const [deleteTarget, setDeleteTarget] = useState<{
    spec: RowSpec
    id: string
    name: string
    preview: { action: 'archive' | 'delete'; references?: Record<string, number> }
  } | null>(null)

  useEffect(() => {
    refreshRows()
  }, [])

  const specs: Record<SectionKey, RowSpec> = {
    tiers: {
      rows: tiers,
      columns: TIER_COLUMNS,
      nameOf: (r) => r.name,
      createRpc: 'governed_create_tier',
      updateRpc: 'governed_update_tier',
      deleteRpc: 'governed_delete_tier',
      createLabel: 'إنشاء شريحة جديدة',
      listLabel: (r) => `${rowVal(r, 'name')} (${formatPercent(Number(rowVal(r, 'discount_percent') ?? 0))}%)`,
    },
    payments: {
      rows: payments,
      columns: PAYMENT_METHOD_COLUMNS,
      nameOf: (r) => r.name,
      createRpc: 'governed_create_payment_method_option',
      updateRpc: 'governed_update_payment_method_option',
      deleteRpc: 'governed_delete_payment_method_option',
      createLabel: 'إنشاء وسيلة دفع جديدة',
      listLabel: (r) => `${rowVal(r, 'name')} (${formatPercent(Number(rowVal(r, 'discount_percent') ?? 0))}%)`,
    },
    shipping: {
      rows: shipping,
      columns: SHIPPING_METHOD_COLUMNS,
      nameOf: (r) => r.name,
      createRpc: 'governed_create_shipping_method_option',
      updateRpc: 'governed_update_shipping_method_option',
      deleteRpc: 'governed_delete_shipping_method_option',
      createLabel: 'إنشاء طريقة شحن جديدة',
      listLabel: (r) => `${rowVal(r, 'name')} (${formatPercent(Number(rowVal(r, 'discount_percent') ?? 0))}%)`,
    },
  }

  const spec = specs[section]

  const displayedRows =
    section === 'tiers'
      ? [...spec.rows].sort((a, b) => Number(rowVal(b, 'minimum_order_amount') ?? 0) - Number(rowVal(a, 'minimum_order_amount') ?? 0))
      : [...spec.rows].sort(
          (a, b) =>
            Number(rowVal(b, 'discount_percent') ?? 0) - Number(rowVal(a, 'discount_percent') ?? 0) ||
            Number(rowVal(a, 'sort_order') ?? 0) - Number(rowVal(b, 'sort_order') ?? 0)
        )

  function selectRow(id: string) {
    const row = spec.rows.find((x: any) => x.id === id)
    if (!row) { setSelectedId(null); return }
    setSelectedId(id)
    const map: Record<string, any> = {}
    for (const col of spec.columns) {
      const v = rowVal(row, col.key)
      if (col.inputType === 'datetime-local' && v) {
        map[col.key] = toLocalISO(v)
      } else {
        map[col.key] = v ?? (col.inputType === 'boolean' ? false : '')
      }
    }
    setForm(map)
  }

  function handleChange(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function refreshRows() {
    setLoading(true)
    try {
      const bundle = await discountOptionsService.getAll().catch(() => null)
      setTiers(bundle?.tiers ?? [])
      setPayments(bundle?.paymentMethods ?? [])
      setShipping(bundle?.shippingMethods ?? [])
    } finally {
      setLoading(false)
    }
  }

  // keeps selection synced after a refresh
  const saveSelectionOnRowRef = { current: () => { if (selectedId) selectRow(selectedId) } }

  async function handleSave() {
    if (!selectedId || !canManage) return
    setSaving(true)
    const token = getToken()
    try {
      const payload: Record<string, any> = { p_token: token, p_id: selectedId }
      for (const col of spec.columns) {
        if (col.hidden || col.key === 'id' || col.key === 'created_at' || col.key === 'updated_at') continue
        const v = form[col.key]
        if (col.inputType === 'datetime-local' && v) {
          payload[`p_${col.key}`] = new Date(v).toISOString()
        } else if (col.inputType === 'number' && (v === '' || v === null || v === undefined)) {
          continue
        } else if (col.inputType === 'number') {
          payload[`p_${col.key}`] = parseFloat(v)
        } else if (col.inputType === 'boolean') {
          payload[`p_${col.key}`] = v
        } else {
          payload[`p_${col.key}`] = v || null
        }
      }

      const { error } = await supabase.rpc(spec.updateRpc, payload)
      if (error) { toast.error(error.message); setSaving(false); return }

      toast.success('تم حفظ التغييرات')
      await refreshRows()
      saveSelectionOnRowRef.current()
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  async function handleCreate() {
    if (!canManage) return
    const name = prompt(`اسم الـ ${section === 'tiers' ? 'شريحة' : section === 'payments' ? 'وسيلة الدفع' : 'طريقة الشحن'} الجديدة:`)
    if (!name?.trim()) return
    setSaving(true)
    const token = getToken()
    const { data, error } = await supabase.rpc(spec.createRpc, { p_token: token, p_name: name.trim() })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('تم الإنشاء')
    await refreshRows()
    if (data?.id) setSelectedId(data.id)
    if (data?.id) selectRow(data.id)
    setSaving(false)
  }

  async function handleToggle(id: string, field: 'is_active' | 'is_visible') {
    if (!canManage || busyId) return
    const row = spec.rows.find((r: any) => r.id === id)
    if (!row) return
    const target = !rowVal(row, field)
    setBusyId(id)
    const token = getToken()
    const { error } = await supabase.rpc(spec.updateRpc, { p_token: token, p_id: id, [`p_${field}`]: target })
    setBusyId(null)
    if (error) { toast.error(error.message); return }
    toast.success(
      field === 'is_active'
        ? target ? 'تم تفعيل العنصر' : 'تم إيقاف العنصر'
        : target ? 'تم إظهار العنصر للعملاء' : 'تم إخفاء العنصر عن العملاء'
    )
    await refreshRows()
  }

  async function handleDeleteClick(id: string) {
    if (!canManage || busyId) return
    const row = spec.rows.find((r: any) => r.id === id)
    if (!row) return
    setBusyId(id)
    const token = getToken()
    const { data, error } = await supabase.rpc(spec.deleteRpc, { p_token: token, p_id: id, p_dry_run: true })
    setBusyId(null)
    if (error) { toast.error(error.message); return }
    if (data?.error) { toast.error(data.error); return }
    setDeleteTarget({ spec, id, name: rowVal(row, 'name') || 'العنصر', preview: data })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setSaving(true)
    const token = getToken()
    const { data, error } = await supabase.rpc(deleteTarget.spec.deleteRpc, {
      p_token: token,
      p_id: deleteTarget.id,
      p_dry_run: false,
    })
    setSaving(false)
    if (error) { toast.error(error.message); setDeleteTarget(null); return }
    if (data?.error) { toast.error(data.error); setDeleteTarget(null); return }
    toast.success(data?.action === 'archive' ? 'تمت أرشفة العنصر (إيقاف + إخفاء مع الحفاظ على السجلات)' : 'تم حذف العنصر نهائياً')
    setDeleteTarget(null)
    setSelectedId(null)
    await refreshRows()
  }

  const switchSection = (next: SectionKey) => {
    setSection(next)
    setSelectedId(null)
    setForm({})
    setDeleteTarget(null)
  }

  const sectionMeta: Record<SectionKey, { label: string; short: string }> = {
    tiers: { label: 'الشرائح السعرية', short: 'شرائح' },
    payments: { label: 'طرق الدفع', short: 'دفع' },
    shipping: { label: 'طرق الشحن', short: 'شحن' },
  }

  const actionBtn = 'shrink-0 text-[11px] font-semibold rounded-lg px-2.5 py-1 active:opacity-90 disabled:opacity-40 border'

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة الخصومات والشرائح</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(Object.keys(sectionMeta) as SectionKey[]).map((key) => (
          <button
            key={key}
            onClick={() => switchSection(key)}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg border transition-colors ${
              section === key ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
            }`}
          >
            {sectionMeta[key].short}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-center py-10 text-text-secondary text-sm">جاري التحميل...</div>
      ) : spec.rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm">
          لا توجد عناصر في {sectionMeta[section].label} بعد
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {displayedRows.map((r: any) => {
            const isSel = selectedId === r.id
            const name = rowVal(r, 'name')
            const discountPct = Number(rowVal(r, 'discount_percent') ?? 0)
            const sortOrder = rowVal(r, 'sort_order')
            const isActive = !!rowVal(r, 'is_active')
            const isVisible = !!rowVal(r, 'is_visible')
            const minAmount = Number(rowVal(r, 'minimum_order_amount') ?? 0)
            const desc = rowVal(r, 'description')
            const busy = busyId === r.id
            return (
              <div
                key={r.id}
                onClick={() => selectRow(r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.id) } }}
                className={`text-right bg-white rounded-xl border-2 p-3 transition-all cursor-pointer ${
                  isSel ? 'border-primary shadow-sm' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-text truncate">{name}</div>
                  <span className="shrink-0 text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">
                    خصم {formatPercent(discountPct)}%
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5 text-[11px] text-text-secondary">
                  {section === 'tiers' && !!desc && <div className="truncate">{desc}</div>}
                  {section === 'tiers' && minAmount > 0 && (
                    <div>الحد الأدنى للمشتريات: {formatCurrencyShort(minAmount)}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={isActive ? 'text-[10px] font-semibold text-success bg-success/10 px-2 py-0.5 rounded-full' : 'text-[10px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-full'}>
                      {isActive ? 'نشط' : 'غير نشط'}
                    </span>
                    <span className={isVisible ? 'text-[10px] font-semibold text-success bg-success/10 px-2 py-0.5 rounded-full' : 'text-[10px] font-semibold text-text-secondary bg-text-secondary/10 px-2 py-0.5 rounded-full'}>
                      {isVisible ? 'ظاهر للعملاء' : 'مخفي عن العملاء'}
                    </span>
                    <span className="text-[10px] text-text-secondary">الترتيب: {sortOrder ?? 0}</span>
                  </div>
                </div>

                {canManage && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/70 pt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => selectRow(r.id)}
                      disabled={busy}
                      className={`${actionBtn} bg-white text-text border-border`}
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleToggle(r.id, 'is_active')}
                      disabled={busy}
                      className={`${actionBtn} ${
                        isActive ? 'bg-warning/10 text-warning border-warning/30' : 'bg-success/10 text-success border-success/30'
                      }`}
                    >
                      {isActive ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button
                      onClick={() => handleToggle(r.id, 'is_visible')}
                      disabled={busy}
                      className={`${actionBtn} ${
                        isVisible ? 'bg-text-secondary/10 text-text-secondary border-border' : 'bg-primary/10 text-primary border-primary/30'
                      }`}
                    >
                      {isVisible ? 'إخفاء' : 'إظهار'}
                    </button>
                    <button
                      onClick={() => handleDeleteClick(r.id)}
                      disabled={busy}
                      className={`${actionBtn} bg-danger/10 text-danger border-danger/30`}
                    >
                      حذف / أرشفة
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canManage && (
        <button onClick={handleCreate} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + {spec.createLabel}
        </button>
      )}

      {selectedId && spec.rows.some((r: any) => r.id === selectedId) && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="بيانات العنصر"
            columns={spec.columns}
            data={form}
            onChange={handleChange}
            readonly={!canManage}
          />

          {canManage && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">
          اضغط على أي بطاقة لتعديل بياناتها، أو استخدم الأزرار المباشرة للتفعيل والإظهار والحذف
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
            <div className="text-sm font-bold text-text">تأكيد الحذف: {deleteTarget.name}</div>
            <p className="text-xs text-text-secondary leading-relaxed">
              {deleteTarget.preview.action === 'archive' ? (
                <>
                  هذا العنصر مستخدم في النظام (طلبات أو استثناءات)، لذا لن يتم حذفه نهائياً. سيتم <b>أرشفته</b>: إيقافه وإخفاؤه
                  عن العملاء مع الحفاظ على جميع السجلات التاريخية.
                </>
              ) : (
                <>
                  هذا العنصر غير مستخدم في أي طلبات أو استثناءات، وسيتم <b>حذفه نهائياً</b> من النظام.
                </>
              )}
            </p>
            <div className="flex gap-2">
              <button onClick={confirmDelete} disabled={saving}
                className="flex-1 bg-danger text-white rounded-xl py-2 text-xs font-semibold active:opacity-90 disabled:opacity-40">
                {saving ? 'جاري التنفيذ...' : 'تأكيد'}
              </button>
              <button onClick={() => setDeleteTarget(null)} disabled={saving}
                className="px-4 border border-border rounded-xl text-xs text-text-secondary">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}