# INVOICE_REFERENCE.md — فاتورة المبيعات (Storefront Invoice)

## الملفات الأصلية

| الملف | المسار |
|---|---|
| ViewModel Builder | `services/storefront/invoiceViewModel.js` |
| HTML Rendering (Screen) | `services/storefront/canonicalInvoice.js` |
| PDF Rendering (A4 + A5) | `services/storefront/pdfService.js` |
| API Layer | `services/storefront/invoicesApi.js` |
| Group Items Utility | `services/storefront/groupItems.js` |
| Detail Page Controller | `domains/storefront/pages/invoices/detail.js` |
| Contracts | `services/contracts/orders.contract.js` |

## وصف الواجهة

صفحة عرض تفاصيل الفاتورة كاملة (طلب شراء أو فاتورة) مع:
- Header باسم الشركة ونوع المستند ورقمه
- كروت جانبية لمعلومات العميل، مندوب المبيعات، موقع التنفيذ، دليل الزيارة
- جدول الأصناف مجمع حسب الشركة
- ملخص (عدد الأصناف، إجمالي الكميات، الإجمالي النهائي)
- Revision badge في حالة التعديل
- Timeline / سجل التغييرات
- أزرار PDF (A4 + A5)، واتساب، تعديل الطلب
- العودة للفواتير

## الحقول (ViewModel)

```js
vm = {
  company: { name: 'شركة الأهرام للتجارة والتوزيع', brand: 'متجر الأهرام' },
  invoice: {
    id, number, docType, date, dateStr, timeStr,
    status, statusLabel, total, totalQty, itemCount,
    notes, revision, updatedAt, updatedBy, updatedByName
  },
  customer: { name, phone, address, locationLink },
  creator: { name, phone, address, type },
  execution: {
    latitude, longitude, accuracy, quality, qualityLabel,
    source, sourceLabel, capturedAt, capturedAtStr,
    capturedAtTime, capturedAtDate, mapsUrl
  },
  visit: {
    visitId, visitNumber, openedAt, openedAtTime,
    invoiceCreatedAt, invoiceCreatedAtTime, diffMs, diffLabel
  } | null,
  items: [{ product_name_snapshot, product_code_snapshot, unit_name_snapshot, quantity, base_price, discount_percent, final_price, company_name_snapshot, tier_name_snapshot }],
  groupedItems: [{ companyName, items }],
  timeline: [{ id, old_status, new_status, note, created_at, changed_by_name }]
}
```

## Workflow

1. يتم استدعاء `getInvoiceDetail(orderId)` من `invoicesApi.js`
2. تجلب البيانات من 4 مصادر بالتوازي:
   - `runtime_order_visibility` (معلومات الطلب)
   - `order_items` (الأصناف)
   - `orders` (revision, updated_at, execution data)
   - `order_timeline` (سجل التغييرات)
3. يتم بناء ViewModel عبر `buildInvoiceViewModel({ order, items, session, geo, activeVisit })`
4. تعرض الصفحة عبر `buildCanonicalInvoiceHtml(vm)` للشاشة أو `renderInvoiceHtml(vm)` للـ PDF

## القوالب

### جدول الأصناف (Screen — canonicalInvoice.js)

| كود الصنف | اسم الصنف | الوحدة | الكمية | السعر | الإجمالي |
|---|---|---|---|---|---|
| — | المطعم (3 أصناف) | | | | |
| ABC-123 | منتج أ | قطعة | 5 | 50 ج.م | 250 ج.م |
| | إجمالي المطعم | | | | 250 ج.م |
| | الإجمالي النهائي | | | | 250 ج.م |

### جدول الأصناف (PDF — pdfService.js)

نفس الأعمدة مع تنسيق مطبعي بـ `@page { size: A4; margin: 1.5cm }`.

### Timeline (سجل التغييرات)

لكل حدث: تاريخ + وقت + اسم الفاعل + نوع الحدث + تفاصيل التغيير.

أنواع التغييرات المدعومة: `QTY_CHANGE`, `ADD_ITEM`, `REMOVE_ITEM`, `PRICE_CHANGE`, `STATUS_CHANGE`.

## الأزرار

| الزر | الموقع | الإجراء |
|---|---|---|
| 🖨️ PDF A4 | `detail.js` | `renderInvoiceHtml(vm)` → `printInvoice(html)` → `window.print()` |
| 📱 PDF A5 | `detail.js` | `printInvoiceA5(vm)` → `renderInvoiceHtmlA5(vm)` → `window.print()` |
| 📱 إرسال واتساب | `detail.js` | `buildWhatsAppMessage(vm)` → `window.open(url)` |
| ✏️ تعديل الطلب | `detail.js` | `restoreCartFromOrder()` → `location.hash = '#checkout?edit=1'` |
| ← العودة للفواتير | `detail.js` | رابط `#invoices` |

### شروط ظهور زر التعديل
- المستخدم من نوع `employee`
- الطلب مملوك للموظف (`createdByEmployeeId === ses.actor.id`)
- الحالة من ضمن `['submitted', 'pending', 'reviewing']`

## التنقلات

- `#invoices/:id` → صفحة تفاصيل الفاتورة
- زر العودة: `#invoices`
- زر التعديل: `#checkout?edit=1`

## Screens المستخدمة

- `runtime_order_visibility` (view) — بيانات الطلب الأساسية
- `order_items` (table) — الأصناف
- `orders` (table) — بيانات إضافية (revision, execution)
- `order_timeline` (table) — سجل التغييرات
- `employees` (table) — لاستكمال اسم الممثل (actor_name)

## ملاحظات مهمة

1. **DocType logic**: إذا كانت الحالة `pending`, `reviewing`, `submitted` → "طلب شراء" وإلا "فاتورة"
2. **GPS Accuracy**: يُصنف الدقة إلى `excellent (≤10m)`, `accurate (≤15m)`, `good (≤30m)`, `weak (≤50m)`, `rejected (>50m)`
3. **Status translation**: 17 حالة مع ترجمة عربية كاملة
4. **Duration label**: يُحسب الفرق بين وقت بدء الزيارة ووقت إنشاء الفاتورة ويعرض "X ساعة و Y دقيقة" أو "Y دقيقة"
5. **Execution source**: `gps`, `network`, `cached`, `manual` مع ترجمة عربية
6. **Audit event label**: لكل حالة حدث مراجعة مع ترجمة مخصصة
7. **Missing snapshots**: يتم استكمال `customer_name_snapshot`, `created_by_name_snapshot`, `actor_name` من جداول إضافية إذا كانت null في view
8. **No external PDF library**: الطباعة تتم عبر `window.print()` فقط، لا توجد مكتبة PDF خارجية
9. **Revision badge**: يظهر فقط إذا `revision > 0` مع تاريخ واسم آخر تعديل

## تصنيف دقة GPS

```js
excellent: ≤10m  → 'ممتازة'
accurate: ≤15m   → 'دقيقة'
good: ≤30m       → 'جيدة'
weak: ≤50m       → 'ضعيفة'
rejected: >50m   → 'مرفوضة'
```

## حالات الطلب وترجمتها

```js
draft: 'مسودة', pending: 'قيد الانتظار', submitted: 'تم الإرسال',
reviewing: 'تحت المراجعة', approved: 'معتمد', preparing: 'قيد التجهيز',
dispatched: 'خرج للشحن', delivered: 'تم التسليم', collected: 'تم التحصيل',
returned: 'مرتجع', cancelled: 'ملغي', confirmed: 'تم التأكيد',
processing: 'قيد التجهيز', shipped: 'تم الشحن', paid: 'مدفوع',
completed: 'مكتمل', rejected: 'مرفوض'
```
