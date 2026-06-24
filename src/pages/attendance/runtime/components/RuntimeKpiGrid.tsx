import { ShoppingCart, DollarSign, Users, HandCoins } from 'lucide-react'

interface RuntimeKpiGridProps {
  todayOrders: number
  todaySales: number
  todayCollections: number
  todayNewCustomers: number
}

function fmtCurrency(n: number): string {
  return Math.round(n).toLocaleString('en-EG')
}

export default function RuntimeKpiGrid({
  todayOrders, todaySales, todayCollections, todayNewCustomers,
}: RuntimeKpiGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
        <div className="p-2.5 bg-blue-100 rounded-xl">
          <ShoppingCart className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{todayOrders}</div>
          <div className="text-[10px] text-gray-400">الطلبيات</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
        <div className="p-2.5 bg-green-100 rounded-xl">
          <DollarSign className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{fmtCurrency(todaySales)}</div>
          <div className="text-[10px] text-gray-400">المبيعات</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
        <div className="p-2.5 bg-amber-100 rounded-xl">
          <HandCoins className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{fmtCurrency(todayCollections)}</div>
          <div className="text-[10px] text-gray-400">التحصيلات</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
        <div className="p-2.5 bg-purple-100 rounded-xl">
          <Users className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">{todayNewCustomers}</div>
          <div className="text-[10px] text-gray-400">عملاء جدد</div>
        </div>
      </div>
    </div>
  )
}
