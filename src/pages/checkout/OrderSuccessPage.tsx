import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatCurrencyShort, formatDateTime } from '../../utils/format'

interface OrderSuccessData {
  order: { id: string; orderNumber: string; status: string; totalAmount: number; submittedAt: string }
  address?: { label: string; street: string; city: string }
  paymentMethod?: string
  paymentLabel?: string
}

export function OrderSuccessPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OrderSuccessData | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('lastOrder')
    if (stored) {
      setData(JSON.parse(stored))
    }
  }, [])

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <h2 className="text-lg font-bold text-text mb-2">لا يوجد طلب</h2>
        <p className="text-sm text-text-secondary mb-4">لم يتم العثور على طلب سابق</p>
        <button onClick={() => navigate('/storefront')} className="bg-primary text-white text-sm px-6 py-2.5 rounded-lg">
          الذهاب للمتجر
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-success/10 border border-success/30 rounded-lg p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl text-success">✓</span>
        </div>
        <h1 className="text-xl font-bold text-text mb-1">تم إرسال الطلب بنجاح</h1>
        <p className="text-sm text-text-secondary">رقم الطلب: {data.order.orderNumber}</p>
      </div>

      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">رقم الطلب</span>
          <span className="text-text font-semibold">{data.order.orderNumber}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">تاريخ الطلب</span>
          <span className="text-text">{data.order.submittedAt ? formatDateTime(data.order.submittedAt) : '-'}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">الحالة</span>
          <span className="text-primary font-semibold">قيد المراجعة</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">طريقة الدفع</span>
          <span className="text-text">{data.paymentLabel || '-'}</span>
        </div>
        {data.address && (
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">عنوان الشحن</span>
            <span className="text-text text-left">{data.address.label}: {data.address.street}, {data.address.city}</span>
          </div>
        )}
        <hr className="border-border" />
        <div className="flex justify-between text-base font-bold">
          <span className="text-text">الإجمالي</span>
          <span className="text-text">{formatCurrencyShort(data.order.totalAmount)}</span>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-700">
          سيتم مراجعة طلبك من قبل فريق المبيعات. يمكنك متابعة حالة الطلب من صفحة الطلبات.
        </p>
      </div>

      <div className="space-y-2">
        <button onClick={() => navigate('/orders')} className="w-full bg-primary text-white text-sm py-3 rounded-lg active:bg-primary-dark transition-colors">
          عرض الطلبات
        </button>
        <button onClick={() => navigate('/storefront')} className="w-full bg-white text-primary text-sm py-3 rounded-lg border border-primary active:bg-surface transition-colors">
          العودة للمتجر
        </button>
      </div>
    </div>
  )
}
