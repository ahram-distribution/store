# تدقيق سلامة بيانات العملاء والموظفين والمستخدمين

**التاريخ:** 9 يونيو 2026  
**النطاق:** Customers (إنشاء/تعديل/عرض) · Employees (إنشاء/تعديل/عرض) · Users  
**قاعدة:** No modifications — تحليل الوضع الحالي فقط

---

## 🧭 الملخص التنفيذي

تم تتبع الرحلة الكاملة لـ 7 أنواع من البيانات (الاسم، الهاتف، العنوان، الموقع، المسؤول، الـ Tier، طريقة الدفع) عبر:

1. شاشات الإنشاء (Frontend form fields)
2. RPCات الإنشاء (Parameters)
3. قاعدة البيانات (Tables/Columns)
4. شاشات العرض والتعديل
5. صفحات الطلب (Order detail view)

### أهم 3 اكتشافات

| # | المشكلة | التأثير | الخطورة |
|---|---------|---------|---------|
| 1 | `governed_create_customer` ينتظر `p_address_line1` والواجهة ترسل `p_formatted_address` | بدون GPS: العنوان يضيع بالكامل (لا يُحفظ في أي جدول) | 🔴 عالية |
| 2 | `customer_addresses` جدول مهمل — لا يُملى أبداً من أي RPC حالي | دالة `get_governed_customer_addresses` ترجع `[]` دائماً للعملاء الجدد | 🔴 عالية |
| 3 | شاشة تعديل العميل تفتقد حقول العنوان والموقع | لا يمكن تصحيح أخطاء العنوان بعد إنشاء العميل | 🔴 عالية |

---

## 🏗️ 1. شاشات الإنشاء الحالية

### 1.1 إنشاء عميل — موظف
**الملف:** `src/pages/customers/NewCustomerPage.tsx`  
**RPC:** `governed_create_customer`

| الحقل في الشاشة | المتغير | يُرسل كـ | يُحفظ في |
|----------------|---------|---------|---------|
| اسم النشاط التجاري | `companyName` | `p_company_name` | `customers.company_name` |
| اسم المسؤول | `responsibleName` | `p_responsible_name` + `p_contact_name` | `customers.responsible_name` + `customer_contacts.full_name` |
| نوع النشاط | `businessType` | `p_business_type` | `customers.business_type` |
| رقم الهاتف | `phone` | `p_phone` + `p_contact_phone` | `identities.phone` + `customer_contacts.phone` |
| البريد الإلكتروني | `email` | `p_email` | `customers.email` |
| كلمة المرور | `password` | `p_password` | `identities.password_hash` |
| العنوان بالتفصيل | `addressDetail` | `p_formatted_address` | `unified_locations.formatted_address` (فقط مع GPS) |
| الموقع الجغرافي | `location` | `p_latitude/longitude/accuracy_meters` | `unified_locations` |

### 1.2 تسجيل عميل — ذاتي
**الملف:** `src/pages/auth/RegistrationPage.tsx`  
**RPC:** `register_customer`

نفس الحقول تقريباً، لكن:
- كود العميل يبدأ بـ `REG-` (عشوائي) بدلاً من `CUS-` (تسلسلي)
- لا يوجد `customer_addresses` (أبداً)
- الموقع GPS إجباري
- المالك أول SUPER_ADMIN في النظام

### 1.3 إنشاء مندوب
**الملف:** `src/pages/employees/EmployeesPage.tsx` | `HierarchyPage.tsx` | `SupervisorPage.tsx`  
**RPC:** `governed_create_employee`

| الحقل | يُرسل كـ | يُحفظ في | ✅ |
|-------|---------|---------|---|
| الاسم الكامل | `p_full_name` | `employees.full_name` | ✅ |
| رقم الهاتف | `p_phone` | `identities.phone` | ✅ |
| كلمة المرور | `p_password` | `identities.password_hash` | ✅ |
| البريد الإلكتروني | `p_email` | `employees.email` | ✅ |
| العنوان | `p_address` | `employees.address` | ✅ |
| الدور الوظيفي | `p_role_id` | `employee_roles.role_id` | ✅ |
| المدير المباشر | `p_manager_id` | `employees.manager_id` | ✅ |

📌 **جميع حقول المندوب تعمل بكفاءة — لا توجد مشكلة.**

---

## 🔍 2. RPCات الإنشاء — التتبع الكامل

### 2.1 `governed_create_customer` (V4)
**الملف:** `supabase/migrations/20260617_customer_address_location_link.sql`  
**18 معامل — أحدث إصدار منشور**

```sql
CREATE OR REPLACE FUNCTION public.governed_create_customer(
  p_token uuid,              -- تحقق الجلسة
  p_company_name varchar,    -- → customers.company_name
  p_phone varchar DEFAULT NULL,         -- → identities.phone
  p_contact_name varchar DEFAULT NULL,  -- → customer_contacts.full_name
  p_contact_phone varchar DEFAULT NULL, -- → customer_contacts.phone
  p_address_line1 varchar DEFAULT NULL, -- → customer_addresses.address_line1 (شرط)
  p_city varchar DEFAULT 'القاهرة',    -- → customer_addresses.city
  p_region varchar DEFAULT NULL,        -- ❌ لا يُحفظ في أي جدول
  p_business_type business_type DEFAULT NULL,      -- → customers.business_type
  p_responsible_name varchar DEFAULT NULL,          -- → customers.responsible_name
  p_latitude numeric DEFAULT NULL,      -- → unified_locations.latitude
  p_longitude numeric DEFAULT NULL,     -- → unified_locations.longitude
  p_accuracy_meters numeric DEFAULT NULL,           -- → unified_locations.accuracy_meters
  p_formatted_address text DEFAULT NULL, -- → unified_locations.formatted_address
  p_password varchar DEFAULT NULL,      -- → identities.password_hash (bcrypt)
  p_email varchar DEFAULT NULL,         -- → customers.email
  p_credit_limit decimal DEFAULT NULL,  -- → customers.credit_limit
  p_credit_days integer DEFAULT NULL    -- → customers.credit_days
)
```

**منطق حفظ الموقع (أسطر V4):**
```
IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    → unified_locations(id, lat, lng, accuracy, COALESCE(p_formatted_address, p_address_line1), now())
ELSIF p_address_line1 IS NOT NULL THEN   ← ✳️ المشكلة هنا
    → unified_locations(id, p_address_line1, now())
END IF
```

### 2.2 `register_customer` (V6)
**الملف:** `supabase/migrations/20260615_identity_rules_final.sql`  
**10 معاملات — للتسجيل الذاتي**

```sql
CREATE OR REPLACE FUNCTION public.register_customer(
  p_phone varchar,           -- → identities.phone
  p_password varchar,        -- → identities.password_hash
  p_company_name varchar,    -- → customers.company_name
  p_responsible_name varchar, -- → customers.responsible_name + customer_contacts.full_name
  p_business_type business_type,  -- → customers.business_type
  p_latitude numeric,        -- → unified_locations.latitude
  p_longitude numeric,       -- → unified_locations.longitude
  p_accuracy_meters numeric, -- → unified_locations.accuracy_meters
  p_formatted_address text DEFAULT NULL,  -- → unified_locations.formatted_address
  p_email varchar DEFAULT NULL           -- → customers.email
)
```

**ملاحظة:** `register_customer` لا ينشئ `customer_addresses` أبداً، ولا يقبل `p_credit_limit`/`p_credit_days`.

### 2.3 `governed_create_employee` (V3)
**الملف:** `supabase/migrations/20260608_schema_alignment.sql`  
**8 معاملات — جميعها تعمل ✅**

```sql
CREATE OR REPLACE FUNCTION public.governed_create_employee(
  p_token uuid,
  p_full_name varchar,       -- → employees.full_name
  p_phone varchar,           -- → identities.phone (unique check)
  p_password varchar DEFAULT NULL,  -- → identities.password_hash
  p_email varchar DEFAULT NULL,     -- → employees.email
  p_role_id uuid DEFAULT NULL,      -- → employee_roles.role_id
  p_manager_id uuid DEFAULT NULL,   -- → employees.manager_id
  p_address text DEFAULT NULL       -- → employees.address
)
```

---

## 🗄️ 3. قاعدة البيانات — هيكل الجداول

### `customers` (العمود الأساسي)

| العمود | النوع | المصدر | ملاحظات |
|--------|------|--------|---------|
| `id` | uuid PK | auto | |
| `identity_id` | uuid FK → identities | auto | 1:1 |
| `code` | varchar(20) UNIQUE | CUS-2026-000001 / REG-XXXXXXXX |
| `company_name` | varchar(255) | من الشاشة | |
| `responsible_name` | varchar(255) | من الشاشة | |
| `business_type` | business_type enum | من الشاشة | |
| `email` | varchar(255) | من الشاشة | |
| `credit_limit` | decimal(12,2) DEFAULT 0 | من الشاشة | فقط governed |
| `credit_days` | integer DEFAULT 0 | من الشاشة | فقط governed |
| `location_id` | uuid FK → unified_locations | يتم تعبئته من RPC | |
| `owner_type` | varchar(20) DEFAULT 'employee' | ثابت | |
| `owner_id` | uuid FK → employees | الموظف المسؤول | |
| `is_active` | boolean DEFAULT true | | |
| `registered_at` | timestamptz | | |
| `created_at` / `updated_at` | timestamptz | auto | |

> **ملاحظة:** لا يوجد عمود `address` مباشر في `customers`. العنوان موجود عبر `location_id` ← `unified_locations.formatted_address`.

### `unified_locations` (الموقع والعنوان الموحد)

| العمود | النوع | ملاحظات |
|--------|------|---------|
| `id` | uuid PK | |
| `latitude` | numeric | nullable (V4) |
| `longitude` | numeric | nullable (V4) |
| `accuracy_meters` | numeric | |
| `google_maps_url` | text | GENERATED ALWAYS AS |
| `formatted_address` | text | العنوان النصي |
| `captured_at` | timestamptz | |
| `created_at` | timestamptz | |

### `customer_addresses` (عنوان قديم — مهجور فعلياً)

| العمود | النوع | ملاحظات |
|--------|------|---------|
| `id` | uuid PK | |
| `customer_id` | uuid FK → customers | |
| `address_line1` | varchar(255) | **لا يُملى حالياً** |
| `city` | varchar(100) DEFAULT 'القاهرة' | |
| `is_default` | boolean | |
| `latitude/longitude` | decimal | nullable |

> ⚠️ هذا الجدول لا يستقبل بيانات من أي شاشة حالية.

### `customer_contacts` (جهات الاتصال)

| العمود | النوع |
|--------|------|
| `customer_id` | uuid FK → customers |
| `full_name` | varchar(255) = `responsible_name` |
| `phone` | varchar(20) = `phone` (نفس رقم العميل) |
| `is_primary` | boolean DEFAULT false |

### `orders` — أعمدة Snapshot (لقطة وقت الإنشاء)

| العمود | يخزن |
|--------|------|
| `snapshot_customer_name` | `customers.company_name` وقت الإنشاء |
| `snapshot_customer_phone` | `customer_contacts.phone` وقت الإنشاء |
| `snapshot_customer_address` | `unified_locations.formatted_address` وقت الإنشاء |
| `snapshot_owner_name` | `employees.full_name` |
| `snapshot_owner_phone` | `identities.phone` (للموظف المالك) |
| `snapshot_owner_address` | `employees.address` |
| `snapshot_sender_name` | `employees.full_name` أو `customers.company_name` |
| `snapshot_sender_phone` | `identities.phone` أو `customer_contacts.phone` |
| `snapshot_sender_address` | `employees.address` أو `unified_locations.formatted_address` |

### `employees`

| العمود | النوع |
|--------|------|
| `full_name` | varchar(255) |
| `email` | varchar(255) |
| `manager_id` | uuid (self FK) |
| `address` | text |
| `is_active` | boolean |
| `identity_id` | uuid FK → identities (1:1) |

### `identities`

| العمود | النوع |
|--------|------|
| `phone` | varchar(20) UNIQUE |
| `password_hash` | varchar(255) bcrypt |
| `identity_type` | enum: 'employee' / 'customer' |
| `is_active` | boolean |

---

## 📖 4. مصدر القراءة — كل شاشة

### 4.1 صفحات الطلب → `get_governed_order` / `get_governed_orders`

| حقل الشاشة | مصدر القراءة | طبيعة البيانات |
|-----------|-------------|----------------|
| customer_name | `orders.snapshot_customer_name` | لقطة (مجمّدة) |
| customer_phone | `orders.snapshot_customer_phone` | لقطة (مجمّدة) |
| customer_address | `orders.snapshot_customer_address` | لقطة (مجمّدة) |
| customer_maps_url | `''` hardcoded | (تم الإصلاح) |

**الإصدار:** `20260616_snapshot_architecture.sql` (singular), `20260618_fix_governance_leak.sql` (plural)

### 4.2 صفحة ملف العميل → `get_governed_customer`

| حقل الشاشة | مصدر القراءة |
|-----------|-------------|
| الكود | `customers.code` |
| اسم النشاط | `customers.company_name` |
| اسم المسؤول | `customers.responsible_name` |
| نوع النشاط | `customers.business_type` |
| رقم الهاتف | `identities.phone` (JOIN) |
| البريد الإلكتروني | `customers.email` |
| الموظف المسؤول | `employees.full_name` (JOIN) |
| الحد الائتماني | `customers.credit_limit` |
| فترة الائتمان | `customers.credit_days` |
| الموقع | ⚠️ طلب منفصل: `get_governed_location` ← `unified_locations` |
| العناوين | ⚠️ طلب منفصل: `get_governed_customer_addresses` ← `customer_addresses` |
| جهات الاتصال | طلب منفصل: `get_governed_customer_contacts` ← `customer_contacts` |

**الإصدار:** `20260604_unified_identity_location.sql`

### 4.3 شاشة تعديل العميل → `governed_update_customer`

**الإصدار:** `20260608_customer_reality_gap_closure.sql`

```sql
CREATE OR REPLACE FUNCTION public.governed_update_customer(
  p_token uuid,
  p_id uuid,
  p_company_name varchar DEFAULT NULL,       -- → customers.company_name
  p_email varchar DEFAULT NULL,              -- → customers.email
  p_credit_limit decimal DEFAULT NULL,       -- → customers.credit_limit
  p_credit_days integer DEFAULT NULL,        -- → customers.credit_days
  p_business_type business_type DEFAULT NULL, -- → customers.business_type
  p_responsible_name varchar DEFAULT NULL,    -- → customers.responsible_name
  p_password varchar DEFAULT NULL,           -- → identities.password_hash
  p_phone varchar DEFAULT NULL               -- → identities.phone
)
```

**📌 لا يقبل تعديل:**
- العنوان (formatted_address / address_line1)
- الموقع (latitude / longitude)
- جهات الاتصال (customer_contacts)

---

## 📊 5. جدول المقارنة الكامل — Customer

| البيان | شاشة الإنشاء | RPC (param) | الجدول.العمود | شاشة التعديل | شاشة الطلب |
|--------|-------------|-------------|---------------|-------------|-----------|
| الاسم (نشاط) | `companyName` `text` | `p_company_name` | `customers.company_name` | ✅ `p_company_name` | `snapshot_customer_name` (لقطة) |
| المسؤول | `responsibleName` `text` | `p_responsible_name` | `customers.responsible_name` | ✅ `p_responsible_name` | — |
| نوع النشاط | `businessType` `select` | `p_business_type` | `customers.business_type` | ✅ `p_business_type` | — |
| الهاتف | `phone` `tel` | `p_phone` | `identities.phone` | ✅ `p_phone` | `snapshot_customer_phone` (لقطة) |
| البريد | `email` `email` | `p_email` | `customers.email` | ✅ `p_email` | — |
| كلمة المرور | `password` `password` | `p_password` | `identities.password_hash` | ✅ `p_password` | — |
| العنوان النصي | `addressDetail` `textarea` | `p_formatted_address` | `unified_locations.formatted_address` | ❌ لا يوجد | `snapshot_customer_address` (لقطة) |
| العنوان النصي | — | `p_address_line1` (لا يُرسل) | `customer_addresses.address_line1` | ❌ لا يوجد | — |
| الموقع GPS | GPS capture | `p_lat/lng/accuracy` | `unified_locations` | ❌ لا يوجد | `execution_lat/lng` (لقطة منفصلة) |
| رابط خرائط | — | — | `unified_locations.google_maps_url` | ❌ لا يوجد | `customer_maps_url` (تم الإصلاح) |
| الـ Tier | — | `p_tier_id` (في create_order) | `orders.tier_id` | — | — |
| طريقة الدفع | — | — | `orders.payment_method` | — | (تم الإصلاح) |
| حد ائتماني | — | `p_credit_limit` | `customers.credit_limit` | ✅ | — |
| `p_region` | — | `p_region` (لا يُرسل) | ❌ لا يُحفظ أبداً | — | — |

---

## 🔬 6. الأسباب الجذرية — تفصيل كامل

### 🔴 السبب #1: انقطاع تام للعنوان النصي بدون GPS

**الشفرة المعيبة** — `20260617_customer_address_location_link.sql`:

```sql
-- الواجهة ترسل p_formatted_address
-- لكن RPC ينتظر p_address_line1 للفرع النصي فقط
ELSIF p_address_line1 IS NOT NULL THEN
    v_location_id := gen_random_uuid();
    INSERT INTO unified_locations (id, formatted_address, captured_at)
    VALUES (v_location_id, p_address_line1, now());
END IF;

-- نفس المشكلة مع customer_addresses
IF p_address_line1 IS NOT NULL THEN
    INSERT INTO public.customer_addresses (customer_id, address_line1, city, is_default)
    VALUES (v_customer_id, p_address_line1, p_city, true)
    ...
END IF;
```

**التدفق الفعلي:**
```
NewCustomerPage
  → { p_formatted_address: "12 شارع..." }   ← يرسل
  → { p_address_line1: undefined }           ← لا يرسل
  ↓
RPC:
  GPS موجود؟ → نعم → unified_locations(formatted_address = p_formatted_address) ✅
  GPS موجود؟ → لا → ELSIF p_address_line1? → NO → لا يُنشأ شيء ❌
  p_address_line1? → NO → لا يُنشأ customer_addresses ❌
```

**النطاق المتأثر:** أي عميل يُنشأ عبر NewCustomerPage بدون GPS أو بفشل GPS — العناوين تضيع.

**الدليل:** `p_contact_name` و `p_contact_phone` يُرسلان بنفس القيمة (`responsibleName` و `phone`). `p_address_line1` لم يُرسل أبداً في أي كود Frontend.

---

### 🔴 السبب #2: `customer_addresses` جدول مهمل (لا يُملى)

جدول `customer_addresses` صُمم لتخزين عناوين متعددة لكل عميل. حالياً:
- `governed_create_customer` لا يملؤه (لأن `p_address_line1` لا يُرسل)
- `register_customer` لا يتعامل معه أبداً
- `governed_update_customer` لا يتعامل معه أبداً

النتيجة: `get_governed_customer_addresses` يرجع دائماً `[]` لكل العملاء الجدد.

في المقابل، `unified_locations` يحصل على العنوان (`formatted_address`) لكنه مخزن في سجل واحد فقط (ليس عناوين متعددة).

---

### 🔴 السبب #3: لا يوجد تعديل عنوان/موقع في شاشة تعديل العميل

`CustomerProfilePage.tsx` يحتوي على 9 حقول تعديل فقط: الاسم، الإيميل، الهاتف، اسم المسؤول، نوع النشاط، الحد الائتماني، فترة الائتمان، كلمة المرور.

**المفقود:** لا يوجد حقل لتعديل:
- العنوان (formatted_address في unified_locations)
- الموقع (latitude/longitude)
- جهات الاتصال (customer_contacts)

و `governed_update_customer` لا يقبل أي param للعنوان أو الموقع أصلاً.

---

### 🟡 السبب #4: بيانات الطلب مجمّدة (Snapshot)

نظام Snapshot Architecture يخزن لقطة من بيانات العميل/المالك/المرسل وقت إنشاء الطلب في أعمدة `snapshot_*` داخل جدول `orders`.

**إيجابي:** يضمن عدم تغيير البيانات التاريخية.

**سلبي:** إذا غيّر العميل هاتفه أو عنوانه، جميع الطلبات السابقة تظهر البيانات القديمة. لا يوجد تحديث عكسي.

هذا تصميم متعمد وليس خطأ، لكنه سبب جذري لعدم تطابق بيانات الطلب مع بيانات العميل الحالية.

---

### 🟡 السبب #5: `get_governed_customer` لا تُرجع العنوان مباشرة

دالة قراءة العميل تُرجع `location_id` فقط (UUID). يجب على الواجهة:
1. استدعاء `get_governed_customer` ← تحصل على `location_id`
2. استدعاء `get_governed_location(location_id)` ← تحصل على العنوان والموقع

هذا يضيف طلب شبكة إضافي ونقطة فشل محتملة.

---

### 🟡 السبب #6: `p_region` معامل وهمي

منذ الإصدار الأول (`20260602_p2_runtime_usability_fixes.sql`)، `p_region` موجود كمعامل في `governed_create_customer` لكنه لا يُستخدم في أي INSERT أو UPDATE في أي إصدار. لا يُرسل من الواجهة أيضاً.

**التأثير:** تضخيم غير ضروري لتوقيع الدالة.

---

### 🟢 السبب #7: ازدواجية الإرسال (ملاحظة)

```
p_contact_name = responsibleName
p_responsible_name = responsibleName
p_phone = phone
p_contact_phone = phone
```

القيم متطابقة، لكنها تُرسل كمعاملين منفصلين. هذا يعني أن `customer_contacts.full_name` = `customers.responsible_name` دائماً (نفس القيمة).

في `governed_create_customer`:
```sql
customers.responsible_name = COALESCE(p_responsible_name, p_contact_name)
```
كلا المعاملين يحملان نفس القيمة، فلا توجد مشكلة عملية، لكنها تشير إلى عدم وضوح في الفصل بين "اسم المسؤول" و "اسم جهة الاتصال".

---

## 🎯 7. توزيع البيانات عبر الجداول

### عميل واحد = 5 جداول على الأقل

```
identities
  └── phone, password_hash
      │
customers
  ├── company_name, responsible_name, business_type, email
  ├── credit_limit, credit_days
  ├── owner_id ───────→ employees
  └── location_id ────→ unified_locations
                          ├── latitude, longitude, accuracy_meters
                          ├── google_maps_url (GENERATED)
                          └── formatted_address

customer_contacts
  └── full_name, phone (is_primary)

customer_addresses ← مهجور
```

### مندوب واحد = 3 جداول

```
identities
  └── phone, password_hash
      │
employees
  ├── full_name, email, address
  ├── manager_id ──→ employees (self)
  └── id ──────────→ employee_roles
                       └── role_id ──→ roles
```

---

## 📝 الخلاصة

| الرقم | المشكلة | الجذر | الشدة | الحل المقترح (للمستقبل) |
|-------|---------|-------|-------|------------------------|
| 1 | العنوان يضيع بدون GPS | RPC ينتظر `p_address_line1` ← Frontend يرسل `p_formatted_address` | 🔴 | تغيير الشرط من `p_address_line1` إلى `p_formatted_address` في فرع ELSIF |
| 2 | `customer_addresses` لا يُملى | لا يوجد RPC يكتب فيه ببيانات حقيقية | 🔴 | إضافة `p_address_line1` إلى الواجهة أو تغيير RPC ليكتب من `p_formatted_address` |
| 3 | لا يوجد تعديل عنوان/موقع | `governed_update_customer` لا يقبل params عنوان | 🔴 | إضافة RPC لتحديث `unified_locations` + حقل في الشاشة |
| 4 | بيانات الطلب مجمّدة | Snapshot Architecture (تصميم) | 🟡 | مقصود — يحتاج قرار عمل لتغييره |
| 5 | `get_governed_customer` لا يعيد العنوان | `location_id` فقط + طلب منفصل | 🟡 | إضافة subquery لـ `unified_locations` في RPC القراءة |
| 6 | `p_region` وهمي | لا يُستخدم منذ V1 | 🟢 | إزالته من توقيع RPC |
| 7 | ازدواجية `p_contact_name`/`p_responsible_name` | كلاهما يحمل `responsibleName` | 🟢 | توحيد، أو إزالة `p_contact_name` إذا غير ضروري |

### البيان الختامي

Employee flow كامل وسليم (جميع الحقول تصل وتُحفظ وتُقرأ وتُعدّل).

Customer flow به 3 ثغرات حرجة في العنوان والموقع تجعل بيانات بعض العملاء ناقصة وغير قابلة للتعديل. الثغرات موجودة في طبقة RPC (شرط `p_address_line1` الخاطئ) وطبقة UI (غياب حقول تعديل العنوان).
