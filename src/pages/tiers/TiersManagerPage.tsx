import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, TIER_COLUMNS } from '../../utils/schemaEditor'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export function TiersManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('tiers.manage')

  const [tiers, setTiers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_tiers', { p_token: token }).then(({ data }) => {
      if (data) setTiers(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  function selectTier(id: string) {
    const t = tiers.find((x: any) => x.id === id)
    if (!t) { setSelectedId(null); return }
    setSelectedId(id)
    const map: Record<string, any> = {}
    for (const col of TIER_COLUMNS) {
      const v = t[col.key]
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

  async function handleSave() {
    if (!selectedId || !canManage) return
    setSaving(true)
    const token = getToken()
    try {
      const payload: Record<string, any> = { p_token: token, p_id: selectedId }
      for (const col of TIER_COLUMNS) {
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

      const { error } = await supabase.rpc('governed_update_tier', payload)
      if (error) { toast.error(error.message); setSaving(false); return }

      toast.success('تم حفظ التغييرات')

      const { data: refreshed } = await supabase.rpc('get_governed_tiers', { p_token: token })
      if (refreshed) setTiers(Array.isArray(refreshed) ? refreshed : [])
      if (selectedId) selectTier(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  async function handleCreate() {
    if (!canManage) return
    const name = prompt('اسم الشريحة الجديدة:')
    if (!name?.trim()) return
    setSaving(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_create_tier', { p_token: token, p_name: name.trim() })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('تم إنشاء الشريحة')
    const { data } = await supabase.rpc('get_governed_tiers', { p_token: token })
    if (data) setTiers(Array.isArray(data) ? data : [])
    setSaving(false)
  }

  const filtered = tiers.filter((t: any) => {
    if (!selectedId) return true
    return true
  })

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة الشرائح</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <select value={selectedId || ''} onChange={(e) => selectTier(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر شريحة...</option>
        {tiers.map((t: any) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.discount_percent}%) {!t.is_active ? '— موقوف' : ''}
          </option>
        ))}
      </select>

      {canManage && (
        <button onClick={handleCreate} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + إنشاء شريحة جديدة
        </button>
      )}

      {selectedId && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="بيانات الشريحة"
            columns={TIER_COLUMNS}
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
        <div className="text-center py-12 text-text-secondary text-sm">اختر شريحة من القائمة أعلاه</div>
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
