/**
 * SYSTEM OF TRUTH GUARD — HARD ENFORCEMENT LAYER
 *
 * === PHASE 2: HARD ENFORCEMENT ===
 *
 * هذه الطبقة تمنع فعلياً (وليس فقط تسجيل) أي مخالفة لمعمارية Single Source of Truth.
 *
 * ما يتم إنفاذه:
 * 1. GPS — منع navigator.geolocation خارج gpsService.ts
 * 2. SUPABASE — منع supabase.from() للجداول المحظورة
 * 3. WHATSAPP — منع whatsapp:// protocol
 *
 * IMPORTANT: هذا الملف لا يعدّل أي كود موجود — هو طبقة منع إضافية (Enforcement Layer)
 */

import { getCurrentLocation, startWatching, stopWatching, isWatching, getLastKnownLocation, clearLocationCache, getAccuracyLabel } from '../services/gpsService'

// ============================================================================
// VIOLATION LOGGING
// ============================================================================

const VIOLATION_LOG: string[] = []

export function getViolationLog(): string[] {
  return [...VIOLATION_LOG]
}

export function clearViolationLog(): void {
  VIOLATION_LOG.length = 0
}

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'

export function warnDeprecatedUsage(category: string, details: string): void {
  const entry = `[VIOLATION] ${category}: ${details} STACK: ${new Error().stack?.split('\n').slice(2, 6).join(' → ') || 'N/A'}`
  VIOLATION_LOG.push(entry)
  if (isDev) {
    console.warn(entry)
  }
}

// ============================================================================
// 1. GPS — UNIFIED ENGINE (المصدر الوحيد المسموح)
// ============================================================================

/**
 * gpsEngine: الواجهة الوحيدة لاستحواذ GPS في التطبيق بأكمله.
 *
 * أي كود يحتاج موقع GPS يجب أن يستخدم gpsEngine.acquire() فقط.
 * أي استخدام مباشر لـ navigator.geolocation خارج gpsService.ts سيتم منعه.
 */
export const gpsEngine = {
  /** الاستحواذ لمرة واحدة (one-shot) */
  acquire: getCurrentLocation,

  /** بدء المراقبة المستمرة (للتتبع الخلفي) */
  startWatching,

  /** إيقاف المراقبة المستمرة */
  stopWatching,

  /** هل المراقبة نشطة؟ */
  isWatching,

  /** آخر موقع معروف */
  getLastKnown: getLastKnownLocation,

  /** مسح cache الموقع */
  clearCache: clearLocationCache,

  /** تصنيف دقة الموقع */
  getAccuracyLabel,

  /** إعادة تعيين (للاختبارات) */
  reset(): void {
    clearLocationCache()
  },
}

// ============================================================================
// 2. GPS ENFORCEMENT — منع navigator.geolocation خارج gpsService
// ============================================================================

const ALLOWED_GPS_CALLERS = ['gpsService.ts', 'systemOfTruthGuard.ts']

function isGpsCallerAllowed(stack: string): boolean {
  return ALLOWED_GPS_CALLERS.some((caller) => stack.includes(caller))
}

/**
 * registerGeolocationGuard: يثبت Proxy على navigator.geolocation.
 *
 * - يسمح بالاستدعاء فقط من gpsService.ts و systemOfTruthGuard.ts
 * - يمنع أي استدعاء من صفحات أو مكونات أخرى
 * - في Development: يظهر رسالة حمراء واضحة + يمنع التنفيذ
 * - في Production: يمنع التنفيذ بصمت
 */
export function registerGeolocationGuard(): void {
  if (typeof navigator === 'undefined') return

  let original: Geolocation | null = null

  try {
    original = navigator.geolocation
  } catch {
    return
  }

  if (!original) return

  const createBlockedFn = (fnName: string) => {
    return (...args: unknown[]) => {
      const stack = new Error().stack || ''
      if (isGpsCallerAllowed(stack)) {
        const originalFn = original![fnName as 'getCurrentPosition' | 'watchPosition'] as (...a: unknown[]) => void
        return originalFn(...args)
      }
      warnDeprecatedUsage('GPS', `navigator.geolocation.${fnName}() من خارج gpsService.ts — استخدم gpsEngine.acquire()`)
      if (isDev) {
        console.error(
          '%c🚫 SYSTEM_OF_TRUTH ENFORCEMENT: navigator.geolocation محظور خارج gpsService.ts%c\nالرجاء استخدام gpsEngine.acquire() بدلاً من ذلك',
          'color: #ff0000; font-weight: bold; font-size: 14px;',
          'color: #ff4444; font-size: 12px;'
        )
        if (fnName === 'getCurrentPosition') {
          const cb = args[0] as PositionCallback
          cb({ coords: { latitude: 0, longitude: 0, accuracy: 999999, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() })
          return
        }
      }
    }
  }

  try {
    Object.defineProperty(navigator, 'geolocation', {
      get() {
        const blocked: Geolocation = {
          getCurrentPosition: createBlockedFn('getCurrentPosition') as typeof original.getCurrentPosition,
          watchPosition: createBlockedFn('watchPosition') as typeof original.watchPosition,
          clearWatch: (id: number) => original!.clearWatch(id),
        }
        return blocked
      },
      configurable: false,
      enumerable: true,
    })
  } catch {
    if (isDev) {
      console.warn('⚠️ SYSTEM_OF_TRUTH: تعذر تثبيت GPS guard (قد يكون readonly)')
    }
  }
}

// ============================================================================
// 3. SUPABASE ENFORCEMENT — منع الوصول المباشر للجداول المحظورة
// ============================================================================

/** الجداول المحظور الوصول المباشر إليها */
const BLOCKED_TABLES = [
  'orders',
  'order_items',
  'customers',
  'customer_addresses',
  'companies',
]

/** RPCs المسموح بها للطلبات */
const ALLOWED_ORDER_RPCS = [
  'governed_create_order',
  'governed_get_order',
  'get_governed_orders',
  'governed_submit_order',
  'governed_approve_order',
  'governed_change_order_status',
  'get_governed_order_items',
]

/** RPCs المسموح بها للعملاء */
const ALLOWED_CUSTOMER_RPCS = [
  'governed_create_customer',
  'governed_update_customer',
  'get_governed_customer',
  'get_governed_customers',
  'get_governed_customer_addresses',
  'get_governed_customer_contacts',
  'register_customer',
]

export function checkDirectTableAccess(tableName: string): boolean {
  if (BLOCKED_TABLES.includes(tableName)) {
    warnDeprecatedUsage('SUPABASE', `supabase.from('${tableName}') مباشر — محظور بواسطة SYSTEM_OF_TRUTH ENFORCEMENT`)
    return false
  }
  return true
}

/**
 * createBlockedQuery: ينشئ كائن thenable يُرجع { data: null, error }
 * لأي استعلام محظور، مع دعم التجميع (chaining).
 */
function createBlockedQuery(tableName: string): Record<string, unknown> {
  const blockedError = {
    message: `BLOCKED BY SYSTEM_OF_TRUTH: direct supabase.from('${tableName}') غير مسموح. استخدم governed RPC بدلاً من ذلك.`,
    code: 'ENFORCEMENT_BLOCK',
    details: '',
    hint: '',
  }

  // نواة thenable تُرجع الـ error
  const thenable = Promise.resolve({ data: null, error: blockedError })

  const handler: ProxyHandler<Promise<{ data: null; error: typeof blockedError }>> = {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return target[prop as keyof typeof target]
      }
      return (..._args: unknown[]) => new Proxy(thenable, handler)
    },
  }

  return new Proxy(thenable, handler) as unknown as Record<string, unknown>
}

/**
 * supabaseProxy: يلف كائن supabase الأصلي.
 *
 * - from(): يمنع الوصول للجداول المحظورة
 * - rpc(): يسجل تحذيراً لـ RPCs غير المحكومة (لا يمنع — قد يكون هناك RPCs شرعية غير موثقة)
 */
export function supabaseProxy(supabase: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(supabase, {
    get(target, prop) {
      if (prop === 'from') {
        return (tableName: string) => {
          if (!checkDirectTableAccess(tableName)) {
            return createBlockedQuery(tableName)
          }
          return (target[prop] as (...a: unknown[]) => unknown)(tableName)
        }
      }
      if (prop === 'rpc') {
        return (rpcName: string, ...args: unknown[]) => {
          if (!ALLOWED_ORDER_RPCS.includes(rpcName) && !ALLOWED_CUSTOMER_RPCS.includes(rpcName)) {
            warnDeprecatedUsage('RPC', `RPC غير محكوم: ${rpcName} — يفضل استخدام governed RPC`)
          }
          return (target[prop] as (...a: unknown[]) => unknown)(rpcName, ...args)
        }
      }
      return target[prop]
    },
  })
}

// ============================================================================
// 4. WHATSAPP ENFORCEMENT — منع whatsapp:// protocol
// ============================================================================

/**
 * registerWindowOpenGuard: يلف window.open ليمنع استخدام whatsapp://
 *
 * - يسمح فقط بـ wa.me URLs (المستخدمة من sendWhatsAppFromDisplay)
 * - يمنع أي whatsapp:// protocol
 */
export function registerWindowOpenGuard(): void {
  if (typeof window === 'undefined') return

  const originalOpen = window.open.bind(window)

  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    const urlStr = typeof url === 'string' ? url : url?.toString() || ''

    if (urlStr.startsWith('whatsapp://')) {
      warnDeprecatedUsage('WHATSAPP', `whatsapp:// محظور — استخدم sendWhatsAppFromDisplay()`)
      if (isDev) {
        console.error(
          '%c🚫 SYSTEM_OF_TRUTH ENFORCEMENT: whatsapp:// محظور%c\nاستخدم sendWhatsAppFromDisplay() مع https://wa.me بدلاً من ذلك',
          'color: #ff0000; font-weight: bold; font-size: 14px;',
          'color: #ff4444; font-size: 12px;'
        )
      }
      return null
    }

    return originalOpen(url, target, features)
  }

  // حماية location.href من تعيين قيمة whatsapp://
  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'location') || Object.getOwnPropertyDescriptor(window, 'location')
    // لا يمكن override location بسهولة — يتم التعامل معه بشكل منفصل
  } catch {
    // تجاهل
  }
}

// ============================================================================
// 5. DIAGNOSTICS
// ============================================================================

export function reportViolations(): { count: number; details: string } {
  const log = getViolationLog()
  return {
    count: log.length,
    details: log.length === 0
      ? '✅ SYSTEM_OF_TRUTH ENFORCEMENT: 0 violations detected'
      : `❌ SYSTEM_OF_TRUTH ENFORCEMENT: ${log.length} violation(s) detected\n${log.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`,
  }
}
