import { useState, useEffect } from 'react'
import { KpiWidget } from './KpiWidget'
import { DataGrid, type Column } from '../components/DataGrid'
import { useBootstrap } from '../context/BootstrapProvider'
import { useDesktopStore } from '../store/desktopStore'
import { createDefaultState } from '../workspace/WorkspaceRegistry'
import type { SalesOrder } from '../../domain/models/salesOrder'
import type { Money } from '../../domain/value-objects'

function formatMoney(m: Money): string {
  return `${m.currency} ${m.amount.toLocaleString()}`
}

function formatCount(n: number): string {
  return n.toLocaleString('ar-EG')
}

export function DesktopDashboard() {
  const bootstrap = useBootstrap()
  const globalFilters = useDesktopStore((s) => s.globalFilters)
  const addWorkspace = useDesktopStore((s) => s.addWorkspace)
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const criteria: Record<string, unknown> = { limit: 200 }
        if (globalFilters.dateFrom) criteria.fromDate = new Date(globalFilters.dateFrom)
        if (globalFilters.dateTo) criteria.toDate = new Date(globalFilters.dateTo)
        const allOrders = await bootstrap.providers.salesOrder.searchOrders(criteria as any)
        setOrders(allOrders || [])
        setLastUpdate(new Date())
      } catch {
        setOrders([])
      }
      setLoading(false)
    }
    load()
  }, [globalFilters.dateFrom, globalFilters.dateTo, bootstrap])

  const totalOrders = orders.length
  const totalSales = orders.reduce((sum, o) => sum + o.grandTotal.amount, 0)
  const submittedOrders = orders.filter(o => o.status === 'submitted').length
  const reviewingOrders = orders.filter(o => o.status === 'reviewing').length
  const pendingOrders = submittedOrders + reviewingOrders
  const approvedOrders = orders.filter(o => o.status === 'approved').length
  const deliveredOrders = orders.filter(o => o.status === 'delivered').length

  function openOrdersWithStatus(status: string) {
    const ws = createDefaultState('orders')
    addWorkspace(ws)
  }

  const periodLabel = globalFilters.datePreset || globalFilters.dateFrom
    ? `${globalFilters.dateFrom || '...'} → ${globalFilters.dateTo || '...'}`
    : 'كل الفترات'

  const kpiMeta = [
    { title: 'إجمالي المبيعات', value: `${formatMoney({ amount: totalSales, currency: 'EGP' })}`, trend: totalOrders > 0 ? 'neutral' as const : 'neutral' as const, trendValue: `${formatCount(totalOrders)} طلب`, icon: '📈', color: '#0B3D91',
      definition: 'إجمالي قيمة المبيعات (سعر البيع شامل الخصم)', source: 'get_unified_orders', period: periodLabel, lastUpdate: lastUpdate },
    { title: 'الطلبات المعلقة', value: formatCount(pendingOrders), subtitle: 'في انتظار المراجعة', trend: pendingOrders > 0 ? 'up' as const : 'neutral' as const, trendValue: `${pendingOrders}`, icon: '📋', color: '#D97706',
      definition: 'الطلبات المقدمة والتي لم يتم اعتمادها بعد', source: 'get_unified_orders (status=submitted,reviewing)', period: periodLabel, lastUpdate: lastUpdate,
      onClick: () => openOrdersWithStatus('pending') },
    { title: 'الطلبات المعتمدة', value: formatCount(approvedOrders), subtitle: 'قيد التحضير', trend: 'neutral' as const, trendValue: `${approvedOrders}`, icon: '✅', color: '#059669',
      definition: 'الطلبات المعتمدة وجاري تجهيزها', source: 'get_unified_orders (status=approved)', period: periodLabel, lastUpdate: lastUpdate,
      onClick: () => openOrdersWithStatus('approved') },
    { title: 'الطلبات المسلمة', value: formatCount(deliveredOrders), trend: 'neutral' as const, trendValue: `${deliveredOrders}`, icon: '📦', color: '#0284C7',
      definition: 'الطلبات التي تم تسليمها للعميل', source: 'get_unified_orders (status=delivered)', period: periodLabel, lastUpdate: lastUpdate,
      onClick: () => openOrdersWithStatus('delivered') },
    { title: 'إجمالي الطلبات', value: formatCount(totalOrders), trend: 'neutral' as const, trendValue: periodLabel, icon: '📊', color: '#7C3AED',
      definition: 'إجمالي عدد الطلبات', source: 'get_unified_orders', period: periodLabel, lastUpdate: lastUpdate,
      onClick: () => openOrdersWithStatus('all') },
  ]

  const recentOrders = orders.slice(0, 10).map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customerName,
    amount: formatMoney(o.grandTotal),
    status: o.status,
    date: o.createdAt instanceof Date ? o.createdAt.toLocaleDateString('ar-SA') : '—',
    rep: o.ownerName,
  }))

  const orderColumns: Column[] = [
    { key: 'orderNumber', label: 'رقم الطلب', width: 130, frozen: true },
    { key: 'customer', label: 'العميل', width: 200 },
    { key: 'amount', label: 'المبلغ', width: 120, align: 'left' },
    {
      key: 'status',
      label: 'الحالة',
      width: 110,
      render: (v: string) => {
        const statusColors: Record<string, string> = {
          submitted: '#0284C7', approved: '#059669', delivered: '#059669',
          rejected: '#DC2626', cancelled: '#94A3B8', reviewing: '#D97706',
        }
        const statusLabels: Record<string, string> = {
          draft: 'مسودة', submitted: 'مقدم', reviewing: 'قيد المراجعة',
          approved: 'معتمد', preparing: 'قيد التحضير', dispatched: 'تم الشحن',
          delivered: 'تم التسليم', rejected: 'مرفوض', cancelled: 'ملغي',
        }
        return (
          <span style={{
            background: (statusColors[v] || '#94A3B8') + '20',
            color: statusColors[v] || '#94A3B8',
            padding: '2px 8px', borderRadius: 10,
            fontSize: 10, fontWeight: 600,
          }}>
            {statusLabels[v] || v}
          </span>
        )
      },
    },
    { key: 'date', label: 'التاريخ', width: 100 },
    { key: 'rep', label: 'مندوب المبيعات', width: 140 },
  ]

  const lowStockCount = 0

  const alerts = [
    ...(pendingOrders > 0 ? [{ type: 'warning' as const, message: `${pendingOrders} طلب في انتظار المراجعة` }] : []),
    ...(totalOrders === 0 ? [{ type: 'info' as const, message: 'لا توجد طلبات بعد' }] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 4 }}>
      <div>
        <h1 style={{ fontSize: 'var(--dt-font-size-xl)', fontWeight: 700, color: 'var(--dt-text-primary)', margin: 0 }}>
          مركز القيادة
        </h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <p style={{ fontSize: 'var(--dt-font-size-sm)', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
            {new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <span style={{ fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-muted)', background: 'var(--dt-bg-surface)', padding: '1px 6px', borderRadius: 4 }}>
            {periodLabel}
          </span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 12,
      }}>
        {kpiMeta.map((kpi) => (
          <div key={kpi.title} style={{ cursor: kpi.onClick ? 'pointer' : 'default' }} onClick={kpi.onClick} title={`${kpi.definition}\nالمصدر: ${kpi.source}\nالفترة: ${kpi.period}\nآخر تحديث: ${kpi.lastUpdate?.toLocaleTimeString('ar-SA') || '—'}`}>
            <KpiWidget
              title={kpi.title}
              value={kpi.value}
              subtitle={kpi.subtitle}
              trend={kpi.trend}
              trendValue={kpi.trendValue}
              icon={kpi.icon}
              color={kpi.color}
              loading={loading}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div style={{
          background: 'var(--dt-bg-surface)', borderRadius: 'var(--dt-radius-lg)',
          border: '1px solid var(--dt-border)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--dt-border)',
            fontWeight: 600, fontSize: 'var(--dt-font-size-sm)', color: 'var(--dt-text-primary)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>آخر الطلبات ({recentOrders.length})</span>
            <span style={{ fontWeight: 400, fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-muted)' }}>
              {lastUpdate ? `آخر تحديث: ${lastUpdate.toLocaleTimeString('ar-SA')}` : ''}
            </span>
          </div>
          <div style={{ height: 320 }}>
            <DataGrid
              columns={orderColumns}
              rows={recentOrders}
              pageSize={5}
              pageSizeOptions={[5, 10]}
              searchable={false}
              exportable={false}
              height="100%"
              emptyMessage={loading ? 'جاري التحميل...' : 'لا توجد طلبات'}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'var(--dt-bg-surface)', borderRadius: 'var(--dt-radius-lg)',
            border: '1px solid var(--dt-border)', padding: 12,
          }}>
            <h3 style={{ fontSize: 'var(--dt-font-size-sm)', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--dt-text-primary)' }}>
              التنبيهات
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alerts.map((alert, i) => {
                const colors: Record<string, string> = { danger: 'var(--dt-danger)', warning: 'var(--dt-warning)', info: 'var(--dt-info)', success: 'var(--dt-success)' }
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '6px 8px', background: colors[alert.type] + '08',
                    borderRadius: 'var(--dt-radius-sm)', borderRight: `3px solid ${colors[alert.type]}`,
                  }}>
                    <span style={{ fontSize: 12, color: colors[alert.type], flexShrink: 0 }}>
                      {alert.type === 'danger' ? '⚠️' : alert.type === 'warning' ? '⚡' : alert.type === 'info' ? 'ℹ️' : '✅'}
                    </span>
                    <span style={{ fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-secondary)' }}>
                      {alert.message}
                    </span>
                  </div>
                )
              })}
              {alerts.length === 0 && (
                <div style={{ fontSize: 'var(--dt-font-size-xs)', color: 'var(--dt-text-muted)', padding: '6px 0' }}>
                  لا توجد تنبيهات حالياً
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
