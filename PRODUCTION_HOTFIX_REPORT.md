# PRODUCTION HOTFIX REPORT — تقرير الإصلاحات التشغيلية

> **التاريخ:** 2026-06-16  
> **المرحلة:** Pre-Go-Live Critical Fixes  
> **المرجع:** PRODUCTION_HOTFIX_REPORT.md  

---

## Fix 1 — GitHub Pages SPA Routing / 404

### Root Cause

**سببان مترابطان:**

1. **Trailing slash في basename:** `App.tsx` كان يستخدم `VITE_BASE_PATH` مباشرة كـ `basename` لـ React Router. القيمة القادمة من `deploy.yml` هي `/store/` (مع slash). React Router v6 يتوقع basename بدون trailing slash. هذا يسبب عدم تطابق في routing.

2. **عدم وجود SPA fallback script:** الـ `generate-404` plugin موجود في `vite.config.ts` وينسخ `index.html` ← `404.html`. لكن في حال لم يتم serve الـ 404.html بشكل صحيح (مشاكل GitHub Pages، SW caching، أو build قديم)، لا يوجد fallback script إضافي.

### Files Changed

| الملف | السطر | التغيير |
|-------|-------|---------|
| `src/App.tsx` | 59 | `basePath` ← `basePath.replace(/\/+$/, '')` — إزالة trailing slash |
| `index.html` | 6-7 | إضافة SPA redirect script + meta tag مع `%BASE_URL%` |

### SPA Redirect Script Logic

```
1. المستخدم يفتح /store/dashboard → GitHub Pages يرجع 404 → يخدم 404.html
2. الـ script يكتشف أن الـ path لا ينتهي بامتداد ملف
3. يحفظ URL الأصلي في sessionStorage
4. يعيد التوجيه إلى /store/ (من meta[name=spa-b])
5. index.html يُحمَّل
6. الـ script يستعيد URL الأصلي من sessionStorage
7. React Router يقرأ المسار المستعاد ويوجّه للصفحة الصحيحة

إضافة إلى ذلك: 404.html (نسخة من index.html) يعمل كـ fallback أساسي
```

### Verification

- `basename` أصبح `/store` بدون trailing slash ← React Router v6 متوافق
- SPA redirect script يعمل مع `%BASE_URL%` الذي يستبدله Vite بـ `/store/` أثناء البناء
- `generate-404` plugin يضمن وجود `dist/404.html` في كل build

---

## Fix 2 — Runtime Crash: "Invalid time value"

### Root Cause

**الملف:** `src/pages/sales-manager/SalesManagerCCPage.tsx`  
**السطر:** 907-908  
**الدالة:** IIFE داخل JSX block

```typescript
// قبل الإصلاح — ينهار إذا كانت القيمة ليست تاريخاً صحيحاً
{startTime && (<span>{new Date(startTime).toLocaleString('ar-EG')}</span>)}
{endTime && (<span>{new Date(endTime).toLocaleString('ar-EG')}</span>)}
```

`new Date(invalidDateString)` يُنشئ Invalid Date object. استدعاء `.toLocaleString('ar-EG')` على Invalid Date يرمي `RangeError: Invalid time value`.

**مصدر البيانات:** `get_governed_visit` RPC (سطر 382). `check_in_at` (NOT NULL) و `check_out_at` (nullable). القيم تأتي من قاعدة البيانات وقد تحتوي على قيم غير صالحة للتاريخ (مثل `null`، سلاسل غير ISO، أو تنسيق غير متوقع).

**لماذا guard `startTime &&` لا يحمي؟** لأن القيمة قد تكون truthy string لكنها ليست تاريخاً صالحاً (مثال: `"0000-00-00"`، `"Invalid date"`). الـ guard يمنع `null` و `undefined` و `""` فقط.

### Files Changed

| الملف | السطر | التغيير |
|-------|-------|---------|
| `src/utils/format.ts` | 25-44 | إضافة `isValidDate()` + `safeFormatDateTime()` |
| `src/pages/sales-manager/SalesManagerCCPage.tsx` | 4 | إضافة import لـ `safeFormatDateTime` |
| `src/pages/sales-manager/SalesManagerCCPage.tsx` | 907-908 | استبدال `new Date(x).toLocaleString(...)` بـ `safeFormatDateTime(x, x)` |

### Fix Details

```typescript
// safeFormatDateTime تتحقق من صحة التاريخ قبل التنسيق
export function safeFormatDateTime(value: string | Date | null | undefined, fallback?: string): string {
  if (!value) return fallback || ''       // null/undefined → fallback
  if (!isValidDate(value)) return fallback || String(value)  // invalid → fallback
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: CAIRO_TZ,
    }).format(value instanceof Date ? value : new Date(value))
  } catch { return fallback || String(value) }
}
```

### Verification

- `isValidDate()`: يتحقق من `null`/`undefined`/`string`/`number`/`Date`/`Invalid Date`
- `safeFormatDateTime()`: لا يرمي أبداً — يعيد fallback أو النص الأصلي في حال الفشل
- النتيجة: `startTime` غير صالح ← يعيد قيمة `startTime` كنص (وليس `RangeError`)

---

## Fix 3 — WhatsApp Snapshot Regression

### Root Cause

**الملف:** `supabase/migrations/20260720_unify_upper_management_role.sql` (السطر 738-759)

**آخر إصدار من `get_governed_order` غيّر نوع الإرجاع من `RETURNS jsonb` إلى `RETURNS orders` (نوع الجدول الخام).**

| الإصدار | نوع الإرجاع | أسماء الحقول | الحالة |
|---------|-------------|--------------|--------|
| `20260714_customer_code_snapshot.sql` | `jsonb` | `customer_name`, `owner_name`, `created_by_name` | ✅ صحيح |
| `20260720_unify_upper_management_role.sql` | `orders` | `snapshot_customer_name`, `snapshot_owner_name`, `snapshot_sender_name` | ❌ خطأ |

عندما يُرجع RPC نوع الجدول الخام، يستقبلها frontend كـ JavaScript object بأسماء أعمدة قاعدة البيانات (مسبوقة بـ `snapshot_`). لكن دالة `buildOrderDisplayData` (وكل الشاشات) تتوقع أسماء مفاتيح نظيفة بدون بادئة (`customer_name` بدلاً من `snapshot_customer_name`). جميع الحقول تؤول إلى `''` → الـ WhatsApp يظهر `—`.

**الملفات المتأثرة:**

| الملف | الاستخدام |
|-------|-----------|
| `src/pages/orders/OrderNewPage.tsx` | WhatsApp بعد إنشاء الطلب |
| `src/pages/storefront/OrderReviewPage.tsx` | WhatsApp من المتجر |
| `src/pages/orders/OrderDetailPage.tsx` + `OrderDetailView.tsx` | عرض التفاصيل + WhatsApp + PDF |
| `src/pages/orders/OrderDetailView.tsx` (renderPdfHtml) | PDF export |

### Files Changed

| الملف | السطر | التغيير |
|-------|-------|---------|
| `src/types/order-display.ts` | 129-134 | إضافة `snapshotVal()` helper — تفحص مفاتيح متعددة وتعيد أول قيمة موجودة |
| `src/types/order-display.ts` | 147-179 | تحديث 15 حقل لاستخدام `snapshotVal()` مع fallback إلى `snapshot_*` |
| `src/components/orders/OrderDetailView.tsx` | 8-13 | إضافة `orderVal()` helper |
| `src/components/orders/OrderDetailView.tsx` | 51-64, 232-242, 306 | تحديث 20+ حقل لاستخدام `orderVal()` مع fallback إلى `snapshot_*` |

### Fix Details

```typescript
// Helper يفحص قائمة مفاتيح ويعيد أول قيمة غير فارغة
function snapshotVal(o: any, keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

// مثال: customer_name يتحقق من:
//   o.customer_name → o.snapshot_customer_name → ''
customerName = snapshotVal(o, ['customer_name', 'snapshot_customer_name'])
```

### Verification

- `buildOrderDisplayData` يتعامل مع كلا التنسيقين (clean keys + snapshot_* keys)
- `OrderDetailView.tsx` يتعامل مع كلا التنسيقين في renderPdfHtml + main render + template
- WhatsApp و PDF و Order Detail جميعها تعمل بغض النظر عن تنسيق RPC
- التوافق عكسي: أي RPC جديد (JSONB صحيح) يستمر في العمل

---

## ملخص التغييرات

| الـ Fix | الملفات المتأثرة | Lines Changed | الخطر |
|---------|-----------------|---------------|-------|
| 1 — 404 Routing | `index.html`, `src/App.tsx` | +3, -1 | LOW |
| 2 — Date Crash | `src/utils/format.ts`, `SalesManagerCCPage.tsx` | +19, -2 | LOW |
| 3 — WhatsApp | `src/types/order-display.ts`, `OrderDetailView.tsx` | +35, -13 | LOW |
| **الإجمالي** | **6 files** | +57, -16 | **LOW** — كل التغييرات محصورة ولا تمس Architecture |

---

*تاريخ الإنشاء: 2026-06-16*  
*الحالة: ✅ جميع الإصلاحات الثلاثة منفذة، commit pending*
