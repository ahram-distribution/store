import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface CustomerRow {
  id: string
  code?: string
  company_name?: string
  phone?: string
  current_balance?: number | null
}

export function SahlAccountsPage() {
  const nav = useNavigate()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [collections, setCollections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statementCustomer, setStatementCustomer] = useState<CustomerRow | null>(null)
  const [ledgerRows, setLedgerRows] = useState<any[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  async function loadData() {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const [custRes, colRes] = await Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_collections', { p_token: token }),
    ])
    if (custRes.data && Array.isArray(custRes.data)) setCustomers(custRes.data as CustomerRow[])
    else if (custRes.error) toast.error(custRes.error.message)
    if (colRes.data && Array.isArray(colRes.data)) setCollections(colRes.data as any[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const totals = useMemo(() => {
    let debt = 0
    let debtors = 0
    for (const c of customers) {
      const b = Number(c.current_balance || 0)
      if (b > 0) { debt += b; debtors++ }
    }
    return { debt, debtors }
  }, [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? customers.filter((c) =>
          (c.company_name || '').toLowerCase().includes(q) ||
          (c.code || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q))
      : customers
    return [...list].sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
  }, [customers, search])

  async function openStatement(cust: CustomerRow) {
    setStatementCustomer(cust)
    setLedgerRows([])
    const token = getToken()
    if (!token) return
    setLedgerLoading(true)
    const res = await supabase.rpc('sahl_get_customer_ledger', { p_token: token, p_customer_id: cust.id })
    setLedgerLoading(false)
    if (res.error) { toast.error(res.error.message); return }
    const data = res.data as any
    if (data?.error) { toast.error(data.error); return }
    setLedgerRows(Array.isArray(data) ? data : [])
  }

  const customerCollections = useMemo(() =>
    statementCustomer ? collections.filter((r) => r.customer_id === statementCustomer.id).slice(0, 15) : []
  , [collections, statementCustomer])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/sahl')} className="text-text-secondary text-lg">&rarr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">الحسابات</h1>
            <p className="text-[10px] text-text-secondary">أرصدة العملاء وكشوف الحساب</p>
          </div>
        </div>
        <button onClick={loadData} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">إجمالي مستحقات العملاء</div>
          <div className="text-lg font-bold text-danger mt-1">{formatCurrencyShort(totals.debt)}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">عملاء عليهم مديونية</div>
          <div className="text-lg font-bold text-warning mt-1">{totals.debtors}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-[10px] text-text-secondary">إجمالي العملاء</div>
          <div className="text-lg font-bold text-text mt-1">{customers.length}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-surface border-b border-border flex items-center gap-3">
          <h2 className="text-sm font-bold text-text shrink-0">👥 أرصدة العملاء</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم / الكود / الهاتف..."
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-xs bg-white outline-none focus:border-primary" />
        </div>
        {loading ? (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا يوجد عملاء مطابقون</div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[560px] overflow-y-auto">
            {filtered.map((c) => {
              const bal = Number(c.current_balance || 0)
              return (
                <button key={c.id} onClick={() => openStatement(c)}
                  className="w-full text-right px-5 py-3 hover:bg-surface/60 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{c.company_name}</div>
                    <div className="text-[10px] text-text-secondary">{c.code}{c.phone ? ` • ${c.phone}` : ''}</div>
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${bal > 0 ? 'text-danger' : bal < 0 ? 'text-warning' : 'text-success'}`}>
                    {formatCurrencyShort(bal)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setStatementCustomer(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-slate-700 to-slate-600 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">كشف حساب — {statementCustomer.company_name}</h3>
                <p className="text-[10px] text-white/70 mt-0.5">{statementCustomer.code}{statementCustomer.phone ? ` • ${statementCustomer.phone}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => nav('/sahl/receipts')} className="text-[10px] bg-emerald-700 text-white px-2.5 py-1.5 rounded">سند قبض جديد</button>
                <div className="text-left">
                  <div className="text-[10px] text-white/70">الرصيد المستحق</div>
                  <div className="text-lg font-bold text-white">{formatCurrencyShort(statementCustomer.current_balance || 0)}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border overflow-y-auto">
              <div className="p-4">
                <h4 className="text-xs font-bold text-text mb-2">آخر حركات الحساب</h4>
                {ledgerLoading ? (
                  <div className="text-center py-8 text-text-secondary text-xs">جاري التحميل...</div>
                ) : ledgerRows.length === 0 ? (
                  <div className="text-center py-8 text-text-secondary text-xs">لا توجد حركات مسجلة على الدفتر</div>
                ) : (
                  <div className="space-y-1.5">
                    {ledgerRows.map((l: any) => (
                      <div key={l.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-text-secondary">{formatDate(l.created_at)}</span>
                        <span className={l.transaction_type === 'debit' ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                          {l.transaction_type === 'debit' ? '+' : '-'}{formatCurrencyShort(l.amount)}
                        </span>
                        <span className="text-[9px] text-text-secondary w-24 text-left truncate" title={l.notes || ''}>{l.notes || l.reference_type || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h4 className="text-xs font-bold text-text mb-2">سندات القبض</h4>
                {customerCollections.length === 0 ? (
                  <div className="text-center py-8 text-text-secondary text-xs">لا توجد سندات</div>
                ) : (
                  <div className="space-y-1.5">
                    {customerCollections.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-text-secondary">{formatDate(r.created_at)}</span>
                        <span>{r.code} <span className={`text-[9px] ${r.status === 'treasury_posted' ? 'text-success' : 'text-accent'}`}>{r.status === 'treasury_posted' ? '(مرحّل)' : '(غير مرحّل)'}</span></span>
                        <span className="font-semibold text-success">{formatCurrencyShort(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-border p-3 text-center">
              <button onClick={() => setStatementCustomer(null)} className="text-text-secondary text-xs py-1">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
