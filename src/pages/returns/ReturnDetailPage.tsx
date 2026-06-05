import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'

const conditionLabels: Record<string, string> = { saleable: 'قابل للبيع', damaged: 'تالف', expired: 'منتهي الصلاحية', unsaleable: 'غير قابل للبيع' }
const conditionColors: Record<string, string> = { saleable: 'bg-success/10 text-success', damaged: 'bg-danger/10 text-danger', expired: 'bg-accent/10 text-accent', unsaleable: 'bg-warning/10 text-warning' }
const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', inspecting: 'فحص', approved: 'تم الاعتماد', rejected: 'مرفوض' }

export function ReturnDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [r, setR] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => {
    if (!id) return
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_return', { p_token: token, p_id: id }),
      supabase.rpc('get_governed_return_items', { p_token: token, p_return_id: id }),
    ]).then(([returnRes, itemsRes]) => {
      if (returnRes.data) setR(returnRes.data as any)
      if (itemsRes.data) setItems(itemsRes.data as any[])
      setLoading(false)
    })
  }, [id])

  const handleApprove = async () => {
    if (!id) return
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (token) {
      await supabase.rpc('governed_approve_return', {
        p_token: token,
        p_id: id,
        p_credit_note_number: 'CN-' + Date.now(),
        p_credit_note_amount: r?.credit_note_amount || null,
      })
    }
    toast.success('تم اعتماد المرتجع وإصدار إشعار دائن')
    navigate('/returns')
  }

  const handleReject = async () => {
    if (!id) return
    const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (token) {
      await supabase.rpc('governed_reject_return', {
        p_token: token,
        p_id: id,
      })
    }
    toast.error('تم رفض المرتجع')
    navigate('/returns')
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!r) return <div className="text-center py-12 text-text-secondary text-sm">المرتجع غير موجود</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/returns')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{r.code}</h1>
        <span className={`text-[10px] px-2 py-0.5 rounded ${
          r.status === 'pending' ? 'bg-accent/10 text-accent' : r.status === 'inspecting' ? 'bg-primary/10 text-primary' : r.status === 'approved' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        }`}>{statusLabels[r.status]}</span>
      </div>

      <div className="bg-white rounded-lg border border-border p-3 space-y-1">
        <div className="flex justify-between text-sm"><span className="text-text-secondary">الطلب الأصلي</span><span className="text-text font-semibold">{r.order_id}</span></div>
        <div className="flex justify-between text-sm"><span className="text-text-secondary">تاريخ الإنشاء</span><span className="text-text">{formatDate(r.created_at)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-text-secondary">إجمالي المرتجع</span><span className="text-danger font-bold">{r.credit_note_amount ? formatCurrencyShort(r.credit_note_amount) : '-'}</span></div>
      </div>

      {items.length > 0 && (
        <div className="bg-white rounded-lg border border-border">
          <div className="px-3 py-2 border-b border-border"><h3 className="text-sm font-semibold text-text">المنتجات</h3></div>
          <div className="divide-y divide-border">
            {items.map((item: any) => (
              <div key={item.id} className="px-3 py-2.5">
                <div className="flex justify-between text-sm"><span className="text-text">{item.product_id}</span><span className="text-text font-semibold">{item.quantity}</span></div>
                <div className="text-xs text-text-secondary mt-1">
                  <span>{item.quantity} {item.unit_type === 'carton' ? 'كرتونة' : item.unit_type === 'dozen' ? 'دستة' : 'قطعة'}</span>
                  {item.reason && <span className="mr-2">سبب: {item.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {r.status === 'pending' && (
        <div className="flex gap-2">
          <button onClick={handleApprove} className="flex-1 bg-success text-white text-sm py-3 rounded-lg active:opacity-90 transition-colors">اعتماد المرتجع</button>
          <button onClick={handleReject} className="flex-1 bg-danger text-white text-sm py-3 rounded-lg active:opacity-90 transition-colors">رفض</button>
        </div>
      )}
    </div>
  )
}
