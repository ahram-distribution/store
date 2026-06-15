# SYSTEM OF TRUTH ENFORCEMENT REPORT — تقرير التنفيذ

> **التاريخ:** 2026-06-16  
> **المرجع:** SYSTEM_OF_TRUTH_MAP.md  
> **الأدوات:** systemOfTruthGuard.ts, ACTIVE_RUNTIME_ONLY.md, FIX_HISTORY.md

---

## ملخص التنفيذ

| المنطقة | الحالة | المخالفات |
|---------|--------|-----------|
| **GPS** | ✅ مُوحَّد (جزئياً) — جميع الصفحات تستخدم `gpsService.getCurrentLocation()` | 0 مخالفات مباشرة، 11 استيراداً يحتاج ترقية إلى `gpsEngine.acquire()` |
| **Orders** | ✅ مُوحَّد — جميع العمليات عبر governed RPCs | 0 مخالفات |
| **Customers** | ⚠️ مخالفتان مباشرتان | 2 |
| **WhatsApp** | ✅ مُوحَّد — جميع الصفحات تستخدم `wa.me` عبر `sendWhatsAppFromDisplay()` | 0 مخالفات |
| **Auth** | ✅ مُوحَّد — جميع العمليات عبر `authService` | 0 مخالفات |
| **Attendance** | ⚠️ تبعية على `trackingEngine` المباشر | 1 ملف (9 استدعاءات) |

---

## 1. GPS — تحليل التنفيذ

### الاستخدام الصحيح (11 صفحة تستورد `getCurrentLocation` من `gpsService`)

| الملف | خط | الاستخدام |
|-------|-----|-----------|
| `src/pages/visits/VisitsPage.tsx` | 8 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/visits/VisitScreen.tsx` | 8 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/visits/VisitDetailPage.tsx` | 8 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/auth/RegistrationPage.tsx` | 6 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/attendance/runtime/AttendanceRuntimePage.tsx` | 7 | `import { getCurrentLocation } from '../../../services/gpsService'` |
| `src/pages/sales-manager/SalesManagerCCPage.tsx` | 6 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/customers/NewCustomerPage.tsx` | 6 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/customers/CustomerProfilePage.tsx` | 21 | `import { getCurrentLocation } from '../../services/gpsService'` |
| `src/pages/diagnostics/GpsTestPage.tsx` | 4-8 | `getCurrentLocation, startWatching, stopWatching, getLastKnownLocation` |
| `src/services/trackingEngine.ts` | 264, 273, 296, 420, 455 | يستخدم `gpsService.startWatching()` و `getLastKnownLocation()` |
| `src/components/shared/LocationDisplay.tsx` | 23 | يستخدم `locationService` بشكل صحيح |

### الحكم

✅ **التنفيذ الأساسي صحيح** — لا توجد صفحة تستخدم `navigator.geolocation` مباشرة خارج `gpsService.ts`.  
👌 **التحسين المطلوب:** ترقية الاستيرادات من `gpsService` إلى `gpsEngine` عبر `systemOfTruthGuard.ts`.

---

## 2. Orders — تحليل التنفيذ

| الملف | النتيجة |
|-------|---------|
| جميع الملفات | ✅ لا يوجد أي `supabase.from('orders')` أو `supabase.from('order_items')` |

### الحكم

✅ **مُوحَّد بالكامل.** جميع عمليات الطلبات تمر عبر governed RPCs.

---

## 3. Customers — المخالفات

### مخالفة 1: `AccountPage.tsx` (خط 156)

```typescript
// ❌ VIOLATION — direct supabase.from('customer_addresses')
supabase
  .from('customer_addresses')
  .select('*')
  .eq('customer_id', customerId)
```

**الخطر:** HIGH — RLS غير مفعل على `customer_addresses`. يجب استخدام `get_governed_customer_addresses` RPC.  
**المرجع:** `FIX_HISTORY.md` FIX-013, `ACTIVE_RUNTIME_ONLY.md` #9

### مخالفة 2: `CompanyManagerPage.tsx` (خط 72)

```typescript
// ❌ VIOLATION — direct supabase.from('companies')
const { data: full } = await supabase.from('companies').select('*').eq('id', id).single()
```

**الخطر:** HIGH — RLS غير مفعل على `companies`. يجب استخدام governed RPC للشركات.  
**المرجع:** `ACTIVE_RUNTIME_ONLY.md` #7

---

## 4. WhatsApp — تحليل التنفيذ

| الملف | النتيجة |
|-------|---------|
| `src/lib/whatsapp.ts` | ✅ `sendWhatsAppFromDisplay()` يستخدم `wa.me` protocol مع `window.open(..., 'noopener,noreferrer')` |
| `src/pages/orders/OrderDetailView.tsx` | ✅ يستخدم `sendWhatsAppFromDisplay()` |
| `src/pages/orders/OrderReviewPage.tsx` | ✅ يستخدم `sendWhatsAppFromDisplay()` |
| `src/pages/orders/OrderNewPage.tsx` | ✅ يستخدم `sendWhatsAppFromDisplay()` |
| جميع الملفات | ✅ لا يوجد أي استخدام لـ `whatsapp://` أو `window.location.href` مع WhatsApp |

### الحكم

✅ **مُوحَّد بالكامل.** جميع عمليات WhatsApp تمر عبر `sendWhatsAppFromDisplay()`.

---

## 5. Attendance — تحليل التبعيات

### `AttendanceRuntimePage.tsx` (9 استدعاءات)

| خط | الاستدعاء | الحالة |
|----|-----------|--------|
| 86 | `trackingEngine.status` | ⚠️ مباشر |
| 107 | `trackingEngine.start(sessionId, employeeId, interval)` | ⚠️ مباشر |
| 110 | `trackingEngine.start(sessionId, employeeId, 300)` | ⚠️ مباشر |
| 119 | `trackingEngine.subscribe(setTrackingStatus)` | ⚠️ مباشر |
| 129 | `trackingEngine.status.running` | ⚠️ مباشر |
| 133 | `trackingEngine.status.running` | ⚠️ مباشر |
| 134 | `trackingEngine.stop()` | ⚠️ مباشر |
| 187 | `trackingEngine.flushNow()` | ⚠️ مباشر |
| 215 | `trackingEngine.stop()` | ⚠️ مباشر |

### الحكم

⚠️ `trackingEngine` هو الـ engine الوحيد للتتبع (لا توجد نسخة أخرى)، لذا استخدامه المباشر مقبول حالياً. لكن يجب في المستقبل توفير واجهة موحّدة عبر guard layer.

---

## 6. Guard Layer — حالة التنفيذ

### `src/utils/systemOfTruthGuard.ts`

| الميزة | الحالة |
|--------|--------|
| `gpsEngine.acquire()` | ✅ تم — يلف `gpsService.getCurrentLocation()` |
| `warnDeprecatedUsage()` | ✅ تم — يسجل violations مع stack trace |
| `registerGeolocationGuard()` | ✅ تم — Proxy على `navigator.geolocation` |
| `checkDirectTableAccess()` | ✅ تم — 16 جدولاً محظوراً |
| `supabaseProxy()` | ✅ تم — يلف supabase لرصد violations |
| `reportViolations()` | ✅ تم — تقرير بجميع violations |
| `checkWhatsappUsage()` | ✅ تم — يرصد `whatsapp://` و `window.location.href` |

---

## 7. المخالفات المتبقية (Open Violations)

| ID | الموقع | المخالفة | الخطر | المرجع |
|----|--------|---------|-------|--------|
| V-001 | `AccountPage.tsx:156` | `supabase.from('customer_addresses')` | HIGH | FIX-013 |
| V-002 | `CompanyManagerPage.tsx:72` | `supabase.from('companies')` | HIGH | FIX-014 |

### ملاحظة

المخالفتان معروفتان وموثقتان في `FIX_HISTORY.md` و `ACTIVE_RUNTIME_ONLY.md`. لا يوجد غيرهما من مخالفات الـ `supabase.from()` المباشر للجداول المحظورة.

---

## 8. الإجراءات المتبقية

1. **إضافة Guard Layer إلى التطبيق** — استدعاء `registerGeolocationGuard()` في نقطة بدء التطبيق
2. **تفعيل `supabaseProxy()`** — لف كائن supabase الأساسي لرصد violations
3. **إصلاح V-001** (AccountPage) — استخدام `get_governed_customer_addresses` RPC
4. **إصلاح V-002** (CompanyManagerPage) — استخدام governed RPC للشركات
5. **ترقية استيرادات GPS** — من `gpsService` إلى `gpsEngine`

---

*تاريخ الإنشاء: 2026-06-16*  
*المرجع: SYSTEM_OF_TRUTH_MAP.md، REGRESSION_GUARD.md، ACTIVE_RUNTIME_ONLY.md، FIX_HISTORY.md*
