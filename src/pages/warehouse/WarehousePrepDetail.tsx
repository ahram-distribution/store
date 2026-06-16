import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { formatCurrencyShort } from '../../utils/format';

function formatDT(ts: string | null | undefined) {
  if (!ts) return 'غير متوفر';
  return new Date(ts).toLocaleString('ar-EG-u-nu-latn');
}

const PREP_STATUS_LABELS: Record<string, string> = {
  in_progress: 'قيد التجهيز',
  completed: 'تم التجهيز',
  reviewed: 'تمت المراجعة',
  failed: 'فشل',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة', submitted: 'مقدم', reviewing: 'قيد المراجعة',
  returned_for_revision: 'معاد للمراجعة', approved: 'معتمد',
  preparing: 'قيد التجهيز', dispatched: 'تم الشحن', delivered: 'تم التسليم',
};

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  missing_quantity: 'نقص في الكمية',
  missing_product: 'منتج غير متوفر',
  damaged_product: 'منتج تالف',
  incomplete_order: 'طلب غير مكتمل',
  other: 'أخرى',
};

export default function WarehousePrepDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { token } = useAuth();
  const [prep, setPrep] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);

  const [opHistory, setOpHistory] = useState<any[]>([]);
  const [modHistory, setModHistory] = useState<any[]>([]);
  const [prepExceptions, setPrepExceptions] = useState<any[]>([]);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [exceptionType, setExceptionType] = useState('missing_quantity');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!id || !token) return;
    setLoading(true);
    const { data: detail, error } = await supabase.rpc('get_governed_preparation_detail', { p_token: token, p_preparation_id: id });
    if (error || !detail || detail.error) { setLoading(false); return; }
    setPrep(detail);
    if (detail.order) {
      setOrder(detail.order);
    }
    if (detail.status_history) setOpHistory(Array.isArray(detail.status_history) ? detail.status_history : []);
    if (detail.modification_history) setModHistory(Array.isArray(detail.modification_history) ? detail.modification_history : []);
    if (detail.exceptions) setPrepExceptions(Array.isArray(detail.exceptions) ? detail.exceptions : []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [id, token]);

  const handleRecordException = async () => {
    if (!token) return;
    try {
      const { data, error } = await supabase.rpc('governed_record_exception', {
        p_token: token, p_preparation_id: id, p_exception_type: exceptionType, p_notes: exceptionNotes || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: 'تم تسجيل الاستثناء' });
      setShowExceptionForm(false);
      setExceptionType('missing_quantity');
      setExceptionNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تسجيل الاستثناء' });
    }
  };

  if (loading) return <div className="p-6 text-center text-gray-500">جاري التحميل...</div>;
  if (!prep) return <div className="p-6 text-center text-gray-400">لم يتم العثور على سجل التجهيز</div>;

  return (
    <div className="p-6" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/warehouse')} className="text-gray-500 text-lg">&larr;</button>
        <h1 className="text-2xl font-bold">تفاصيل التجهيز</h1>
        {prep.status && (
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
            prep.status === 'reviewed' ? 'bg-green-100 text-green-700' :
            prep.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
            prep.status === 'completed' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {PREP_STATUS_LABELS[prep.status] || prep.status}
          </span>
        )}
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message.text}
          <button className="mr-3 float-start" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">معلومات الطلب</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">رقم الطلب</span><span className="font-semibold">{order?.order_number || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">حالة الطلب</span><span>{ORDER_STATUS_LABELS[order?.status] || order?.status || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">الإجمالي</span><span className="font-semibold">{order?.total_amount ? formatCurrencyShort(Number(order.total_amount)) : 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">تاريخ الطلب</span><span>{formatDT(order?.created_at)}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">معلومات العميل</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">اسم العميل</span><span className="font-semibold">{order?.customer_name || order?.snapshot_customer_name || 'غير متوفر'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">رقم الهاتف</span><span>{order?.customer_phone || order?.snapshot_customer_phone || 'غير متوفر'}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">معلومات المالك</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">اسم المالك</span><span className="font-semibold">{order?.owner_name || order?.snapshot_owner_name || 'غير متوفر'}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">معلومات التجهيز</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">الحالة</span><span className="font-semibold">{PREP_STATUS_LABELS[prep.status] || prep.status}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">تاريخ البدء</span><span>{formatDT(prep.started_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">تاريخ الإكمال</span><span>{formatDT(prep.completed_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">تاريخ المراجعة</span><span>{formatDT(prep.reviewed_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">تاريخ الإلغاء</span><span>{formatDT(prep.cancelled_at)}</span></div>
            {prep.notes && <div className="pt-2 border-t mt-2"><span className="text-gray-500">ملاحظات: </span><span className="whitespace-pre-line">{prep.notes}</span></div>}
          </div>
        </div>
      </div>

      {prepExceptions.length > 0 && (
        <div className="bg-white rounded-lg border mb-6">
          <div className="px-4 py-2 border-b bg-red-50">
            <h3 className="text-sm font-semibold text-red-700">الاستثناءات المسجلة</h3>
          </div>
          <div className="divide-y">
            {prepExceptions.map((e: any) => (
              <div key={e.id} className="px-4 py-2 text-sm flex justify-between items-center">
                <div>
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold ml-2">
                    {EXCEPTION_TYPE_LABELS[e.exception_type] || e.exception_type}
                  </span>
                  {e.notes && <span className="text-gray-600 mr-2">{e.notes}</span>}
                </div>
                <span className="text-xs text-gray-400">{formatDT(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(prep.status === 'in_progress' || prep.status === 'completed') && (
        <div className="mb-6">
          {showExceptionForm ? (
            <div className="bg-white rounded-lg border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">تسجيل استثناء جديد</h3>
              <select
                value={exceptionType}
                onChange={(e) => setExceptionType(e.target.value)}
                className="w-full p-2 border rounded mb-3"
              >
                <option value="missing_quantity">نقص في الكمية</option>
                <option value="missing_product">منتج غير متوفر</option>
                <option value="damaged_product">منتج تالف</option>
                <option value="incomplete_order">طلب غير مكتمل</option>
                <option value="other">أخرى</option>
              </select>
              <textarea
                placeholder="ملاحظات (اختياري)"
                value={exceptionNotes}
                onChange={(e) => setExceptionNotes(e.target.value)}
                className="w-full p-2 border rounded mb-3"
                rows={2}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowExceptionForm(false)} className="px-3 py-1.5 bg-gray-200 rounded text-sm">إلغاء</button>
                <button onClick={handleRecordException} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">تسجيل</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowExceptionForm(true)} className="px-3 py-1.5 bg-orange-500 text-white rounded text-sm hover:bg-orange-600">
              تسجيل استثناء
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-2 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">سجل التغييرات التشغيلية</h3>
          </div>
          {opHistory.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">لا توجد تغييرات تشغيلية</div>
          ) : (
            <div className="divide-y max-h-64 overflow-y-auto">
              {opHistory.map((h: any) => (
                <div key={h.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{ORDER_STATUS_LABELS[h.from_status] || h.from_status}</span>
                      <span className="text-gray-400">&rarr;</span>
                      <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">{ORDER_STATUS_LABELS[h.to_status] || h.to_status}</span>
                    </div>
                    <span className="text-gray-400">{new Date(h.changed_at).toLocaleString('ar-EG-u-nu-latn')}</span>
                  </div>
                  {h.reason && <div className="text-gray-500">{h.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border">
          <div className="px-4 py-2 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">سجل التعديلات</h3>
          </div>
          {modHistory.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">لا توجد تعديلات</div>
          ) : (
            <div className="divide-y max-h-64 overflow-y-auto">
              {modHistory.map((h: any) => (
                <div key={h.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-gray-700">{h.field_name}</span>
                    <span className="text-gray-400">{new Date(h.modified_at).toLocaleString('ar-EG-u-nu-latn')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span>{h.old_value || '(فارغ)'}</span>
                    <span>&rarr;</span>
                    <span className="text-blue-600">{h.new_value || '(فارغ)'}</span>
                  </div>
                  {h.reason && <div className="text-gray-400 mt-0.5">{h.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
