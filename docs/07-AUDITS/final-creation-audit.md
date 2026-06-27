# Final Creation Flow Audit

**التاريخ:** 9 يونيو 2026  
**الهدف:** تتبع مسارات الإنشاء الثلاثة بشكل كامل قبل أي قرار إصلاح

---

## Flow 1 — Self Registration

**المسار:** RegistrationPage → `authService.register()` → `register_customer` RPC

### 📍 الاسم

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| اسم النشاط التجاري | `companyName` | `p_company_name` | `customers` | `company_name` |
| اسم المسؤول | `responsibleName` | `p_responsible_name` | `customers` | `responsible_name` |
| اسم المسؤول (مكرر) | `responsibleName` | `p_responsible_name` | `customer_contacts` | `full_name` |

### 📍 رقم الهاتف

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| رقم الهاتف | `phone` | `p_phone` | `identities` | `phone` |
| رقم الهاتف (مكرر) | `phone` | `p_phone` | `customer_contacts` | `phone` |

### 📍 العنوان

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| العنوان | `addressDetail` | `p_formatted_address` | `unified_locations` | `formatted_address` |

### 📍 الموقع

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| الموقع الجغرافي | `location.latitude` | `p_latitude` | `unified_locations` | `latitude` |
| الموقع الجغرافي | `location.longitude` | `p_longitude` | `unified_locations` | `longitude` |
| دقة الموقع | `location.accuracyMeters` | `p_accuracy_meters` | `unified_locations` | `accuracy_meters` |
| *(auto)* | — | *(auto)* | `unified_locations` | `google_maps_url` (GENERATED) |
| *(auto)* | — | *(auto)* | `customers` | `location_id` ← `unified_locations.id` |

### 📍 الملكية (Ownership)

| مفهوم | RPC | Table | Column | القيمة |
|-------|-----|-------|--------|--------|
| صاحب العميل (مندوب) | auto (داخل RPC) | `customers` | `owner_id` | أول `SUPER_ADMIN` في النظام (`SELECT e.id FROM employees e JOIN employee_roles er ... WHERE r.name IN ('SUPER_ADMIN','سوبر أدمن','سوبرادمن') ORDER BY e.created_at ASC LIMIT 1`) |
| نوع المالك | auto | `customers` | `owner_type` | `'employee'` (ثابت) |

**ملاحظة:** `register_customer` لا يقبل أي param للملكية. يختار أول سوبر أدمن تلقائياً.

### 📍 حقول ملكية غير موجودة

| الحقل المطلوب | هل يوجد؟ |
|--------------|---------|
| `created_by` | ❌ لا يوجد على `customers` (موجود على `orders` فقط) |
| `created_by_rep_id` | ❌ لا يوجد في أي جدول في النظام |
| `sales_rep_id` | ❌ لا يوجد كعمود — `owner_id` يؤدي نفس الدور |
| `manager_id` | ❌ لا يوجد على `customers` (موجود على `employees`) |
| `responsible_employee_id` | ❌ لا يوجد — `owner_id` يؤدي نفس الدور |

---

## Flow 2 — Manager Creates Customer

**المسار:** NewCustomerPage → `governed_create_customer` RPC

### 📍 الاسم

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| اسم النشاط التجاري | `companyName` | `p_company_name` | `customers` | `company_name` |
| اسم المسؤول | `responsibleName` | `p_responsible_name` | `customers` | `responsible_name` |
| اسم المسؤول (مكرر) | `responsibleName` | `p_contact_name` | `customer_contacts` | `full_name` |

### 📍 رقم الهاتف

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| رقم الهاتف | `phone` | `p_phone` | `identities` | `phone` |
| رقم الهاتف (مكرر) | `phone` | `p_contact_phone` | `customer_contacts` | `phone` |

### 📍 العنوان

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| العنوان بالتفصيل | `addressDetail` | `p_formatted_address` | `unified_locations` | `formatted_address` ⚠️ فقط مع GPS |
| *(لا يُرسل)* | — | `p_address_line1` ← `DEFAULT NULL` | `customer_addresses` | `address_line1` ❌ لا يُحفظ أبداً |

### 📍 الموقع

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| الموقع الجغرافي | `location.latitude` | `p_latitude` | `unified_locations` | `latitude` ⚠️ فقط مع GPS |
| الموقع الجغرافي | `location.longitude` | `p_longitude` | `unified_locations` | `longitude` ⚠️ فقط مع GPS |
| دقة الموقع | `location.accuracyMeters` | `p_accuracy_meters` | `unified_locations` | `accuracy_meters` ⚠️ فقط مع GPS |
| *(auto)* | — | *(auto)* | `unified_locations` | `google_maps_url` (GENERATED) |
| *(auto)* | — | *(auto)* | `customers` | `location_id` ← `unified_locations.id` ⚠️ فقط مع وجود GPS أو `p_address_line1` |

### 📍 الملكية (Ownership)

| مفهوم | RPC | Table | Column | القيمة |
|-------|-----|-------|--------|--------|
| صاحب العميل (مندوب) | auto (داخل RPC) | `customers` | `owner_id` | `v_session.employee_id` (الموظف الذي ينشئ) |
| نوع المالك | auto | `customers` | `owner_type` | `'employee'` (ثابت) |

**ملاحظة:** `governed_create_customer` لا يقبل `p_owner_id`. المالك هو دائماً الموظف الذي قام بإنشاء العميل (من الجلسة).

---

## Flow 3 — Manager Creates Employee

**المسار:** EmployeesPage → `governed_create_employee` RPC  
أو HierarchyPage → `governed_create_employee` RPC  
أو SupervisorPage → `governed_create_employee` RPC

### 📍 الاسم

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| الاسم الكامل | `newName` | `p_full_name` | `employees` | `full_name` |

### 📍 رقم الهاتف

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| رقم الهاتف | `newPhone` | `p_phone` | `identities` | `phone` (مع check uniqueness) |

### 📍 العنوان

| Screen Field | Variable | RPC Param | Table | Column |
|-------------|----------|-----------|-------|--------|
| العنوان | `newAddress` | `p_address` | `employees` | `address` |

**ملاحظة:** Employees لا يستخدم `unified_locations` أو `customer_addresses`. العنوان مخزن مباشرة في `employees.address` كـ text.

### 📍 الموقع

ليس للموظفين موقع جغرافي. لا يوجد `location_id` في `employees`.

### 📍 الملكية (Ownership)

| مفهوم | RPC | Table | Column | القيمة |
|-------|-----|-------|--------|--------|
| المدير المباشر | `p_manager_id` | `employees` | `manager_id` | من الشاشة (اختياري) |
| مسجل الدور بواسطة | auto (داخل RPC) | `employee_roles` | `assigned_by` | `v_session.employee_id` (الموظف الذي أنشأ) |

**ملاحظة:** `governed_create_employee` يقبل `p_manager_id` ويخزنه مباشرة. لا يوجد مفهوم `owner_id` للموظفين — الهيكل هرمي عبر `manager_id`.

---

## 🆚 المقارنة المباشرة بين الـ 3 Flows

### Question 1 — هل Self Registration و Manager Creation يستخدمان نفس RPC؟

**لا.**

| | Self Registration | Manager Creates Customer |
|---|---|---|
| **RPC** | `register_customer` | `governed_create_customer` |
| **الملف** | `20260615_identity_rules_final.sql` | `20260617_customer_address_location_link.sql` |
| **المعاملات** | 10 | 18 |
| **يتطلب Token؟** | لا (تسجيل مفتوح) | نعم (`p_token` + صلاحية `customers.create`) |
| **يعيد Token؟** | نعم (ينشئ session ويعيد token) | لا (يعيد `{success, id, code, company_name}`) |

**الفرق الجوهري:** `register_customer` هو API مفتوح للتسجيل الذاتي. `governed_create_customer` هو API محكوم يتطلب جلسة موظف نشطة.

---

### Question 2 — هل يكتبان في نفس الجداول؟

**نعم جزئياً.** الجداول المشتركة:

| الجدول | Self Registration | Manager Creates Customer |
|--------|------------------|------------------------|
| `identities` | ✅ يكتب `phone`, `password_hash`, `identity_type='customer'`, `is_active=true` | ✅ يكتب `phone`, `password_hash`, `identity_type='customer'`, `is_active=true` |
| `customers` | ✅ يكتب `code`, `company_name`, `responsible_name`, `business_type`, `location_id`, `owner_type`, `owner_id`, `is_active`, `email`, `registered_at` | ✅ يكتب `code`, `company_name`, `responsible_name`, `business_type`, `location_id`, `owner_type`, `owner_id`, `is_active`, `email` |
| `unified_locations` | ✅ يكتب (دائماً — GPS إجباري) | ✅ يكتب (فقط مع GPS أو `p_address_line1`) |
| `customer_contacts` | ✅ يكتب `full_name`, `phone`, `is_primary=true` | ✅ يكتب `full_name`, `phone`, `is_primary=true` |
| `customer_addresses` | ❌ لا يكتب أبداً | ⚠️ يكتب `address_line1` فقط لو `p_address_line1` مرسل (لا يحدث حالياً) |
| `app.sessions` | ✅ ينشئ session ويعيد token | ❌ لا ينشئ session |

---

### Question 3 — هل يملآن `unified_locations` بنفس الطريقة؟

**لا.**

| الخاصية | Self Registration | Manager Creates Customer |
|---------|------------------|------------------------|
| **GPS إجباري؟** | ✅ نعم — `INSERT` مباشر بدون شرط | ❌ لا — `IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL` |
| **فرع نصي بدون GPS؟** | ❌ غير مدعوم — ليس له فرع | ⚠️ `ELSIF p_address_line1 IS NOT NULL` — لكن `p_address_line1` لا يُرسل |
| **formatted_address** | ✅ `p_formatted_address` (قد يكون NULL) | ✅ `COALESCE(p_formatted_address, p_address_line1)` |
| **latitude/longitude** | ✅ إجباريان NOT NULL | ⚠️ `DROP NOT NULL` (V4) — يمكن أن يكونا NULL |
| **ماذا لو فشل GPS؟** | ❌ الإرسال يفشل (validation في الواجهة) | ⚠️ إذا `p_latitude` = NULL → `ELSIF p_address_line1` → `p_address_line1` = NULL ← **لا يُنشأ شيء** |

**الخلاصة:** `register_customer` يملأ `unified_locations` دائماً وبشكل كامل. `governed_create_customer` يملأه فقط مع GPS — ومع النص فقط (بدون GPS) لا يملؤه أبداً بسبب mismatch بين `p_formatted_address` و `p_address_line1`.

---

### Question 4 — هل هناك حقل يظهر للمستخدم لكنه لا يصل إلى قاعدة البيانات؟

**نعم — حقل واحد:**

| الشاشة | الحقل | المتغير | RPC Param | المشكلة |
|--------|-------|---------|-----------|---------|
| NewCustomerPage | العنوان بالتفصيل | `addressDetail` | `p_formatted_address` | يحفظ فقط مع GPS (IF branch). بدون GPS: `ELSIF p_address_line1 IS NOT NULL` → `p_address_line1` = NULL ← **يضيع العنوان بالكامل** |

**شرح:** المستخدم يكتب عنواناً، الواجهة ترسله كـ `p_formatted_address`. إذا لم يكن هناك GPS، RPC يتفقد `p_address_line1` (NULL) ← لا يدخل أي INSERT branch ← العنوان لا يصل إلى أي جدول.

---

### Question 5 — هل هناك حقل يُحفظ في قاعدة البيانات لكن لا يظهر في شاشة التعديل؟

**نعم — حقول لا تظهر في `governed_update_customer` أو في `CustomerProfilePage` edit form:**

| الحقل | الجدول.العمود | يظهر في شاشة التعديل؟ |
|-------|--------------|---------------------|
| **formatted_address** | `unified_locations.formatted_address` | ❌ لا |
| **latitude** | `unified_locations.latitude` | ❌ لا |
| **longitude** | `unified_locations.longitude` | ❌ لا |
| **accuracy_meters** | `unified_locations.accuracy_meters` | ❌ لا |
| **google_maps_url** | `unified_locations.google_maps_url` (GENERATED) | ❌ لا — GENERATED دائماً |
| **customer_contacts.full_name** | `customer_contacts.full_name` | ❌ لا |
| **customer_contacts.phone** | `customer_contacts.phone` | ❌ لا |
| **owner_id** | `customers.owner_id` | ✅ (نقل ملكية — لكنه ميزة منفصلة، ليس تعديلاً مباشراً) |
| **customer_addresses** | *جميع الأعمدة* | ❌ لا — مهجور أصلاً |

**الموجود في شاشة التعديل (`governed_update_customer`):**
- `company_name` ✅
- `email` ✅
- `phone` (عبر `identities`) ✅
- `responsible_name` ✅
- `business_type` ✅
- `credit_limit` ✅
- `credit_days` ✅
- `password` ✅

**المفقود من التعديل:**
- العنوان ← `unified_locations.formatted_address`
- الموقع ← `unified_locations.latitude/longitude`
- اسم جهة الاتصال ← `customer_contacts.full_name`
- هاتف جهة الاتصال ← `customer_contacts.phone`

---

## 📊 ملحقات — مقارنة Owner_id في الـ 3 Flows

| | Self Registration | Manager Creates Customer | Manager Creates Employee |
|---|---|---|---|
| **صاحب الكيان** | `customers.owner_id` = أول SUPER_ADMIN | `customers.owner_id` = الموظف المنشئ (من الجلسة) | غير موجود (للموظفين) |
| **مفهوم المسؤولية** | العميل يتبع SUPER_ADMIN افتراضياً | العميل يتبع المنشئ مباشرة | الموظف يتبع `manager_id` |
| **قابل للتغيير؟** | نعم — `governed_change_customer_ownership` | نعم — نفس RPC | نعم — `governed_change_employee_manager` |

**ملاحظة حرجة:** في Self Registration، العميل لا يتبع مندوباً محدداً. يتبع أول SUPER_ADMIN في النظام. هذا يعني أن العملاء المسجلين ذاتياً قد لا يكون لديهم مندوب مبيعات فعلي — بل يظهرون تحت إدارة السوبر أدمن.

---

## الخريطة الكاملة — الجدول الوحيد لكل كيان

### Customer (من أي مسار)
```
identities (phone, password_hash)
    │ 1:1
customers (company_name, responsible_name, business_type, email, credit_limit, credit_days, owner_id, is_active, registered_at)
    │ FK
    ├── unified_locations (formatted_address, latitude, longitude, accuracy_meters, google_maps_url)
    │
    └── customer_contacts (full_name, phone, is_primary)
         (customer_addresses — مهجور)
```

### Employee (من أي مسار)
```
identities (phone, password_hash)
    │ 1:1
employees (full_name, email, address, manager_id, is_active)
    │ FK
    └── employee_roles (role_id, assigned_by)
```

---

## 🎯 الخلاصة النهائية

1. **RPCs مختلفة:** `register_customer` (10 params, بدون Token) ≠ `governed_create_customer` (18 params, مع Token)
2. **جداول متطابقة** باستثناء: `customer_addresses` (يكتبه governed فقط بشرط)، `app.sessions` (ينشئه register فقط)
3. **`unified_locations` يمتلئ مختلف:** register يملؤه دائماً (GPS إجباري) ← governed يملؤه فقط مع GPS أو `p_address_line1` (الذي لا يُرسل)
4. **حقل يظهر ولا يصل:** `addressDetail` (p_formatted_address) بدون GPS يضيع
5. **حقول تحفظ ولا تُعدّل:** العنوان، الموقع، جهات الاتصال (7 حقول) لا تظهر في شاشة تعديل العميل
