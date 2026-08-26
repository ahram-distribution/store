import { useState, useEffect, useMemo } from 'react'
import { sectorsService } from '../../services/sectors'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import type { Sector, SectorGovernorate } from '../../types/sectors'

export function SectorGovernoratesScreen() {
  const canManage = useCapability('sectors.manage')

  const [sectors, setSectors] = useState<Sector[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formNameAr, setFormNameAr] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [assigningSectorId, setAssigningSectorId] = useState<string | null>(null)
  const [selectedGovIds, setSelectedGovIds] = useState<string[]>([])

  async function loadData() {
    setLoading(true)
    try {
      const [sectorsData, govData] = await Promise.all([
        sectorsService.getSectors(),
        supabase.from('reference_governorates').select('id, name_ar').order('name_ar'),
      ])
      setSectors(sectorsData)
      if (govData.data) setGovernorates(govData.data)
    } catch (e: any) {
      toast.error(e?.message || 'فشل تحميل البيانات')
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const filteredSectors = useMemo(() => {
    if (!search) return sectors
    const q = search.toLowerCase()
    return sectors.filter(s =>
      s.name.toLowerCase().includes(q) || (s.name_ar || '').includes(q)
    )
  }, [sectors, search])

  async function handleSave() {
    if (!formName.trim()) { toast.error('اسم القطاع مطلوب'); return }
    setSubmitting(true)
    try {
      if (editingId) {
        await sectorsService.updateSector(editingId, { name: formName, name_ar: formNameAr, description: formDesc })
        toast.success('تم تحديث القطاع')
      } else {
        await sectorsService.createSector(formName, formNameAr, formDesc)
        toast.success('تم إنشاء القطاع')
      }
      resetForm()
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'فشل الحفظ')
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذا القطاع؟')) return
    try {
      await sectorsService.deleteSector(id)
      toast.success('تم الحذف')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'فشل الحذف')
    }
  }

  async function handleToggleActive(sector: Sector) {
    try {
      await sectorsService.updateSector(sector.id, { is_active: !sector.is_active })
      toast.success(sector.is_active ? 'تم إيقاف القطاع' : 'تم تفعيل القطاع')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message)
    }
  }

  async function handleOpenAssignGovs(sector: Sector) {
    setAssigningSectorId(sector.id)
    try {
      const current = await sectorsService.getSectorGovernorates(sector.id)
      setSelectedGovIds(current.map(g => g.governorate_id))
    } catch {
      setSelectedGovIds([])
    }
  }

  async function handleSaveGovAssignment() {
    if (!assigningSectorId) return
    setSubmitting(true)
    try {
      await sectorsService.setSectorGovernorates(assigningSectorId, selectedGovIds)
      toast.success('تم حفظ تعيين المحافظات')
      setAssigningSectorId(null)
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'فشل الحفظ')
    }
    setSubmitting(false)
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setFormName('')
    setFormNameAr('')
    setFormDesc('')
  }

  function openEdit(sector: Sector) {
    setEditingId(sector.id)
    setFormName(sector.name)
    setFormNameAr(sector.name_ar || '')
    setFormDesc(sector.description || '')
    setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">إدارة القطاعات والمحافظات</h1>

      {canManage && (
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة قطاع</button>
      )}

      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="بحث في القطاعات..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      {showForm && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <h2 className="text-sm font-bold text-text">{editingId ? 'تعديل قطاع' : 'قطاع جديد'}</h2>
          <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="اسم القطاع (إنجليزي) *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          <input type="text" value={formNameAr} onChange={e => setFormNameAr(e.target.value)} placeholder="اسم القطاع (عربي)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="وصف" className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" rows={2} />
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
              {submitting ? 'جاري الحفظ...' : 'حفظ'}
            </button>
            <button onClick={resetForm} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filteredSectors.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">لا توجد قطاعات</div>
      ) : (
        <div className="space-y-2">
          {filteredSectors.map(sector => (
            <div key={sector.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-text">{sector.name_ar || sector.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${sector.is_active ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {sector.is_active ? 'نشط' : 'موقوف'}
                    </span>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">{sector.governorate_count} محافظة</span>
                  </div>
                  {sector.name_ar && sector.name !== sector.name_ar && <div className="text-[11px] text-text-secondary">{sector.name}</div>}
                  {sector.description && <div className="text-[10px] text-text-secondary mt-0.5">{sector.description}</div>}
                </div>
              </div>
              {canManage && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button onClick={() => openEdit(sector)}
                    className="text-[10px] bg-surface text-text-secondary px-2 py-1 rounded">تعديل</button>
                  <button onClick={() => handleToggleActive(sector)}
                    className={`text-[10px] px-2 py-1 rounded ${sector.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                    {sector.is_active ? 'إيقاف' : 'تفعيل'}
                  </button>
                  <button onClick={() => handleDelete(sector.id)}
                    className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">حذف</button>
                  <button onClick={() => handleOpenAssignGovs(sector)}
                    className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعيين محافظات</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {assigningSectorId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-lg bg-white rounded-xl border border-border p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">تعيين محافظات للقطاع</h3>
            <div className="text-[11px] text-text-secondary">
              المحافظات المحددة: {selectedGovIds.length}
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
              {governorates.map(g => (
                <label key={g.id} className="flex items-center gap-2 text-xs py-1 cursor-pointer hover:bg-surface rounded px-1">
                  <input type="checkbox" checked={selectedGovIds.includes(g.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedGovIds(prev => [...prev, g.id])
                      else setSelectedGovIds(prev => prev.filter(id => id !== g.id))
                    }}
                    className="rounded" />
                  <span className="text-text">{g.name_ar}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveGovAssignment} disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
                {submitting ? 'جاري الحفظ...' : 'حفظ التعيين'}
              </button>
              <button onClick={() => setAssigningSectorId(null)} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
