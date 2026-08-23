import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface StoreRow { id: string; code: string; name: string; is_active: boolean; notes?: string | null }
interface TreasuryRow { id: string; code: string; name: string; kind: 'cash' | 'bank'; is_active: boolean; notes?: string | null }
type Settings = Record<string, unknown>

export function SahlSettingsPage() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<Settings>({})
  const [stores, setStores] = useState<StoreRow[]>([])
  const [treasuries, setTreasuries] = useState<TreasuryRow[]>([])
  const [savingKey, setSavingKey] = useState('')

  const [stCode, setStCode] = useState('')
  const [stName, setStName] = useState('')
  const [stNotes, setStNotes] = useState('')
  const [editStore, setEditStore] = useState<StoreRow | null>(null)

  const [trCode, setTrCode] = useState('')
  const [trName, setTrName] = useState('')
  const [trKind, setTrKind] = useState<'cash' | 'bank'>('cash')
  const [trNotes, setTrNotes] = useState('')
  const [editTreasury, setEditTreasury] = useState<TreasuryRow | null>(null)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [sRes, stRes, trRes] = await Promise.all([
      supabase.rpc('sahl_get_settings', { p_token: token }),
      supabase.rpc('sahl_get_stores', { p_token: token }),
      supabase.rpc('sahl_get_treasuries', { p_token: token }),
    ])
    setLoading(false)
    if (!sRes.error && sRes.data && !(sRes.data as any).error) setSettings(sRes.data as Settings)
    if (!stRes.error && Array.isArray(stRes.data)) setStores(stRes.data as StoreRow[])
    if (!trRes.error && Array.isArray(trRes.data)) setTreasuries(trRes.data as TreasuryRow[])
  }

  useEffect(() => { loadData() }, [])

  async function updateSetting(key: string, value: string) {
    const token = getToken()
    if (!token) return
    setSavingKey(key)
    const res = await supabase.rpc('sahl_update_setting', {
      p_token: token, p_key: key, p_value: JSON.stringify(value),
    })
    setSavingKey('')
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      toast.error(data.error === 'MISSING_CAPABILITY: sahl.settings.manage' ? 'تحتاج صلاحية إدارة الإعدادات' : data.error)
      return
    }
    setSettings(prev => ({ ...prev, [key]: value }))
    toast.success('تم الحفظ')
    await loadData()
  }

  async function saveStore() {
    const token = getToken()
    if (!token) return
    if (!stName.trim()) { toast.error('أدخل اسم المخزن'); return }
    if (!editStore && !stCode.trim()) { toast.error('أدخل كود المخزن'); return }
    const res = await supabase.rpc('sahl_upsert_store', {
      p_token: token,
      p_store_id: editStore?.id || null,
      p_code: editStore ? editStore.code : stCode.trim(),
      p_name: stName.trim(),
      p_is_active: true,
      p_notes: stNotes.trim() || null,
    })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.error === 'CODE_LOCKED') toast.error('لا يمكن تعديل كود المخزن الرئيسي')
      else if (data.error === 'DUPLICATE_CODE') toast.error('الكود مستخدم بالفعل')
      else if (String(data.error).startsWith('MISSING_CAPABILITY')) toast.error('تحتاج صلاحية إدارة الإعدادات')
      else toast.error(data.error)
      return
    }
    toast.success(editStore ? 'تم تحديث المخزن' : 'تم إضافة المخزن')
    setEditStore(null); setStCode(''); setStName(''); setStNotes('')
    await loadData()
  }

  async function saveTreasury() {
    const token = getToken()
    if (!token) return
    if (!trName.trim()) { toast.error('أدخل اسم الخزانة'); return }
    if (!editTreasury && !trCode.trim()) { toast.error('أدخل كود الخزانة'); return }
    const res = await supabase.rpc('sahl_upsert_treasury', {
      p_token: token,
      p_treasury_id: editTreasury?.id || null,
      p_code: editTreasury ? editTreasury.code : trCode.trim(),
      p_name: trName.trim(),
      p_kind: trKind,
      p_is_active: true,
      p_notes: trNotes.trim() || null,
    })
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) {
      if (data.error === 'CODE_LOCKED') toast.error('لا يمكن تعديل كود الخزانة الرئيسية')
      else if (data.error === 'DUPLICATE_CODE') toast.error('الكود مستخدم بالفعل')
      else if (String(data.error).startsWith('MISSING_CAPABILITY')) toast.error('تحتاج صلاحية إدارة الإعدادات')
      else toast.error(data.error)
      return
    }
    toast.success(editTreasury ? 'تم تحديث الخزانة' : 'تم إضافة الخزانة')
    setEditTreasury(null); setTrCode(''); setTrName(''); setTrNotes(''); setTrKind('cash')
    await loadData()
  }

  function startEditStore(s: StoreRow) {
    setEditStore(s)
    setStCode(s.code); setStName(s.name); setStNotes(s.notes || '')
  }
  function startEditTreasury(t: TreasuryRow) {
    setEditTreasury(t)
    setTrCode(t.code); setTrName(t.name); setTrKind(t.kind); setTrNotes(t.notes || '')
  }

  const str = (k: string, d = '') => (typeof settings[k] === 'string' ? settings[k] as string : d)

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">إعدادات سهل</h1>
            <p className="text-[10px] text-text-secondary">المخازن والخزائن وتفضيلات العمل</p>
          </div>
        </div>
        <button onClick={loadData} disabled={loading}
          className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <section className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-bold text-text">⚙️ التفضيلات العامة</h2>
        </div>
        <div className="p-5 grid md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-text-secondary block mb-1.5">المخزن الافتراضي</label>
            <select value={str('default_store_code', 'MAIN')}
              onChange={(e) => updateSetting('default_store_code', e.target.value)}
              disabled={savingKey === 'default_store_code'}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
              {stores.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
            </select>
            <p className="text-[9px] text-text-secondary mt-1">يُستخدم عند الشراء والمرتجعات إن لم تحدد مخزناً</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-text-secondary block mb-1.5">الدرج الافتراضي</label>
            <select value={str('default_drawer_code', 'MAIN')}
              onChange={(e) => updateSetting('default_drawer_code', e.target.value)}
              disabled={savingKey === 'default_drawer_code'}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
              {treasuries.map((t) => <option key={t.id} value={t.code}>{t.name}{t.kind === 'bank' ? ' (بنك)' : ''}</option>)}
            </select>
            <p className="text-[9px] text-text-secondary mt-1">يُستخدم للقبض والمصروف والبيع النقدي افتراضياً</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-text-secondary block mb-1.5">عرض ورق الطباعة</label>
            <select value={str('receipt_paper_width', '80mm')}
              onChange={(e) => updateSetting('receipt_paper_width', e.target.value)}
              disabled={savingKey === 'receipt_paper_width'}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white">
              <option value="80mm">رول 80mm</option>
              <option value="A4">A4</option>
            </select>
            <p className="text-[9px] text-text-secondary mt-1">القيمة الابتدائية لشاشة المبيعات والطباعة</p>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">🏬 المخازن ({stores.length})</h2>
        </div>
        <div className="divide-y divide-border/60">
          {stores.map((s) => (
            <div key={s.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text">{s.name}</span>
                  <span className="text-[9px] bg-surface rounded px-1.5 py-0.5 text-text-secondary">{s.code}</span>
                  {!s.is_active && <span className="text-[9px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">موقوف</span>}
                </div>
                {s.notes && <div className="text-[10px] text-text-secondary mt-0.5 truncate">{s.notes}</div>}
              </div>
              <button onClick={() => startEditStore(s)} className="shrink-0 text-[10px] text-primary border border-border rounded px-2 py-1">تعديل</button>
            </div>
          ))}
        </div>
        <div className="bg-surface/50 border-t border-border p-4">
          <div className="text-[11px] font-bold text-text mb-2">{editStore ? `تعديل: ${editStore.name}` : 'إضافة مخزن جديد'}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input value={stCode} onChange={(e) => setStCode(e.target.value)} placeholder="الكود *"
              disabled={!!editStore}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <input value={stName} onChange={(e) => setStName(e.target.value)} placeholder="الاسم *"
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <input value={stNotes} onChange={(e) => setStNotes(e.target.value)} placeholder="ملاحظات"
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <div className="flex gap-2">
              <button onClick={saveStore} className="flex-1 bg-primary text-primary-foreground rounded-lg text-xs font-bold py-2">{editStore ? 'حفظ' : 'إضافة'}</button>
              {editStore && (
                <button onClick={() => { setEditStore(null); setStCode(''); setStName(''); setStNotes('') }}
                  className="text-xs text-text-secondary border border-border rounded-lg px-3">إلغاء</button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-surface px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">💵 الخزائن والأدراج ({treasuries.length})</h2>
        </div>
        <div className="divide-y divide-border/60">
          {treasuries.map((t) => (
            <div key={t.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text">{t.name}</span>
                  <span className={`text-[9px] rounded px-1.5 py-0.5 ${t.kind === 'bank' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {t.kind === 'bank' ? 'حساب بنكي' : 'درج نقدي'}
                  </span>
                  <span className="text-[9px] bg-surface rounded px-1.5 py-0.5 text-text-secondary">{t.code}</span>
                  {!t.is_active && <span className="text-[9px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">موقوف</span>}
                </div>
                {t.notes && <div className="text-[10px] text-text-secondary mt-0.5 truncate">{t.notes}</div>}
              </div>
              <button onClick={() => startEditTreasury(t)} className="shrink-0 text-[10px] text-primary border border-border rounded px-2 py-1">تعديل</button>
            </div>
          ))}
        </div>
        <div className="bg-surface/50 border-t border-border p-4">
          <div className="text-[11px] font-bold text-text mb-2">{editTreasury ? `تعديل: ${editTreasury.name}` : 'إضافة خزانة جديدة'}</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input value={trCode} onChange={(e) => setTrCode(e.target.value)} placeholder="الكود *"
              disabled={!!editTreasury}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <input value={trName} onChange={(e) => setTrName(e.target.value)} placeholder="الاسم *"
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <select value={trKind} onChange={(e) => setTrKind(e.target.value as 'cash' | 'bank')}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="cash">درج نقدي</option>
              <option value="bank">حساب بنكي</option>
            </select>
            <input value={trNotes} onChange={(e) => setTrNotes(e.target.value)} placeholder="ملاحظات"
              className="border border-border rounded-lg px-3 py-2 text-sm bg-white" />
            <div className="flex gap-2">
              <button onClick={saveTreasury} className="flex-1 bg-primary text-primary-foreground rounded-lg text-xs font-bold py-2">{editTreasury ? 'حفظ' : 'إضافة'}</button>
              {editTreasury && (
                <button onClick={() => { setEditTreasury(null); setTrCode(''); setTrName(''); setTrNotes(''); setTrKind('cash') }}
                  className="text-xs text-text-secondary border border-border rounded-lg px-3">إلغاء</button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
