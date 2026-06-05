# MY_ORDERS_REFERENCE.md — قائمة الطلبات (Field Domain)

## الملفات الأصلية

| الملف | المسار |
|---|---|
| List Page | `domains/field/pages/orders.js` |
| Detail Page | `domains/field/pages/order.js` |
| Order Contract | `services/contracts/orders.contract.js` |
| Group Items | `services/storefront/groupItems.js` |
| Storefront Invoices Detail | `domains/storefront/pages/invoices/detail.js` |
| Storefront Invoice ViewModel | `services/storefront/invoiceViewModel.js` |

## وصف الواجهة — قائمة الطلبات

صفحة عرض قائمة الطلبات للمندوب الميداني:
- **قائمة عمودية**: `<a>` cards مع معلومات موجزة
- **لا توجد فلاتر** — كل الطلبات المتاحة ضمن نطاق الرؤية
- **الحد**: 50 طلب (`limit=50`)
- **الترتيب**: `created_at.desc`

### Contents of each card:
```
السطر 1: {docType} {order_number} | {status Arabic}
السطر 2: 👤 {customer_name} - {customer_phone}
السطر 3: 📍 {customer_address}  (إن وجد)
السطر 4: 🧑‍💼 {rep_name} - {rep_phone}
السطر 5: {date} - {total} ج.م
```

### صفحة تفاصيل الطلب

- زر رجوع "← العودة"
- Header: نوع المستند + الرقم + الحالة بالعربي
- معلومات: العميل (الاسم، الهاتف، العنوان)، مندوب المبيعات، التاريخ، الإجمالي، الملاحظات
- جدول الأصناف: **كود الصنف | اسم الصنف | الكمية | السعر | الإجمالي** (بدون عمود الوحدة)
- تجميع حسب الشركة مع إجمالي فرعي لكل شركة

## الحقول

### Order List Select
```js
'id,order_number,customer_id,total_amount,order_status,workflow_status,created_at,created_by_employee_id,created_by_name,created_by_name_snapshot,created_by_phone_snapshot,owner_name_snapshot,role_code,created_by_code,customer_name_snapshot,customer_phone_snapshot,customer_address_snapshot'
```

### Order Detail Select
```js
'id,order_number,customer_id,customer_name_snapshot,customer_phone_snapshot,customer_address_snapshot,created_by_name_snapshot,created_by_phone_snapshot,total_amount,discount_amount,subtotal_amount,order_status,workflow_status,approval_status,payment_status,created_at,note,created_by_employee_id,created_by_name,created_by_code,owner_type,owner_id,owner_name_snapshot,manager_name,role_code,role_name,execution_latitude,execution_longitude,execution_maps_url,execution_source,order_execution_status,payment_method_id,branch_id,warehouse_id,order_source,visit_id'
```

### Order Item Fields (Detail Page)
```js
'*,product_name_snapshot,product_code_snapshot,unit_name_snapshot,final_price'
```

### Status Translation (Field Domain)
```js
pending: 'قيد الانتظار'
confirmed: 'مؤكد'
processing: 'قيد التنفيذ'
shipped: 'تم الشحن'
delivered: 'تم التوصيل'
cancelled: 'ملغي'
```

## Workflow

### قائمة الطلبات:
1. `renderFieldOrders(container)` → `runtime_order_visibility` مع `orderListSelect()`
2. يطبق `buildOrderScopeFilter()` لتحديد نطاق الرؤية
3. يعرض القائمة مع `limit=50` مرتبة تنازلياً
4. كل card clickable → `#field/orders/:id`

### صفحة الطلب:
1. `renderFieldOrder(container, params)` → `params.orderId`
2. يستدعي بالتوازي:
   - `runtime_order_visibility` (تفاصيل الطلب)
   - `order_items` (الأصناف)
3. يعرض المعلومات + جدول الأصناف المجمع حسب الشركة

### DocType Logic:
```js
function _docTitle(status) {
  const s = String(status || '').trim().toLowerCase();
  return ['pending', 'reviewing', 'submitted'].includes(s) ? 'طلب شراء' : 'فاتورة';
}
```

## القوالب

### جدول الأصناف (صفحة التفاصيل — field domain)

| كود الصنف | اسم الصنف | الكمية | السعر | الإجمالي |
|---|---|---|---|---|
| ABC-123 | منتج أ | 5 | 50 ج.م | 250 ج.م |
| | إجمالي الشركة | | | 250 ج.م |
| | الإجمالي النهائي | | | 250 ج.م |

**ملاحظة**: لا يوجد عمود "الوحدة" في نسخة Field Domain (يوجد في Storefront)

### Storefront Checkout Table (نفس الأعمدة لكن مع إضافة الوحدة):
| كود الصنف | اسم الصنف | الوحدة | الكمية | السعر | الإجمالي |

## الأزرار

| الزر | الرابط | الإجراء |
|---|---|---|
| ← العودة | `#field/orders` | العودة للقائمة |

## التنقلات

- `#field/orders` → قائمة الطلبات
- `#field/orders/:orderId` → صفحة الطلب

## Screens المستخدمة

| الـ View/Table | الاستخدام |
|---|---|
| `runtime_order_visibility` | قائمة الطلبات + تفاصيل الطلب |
| `order_items` | أصناف الطلب |

## ملاحظات مهمة

1. **مصدر البيانات**: `runtime_order_visibility` view (وليس `orders` table مباشرة)
2. **نطاق الرؤية**: `buildOrderScopeFilter()` يحدد الطلبات المتاحة حسب صلاحية المستخدم
3. **حالات الطلب**: 6 حالات فقط في Field Domain (قائمة الطلبات) — `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled` (بينما في storefront 17 حالة)
4. **الحد**: 50 طلب — لا يوجد pagination
5. **المعلومات الناقصة**: يتم استكمال معلومات العميل (`customer_name_snapshot`, `customer_phone_snapshot`) من سياق الطلب
6. **جدول الأصناف لا يحتوي على عمود الوحدة** في Field Domain (يحتوي عليه في Storefront)
7. **لا يوجد زر تعديل** أو أي إجراءات في Field Order Detail (عرض فقط)
8. **التجميع حسب الشركة**: يستخدم `groupItemsByCompany()` مع `computeGroupSubtotal()` و `computeGrandTotal()`
9. **وظيفة `_docTitle()`**: نفس منطق `invoiceViewModel.js` — الحالات `pending`, `reviewing`, `submitted` → "طلب شراء" وإلا "فاتورة"
10. **لا توجد روابط Google Maps** في Field Order Detail (بينما توجد في Storefront Invoice Detail)
11. **المقارنة مع Storefront**: Field Order أبسط — لا يوجد GPS, Visit Evidence, Revision, Timeline, أو أزرار PDF
