import { exportToExcel } from './excelExporter'

export interface SalesAnalyticsRow {
  name: string
  activity: number
  target: number
  orderCount?: number
}

export type SalesAnalyticsTab = 'customers' | 'companies' | 'products'

const TAB_ENTITY_LABELS: Record<SalesAnalyticsTab, string> = {
  customers: 'العملاء',
  companies: 'الشركات',
  products: 'الأصناف',
}

const TAB_COLUMNS: Record<SalesAnalyticsTab, { key: string; label: string; format?: 'number' | 'currency' }[]> = {
  customers: [
    { key: 'name', label: 'اسم العميل' },
    { key: 'activity', label: 'النشاط', format: 'currency' },
    { key: 'target', label: 'المنفذ فعلي', format: 'currency' },
    { key: 'orderCount', label: 'عدد الطلبات', format: 'number' },
  ],
  companies: [
    { key: 'name', label: 'اسم الشركة' },
    { key: 'activity', label: 'النشاط', format: 'currency' },
    { key: 'target', label: 'المنفذ فعلي', format: 'currency' },
  ],
  products: [
    { key: 'name', label: 'اسم الصنف' },
    { key: 'activity', label: 'النشاط', format: 'currency' },
    { key: 'target', label: 'المنفذ فعلي', format: 'currency' },
  ],
}

export interface SalesAnalyticsExportParams {
  tab: SalesAnalyticsTab
  tabLabel: string
  rows: SalesAnalyticsRow[]
  totals: { activity: number; target: number }
  filters: string[]
}

export function exportSalesAnalyticsExcel({ tab, tabLabel, rows, totals, filters }: SalesAnalyticsExportParams): void {
  const columns = TAB_COLUMNS[tab]

  const data: Record<string, unknown>[] = rows.map((r) => ({
    name: r.name,
    activity: r.activity,
    target: r.target,
    orderCount: r.orderCount ?? 0,
  }))

  const summary: { label: string; value: number; format?: 'number' | 'currency' }[] = [
    { label: `عدد ${TAB_ENTITY_LABELS[tab]}`, value: rows.length, format: 'number' },
    { label: 'إجمالي النشاط', value: totals.activity, format: 'currency' },
    { label: 'إجمالي المنفذ فعلي', value: totals.target, format: 'currency' },
  ]

  exportToExcel({
    title: `تحليل المبيعات — ${tabLabel}`,
    subtitle: `تقرير المبيعات حسب ${TAB_ENTITY_LABELS[tab]}`,
    columns,
    data,
    fileName: `sales_analytics_${tab}`,
    summary,
    filters: filters.length ? filters : ['بدون فلاتر'],
    columnWidths: [40, 16, 16, 14],
    presentation: { rtl: true, landscape: true, fitToWidth: true, printTitles: true },
  })
}