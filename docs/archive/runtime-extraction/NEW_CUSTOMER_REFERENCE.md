# NEW_CUSTOMER_REFERENCE.md — إضافة عميل جديد (Ops Domain)

## الملفات الأصلية

| الملف | المسار |
|---|---|
| Ops Customers Page | `domains/ops/pages/customers.js` |
| CRUD Helper | `domains/ops/pages/crudHelper.js` |
| Customer Contract | `services/contracts/customers.contract.js` |
| Governance | `services/storefront/governanceRuntime.js` |
| Field Customers (Reference) | `domains/field/pages/customers.js` |

## وصف الواجهة

نموذج إضافة عميل جديد في شاشة **Ops** (الإدارة التشغيلية) وليس للمندوب الميداني:

### Modal Form
نافذة منبثقة (modal) تحتوي على:
1. **الاسم** (`customer_name`) — نص، إجباري
2. **رقم الهاتف** (`phone`) — نص، نوع tel، إجباري
3. **العنوان** (`address`) — نص، اختياري
4. **المنطقة** (`region`) — نص، اختياري
5. **نشط** (`is_active`) — checkbox، افتراضي true

### بعد الإنشاء — ربط المندوب
1. تظهر نافذة منبثقة ثانية (modal)
2. `<select>` بقائمة الموظفين النشطين
3. خيار "تخطي" (بدون مندوب)
4. خيار "تأكيد الربط"

## الحقول

### Form Fields
```js
[
  { key: 'customer_name', label: 'الاسم', required: true },
  { key: 'phone', label: 'رقم الهاتف', type: 'tel' },
  { key: 'address', label: 'العنوان' },
  { key: 'region', label: 'المنطقة' },
  { key: 'is_active', label: 'نشط', type: 'checkbox', default: 'true' },
]
```

### API POST to `customers` table
```js
{ customer_name, phone, address, region, created_by_employee_id }
```

### API POST to `customer_assignments` table
```js
{
  customer_id: newCust.id,
  employee_id: empId,
  assignment_role: 'owner',
  is_primary: true,
  is_active: true,
}
```

## Workflow

```
1. المستخدم يضغط "+ إضافة عميل"
2. `_addCustomer()` → fetch employees list ← `employees?select=id,full_name&is_active=eq.true`
3. `showModal()` → إظهار النموذج
4. المستخدم يملأ الحقول ويضغط "حفظ"
5. `apiPost('customers', vals)` → POST إلى جدول `customers`
6. إذا نجح وإنشاء `id` جديد:
   - `_promptAssign(newCust.id, employees)` → إظهار نافذة اختيار المندوب
   - المستخدم يختار مندوب أو "تخطي"
   - إذا اختار مندوب → `apiPost('customer_assignments', {...})`
7. `_load()` → إعادة تحميل قائمة العملاء
8. `_render('')` → إعادة عرض القائمة
```

## الأزرار

| الزر | الإجراء |
|---|---|
| + إضافة عميل | فتح modal الإضافة (يظهر فقط للمستخدمين المصرح لهم) |
| حفظ | `apiPost('customers', vals)` |
| تخطي | إغلاق modal الربط بدون ربط |
| تأكيد الربط | `apiPost('customer_assignments', {...})` ثم إغلاق |
| ✕ | إغلاق modal |

## شروط الظهور لزر الإضافة

```js
_canEdit = getIdentity()?.isAdmin
  || String(getSession()?.role?.roleCode || '').toUpperCase() === 'SUPER_ADMIN'
  || await hasCapability('can_manage_system').catch(() => false);
```

## التنقلات

- `#ops/customers` → قائمة العملاء (Ops)
- لا يوجد تنقل مباشر — كل شيء في modal على نفس الصفحة

## Screens المستخدمة

| الـ Table | الاستخدام |
|---|---|
| `customers` | إضافة سجل العميل |
| `customer_assignments` | ربط العميل بالمندوب |
| `employees` | جلب قائمة المندوبين للربط |

## ملاحظات مهمة

1. **الفرق بين Ops و Field**: Ops هو مشرف/مدير يمكنه إدارة العملاء، بينما Field هو مندوب ميداني لا يملك صلاحية الإضافة
2. **الصلاحية**: الإضافة مشروطة بكون المستخدم Admin أو Super Admin أو لديه `can_manage_system`
3. **المنطقة (region)**: حقل موجود في النموذج لكنه ليس في `runtime_customer_visibility` view — يخزن مباشرة في `customers` table
4. **الربط التلقائي**: بعد إضافة العميل، يطلب النظام ربطه بمندوب (اختياري)
5. **إلغاء الربط القديم**: في حالة إعادة الربط (`_reassignCustomer`) يتم تعطيل الربط القديم عبر `PATCH` مع `is_active: false` ثم إنشاء ربط جديد
6. **apiPost/ apiPatch/ apiDelete**: من `crudHelper.js` — دوال مساعدة للـ HTTP methods
7. **showModal()**: من `crudHelper.js` — دالة مساعدة لإنشاء modal عام مع حقول ديناميكية
8. **البيانات في Ops**: يتم تحميل العملاء + الطلبات + الزيارات + المندوبين دفعة واحدة (`_load()`) لعرض إحصائيات لكل عميل (إجمالي الفواتير، عدد الزيارات، إجمالي الإنفاق، التصنيف)
9. **لا يوجد تكامل مع `governed_create_customer` RPC** في الكود الحالي — العميل يُنشأ عبر POST مباشر إلى `customers` table
10. **حقل `created_by_employee_id`** يضاف تلقائياً من session المستخدم عند الإضافة
11. **لا يوجد تحقق (validation)** جانب العميل غير `required` — يُترك التحقق للـ database constraints
12. **العميل الجديد يظهر فوراً** بعد `_load()` + `_render('')` دون الحاجة لإعادة تحميل الصفحة
