import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../hooks/useCapability'
import { DynamicSchemaEditor, CREDIT_PROGRAM_COLUMNS } from '../../utils/schemaEditor'
import toast from 'react-hot-toast'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

export function CreditProgramsManagerPage() {
  const nav = useNavigate()
  const canManage = useCapability('credit.program.manage')

  const [programs, setPrograms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})

  const load = (token: string | null) => {
    if (!token) return
    supabase.rpc('governed_get_credit_programs', { p_token: token, p_include_inactive: true }).then(({ data }) => {
      if (data) setPrograms(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    load(token)
  }, [])

  function selectProgram(id: string) {
    const p = programs.find((x: any) => x.id === id)
    if (!p) { setSelectedId(null); return }
    setSelectedId(id)
    const map: Record<string, any> = {}
    for (const col of CREDIT_PROGRAM_COLUMNS) {
      const v = p[col.key]
      map[col.key] = v ?? (col.inputType === 'boolean' ? false : '')
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
      const { error } = await supabase.rpc('governed_update_credit_program', {
        p_token: token,
        p_id: selectedId,
        p_name: form.name || null,
        p_credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
        p_credit_days: form.credit_days ? parseInt(form.credit_days) : null,
        p_terms: form.terms || null,
      })
      if (error) { toast.error(error.message); setSaving(false); return }

      toast.success('تم حفظ التغييرات')
      load(token)
      if (selectedId) selectProgram(selectedId)
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ')
    }
    setSaving(false)
  }

  async function handleToggle(id: string, currentActive: boolean) {
    if (!canManage) return
    const token = getToken()
    const { error } = await supabase.rpc('governed_toggle_credit_program', {
      p_token: token, p_id: id, p_is_active: !currentActive,
    })
    if (error) { toast.error(error.message); return }
    toast.success(currentActive ? 'تم إيقاف البرنامج' : 'تم تفعيل البرنامج')
    load(token)
  }

  async function handleCreate() {
    if (!canManage) return
    const name = prompt('اسم البرنامج الجديد:')
    if (!name?.trim()) return
    setSaving(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_create_credit_program', {
      p_token: token,
      p_name: name.trim(),
      p_credit_limit: 0,
      p_credit_days: 30,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('تم إنشاء البرنامج')
    load(token)
    setSaving(false)
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إدارة برامج الائتمان</h1>
        {!canManage && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded">عرض فقط</span>}
      </div>

      <select value={selectedId || ''} onChange={(e) => selectProgram(e.target.value)}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">اختر برنامج...</option>
        {programs.map((p: any) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.credit_limit && `${p.credit_limit.toLocaleString()}ج`}) {!p.is_active ? '— موقوف' : ''}
          </option>
        ))}
      </select>

      {canManage && (
        <button onClick={handleCreate} disabled={saving}
          className="w-full bg-primary/10 text-primary rounded-xl py-2.5 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          + إنشاء برنامج جديد
        </button>
      )}

      {selectedId && (
        <div className="space-y-4">
          <DynamicSchemaEditor
            title="بيانات البرنامج"
            columns={CREDIT_PROGRAM_COLUMNS}
            data={form}
            onChange={handleChange}
            readonly={!canManage}
          />

          <div className="flex gap-2">
            {canManage && (
              <button onClick={() => handleToggle(selectedId, form.is_active)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold active:opacity-90 ${form.is_active ? 'bg-warning text-white' : 'bg-success text-white'}`}>
                {form.is_active ? 'إيقاف البرنامج' : 'تفعيل البرنامج'}
              </button>
            )}
          </div>

          {canManage && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          )}
        </div>
      )}

      {!selectedId && !loading && (
        <div className="text-center py-12 text-text-secondary text-sm">اختر برنامج من القائمة أعلاه</div>
      )}
    </div>
  )
}
