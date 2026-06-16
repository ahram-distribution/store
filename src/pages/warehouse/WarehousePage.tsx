import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { OrderStatusManager } from '../../components/orders/OrderStatusManager';
import { useCapability } from '../../hooks/useCapability';
import { formatCurrencyShort } from '../../utils/format';

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

type WaitingOrder = {
  id: string;
  code: string;
  customer_name: string;
  total: number;
  created_at: string;
  status?: string;
};

type Tab = 'waiting' | 'in_progress' | 'completed' | 'review_queue' | 'reviewed' | 'exceptions';

const TAB_LABELS: Record<Tab, string> = {
  waiting: 'بانتظار التجهيز',
  in_progress: 'قيد التجهيز',
  completed: 'تم التجهيز',
  review_queue: 'بانتظار المراجعة',
  reviewed: 'تمت المراجعة',
  exceptions: 'استثناءات',
};

export default function WarehousePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam || 'waiting');
  const [waitingOrders, setWaitingOrders] = useState<WaitingOrder[]>([]);
  const [prepRecords, setPrepRecords] = useState<PrepRecord[]>([]);
  const [exceptionRecords, setExceptionRecords] = useState<PrepRecord[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [failReason, setFailReason] = useState('');
  const [showFailDialog, setShowFailDialog] = useState<string | null>(null);
  const [showExceptionDialog, setShowExceptionDialog] = useState<string | null>(null);
  const [exceptionType, setExceptionType] = useState('missing_quantity');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [showDispatchDialog, setShowDispatchDialog] = useState<string | null>(null);
  const [dispatchEmpId, setDispatchEmpId] = useState('');
  const [deliveryEmployees, setDeliveryEmployees] = useState<{ id: string; code: string }[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const canManage = useCapability('orders.manage');

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) setActiveTab(tabParam);
  }, [tabParam]);

  const statusFilter: Record<string, string | null> = {
    waiting: null,
    in_progress: 'in_progress',
    completed: 'completed',
    review_queue: 'completed',
    reviewed: 'reviewed',
    exceptions: null,
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setMessage(null);
    try {
      if (activeTab === 'waiting') {
        const { data, error } = await supabase.rpc('get_governed_waiting_preparations', { p_token: token });
        if (error) throw error;
        setWaitingOrders(data || []);
      } else if (activeTab === 'exceptions') {
        const { data, error } = await supabase.rpc('get_governed_preparation_queue', {
          p_token: token,
          p_status_filter: 'failed',
        });
        if (error) throw error;
        setExceptionRecords(data || []);
      } else {
        const filter = statusFilter[activeTab];
        const { data, error } = await supabase.rpc('get_governed_preparation_queue', {
          p_token: token,
          p_status_filter: filter,
        });
        if (error) throw error;
        setPrepRecords(data || []);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  }, [token, activeTab]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_governed_employees', { p_token: token }).then(({ data }) => {
      const arr = (data as any[]) || []
      setDeliveryEmployees(arr.filter((emp: any) => emp.is_active).map((emp: any) => ({ id: emp.id, code: emp.code })))
    })
  }, [token])

  const handleStart = async (orderId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_start_preparation', {
        p_token: token, p_id: orderId, p_notes: notes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم بدء التجهيز' }); setNotes(''); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل بدء التجهيز' }); }
  };

  const handleComplete = async (prepId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_complete_preparation', {
        p_token: token, p_preparation_id: prepId, p_notes: notes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم إكمال التجهيز' }); setNotes(''); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل إكمال التجهيز' }); }
  };

  const handleApprove = async (prepId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_review_preparation', {
        p_token: token, p_preparation_id: prepId, p_notes: notes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم اعتماد التجهيز' }); setNotes(''); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل الاعتماد' }); }
  };

  const handleReturnToPrep = async (prepId: string) => {
    if (!token) return;
    if (!notes.trim()) {
      setMessage({ type: 'error', text: 'الرجاء إدخال سبب الإعادة للتجهيز' });
      return;
    }
    try {
      const { data, error } = await supabase.rpc('governed_return_to_preparation', {
        p_token: token, p_preparation_id: prepId, p_notes: notes,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم إعادة التجهيز للمستودع' }); setNotes(''); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل الإعادة للمستودع' }); }
  };

  const handleFail = async (prepId: string) => {
    if (!token) return;
    if (!failReason.trim()) {
      setMessage({ type: 'error', text: 'الرجاء إدخال سبب الفشل' });
      return;
    }
    try {
      const { data, error } = await supabase.rpc('governed_fail_preparation', {
        p_token: token, p_preparation_id: prepId, p_failure_reason: failReason, p_notes: notes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم تسجيل فشل التجهيز' });
      setFailReason(''); setNotes(''); setShowFailDialog(null); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل تسجيل الفشل' }); }
  };

  const handleDispatch = async (orderId: string) => {
    if (!token || !dispatchEmpId) return
    try {
      const { data, error } = await supabase.rpc('governed_dispatch_order', {
        p_token: token, p_id: orderId, p_assigned_to: dispatchEmpId,
      })
      if (error) throw error
      setMessage({ type: 'success', text: 'تم إرسال الطلب للتوصيل' })
      setShowDispatchDialog(null); setDispatchEmpId(''); loadData()
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل إرسال الطلب للتوصيل' }) }
  }

  const handleRecordException = async (prepId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_record_exception', {
        p_token: token, p_preparation_id: prepId, p_exception_type: exceptionType, p_notes: exceptionNotes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم تسجيل الاستثناء' });
      setExceptionType('missing_quantity'); setExceptionNotes(''); setShowExceptionDialog(null); loadData();
    } catch (err: any) { setMessage({ type: 'error', text: err.message || 'فشل تسجيل الاستثناء' }); }
  };

  const tabs: Tab[] = ['waiting', 'in_progress', 'completed', 'review_queue', 'reviewed', 'exceptions'];

  const exceptionTypeOptions = [
    { value: 'missing_quantity', label: 'نقص في الكمية' },
    { value: 'missing_product', label: 'منتج غير متوفر' },
    { value: 'damaged_product', label: 'منتج تالف' },
    { value: 'incomplete_order', label: 'طلب غير مكتمل' },
    { value: 'other', label: 'أخرى' },
  ];

  return (
    <div className="px-4 pb-24" dir="rtl">
      <h1 className="text-lg font-bold text-text mb-4">المستودع — تجهيز الطلبات</h1>

      {message && (
        <div className={`p-3 mb-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <div className="flex items-center justify-between">
            <span>{message.text}</span>
            <button className="text-lg leading-none" onClick={() => setMessage(null)}>&times;</button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold ${
              activeTab === t ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={activeTab === 'review_queue' ? 'سبب الإعادة (مطلوب)' : 'ملاحظات (اختياري)'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white"
        />
      </div>

      {/* Fail Dialog */}
      {showFailDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-text mb-3">تسجيل فشل التجهيز</h3>
            <textarea
              placeholder="سبب الفشل (مطلوب)"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm mb-3"
              rows={3}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowFailDialog(null)} className="flex-1 bg-surface text-text rounded-xl py-2 text-sm">إلغاء</button>
              <button onClick={() => handleFail(showFailDialog)} className="flex-1 bg-red-600 text-white rounded-xl py-2 text-sm">تأكيد الفشل</button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Dialog */}
      {showDispatchDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-text mb-3">إرسال للتوصيل</h3>
            <select
              value={dispatchEmpId}
              onChange={(e) => setDispatchEmpId(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm mb-3"
            >
              <option value="">اختر مندوب التوصيل...</option>
              {deliveryEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.code}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowDispatchDialog(null)} className="flex-1 bg-surface text-text rounded-xl py-2 text-sm">إلغاء</button>
              <button onClick={() => handleDispatch(showDispatchDialog)} disabled={!dispatchEmpId} className="flex-1 bg-success text-white rounded-xl py-2 text-sm disabled:opacity-40">إرسال</button>
            </div>
          </div>
        </div>
      )}

      {/* Exception Dialog */}
      {showExceptionDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-text mb-3">تسجيل استثناء</h3>
            <select
              value={exceptionType}
              onChange={(e) => setExceptionType(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm mb-3"
            >
              {exceptionTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <textarea
              placeholder="ملاحظات (اختياري)"
              value={exceptionNotes}
              onChange={(e) => setExceptionNotes(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm mb-3"
              rows={3}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowExceptionDialog(null)} className="flex-1 bg-surface text-text rounded-xl py-2 text-sm">إلغاء</button>
              <button onClick={() => handleRecordException(showExceptionDialog)} className="flex-1 bg-blue-600 text-white rounded-xl py-2 text-sm">تسجيل</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : activeTab === 'waiting' ? (
        <div className="space-y-2">
          {waitingOrders.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات بانتظار التجهيز</div>
          ) : waitingOrders.map((o) => (
            <div key={o.id} className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text">{o.code}</span>
              </div>
              <div className="text-xs text-text-secondary space-y-0.5">
                <p>العميل: {o.customer_name}</p>
                <p>الإجمالي: {formatCurrencyShort(Number(o.total))}</p>
                <p>التاريخ: {new Date(o.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>
              </div>
              <button onClick={() => handleStart(o.id)} className="w-full mt-3 bg-primary text-white rounded-xl py-2 text-sm font-semibold active:bg-primary-dark transition-colors">
                بدء التجهيز
              </button>
              {canManage && (
                <OrderStatusManager
                  orderId={o.id}
                  currentStatus={o.status || 'approved'}
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
      ) : activeTab === 'review_queue' ? (
        <div className="space-y-2">
          {prepRecords.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات بانتظار المراجعة</div>
          ) : prepRecords.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text">{r.order_code}</span>
                <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">بانتظار المراجعة</span>
              </div>
              <div className="text-xs text-text-secondary space-y-0.5 mb-3">
                <p>العميل: {r.customer_name}</p>
                <p>بدء: {new Date(r.started_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>
                <p>إكمال: {r.completed_at ? new Date(r.completed_at).toLocaleDateString('ar-EG-u-nu-latn') : 'غير متوفر'}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleApprove(r.id)} className="flex-1 bg-indigo-600 text-white rounded-xl py-2 text-xs font-semibold active:opacity-90 transition-colors">اعتماد التجهيز</button>
                <button onClick={() => handleReturnToPrep(r.id)} className="flex-1 bg-yellow-600 text-white rounded-xl py-2 text-xs font-semibold active:opacity-90 transition-colors">إعادة للتجهيز</button>
                <button onClick={() => navigate(`/warehouse/prep/${r.id}`)} className="flex-1 bg-gray-600 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">التفاصيل</button>
              </div>
              {canManage && (
                <OrderStatusManager
                  orderId={r.order_id}
                  currentStatus={r.status || 'approved'}
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
      ) : activeTab === 'exceptions' ? (
        <div className="space-y-2">
          {exceptionRecords.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد استثناءات</div>
          ) : exceptionRecords.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text">{r.order_code}</span>
                <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full">فشل</span>
              </div>
              <div className="text-xs text-text-secondary space-y-0.5 mb-3">
                <p>العميل: {r.customer_name}</p>
                <p>بدء: {new Date(r.started_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>
                {r.notes && <p className="text-gray-500">ملاحظات: {r.notes}</p>}
              </div>
              <button onClick={() => navigate(`/warehouse/prep/${r.id}`)} className="w-full bg-gray-600 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">التفاصيل</button>
              {canManage && (
                <OrderStatusManager
                  orderId={r.order_id}
                  currentStatus={r.status || 'approved'}
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
      ) : (
        <div className="space-y-2">
          {prepRecords.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-sm">لا توجد سجلات</div>
          ) : prepRecords.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text">{r.order_code}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  r.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                  r.status === 'completed' ? 'bg-green-100 text-green-700' :
                  r.status === 'reviewed' ? 'bg-indigo-100 text-indigo-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {r.status === 'in_progress' ? 'قيد التجهيز' : r.status === 'completed' ? 'مكتمل' : r.status === 'reviewed' ? 'مؤكد' : 'فشل'}
                </span>
              </div>
              <div className="text-xs text-text-secondary space-y-0.5 mb-3">
                <p>العميل: {r.customer_name}</p>
                <p>بدء: {new Date(r.started_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>
                {r.completed_at && <p>إكمال: {new Date(r.completed_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>}
                {r.reviewed_at && <p>مراجعة: {new Date(r.reviewed_at).toLocaleDateString('ar-EG-u-nu-latn')}</p>}
              </div>
              <div className="flex gap-2">
                {r.status === 'in_progress' && (
                  <>
                    <button onClick={() => handleComplete(r.id)} className="flex-1 bg-green-600 text-white rounded-xl py-2 text-xs font-semibold active:opacity-90 transition-colors">إكمال</button>
                    <button onClick={() => { setFailReason(''); setShowFailDialog(r.id); }} className="flex-1 bg-red-600 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">فشل</button>
                    <button onClick={() => setShowExceptionDialog(r.id)} className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">استثناء</button>
                    <button onClick={() => navigate(`/warehouse/prep/${r.id}`)} className="flex-1 bg-gray-600 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">التفاصيل</button>
                  </>
                )}
                {(r.status === 'completed' || r.status === 'reviewed') && (
                  <>
                    {r.status === 'reviewed' ? (
                      <button onClick={() => { setDispatchEmpId(''); setShowDispatchDialog(r.order_id) }} className="flex-1 bg-success text-white rounded-xl py-2 text-xs font-semibold active:opacity-90 transition-colors">إرسال للتوصيل</button>
                    ) : (
                      <span className="flex-1 text-center rounded-xl py-2 text-xs font-semibold text-green-600 bg-green-50">مكتمل</span>
                    )}
                    <button onClick={() => navigate(`/warehouse/prep/${r.id}`)} className="flex-1 bg-gray-600 text-white rounded-xl py-2 text-xs active:opacity-90 transition-colors">التفاصيل</button>
                  </>
                )}
                {r.status === 'failed' && (
                  <span className="w-full text-center text-red-600 rounded-xl py-2 text-xs font-semibold bg-red-50">ملغي</span>
                )}
              </div>
              {canManage && (
                <OrderStatusManager
                  orderId={r.order_id}
                  currentStatus={r.status || 'approved'}
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
