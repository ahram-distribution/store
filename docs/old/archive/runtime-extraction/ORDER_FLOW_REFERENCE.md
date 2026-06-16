# ORDER_FLOW_REFERENCE.md — تدفق إنشاء الفاتورة (Order Submission Flow)

## الملفات الأصلية

| الملف | المسار |
|---|---|
| Orchestrator | `services/storefront/invoiceRuntime.js` |
| Order CRUD + Idempotency | `services/storefront/orderApi.js` |
| Cart Management | `services/storefront/cartApi.js` |
| Timeline Logger | `services/storefront/orderTimelineApi.js` |
| Checkout Page UI | `domains/storefront/pages/checkout.js` |
| Visit Linker | `services/storefront/visitsApi.js` |
| Governance | `services/storefront/governanceRuntime.js` |
| Contract | `services/contracts/orders.contract.js` |

## وصف التدفق

### 1. Checkout Page (`checkout.js`)

المستخدم يضغط "إنشاء الفاتورة وإرسالها" ويتم:

1. `acquireCheckoutLock()` — منع التنفيذ المتزامن (30s timeout)
2. `hydrateCart()` — تحميل بيانات المنتجات والأسعار والمخزون
3. `validateCart()` — التحقق من وجود المنتج، الوحدة، السعر، المخزون
4. `_checkBarrier()` — فحص حالة السلة (STALE, INVALID) + أخطاء التحقق
5. إذا OK → `_handleSubmit()`:
   - `clearGeoCache()` — مسح cache GPS السابق
   - `computeTotals(hydrated)` — حساب المجاميع
   - `createInvoiceRuntime(hydrated, notes)` — إنشاء الفاتورة
   - `buildWhatsAppMessage(viewModel)` → `openWhatsApp(url)` — فتح واتساب
   - `clearCart()` — مسح السلة
   - عرض شاشة النجاح

### 2. Invoice Runtime (`invoiceRuntime.js`)

```js
createInvoiceRuntime(hydrated, notes)
```

1. `canCreateOrder()` — التحقق من الصلاحية
2. `computeTotals(hydrated)` — حساب الإجمالي
3. `captureGeo()` — التقاط GPS (3 محاولات + fallback)
4. `createOrder(hydrated, total, geo)` — إنشاء الطلب في قاعدة البيانات
5. `getActiveVisit()` — فحص وجود زيارة نشطة
6. إذا وجدت → `linkOrderToVisit(visitId, orderId, orderNumber)` — ربط الطلب بالزيارة
7. `buildInvoiceViewModel({ order, items, session, geo, activeVisit, geoGuidance })` — بناء ViewModel

### 3. GPS Capture (`invoiceRuntime.js` — `captureGeo()`)

```js
التقاط GPS:
1. 3 محاولات متتالية مع timeout 20s, enableHighAccuracy: true
2. إذا 2 عينات accuracy ≤ 10m → break
3. بين المحاولات 500ms تأخير
4. إذا لا توجد عينات → fallback (enableHighAccuracy: false, timeout 10s, maximumAge: 60s)
5. فرز العينات حسب الدقة (الأفضل أولاً)
6. تخزين cache في _geoCache
7. return: { lat, lng, accuracy, capturedAt, mapsUrl }
```

### 4. Order Creation (`orderApi.js` — `createOrder()`)

**Idempotency Lock**:
- `LOCK_KEY = 'v2_order_checkout_locked'` في sessionStorage
- TTL: 30 دقيقة
- قبل إنشاء الطلب: `_readLock()` → إذا وجد lock قديم → `_findOrderByNumber()` → إذا الطلب موجود → return existing
- بعد توليد رقم الطلب: `_writeLock()` → قبل DB insert
- بعد النجاح: `_clearLock()`

**توليد رقم الطلب**:
- استدعاء RPC: `generate_order_number()`
- إرجاع النص (مثل `AHR-2026-000001`)

**إنشاء سجل في `orders`**:
```js
orderPayload = {
  order_number,
  total_amount,
  workflow_status: 'submitted',
  created_by_type,              // 'employee' | 'customer'
  created_by_name_snapshot,     // full name من session
  order_source: 'storefront',
  created_at: now,
  // إذا الموظف:
  created_by_employee_id,       // UUID من session
  customer_id,                  // من getSelectedCustomer()
  customer_name_snapshot,       // من العميل المختار
  // GPS:
  execution_latitude, execution_longitude,
  execution_maps_url, execution_source: 'gps',
  execution_accuracy_meters, execution_captured_at,
}
```

**إنشاء سجلات في `order_items`**:
لكل صنف في السلة:
```js
{
  order_id,
  product_id, product_unit_id,
  quantity, base_price, final_price,
  line_subtotal, line_total,
  product_name_snapshot, product_code_snapshot,
  unit_name_snapshot, unit_code_snapshot,
  company_name_snapshot, tier_name_snapshot,
  tier_price, quantity_base_unit,
  pricing_source: 'runtime',
  inventory_status: 'reserved',
  approval_status: 'pending',
  participates_in_tier,
  discount_percent, discount_amount,
}
```

**تسجيل حدث في `order_timeline`**:
```js
logTimelineEvent(order.id, 'order_created', {
  newValue: { order_number, total: order.total_amount }
})
```

**إرسال حدث للنظام**:
```js
emit(EVENTS.INVOICE_CREATED, { orderId, orderNumber, total, customerId })
```

### 5. Order Update (`orderApi.js` — `updateOrder()`)

1. جلب current order (revision + metadata)
2. جلب old items للـ change diff
3. زيادة `revision` بمقدار 1
4. تحديث `orders` (PATCH): totals, revision, updated_at, execution data, runtime_metadata
5. حذف old order_items
6. إدراج new order_items
7. إعادة fetch الـ order
8. بناء changeDetails (REMOVE_ITEM, ADD_ITEM, QTY_CHANGE, PRICE_CHANGE)
9. تسجيل `order_edited` في timeline مع changeDetails

### 6. Cart Hydration (`cartApi.js` — `hydrateCart()`)

1. قراءة `v2_cart` من localStorage
2. Fetch المنتجات من `products` + `product_units`
3. Fetch المخزون من `inventory_stock`
4. تطبيق الأسعار عبر `resolve_product_price` RPC أو `runtime_product_prices` view
5. حساب `computeTotals()` → subtotal, discountTotal, grand
6. `validateCart()` → errors لكل صنف
7. حفظ حالة السلة (CLEAN, DIRTY, STALE, INVALID)

### 7. Cart State Machine

```
CLEAN → DIRTY (عند إضافة/إزالة/تعديل صنف)
DIRTY → STALE (عند تغيير الشريحة السعرية)
DIRTY → INVALID (عند عدم توفر منتج/سعر/وحدة)
STALE → CLEAN (بعد إعادة التحميل)
INVALID → CLEAN (بعد إزالة الأصناف غير المتاحة)
```

### 8. Checkout Lock (in-memory)

- `_checkoutLocked` boolean
- 30s timeout للتحرير التلقائي
- `acquireCheckoutLock()` → return false إذا كان locked
- `releaseCheckoutLock()` → فتح القفل

## الحقول

### Cart Item (localStorage)
```js
{ pid, puid, qty, product, unit, code, unitName, unitCode }
```

### Hydrated Item
```js
{
  pid, puid, qty, product, unit,
  stock, unitName, unitCode,
  price: { found, base_price, final_price, discount_percent, tier_name, tier_code },
  _pricingContext: { basePrice, finalPrice, discountPercent, tierLabel, reason, hasDiscount }
}
```

### Compute Totals
```js
{ subtotal, discountTotal, grand }
```

## الأزرار (Checkout Page)

| الزر | الإجراء |
|---|---|
| 💳 إنشاء الفاتورة وإرسالها | `createInvoiceRuntime()` → WhatsApp → نجاح |
| ✏️ تحديث الطلب وإرسال واتساب | `updateInvoiceRuntime()` → WhatsApp → نجاح |
| ← العودة للسلة | `#cart` |
| 📄 عرض الفاتورة | `#invoices/:id` |
| 📱 إعادة فتح واتساب | `buildWhatsAppMessage()` → `openWhatsApp()` |
| 📋 فواتيري | `#invoices` |
| 🛍️ متابعة التسوق | `#products` |

## التنقلات

- `#checkout` → صفحة المراجعة
- `#checkout?edit=1` → تعديل الفاتورة
- `#customers?select=1` → اختيار عميل (إذا لم يتم اختياره)
- `#invoices/:id` → عرض الفاتورة بعد الإنشاء

## Screens المستخدمة

| الـ Table/View | الاستخدام |
|---|---|
| `orders` | إنشاء/تحديث الطلب |
| `order_items` | إدراج/حذف الأصناف |
| `order_timeline` | تسجيل الأحداث |
| `generate_order_number` (RPC) | توليد رقم الطلب |
| `resolve_product_price` (RPC) | حساب السعر مع الشرائح |
| `runtime_product_prices` (view) | Fallback للأسعار |
| `products` | معلومات المنتجات |
| `product_units` | وحدات المنتج |
| `inventory_stock` | المخزون المتاح |
| `runtime_order_visibility` (view) | fetch بعد التحديث |
| `customer_tier_assignments` | شرائح العميل (للمتجر) |
| `employees` | استكمال بيانات الموظف |

## ملاحظات مهمة

1. **Idempotency**: Lock في sessionStorage + TTL 30 دقيقة + استرجاع الطلب الموجود
2. **GPS**: 3 محاولات + fallback → cache للجلسة
3. **Cart isolation**: السلة في localStorage منفصلة عن أي zustand store
4. **Edit flow**: يخزن `EDIT_ORDER_KEY` في sessionStorage → يستخدم `clearEditOrderId()` بعد الانتهاء
5. **Customer selection**: `CUSTOMER_SELECT_KEY` في sessionStorage → ضروري للموظفين (اختيار عميل)
6. **التحقق من الصلاحية**: `canCreateOrder()` من governance — قبل أي عملية
7. **Cart validation**: يتحقق من product موجود، unit موجود، price موجود، stock كافي
8. **Cart stale detection**: اشتراك في session changes → إذا تغير type/role/tier → mark stale
9. **Barrier check**: قبل الإرسال → إذا critical errors → تعطيل الزر
10. **Error handling**: network errors → toast, generic errors → toast, مع إعادة تمكين الزر
11. **Success screen**: يعرض ملخص الفاتورة + أزرار الإجراءات + فتح واتساب تلقائي
12. **لا يوجد استخدام لـ zustand**: كل التخزين في localStorage/sessionStorage + in-memory
13. **طلب العميل مقابل الموظف**: customer → لا يحتاج اختيار عميل (هو نفسه العميل)، employee → يجب اختيار عميل عبر `getSelectedCustomer()`
