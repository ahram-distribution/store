import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const refTypeLabels: Record<string, string> = {
  collection: 'سند قبض', expense: 'سند صرف', employee_advance: 'سلفة موظف',
  purchase: 'فاتورة شراء', supplier_payment: 'صرف لمورد', purchase_return: 'مرتجع شراء',
  advance_settlement: 'تسوية سلفة', cheque: 'شيك', sale: 'فاتورة بيع', sale_void: 'إلغاء فاتورة بيع',
  treasury_transfer_out: 'تحويل خزينة (صادر)', treasury_transfer_in: 'تحويل خزينة (وارد)',
}

interface Summary {
  today_inflow?: number
  today_outflow?: number
  month_inflow?: number
  month_outflow?: number
  balance?: number
  transactions?: any[]
  error?: string
}

interface DrawerInfo {
  id: string
  code: string
  name: string
  kind: 'cash' | 'bank'
  is_active: boolean
  balance: number
}

export function SahlTreasuryPage() {
  const nav = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'inflow' | 'outflow'>('all')
  const canManage = useCapability('sahl.settings.manage')

  // تحويل من خزينة لأخرى
  const [drawers, setDrawers] = useState<DrawerInfo[]>([])
  const [showTransfer, setShowTransfer] = useState(false)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [posting, setPosting] = useState(false)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const res = await supabase.rpc('sahl_get_treasury_summary', { p_token: token })
    if (res.error) toast.error(res.error.message)
    else {
      const data = res.data as Summary
      if (data?.error) toast.error(data.error)
      else setSummary(data)
    }
    const dr = await supabase.rpc('sahl_get_treasuries', { p_token: token })
    if (!dr.error) {
      const d = dr.data as any
      if (d?.error) toast.error(d.error)
      else {
        const list = (d || []) as DrawerInfo[]
        setDrawers(list)
        if (list.length && !fromId) setFromId(list[0].id)
      }
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function submitTransfer() {
    const token = getToken()
    if (!token) return
    if (!fromId || !toId) return toast.error('اختر الخزينة من وإلى')
    if (fromId === toId) return toast.error('لا يمكن التحويل لنفس الخزينة')
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('أدخل مبلغاً صحيحاً')
    setPosting(true)
    const res = await supabase.rpc('sahl_create_treasury_transfer', {
      p_token: token, p_from_treasury_id: fromId, p_to_treasury_id: toId,
      p_amount: amt, p_notes: notes.trim() || null,
    })
    setPosting(false)
    const data = res.data as any
    if (res.error) return toast.error(res.error.message)
    if (data?.error) return toast.error(data.error)
    toast.success(`تم التحويل — ${data.code}`)
    setShowTransfer(false); setAmount(''); setNotes('')
    loadData()
  }

  const movements = useMemo(() => {
    const all = summary?.transactions || []
    if (filter === 'all') return all
    return all.filter((t) => t.transaction_type === filter)
  }, [summary, filter])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الخزينة</h1>
            <p className="text-[10px] text-text-secondary">حركة النقدية — الوارد والمنصرف والرصيد</p>
          </div>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-text-secondary text-sm">جاري التحميل...</div>
      ) : !summary ? (
        <div className="text-center py-16 text-text-secondary text-sm">تعذر تحميل بيانات الخزينة</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-gradient-to-l from-slate-800 to-slate-700 rounded-xl p-4 col-span-2 md:col-span-1">
              <div className="text-[10px] text-white/70">رصيد الخزينة الحالي</div>
              <div className={`text-xl font-bold mt-1 ${(summary.balance || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatCurrencyShort(summary.balance || 0)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">وارد اليوم</div>
              <div className="text-lg font-bold text-success mt-1">{formatCurrencyShort(summary.today_inflow || 0)}</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">منصرف اليوم</div>
              <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(summary.today_outflow || 0)}</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">وارد الشهر</div>
              <div className="text-lg font-bold text-success mt-1">{formatCurrencyShort(summary.month_inflow || 0)}</div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <div className="text-[10px] text-text-secondary">منصرف الشهر</div>
              <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(summary.month_outflow || 0)}</div>
            </div>
          </div>

          {/* الخزائن — drawers & banks */}
          {drawers.length > 0 && (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 bg-surface border-b border-border">
                <h2 className="text-sm font-bold text-text">🏦 الخزائن والحسابات البنكية</h2>
                {canManage && (
                  <button onClick={() => setShowTransfer(v => !v)}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg bg-primary text-white font-semibold">
                    تحويل من خزينة لأخرى
                  </button>
                )}
              </div>
              {showTransfer && canManage && (
                <div className="px-5 py-4 bg-primary/5 border-b border-border space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block">
                      <span className="text-[10px] text-text-secondary block mb-1">من خزينة</span>
                      <select value={fromId} onChange={e => setFromId(e.target.value)}
                        className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-white">
                        {drawers.filter(d => d.is_active).map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({formatCurrencyShort(d.balance)})</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-text-secondary block mb-1">إلى خزينة</span>
                      <select value={toId} onChange={e => setToId(e.target.value)}
                        className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-white">
                        <option value="">— اختر —</option>
                        {drawers.filter(d => d.is_active && d.id !== fromId).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-text-secondary block mb-1">المبلغ</span>
                      <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                        placeholder="0.00" className="w-full text-xs border border-border rounded-lg px-3 py-2" />
                    </label>
                  </div>
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)"
                    className="w-full text-xs border border-border rounded-lg px-3 py-2" />
                  <div className="flex gap-2">
                    <button onClick={submitTransfer} disabled={posting}
                      className="text-xs px-4 py-2 rounded-lg bg-success text-white font-bold disabled:opacity-50">
                      {posting ? 'جاري الحفظ...' : 'حفظ'}
                    </button>
                    <button onClick={() => setShowTransfer(false)}
                      className="text-xs px-4 py-2 rounded-lg border border-border text-text-secondary">تراجع</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-x-reverse divide-border/60">
                {drawers.map(d => (
                  <div key={d.id} className={`p-4 ${!d.is_active ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-1.5">
                      <span>{d.kind === 'bank' ? '🏛️' : '💵'}</span>
                      <span className="text-xs font-bold text-text">{d.name}</span>
                      {!d.is_active && <span className="text-[9px] text-danger">(غير نشطة)</span>}
                    </div>
                    <div className={`text-base font-bold mt-1 ${(d.balance || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatCurrencyShort(d.balance || 0)}
                    </div>
                    <div className="text-[9px] text-text-secondary mt-0.5">{d.kind === 'bank' ? 'حساب بنكي' : 'درج نقدية'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-surface border-b border-border">
              <h2 className="text-sm font-bold text-text">📜 حركة النقدية</h2>
              <div className="flex gap-1.5">
                {([['all', 'الكل'], ['inflow', 'وارد'], ['outflow', 'منصرف']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setFilter(k)}
                    className={`text-[10px] px-2 py-1 rounded ${filter === k ? 'bg-primary text-white' : 'border border-border text-text-secondary'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {movements.length === 0 ? (
              <div className="text-center py-12 text-text-secondary text-sm">لا توجد حركات</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
                {movements.map((t: any) => {
                  const isIn = t.transaction_type === 'inflow'
                  return (
                    <div key={t.id} className="px-5 py-3 hover:bg-surface/60 transition-colors flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${isIn ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                            {isIn ? 'وارد ↓' : 'منصرف ↑'}
                          </span>
                          <span className="text-xs font-semibold text-text">{refTypeLabels[t.reference_type] || t.reference_type}</span>
                          {t.doc_code && <span className="text-[10px] text-text-secondary">{t.doc_code}</span>}
                        </div>
                        <div className="text-[10px] text-text-secondary mt-0.5 truncate">
                          {t.party_name ? `${t.party_name} • ` : ''}{t.notes || ''}
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className={`text-sm font-bold ${isIn ? 'text-success' : 'text-danger'}`}>
                          {isIn ? '+' : '-'}{formatCurrencyShort(t.amount)}
                        </div>
                        <div className="text-[9px] text-text-secondary">{formatDate(t.created_at)}{t.created_by_name ? ` • ${t.created_by_name}` : ''}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
