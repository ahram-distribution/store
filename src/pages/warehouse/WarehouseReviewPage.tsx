import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { OrderStatusManager } from '../../components/orders/OrderStatusManager';
import { useCapability } from '../../hooks/useCapability';

type PrepRecord = {
  id: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  status: string;
  started_by: string;
  started_at: string;
  completed_by: string | null;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
};

export default function WarehouseReviewPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [records, setRecords] = useState<PrepRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const canManage = useCapability('orders.manage');

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_governed_preparation_queue', {
        p_token: token,
        p_status_filter: 'completed',
      });
      if (error) throw error;
      setRecords(data || []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تحميل البيانات' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleApprove = async (prepId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_review_preparation', {
        p_token: token,
        p_preparation_id: prepId,
        p_notes: notes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم اعتماد التجهيز' });
      setNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل الاعتماد' });
    }
  };

  const handleReturnToPrep = async (prepId: string) => {
    if (!token) return;
    if (!notes.trim()) {
      setMessage({ type: 'error', text: 'الرجاء إدخال سبب الإعادة للتجهيز' });
      return;
    }
    try {
      const { data, error } = await supabase.rpc('governed_return_to_preparation', {
        p_token: token,
        p_preparation_id: prepId,
        p_notes: notes,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم إعادة التجهيز للمستودع' });
      setNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل الإعادة للمستودع' });
    }
  };

  return (
    <div className="px-4 pb-24" dir="rtl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/warehouse')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">مراجعة التجهيز</h1>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <div className="flex items-center justify-between">
            <span>{message.text}</span>
            <button className="text-lg leading-none" onClick={() => setMessage(null)}>&times;</button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="ملاحظات (اختياري)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات بانتظار المراجعة</div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <button onClick={() => navigate(`/warehouse/prep/${r.id}`)} className="text-sm font-semibold text-primary hover:underline">{r.order_code}</button>
                <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">بانتظار المراجعة</span>
              </div>
              <div className="text-xs text-text-secondary space-y-0.5 mb-3">
                <p>العميل: {r.customer_name}</p>
                <p>بدء: {new Date(r.started_at).toLocaleDateString('ar-EG')}</p>
                <p>إكمال: {r.completed_at ? new Date(r.completed_at).toLocaleDateString('ar-EG') : '—'}</p>
                {r.notes && <p>ملاحظات: {r.notes}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleApprove(r.id)} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-90 transition-colors">
                  اعتماد التجهيز
                </button>
                <button onClick={() => handleReturnToPrep(r.id)} className="flex-1 bg-yellow-600 text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-90 transition-colors">
                  إعادة للتجهيز
                </button>
              </div>
              {canManage && (
                <OrderStatusManager
                  orderId={r.order_id}
                  currentStatus={r.status || 'prepared'}
                  canReview={false}
                  canCompletePreparation={false}
                  canSendToDelivery={false}
                  canManage={true}
                  onSuccess={() => loadData()}
                  onError={(err) => setMessage({ type: 'error', text: err })}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
