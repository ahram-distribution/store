import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

interface AppDetail {
  application: any; customer: any; program: any; contract: any | null
}

const statusLabels: Record<string, string> = {
  draft: 'مسودة', submitted: 'مقدم', under_review: 'قيد المراجعة', documents_received: 'المستندات كاملة', approved: 'معتمد', rejected: 'مرفوض', suspended: 'معلق'
}

export function CreditReviewPage() {
  const { id } = useParams(); const navigate = useNavigate()
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState('')
  const [docs, setDocs] = useState({ commercial: false, tax: false, national: false, cheques: false, contract: false })

  const load = () => {
    const token = getToken(); if (!token) return
    supabase.rpc('get_governed_credit_application', { p_token: token, p_id: id }).then(({ data }) => {
      if (data) setDetail(data as AppDetail); setLoading(false)
    })
  }

  useEffect(() => { load() }, [id])

  const a = detail?.application; const c = detail?.customer; const p = detail?.program; const cc = detail?.contract

  const action = async (fn: string, extra?: any) => {
    const token = getToken(); if (!token) { toast.error('جلسة منتهية'); return }
    const { error } = await supabase.rpc(fn, { p_token: token, p_id: id, ...extra })
    if (error) { toast.error(error.message); return }
    toast.success('تم بنجاح'); load()
  }

  const confirmDocs = async () => {
    const token = getToken(); if (!token) return
    const { error } = await supabase.rpc('governed_confirm_documents', {
      p_token: token, p_id: id,
      p_doc_commercial_reg: docs.commercial, p_doc_tax_card: docs.tax,
      p_doc_national_id: docs.national, p_doc_cheques: docs.cheques,
      p_doc_contract_signed: docs.contract
    })
    if (error) { toast.error(error.message); return }
    toast.success('تم تأكيد المستندات'); load()
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!detail) return <div className="text-center py-12 text-text-secondary text-sm">لم يتم العثور على الطلب</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">الائتمان</p>
        <h2 className="text-xl font-bold mt-1">تفاصيل الطلب</h2>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-semibold text-text">{c?.company_name}</p>
        <p className="text-xs text-text-secondary">البرنامج: {p?.name} - {p?.credit_limit?.toLocaleString()} ج.م / {p?.credit_days} يوم</p>
        <p className="text-xs text-text-secondary">الحالة: <span className="font-semibold">{statusLabels[a?.status] || a?.status}</span></p>
        {a?.submitted_at && <p className="text-xs text-text-secondary">تاريخ التقديم: {new Date(a.submitted_at).toLocaleDateString('ar-EG')}</p>}
        {a?.rejection_reason && <p className="text-xs text-red-600">سبب الرفض: {a.rejection_reason}</p>}
        {a?.suspension_reason && <p className="text-xs text-orange-600">سبب التعليق: {a.suspension_reason}</p>}
      </div>

      {['submitted', 'under_review'].includes(a?.status) && !a?.doc_confirmed_by && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text">تأكيد استلام المستندات</h3>
          {[{ k: 'commercial', l: 'السجل التجاري' }, { k: 'tax', l: 'البطاقة الضريبية' }, { k: 'national', l: 'الرقم القومي' }, { k: 'cheques', l: 'الشيكات' }, { k: 'contract', l: 'العقد الموقع' }].map(d => (
            <label key={d.k} className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={(docs as any)[d.k]} onChange={e => setDocs({ ...docs, [d.k]: e.target.checked })} className="accent-primary" />
              {d.l}
            </label>
          ))}
          <button onClick={confirmDocs} className="w-full bg-primary text-white rounded-xl p-2 text-sm font-semibold">تأكيد الاستلام</button>
        </div>
      )}

      {a?.status === 'submitted' && (
        <button onClick={() => action('governed_review_credit')} className="w-full bg-accent text-white rounded-xl p-3 text-sm font-semibold">بدء المراجعة</button>
      )}

      {['documents_received', 'under_review'].includes(a?.status) && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text">إجراءات الاعتماد</h3>
          <div className="flex gap-2">
            <button onClick={() => action('governed_approve_credit')} className="flex-1 bg-success text-white rounded-xl p-3 text-sm font-semibold">اعتماد</button>
            <button onClick={async () => {
              if (!reason) { toast.error('يرجى إدخال سبب الرفض'); return }
              await action('governed_reject_credit', { p_reason: reason })
            }} className="flex-1 bg-red-600 text-white rounded-xl p-3 text-sm font-semibold">رفض</button>
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="سبب الرفض" rows={2} className="w-full border border-border rounded-lg p-2 text-sm text-right" />
        </div>
      )}

      {a?.status === 'approved' && (
        <button onClick={() => action('governed_suspend_credit', { p_reason: reason })} className="w-full bg-warning text-white rounded-xl p-3 text-sm font-semibold">تعليق الائتمان</button>
      )}

      {a?.status === 'suspended' && (
        <button onClick={() => action('governed_reactivate_credit')} className="w-full bg-success text-white rounded-xl p-3 text-sm font-semibold">إعادة التفعيل</button>
      )}

      {cc && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-semibold text-text">العقد</h3>
          {cc.signed_at ? (
            <p className="text-xs text-green-600">تم التوقيع: {new Date(cc.signed_at).toLocaleDateString('ar-EG')}</p>
          ) : (
            <p className="text-xs text-yellow-600">لم يتم التوقيع بعد</p>
          )}
        </div>
      )}

      <button onClick={() => navigate('/credit/applications')} className="w-full bg-surface text-text rounded-xl p-3 text-sm">العودة للقائمة</button>
    </div>
  )
}
