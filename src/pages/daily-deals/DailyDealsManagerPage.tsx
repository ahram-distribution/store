import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, DAILY_DEAL_COLUMNS } from '../../utils/schemaEditor'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export function DailyDealsManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('deals.manage')

  const [deals, setDeals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [dealItems, setDealItems] = useState<any[]>([])

  const statusActions: Record<string, { label: string; action: string; color: string } | null> = {
    draft: { label: 'تفعيل', action: 'activate', color: 'bg-success text-white' },
    scheduled: { label: 'تفعيل', action: 'activate', color: 'bg-success text-white' },
    active: { label: 'إلغاء', action: 'cancel', color: 'bg-danger text-white' },
    sold_out: null,
    expired: null,
    cancelled: null,
  }

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_daily_deals', { p_token: token }).then(({ data }) => {
      if (data) setDeals(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  function selectDeal(id: string) {
    const d = deals.find((x: any) => x.id === id)
    if (!d) { setSelectedId(null); return }
    setSelectedId(id)
    const map: Record<string, any> = {}
    for (const col of DAILY_DEAL_COLUMNS) {
      const v = d[col.key]
      if (col.inputType === 'datetime-local' && v) {
        map[col.key] = toLocalISO(v)
      } else {
        map[col.key] = v ?? (col.inputType === 'boolean' ? false : '')
      }
    }
    setForm(map)
    setDealItems(d.items || [])
  }

  function handleChange(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleStatusAction(action: string) {
    if (!selectedId || !canManage) return
    setSaving(true)
    const token = getToken()
    const fn = action === 'activate' ? 'governed_activate_daily_deal' : 'governed_cancel_daily_deal'
    const { error } = await supabase.rpc(fn, { p_token: token, p_id: selectedId })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(action === 'activate' ? 'تم تفعيل العرض' : 'تم إلغاء العرض')

    const { data: refreshed } = await supabase.rpc('get_governed_daily_deals', { p_token: token })
    if (refreshed) setDeals(Array.isArray(refreshed) ? refreshed : [])
    if (selectedId) selectDeal(selectedId)
    setSaving(false)
  }

  async function handleSave() {
    if (!selectedId || !canManage) return
    setSaving(true)
    const token = getToken()
    try {
      const payload: Record<string, any> = { p_token: token, p_id: selectedId }
      const rpcFields = ['title', 'image_url', 'description', 'fixed_price', 'starts_at', 'ends_at']
      for (const key of rpcFields) {
        if (key === 'fixed_price') {
          payload.p_fixed_price = form.fixed_price ? parseFloat(form.fixed_price) : null
        } else if (key === 'starts_at' || key === 'ends_at') {
          payload[`p_${key}`] = form[key] ? new Date(form[key]).toISOString() : null
        } else {
          payload[`p_${key}`] = form[key] || null
        }
      }
      const { error: updateErr } = await supabase.rpc('governed_update_daily_deal', payload)
      if (updateErr) { toast.error(updateErr.message); setSaving(false); return }

      const directFields: Record<string, any> = {}
      if (form.original_quantity !== undefined && form.original_quantity !== '') {
        directFields.original_quantity = parseInt(form.original_quantity)
      }
      if (Object.keys(directFields).length > 0) {
        const { error: directErr } = await supabase.from('daily_deals').update(directFields).eq('id', selectedId)
        if (directErr) { toast.error('فشل تحديث بعض الحقول: ' + directErr.message); setSaving(false); return }
      }

      toast.success('تم حفظ التغييرات')

      const { data: refreshed } = await supabase.rpc('get_governed_daily_deals', { p_token: token })
      if (refreshed) setDeals(Array.isArray(refreshed) ? refreshed : [])
      if (selectedId) selectDeal(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  const action = selectedId ? statusActions[form.status] ?? null : null

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة العروض اليومية</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <select value={selectedId || ''} onChange={(e) => selectDeal(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر عرض...</option>
        {deals.map((d: any) => (
          <option key={d.id} value={d.id}>
            {d.title} ({d.status})
          </option>
        ))}
      </select>

      {selectedId && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="بيانات العرض"
            columns={DAILY_DEAL_COLUMNS}
            data={form}
            onChange={handleChange}
            readonly={!canManage}
          />

          {/* Items */}
          {dealItems.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <h2 className="text-sm font-bold">المنتجات</h2>
              {dealItems.map((item: any) => (
                <div key={item.id} className="flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2">
                  <span className="flex-1 font-semibold">{item.product_name || item.product_id}</span>
                  <span className="text-text-secondary">الكمية: {item.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {canManage && action && (
            <button onClick={() => handleStatusAction(action.action)} disabled={saving}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40 ${action.color}`}>
              {action.label}
            </button>
          )}

          {canManage && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">اختر عرض من القائمة أعلاه</div>
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
