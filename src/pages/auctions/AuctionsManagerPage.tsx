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

  async function handleSave() {
    if (!selectedId || !canManage) return
    setSaving(true)
    const token = getToken()
    try {
      const patch: Record<string, any> = {}
      for (const col of AUCTION_COLUMNS) {
        if (col.hidden || col.readonly || col.key === 'id' || col.key === 'created_at' || col.key === 'updated_at') continue
        const v = form[col.key]
        if (col.inputType === 'datetime-local' && v) {
          patch[col.key] = new Date(v).toISOString()
        } else if (col.inputType === 'number' && (v === '' || v === null || v === undefined)) {
          continue
        } else if (col.inputType === 'number') {
          patch[col.key] = parseFloat(v)
        } else if (col.inputType === 'boolean') {
          patch[col.key] = v
        } else {
          patch[col.key] = v || null
        }
      }
      delete patch.created_by

      const { error } = await supabase.from('auctions').update(patch).eq('id', selectedId)
      if (error) { toast.error(error.message); setSaving(false); return }

      toast.success('تم حفظ التغييرات')

      const { data: refreshed } = await supabase.rpc('get_governed_auctions', { p_token: token })
      if (refreshed) setAuctions(Array.isArray(refreshed) ? refreshed : [])
      if (selectedId) selectAuction(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  async function handleCreate() {
    if (!canManage) return
    const title = prompt('عنوان المزاد الجديد:')
    if (!title?.trim()) return
    setSaving(true)
    const token = getToken()
    const code = `AUC-${Date.now().toString(36).toUpperCase()}`
    const { error } = await supabase.from('auctions').insert({
      code,
      title: title.trim(),
      starting_price: 0,
      current_price: 0,
      bid_increment: 1,
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_by: token,
    }).select().single()

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('تم إنشاء المزاد')

    const { data: refreshed } = await supabase.rpc('get_governed_auctions', { p_token: token })
    if (refreshed) setAuctions(Array.isArray(refreshed) ? refreshed : [])
    setSaving(false)
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة المزادات</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <select value={selectedId || ''} onChange={(e) => selectAuction(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر مزاد...</option>
        {auctions.map((a: any) => (
          <option key={a.id} value={a.id}>
            {a.title} ({a.status}) — {a.code}
          </option>
        ))}
      </select>

      {canManage && (
        <button onClick={handleCreate} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + إنشاء مزاد جديد
        </button>
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
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
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
