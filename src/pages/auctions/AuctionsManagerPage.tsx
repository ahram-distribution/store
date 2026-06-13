import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, AUCTION_COLUMNS } from '../../utils/schemaEditor'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export function AuctionsManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('auctions.manage')

  const [auctions, setAuctions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [auctionItems, setAuctionItems] = useState<any[]>([])

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<Record<string, any>>({})

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_auctions', { p_token: token }).then(({ data }) => {
      if (data) setAuctions(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  function selectAuction(id: string) {
    const a = auctions.find((x: any) => x.id === id)
    if (!a) { setSelectedId(null); return }
    setSelectedId(id)
    setShowCreate(false)
    const map: Record<string, any> = {}
    for (const col of AUCTION_COLUMNS) {
      const v = a[col.key]
      if (col.inputType === 'datetime-local' && v) {
        map[col.key] = toLocalISO(v)
      } else {
        map[col.key] = v ?? (col.inputType === 'boolean' ? false : '')
      }
    }
    setForm(map)
    setAuctionItems(a.items || [])
  }

  function handleChange(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleCreateChange(key: string, value: any) {
    setCreateForm((prev) => ({ ...prev, [key]: value }))
  }

  function validateAuction(data: Record<string, any>, isCreate: boolean): string | null {
    if (!data.title?.trim()) return 'العنوان مطلوب'
    if (!data.code?.trim()) return 'الكود مطلوب'
    const sp = parseFloat(data.starting_price)
    if (isCreate && (isNaN(sp) || sp < 0)) return 'السعر الابتدائي غير صالح'
    const bi = parseFloat(data.bid_increment)
    if (isCreate && (isNaN(bi) || bi <= 0)) return 'زيادة المزايدة غير صالحة'
    if (data.start_time && data.end_time && new Date(data.start_time) >= new Date(data.end_time)) {
      return 'وقت البدء يجب أن يكون قبل وقت الانتهاء'
    }
    return null
  }

  async function handleSave() {
    if (!selectedId || !canManage) return
    const err = validateAuction(form, false)
    if (err) { toast.error(err); return }
    setSaving(true)
    const token = getToken()
    try {
      function buildRpcParams(targetId: string | null) {
        const params: Record<string, any> = { p_token: token }
        if (targetId) params.p_id = targetId
        for (const col of AUCTION_COLUMNS) {
          if (col.hidden || col.readonly || col.key === 'id' || col.key === 'created_at' || col.key === 'updated_at' || col.key === 'status' || col.key === 'current_price' || col.key === 'winner_amount' || col.key === 'winner_id') continue
          if (col.key === 'code' || col.key === 'created_by') continue
          const v = form[col.key]
          if (col.inputType === 'datetime-local' && v) {
            params[`p_${col.key}`] = new Date(v).toISOString()
          } else if (col.inputType === 'number' && (v === '' || v === null || v === undefined)) {
            continue
          } else if (col.inputType === 'number') {
            params[`p_${col.key}`] = parseFloat(v)
          } else if (col.inputType === 'boolean') {
            params[`p_${col.key}`] = v
          } else {
            params[`p_${col.key}`] = v || null
          }
        }
        return params
      }

      const { error } = await supabase.rpc('governed_update_auction', buildRpcParams(selectedId))
      if (error) { toast.error(error.message); setSaving(false); return }

      toast.success('تم حفظ التعديلات')

      const { data: refreshed } = await supabase.rpc('get_governed_auctions', { p_token: token })
      if (refreshed) setAuctions(Array.isArray(refreshed) ? refreshed : [])
      if (selectedId) selectAuction(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  function openCreateForm() {
    const blank: Record<string, any> = {}
    for (const col of AUCTION_COLUMNS) {
      if (col.key === 'status' || col.key === 'current_price' || col.key === 'winner_amount' || col.key === 'winner_id') continue
      blank[col.key] = col.inputType === 'boolean' ? false : ''
    }
    blank.code = `AUC-${Date.now().toString(36).toUpperCase()}`
    setCreateForm(blank)
    setShowCreate(true)
    setSelectedId(null)
  }

  async function handleCreate() {
    if (!canManage) return
    const err = validateAuction(createForm, true)
    if (err) { toast.error(err); return }
    setSaving(true)
    const token = getToken()
    try {
      const code = createForm.code?.trim() || `AUC-${Date.now().toString(36).toUpperCase()}`
      const { error } = await supabase.rpc('governed_create_auction', {
        p_token: token,
        p_code: code,
        p_title: createForm.title?.trim() || 'مزاد جديد',
        p_description: createForm.description || null,
        p_image_url: createForm.image_url || null,
        p_starting_price: parseFloat(createForm.starting_price) || 0,
        p_bid_increment: parseFloat(createForm.bid_increment) || 1,
        p_deposit_amount: createForm.deposit_amount ? parseFloat(createForm.deposit_amount) : null,
        p_start_time: createForm.start_time ? new Date(createForm.start_time).toISOString() : new Date().toISOString(),
        p_end_time: createForm.end_time ? new Date(createForm.end_time).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      })

      if (error) { toast.error(error.message); setSaving(false); return }
      toast.success('تم إنشاء المزاد')

      const { data: refreshed } = await supabase.rpc('get_governed_auctions', { p_token: token })
      if (refreshed) setAuctions(Array.isArray(refreshed) ? refreshed : [])
      setShowCreate(false)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة المزادات</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      {/* Create button */}
      {canManage && !showCreate && (
        <button onClick={openCreateForm} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + إنشاء مزاد جديد
        </button>
      )}

      {/* Create form */}
      {showCreate && canManage && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="مزاد جديد"
            columns={AUCTION_COLUMNS.filter(c =>
              c.key !== 'status' && c.key !== 'current_price' && c.key !== 'winner_amount' && c.key !== 'winner_id' && c.key !== 'available_quantity'
            )}
            data={createForm}
            onChange={handleCreateChange}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving}
              className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الإنشاء...' : 'إنشاء المزاد'}
            </button>
            <button onClick={() => setShowCreate(false)} disabled={saving}
              className="px-6 border border-border rounded-xl py-2.5 text-sm font-semibold text-text-secondary active:opacity-90">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Select dropdown */}
      {!showCreate && (
        <select value={selectedId || ''} onChange={(e) => selectAuction(e.target.value)}
          className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">اختر مزاد...</option>
          {auctions.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.status}) — {a.code}
            </option>
          ))}
        </select>
      )}

      {selectedId && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="بيانات المزاد"
            columns={AUCTION_COLUMNS}
            data={form}
            onChange={handleChange}
            readonly={!canManage}
          />

          {/* Items */}
          {auctionItems.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <h2 className="text-sm font-bold">المنتجات</h2>
              {auctionItems.map((item: any) => (
                <div key={item.id} className="flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2">
                  <span className="flex-1 font-semibold">{item.product_name || item.product_id}</span>
                  <span className="text-text-secondary">الكمية: {item.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
                {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
              <button onClick={() => setSelectedId(null)}
                className="px-6 border border-border rounded-xl py-3 text-sm font-semibold text-text-secondary active:opacity-90">
                عودة
              </button>
            </>
          )}
        </div>
      )}

      {!selectedId && !showCreate && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">اختر مزاد من القائمة أعلاه</div>
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
