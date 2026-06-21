# إصلاح رسالة الواتساب — توحيد مصدر البيانات

## التاريخ
2026-06-21

## Commit
`6aed78a`

## الملفات المعدلة
| ملف | التغيير |
|---|---|
| `src/pages/orders/OrderNewPage.tsx` | تمرير `fullOrder.order` بدلاً من `fullOrder` + إزالة DTO منفصل للأصناف |
| `src/pages/orders/OrderEditPage.tsx` | نفس الإصلاح |
| `src/pages/storefront/OrderReviewPage.tsx` | نفس الإصلاح |
| `src/lib/whatsapp.ts` | إضافة `isNaN(d.getTime())` لمنع ظهور NaN |
| `src/types/order-display.ts` | إضافة `customer_owner_name` / `order_creator_name` كمفاتيح احتياطية |

---

## Root Cause

### المشكلة
رسالة الواتساب كانت تظهر:
- رقم الطلب: **فارغ**
- التاريخ: **NaN**
- بيانات العميل: **غير متوفر**
- بيانات المسؤول: **غير متوفر**
- بيانات مرسل الطلب: **غير متوفر**
- طريقة الدفع: **غير متوفر**

بينما الأصناف والإجماليات كانت تظهر **صحيحة**.

### التحليل
دالة `buildOrderDisplayData()` تستقبل كائن `order` وتقرأ منه الحقول التالية:
```
o.order_number
o.created_at
o.snapshot_customer_name
o.snapshot_owner_name
o.snapshot_sender_name
o.payment_method
```

في `OrderDetailView.tsx` (صفحة الطلبات الموحدة) كان النداء صحيحاً:
```typescript
buildOrderDisplayData({ order: data.order, items: data.items })
// data.order = الكائن الفرعي order القادم من RPC ✅
```

أما في `OrderNewPage.tsx` و`OrderEditPage.tsx` و`OrderReviewPage.tsx` فكان النداء خاطئاً:
```typescript
// ❌ fullOrder = استجابة RPC الكاملة { order: {...}, customer: {...}, items: [...] }
buildOrderDisplayData({ order: fullOrder, items: orderItems })
```

الاستجابة الكاملة من RPC لا تحتوي على `order_number` أو `snapshot_customer_name` في جذرها — هذه الحقول موجودة داخل `fullOrder.order`. لذلك كل الحقول كانت `undefined`.

الأصناف كانت تعمل لأنها كانت تمرر كمعامل منفصل `items` مع Transform مخصص (DTO منفصل).

### شجرة الخطأ
```
get_unified_order RPC
  └─ { order: { order_number, snapshot_customer_name, ... },
       customer: { ... },
       items: [...] }

OrderNewPage.tsx (قبل الإصلاح)
  └─ buildOrderDisplayData({ order: fullOrder ❌, items: items })
      └─ o = fullOrder = { order: {...}, customer: {...}, ... }
          └─ o.order_number → undefined → ''
          └─ o.snapshot_customer_name → undefined → ''
          └─ o.created_at → undefined → formatDateTime('') → NaN
```

---

## Source of Truth المعتمد

`get_unified_order` RPC — نفس RPC المستخدم في `OrderDetailView` (صفحة الطلبات الموحدة).

مصدر الحقيقة لكل حقل في الرسالة:

| حقل الرسالة | المصدر في RPC | العمود في قاعدة البيانات |
|---|---|---|
| رقم الطلب | `order.order_number` | `orders.order_number` |
| التاريخ | `order.created_at` | `orders.created_at` |
| اسم العميل | `order.snapshot_customer_name` | `orders.snapshot_customer_name` |
| هاتف العميل | `order.snapshot_customer_phone` | `orders.snapshot_customer_phone` |
| عنوان العميل | `order.snapshot_customer_address` | `orders.snapshot_customer_address` |
| اسم المسؤول | `order.snapshot_owner_name` ← `order.customer_owner_name` | Snapshot ← employees |
| هاتف المسؤول | `order.snapshot_owner_phone` | `orders.snapshot_owner_phone` |
| اسم المرسل | `order.snapshot_sender_name` ← `order.order_creator_name` | Snapshot ← identities |
| هاتف المرسل | `order.snapshot_sender_phone` | `orders.snapshot_sender_phone` |
| طريقة الدفع | `order.payment_method` | `orders.payment_method` |
| الأصناف | `items[].product_name` | `order_items` + `products` JOIN |

جميع الحقول تقرأ من نفس كائن `order` الذي تستخدمه `OrderDetailView`.

---

## الإصلاح

### 1. تصحيح تمرير البيانات (3 ملفات)
```typescript
// قبل
buildOrderDisplayData({ order: fullOrder, items: orderItems })

// بعد
buildOrderDisplayData({ order: fullOrder.order, items: fullOrder.items })
```

### 2. إزالة DTO المنفصل للأصناف (3 ملفات)
```typescript
// قبل - Transform منفصل
const orderItems = fullOrder.items.map(i => ({
  ...i,
  products: { product_name: i.product_name, ... }
}))

// بعد - استخدام items كما هي من RPC مباشرة
buildOrderDisplayData({ order: fullOrder.order, items: fullOrder.items })
```

الأصناف من RPC تأتي مسطحة:
```json
{
  "product_name": "...",
  "legacy_code": "...",
  "company_name": "..."
}
```
ودالة `buildOrderDisplayData` تقرأ الحقول المسطحة أولاً قبل `products.` nested:
```typescript
productName: i.product_name || i.products?.product_name || '',
```
لذلك الـ Transform لم يكن ضرورياً.

### 3. منع NaN في التاريخ
```typescript
// قبل
const d = new Date(iso)
const y = d.getFullYear()  // يعطي NaN إذا iso = '' أو invalid

// بعد
const d = new Date(iso)
if (isNaN(d.getTime())) return ''  // يرجع سلسلة فارغة بدلاً من NaN
```

### 4. إضافة مفاتيح احتياطية live
```typescript
// قبل
const ownerName = snapshotVal(o, ['owner_name', 'snapshot_owner_name'])

// بعد
const ownerName = snapshotVal(o, ['owner_name', 'snapshot_owner_name', 'customer_owner_name'])
```
أُضيف `customer_owner_name` و `order_creator_name` كمفاتيح احتياطية للحالات التي تكون فيها حقول Snapshot فارغة (طلبات قديمة).

---

## تدفق البيانات بعد الإصلاح

```
جميع الصفحات (OrderDetailView, OrderNewPage, OrderEditPage, OrderReviewPage)
  │
  ├─ get_unified_order(p_token, p_id)
  │   └─ { order: {...}, customer: {...}, items: [...], ... }
  │
  └─ buildOrderDisplayData({ order: fullOrder.order, items: fullOrder.items })
      │                                  ↑              ↑
      │                           order sub-object   items array
      │                           (نفس المصدر)       (نفس المصدر)
      └─ OrderDisplayData
          └─ buildWhatsAppMessageFromDisplay(display)
              └─ رسالة واتساب موحدة
```

جميع المسارات تؤدي إلى نفس مصدر البيانات ولا يوجد Query أو DTO مستقل.

---

## التحقق

- [x] `OrderDetailView.tsx` — لم يتغير (كان صحيحاً أصلاً)
- [x] `OrderNewPage.tsx` — تم تصحيح `fullOrder` → `fullOrder.order`
- [x] `OrderEditPage.tsx` — تم تصحيح `fullOrder` → `fullOrder.order`
- [x] `OrderReviewPage.tsx` — تم تصحيح `fullOrder` → `fullOrder.order`
- [x] `whatsapp.ts` — تم إضافة حماية NaN
- [x] `order-display.ts` — تم إضافة مفاتيح احتياطية live
- [x] Build success (`npm run build`)
- [x] Push + Deploy success (commit `6aed78a`, workflow completed)
