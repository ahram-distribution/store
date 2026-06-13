import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, DAILY_DEAL_COLUMNS } from '../../utils/schemaEditor'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export function DailyDealsManagementPage() {
  const canManage = useCapability('deals.manage')
  const [deals, setDeals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<Record<string, any>>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [editingItems, setEditingItems] = useState<any[]>([])

  const fetchDeals = async () => {
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }
    const { data } = await supabase.rpc('get_governed_daily_deals', { p_token: token })
    if (data) setDeals(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { fetchDeals() }, [])

  function resetCreate() {
    const blank: Record<string, any> = {}
    for (const col of DAILY_DEAL_COLUMNS) {
      if (col.key === 'status') continue
      blank[col.key] = col.inputType === 'boolean' ? false : ''
    }
    setCreateForm(blank)
    setShowCreate(true)
    setEditingId(null)
  }

  function handleCreateChange(key: string, value: any) {
    setCreateForm(prev => ({ ...prev, [key]: value }))
  }

  function validateDeal(data: Record<string, any>, isCreate: boolean): string | null {
    if (!data.title?.trim()) return 'العنوان مطلوب'
    const price = parseFloat(data.fixed_price)
    if (isNaN(price) || price < 0) return 'السعر الثابت غير صالح'
    if (isCreate) {
      const qty = parseInt(data.original_quantity)
      if (isNaN(qty) || qty <= 0) return 'الكمية الأصلية يجب أن تكون أكبر من صفر'
    }
    if (data.starts_at && data.ends_at && new Date(data.starts_at) >= new Date(data.ends_at)) {
      return 'تاريخ البدء يجب أن يكون قبل تاريخ الانتهاء'
    }
    return null
  }

  async function handleCreateSave() {
    if (!canManage) return
    const err = validateDeal(createForm, true)
    if (err) { toast.error(err); return }
    setSaving(true)
    const token = getToken()
    try {
      const { error } = await supabase.rpc('governed_create_daily_deal', {
        p_token: token,
        p_title: createForm.title?.trim() || 'غير محدد',
        p_image_url: createForm.image_url || null,
        p_description: createForm.description || null,
        p_fixed_price: parseFloat(createForm.fixed_price) || 0,
        p_quantity: parseInt(createForm.original_quantity) || 0,
        p_starts_at: createForm.starts_at ? new Date(createForm.starts_at).toISOString() : null,
        p_ends_at: createForm.ends_at ? new Date(createForm.ends_at).toISOString() : null,
        p_items: [],
      })
      if (error) { toast.error(error.message); setSaving(false); return }
      toast.success('تم إنشاء العرض')
      setShowCreate(false)
      fetchDeals()
    } catch (err: any) { toast.error(err.message) }
    setSaving(false)
  }

  function startEdit(deal: any) {
    setEditingId(deal.id)
    setShowCreate(false)
    const map: Record<string, any> = {}
    for (const col of DAILY_DEAL_COLUMNS) {
      const v = deal[col.key]
      if (col.inputType === 'datetime-local' && v) {
        map[col.key] = toLocalISO(v)
      } else {
        map[col.key] = v ?? (col.inputType === 'boolean' ? false : '')
      }
    }
    setEditForm(map)
    setEditingItems(deal.items || [])
  }

  function handleEditChange(key: string, value: any) {
    setEditForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleEditSave() {
    if (!editingId || !canManage) return
    const err = validateDeal(editForm, false)
    if (err) { toast.error(err); return }
    setSaving(true)
    const token = getToken()
    try {
      const payload: Record<string, any> = { p_token: token, p_id: editingId }
      const rpcFields = ['title', 'image_url', 'description', 'fixed_price', 'starts_at', 'ends_at', 'original_quantity']
      for (const key of rpcFields) {
        if (key === 'fixed_price') {
          payload.p_fixed_price = editForm.fixed_price ? parseFloat(editForm.fixed_price) : null
        } else if (key === 'starts_at' || key === 'ends_at') {
          payload[`p_${key}`] = editForm[key] ? new Date(editForm[key]).toISOString() : null
        } else if (key === 'original_quantity') {
          payload.p_original_quantity = editForm.original_quantity !== undefined && editForm.original_quantity !== ''
            ? parseInt(editForm.original_quantity) : null
        } else {
          payload[`p_${key}`] = editForm[key] || null
        }
      }
      const { error: updateErr } = await supabase.rpc('governed_update_daily_deal', payload)
      if (updateErr) { toast.error(updateErr.message); setSaving(false); return }
      toast.success('تم حفظ التعديلات')
      fetchDeals()
    } catch (err: any) { toast.error(err.message) }
    setSaving(false)
  }

  async function handleStatusAction(action: string) {
    if (!editingId || !canManage) return
    setSaving(true)
    const token = getToken()
    const fn = action === 'activate' ? 'governed_activate_daily_deal' : 'governed_cancel_daily_deal'
    const { error } = await supabase.rpc(fn, { p_token: token, p_id: editingId })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(action === 'activate' ? 'تم التفعيل' : 'تم الإلغاء')
    fetchDeals()
    setSaving(false)
  }

  const statusLabels: Record<string, string> = {
    draft: 'مسودة', scheduled: 'مجدول', active: 'نشط',
    sold_out: 'نفد', expired: 'منتهي', cancelled: 'ملغي',
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', scheduled: 'bg-blue-100 text-blue-600',
    active: 'bg-success/10 text-success', sold_out: 'bg-red-100 text-red-600',
    expired: 'bg-gray-100 text-gray-500', cancelled: 'bg-danger/10 text-danger',
  }

  if (!canManage && loading) return <div className="text-center text-text-secondary text-sm py-8">جاري التحميل...</div>

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text">إدارة العروض اليومية</h1>
        <span className="text-xs text-text-secondary">{deals.length} عرض</span>
      </div>

      {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}

      {/* Create button */}
      {canManage && !showCreate && !editingId && (
        <button onClick={resetCreate} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + إنشاء عرض جديد
        </button>
      )}

      {/* Create form */}
      {showCreate && canManage && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="عرض جديد"
            columns={DAILY_DEAL_COLUMNS.filter(c => c.key !== 'status' && c.key !== 'available_quantity')}
            data={createForm}
            onChange={handleCreateChange}
          />
          <div className="flex gap-2">
            <button onClick={handleCreateSave} disabled={saving}
              className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </button>
            <button onClick={() => setShowCreate(false)} disabled={saving}
              className="px-6 border border-border rounded-xl py-2.5 text-sm font-semibold text-text-secondary active:opacity-90">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Card list */}
      {!editingId && !showCreate && (
        <>
          {deals.length === 0 && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
              <p className="text-sm text-amber-700">لا توجد عروض يومية بعد</p>
            </div>
          )}

          <div className="space-y-2">
            {deals.map((deal) => (
              <div key={deal.id} className={`bg-white rounded-lg border border-border p-3 ${editingId === deal.id ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-text truncate">{deal.title}</h3>
                    {deal.description && (
                      <p className="text-xs text-text-secondary truncate mt-0.5">{deal.description}</p>
                    )}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[deal.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabels[deal.status] || deal.status}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-text-secondary">
                  <span>السعر: {deal.fixed_price ? Number(deal.fixed_price).toLocaleString('ar-EG') : 0}</span>
                  <span>المتبقي: {deal.available_quantity}/{deal.original_quantity}</span>
                  {deal.ends_at && (
                    <span>ينتهي: {new Date(deal.ends_at).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                  )}
                </div>

                {deal.items?.length > 0 && (
                  <div className="mt-2 text-xs text-text-secondary">
                    {deal.items.map((item: any) => (
                      <span key={item.id} className="ml-2">{item.product_name} x{item.quantity}</span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-2">
                  {canManage && (
                    <button onClick={() => startEdit(deal)}
                      className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-lg">
                      تعديل
                    </button>
                  )}
                  {canManage && (deal.status === 'draft' || deal.status === 'scheduled') && (
                    <button onClick={async () => {
                      const token = getToken()
                      const { error } = await supabase.rpc('governed_activate_daily_deal', { p_token: token, p_id: deal.id })
                      if (error) toast.error(error.message); else { toast.success('تم التفعيل'); fetchDeals() }
                    }} className="text-xs bg-success text-white px-3 py-1 rounded-lg">
                      تفعيل
                    </button>
                  )}
                  {canManage && deal.status === 'active' && (
                    <button onClick={async () => {
                      const token = getToken()
                      const { error } = await supabase.rpc('governed_cancel_daily_deal', { p_token: token, p_id: deal.id })
                      if (error) toast.error(error.message); else { toast.success('تم الإلغاء'); fetchDeals() }
                    }} className="text-xs bg-danger text-white px-3 py-1 rounded-lg">
                      إلغاء
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Edit form */}
      {editingId && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="تعديل العرض"
            columns={DAILY_DEAL_COLUMNS}
            data={editForm}
            onChange={handleEditChange}
          />

          {editingItems.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <h2 className="text-sm font-bold">المنتجات</h2>
              {editingItems.map((item: any) => (
                <div key={item.id} className="flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2">
                  <span className="flex-1 font-semibold">{item.product_name || item.product_id}</span>
                  <span className="text-text-secondary">الكمية: {item.quantity}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {canManage && editForm.status !== 'expired' && editForm.status !== 'cancelled' && (
              <>
                <button onClick={handleEditSave} disabled={saving}
                  className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
                  {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
                {(editForm.status === 'draft' || editForm.status === 'scheduled') && (
                  <button onClick={() => handleStatusAction('activate')} disabled={saving}
                    className="bg-success text-white rounded-xl py-2.5 px-4 text-sm font-semibold active:opacity-90 disabled:opacity-40">
                    تفعيل
                  </button>
                )}
                {editForm.status === 'active' && (
                  <button onClick={() => handleStatusAction('cancel')} disabled={saving}
                    className="bg-danger text-white rounded-xl py-2.5 px-4 text-sm font-semibold active:opacity-90 disabled:opacity-40">
                    إلغاء
                  </button>
                )}
              </>
            )}
            <button onClick={() => { setEditingId(null); setShowCreate(false) }}
              className="px-6 border border-border rounded-xl py-2.5 text-sm font-semibold text-text-secondary active:opacity-90">
              عودة
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function toLocalISO(v: any): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
