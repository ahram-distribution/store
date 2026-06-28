export interface PageHealthRecord {
  path: string
  status: 'OK' | 'ERROR' | 'CRASH' | 'NOT_TESTED'
  errorCount: number
  apiErrors: string[]
  whiteScreen: boolean
  timeMs: number
  timestamp: string
}

export interface HealthReport {
  generatedAt: string
  totalRoutes: number
  ok: number
  errors: number
  crashes: number
  records: PageHealthRecord[]
  summary: string
}

class HealthMonitor {
  private records: Map<string, PageHealthRecord> = new Map()
  private errors: { message: string; source: string; time: number }[] = []
  private originalConsoleError: typeof console.error | null = null
  private listeners: Array<() => void> = []
  private startedAt: number = 0

  start(): void {
    if (this.originalConsoleError) return
    this.startedAt = Date.now()
    this.originalConsoleError = console.error
    const self = this
    console.error = function (...args: unknown[]) {
      self.errors.push({
        message: args.map(String).join(' '),
        source: 'console.error',
        time: Date.now(),
      })
      self.originalConsoleError?.apply(console, args)
    }

    const onError = (event: ErrorEvent) => {
      self.errors.push({
        message: event.message,
        source: 'window.onerror',
        time: Date.now(),
      })
    }
    window.addEventListener('error', onError)
    this.listeners.push(() => window.removeEventListener('error', onError))

    const onRejection = (event: PromiseRejectionEvent) => {
      self.errors.push({
        message: event.reason?.message || String(event.reason),
        source: 'unhandledrejection',
        time: Date.now(),
      })
    }
    window.addEventListener('unhandledrejection', onRejection)
    this.listeners.push(() => window.removeEventListener('unhandledrejection', onRejection))
  }

  stop(): void {
    if (this.originalConsoleError) {
      console.error = this.originalConsoleError
      this.originalConsoleError = null
    }
    this.listeners.forEach((remove) => remove())
    this.listeners = []
  }

  recordError(message: string, source: string): void {
    this.errors.push({ message, source, time: Date.now() })
  }

  recordPageVisit(path: string, health: Partial<PageHealthRecord>): void {
    const existing = this.records.get(path) || {
      path,
      status: 'NOT_TESTED',
      errorCount: 0,
      apiErrors: [],
      whiteScreen: false,
      timeMs: 0,
      timestamp: new Date().toISOString(),
    }
    this.records.set(path, { ...existing, ...health, timestamp: new Date().toISOString() })
  }

  getPageErrors(path: string): { message: string; source: string }[] {
    return this.errors.filter((e) => e.source === path || e.source === 'console.error' || e.source === 'unhandledrejection')
  }

  generateReport(): HealthReport {
    const records = Array.from(this.records.values())
    const ok = records.filter((r) => r.status === 'OK').length
    const errors = records.filter((r) => r.status === 'ERROR').length
    const crashes = records.filter((r) => r.status === 'CRASH' || r.whiteScreen).length

    return {
      generatedAt: new Date().toISOString(),
      totalRoutes: records.length,
      ok,
      errors,
      crashes,
      records,
      summary: [
        `إجمالي المسارات: ${records.length}`,
        `سليمة: ${ok}`,
        `بها أخطاء: ${errors}`,
        `مكسورة (Crash/White Screen): ${crashes}`,
        `إجمالي الأخطاء المسجلة: ${this.errors.length}`,
      ].join('\n'),
    }
  }

  generateMarkdownReport(): string {
    const report = this.generateReport()
    const now = new Date(report.generatedAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })

    let md = `# تقرير صحة الصفحات\n`
    md += `\n**تاريخ التقرير:** ${now}\n\n`
    md += `## ملخص\n\n`
    md += `| المؤشر | القيمة |\n|---|---|\n`
    md += `| إجمالي المسارات | ${report.totalRoutes} |\n`
    md += `| سليمة (OK) | ${report.ok} |\n`
    md += `| بها أخطاء (ERROR) | ${report.errors} |\n`
    md += `| مكسورة (CRASH) | ${report.crashes} |\n`
    md += `| إجمالي الأخطاء المسجلة | ${this.errors.length} |\n\n`
    md += `## تفاصيل المسارات\n\n`
    md += `| # | المسار | الحالة | أخطاء | API Errors | White Screen |\n|---|---|---|---|---|---|\n`
    report.records.forEach((r, i) => {
      md += `| ${i + 1} | \`${r.path}\` | ${r.status} | ${r.errorCount} | ${r.apiErrors.length} | ${r.whiteScreen ? 'YES' : 'NO'} |\n`
    })
    md += `\n## سجل الأخطاء\n\n`
    if (this.errors.length === 0) {
      md += `لا توجد أخطاء مسجلة.\n`
    } else {
      this.errors.forEach((e) => {
        md += `- \`[${e.source}]\` ${e.message}\n`
      })
    }
    return md
  }

  getAllRecords(): PageHealthRecord[] {
    return Array.from(this.records.values())
  }

  getErrorCount(): number {
    return this.errors.length
  }
}

export const healthMonitor = new HealthMonitor()

export const ROUTE_MANIFEST = {
  public: [
    '/login',
    '/register',
    '/storefront',
    '/storefront/products',
    '/daily-deals',
    '/daily-deals/:id',
    '/flash-offers',
    '/flash-offers/:id',
    '/tiers',
    '/auctions',
    '/auctions/:id',
  ],
  protected: {
    employee: [
      '/dashboard',
      '/dashboard/performance',
      '/dashboard/employee-analysis',
      '/visits',
      '/visits/screen',
      '/visits/new',
      '/visits/:id',
      '/customers',
      '/customers/new',
      '/customers/:id',
      '/customers/:id/analytics',
      '/analytics/customers',
      '/collections',
      '/collections/new',
      '/collections/followup',
      '/returns',
      '/returns/new',
      '/returns/:id',
      '/products/:id',
      '/products/manage',
      '/deals',
      '/daily-deals/manage',
      '/flash-offers/manage',
      '/tiers/manage',
      '/auctions/manage',
      '/credit/manage',
      '/credit/programs',
      '/credit/programs/manage',
      '/credit/applications',
      '/credit/applications/:id',
      '/warehouse/prep/:id',
      '/delivery',
      '/delivery/:id',
      '/employees/:id',
      '/hierarchy',
      '/companies/:id',
      '/companies/manage',
      '/reports',
      '/activity',
      '/settings/company',
      '/launcher/:module',
      '/account/profile',
      '/account/permissions',
      '/command-center',
      '/command-center/modules/:moduleKey',
      '/attendance',
      '/attendance/runtime',
      '/attendance/settings',
      '/attendance/team-map',
      '/attendance/employee/:employeeId/:date',
      '/attendance/operations',
      '/sales-manager-cc',
      '/ops/gps-test',
    ],
    customer: [
      '/storefront',
      '/storefront/products',
      '/cart',
      '/order-review',
      '/checkout',
      '/order-success',
      '/orders',
      '/orders/:id',
      '/credit',
      '/tiers',
      '/auctions',
      '/auctions/:id',
      '/daily-deals',
      '/flash-offers',
      '/account',
    ],
  },
} as const

export function getRouteCount(): { total: number; public: number; protected: number } {
  const publicCount = ROUTE_MANIFEST.public.length
  const employeeCount = ROUTE_MANIFEST.protected.employee.length
  const customerCount = ROUTE_MANIFEST.protected.customer.length
  const uniqueProtected = new Set([...ROUTE_MANIFEST.protected.employee, ...ROUTE_MANIFEST.protected.customer]).size
  return {
    total: publicCount + uniqueProtected,
    public: publicCount,
    protected: uniqueProtected,
  }
}

export async function runDiagnostic(): Promise<HealthReport> {
  healthMonitor.start()
  const counts = getRouteCount()
  const report = healthMonitor.generateReport()
  report.totalRoutes = counts.total
  return report
}

;(globalThis as any).__healthMonitor = healthMonitor
;(globalThis as any).__runDiagnostic = runDiagnostic
