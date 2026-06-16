# MY_CUSTOMERS_REFERENCE.md — قائمة العملاء (Field Domain)

## الملفات الأصلية

| الملف | المسار |
|---|---|
| List Page | `domains/field/pages/customers.js` |
| Detail Page | `domains/field/pages/customer.js` |
| Customer Contract | `services/contracts/customers.contract.js` |
| Visits Contract | `services/contracts/visits.contract.js` |

## وصف الواجهة — قائمة العملاء

صفحة عرض قائمة العملاء للمندوب الميداني:
- **Search bar**: `<input>` للبحث النصي client-side (الاسم، الهاتف، العنوان)
- **قائمة عمودية**: `<a>` cards مع اسم العميل (bold) + الهاتف + العنوان
- **لا توجد أزرار إجراءات** — فقط click لفتح صفحة العميل
- **لا توجد فلاتر** — فقط بحث نصي

### صفحة تفاصيل العميل

صفحة عميل فردي مع:
- زر رجوع "← العودة"
- Header: اسم العميل + badge (نشط/غير نشط)
- معلومات: الهاتف، العنوان، النوع
- أزرار إجراءات: "بدء زيارة"، "عرض الطلبات"، "تعديل البيانات"
- آخر الزيارات (آخر 5 زيارات) — card مع التاريخ + الحالة + وقت check-in/out

## الحقول

### Customer List Select
```js
'id,customer_code,customer_name,phone,address,customer_type,is_active,created_at,owner_name,owner_code,managed_by_employee_id'
```

### Customer Detail Select (full contract)
```js
CustomerContract = {
  id: 'id', code: 'customer_code', name: 'customer_name',
  phone: 'phone', address: 'address', latitude: 'latitude', longitude: 'longitude',
  branchId: 'branch_id', createdByEmployeeId: 'created_by_employee_id',
  managedByEmployeeId: 'managed_by_employee_id', customerType: 'customer_type',
  isActive: 'is_active', createdAt: 'created_at', mapsUrl: 'google_maps_url',
  password: 'password', ownerName: 'owner_name', ownerCode: 'owner_code',
  managerName: 'manager_name', roleCode: 'role_code', roleName: 'role_name',
}
```

### Visit Card (في صفحة العميل)
```js
{
  id, visit_status, created_at, check_in_time, check_out_time,
  customer_id, customer_name, maps_link
}
```

## Workflow

### قائمة العملاء:
1. `renderFieldCustomers(container)` يستدعي `runtime_customer_visibility`
2. يطبق `buildOrderScopeFilter()` لتحديد نطاق الرؤية
3. يعرض القائمة مع search input
4. البحث: filter client-side على `customer_name`, `phone`, `address`

### صفحة العميل:
1. `renderFieldCustomer(container, params)` يأخذ `params.customerId`
2. يستدعي بالتوازي:
   - `runtime_customer_visibility` (تفاصيل العميل)
   - `runtime_visits_with_maps` (آخر 5 زيارات مع `limit=5`)
3. يعرض المعلومات + أزرار الإجراءات + قائمة الزيارات

## الأزرار (صفحة العميل)

| الزر | الرابط | الإجراء |
|---|---|---|
| ← العودة | `#field/customers` | العودة للقائمة |
| بدء زيارة | `#field/visits` | الانتقال لصفحة الزيارات |
| عرض الطلبات | `#field/orders` | الانتقال لصفحة الطلبات |
| تعديل البيانات | `#field/customers/:id` | تعديل (نفس الصفحة حالياً) |

## التنقلات

- `#field/customers` → قائمة العملاء
- `#field/customers/:customerId` → صفحة العميل
- `#field/visits` → بدء زيارة
- `#field/orders` → عرض الطلبات

## Screens المستخدمة

| الـ View/Table | الاستخدام |
|---|---|
| `runtime_customer_visibility` | بيانات العملاء |
| `runtime_visits_with_maps` | زيارات العميل |

## ملاحظات مهمة

1. **مصدر البيانات**: `runtime_customer_visibility` view (وليس `customers` table مباشرة)
2. **نطاق الرؤية**: `buildOrderScopeFilter()` يحدد العملاء المتاحين حسب صلاحية المستخدم
3. **حالات العميل**: `is_active` → badge "نشط" أو "غير نشط"
4. **حالات الزيارة**: `completed` → ✅ مكتملة, `open` → 🟢 قيد التنفيذ, `cancelled` → ❌ ملغية, default → 📋 مجدولة
5. **عدد الزيارات**: محدود بـ 5 (آخر 5 زيارات)
6. **الترتيب**: الزيارات مرتبة حسب `check_in_time.desc.nullslast`
7. **لا يوجد lazy loading** أو pagination في القائمة
8. **وظيفة `_e(s)`**: escape HTML entities عبر DOM element
9. **التواريخ**: `toLocaleDateString('ar-EG-u-nu-latn', ...)` — أرقام غربية بتنسيق عربي
10. **أوقات الزيارات**: `toLocaleTimeString('ar-EG', ...)` — ساعة:دقيقة
11. **الرابط لفتح الخريطة** في صفحة العميل: يستخدم `google_maps_url` من جدول `customers`
