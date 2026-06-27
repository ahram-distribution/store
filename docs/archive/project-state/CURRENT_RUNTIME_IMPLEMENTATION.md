# Ahram Distribution — Current Runtime Implementation Status

> Generated: 2026-06-02
> Purpose: Operational reference for session continuity

---

## ما تم تنفيذه حتى الآن

| المرحلة | الحالة |
|---|---|
| استخراج مواصفات المرجع القديم من `alahram-runtime` | ✅ مكتمل |
| نظام الفاتورة الموحد (InvoiceView) | ✅ مكتمل |
| ملف العميل (CustomerProfilePage) | ✅ مكتمل |
| إنشاء طلب (OrderNewPage) | ✅ مكتمل |
| شاشة الزيارة (VisitScreen) | ✅ مكتمل |
| My Customers (CustomersPage) — كروت مطابقة للمرجع | ✅ مكتمل |
| My Orders (OrdersPage) — كروت مطابقة للمرجع | ✅ مكتمل |
| اختصارات سريعة في SalesRepWorkDay | ✅ مكتمل |
| PDF RTL للفاتورة (A4 & A5) | ✅ مكتمل |
| قواعد التنقل العامة (Global Navigation Rules) | ✅ مكتمل |
| توثيق الجلسة (CURRENT_RUNTIME_IMPLEMENTATION.md) | ✅ مكتمل |
| القرار المعماري: Global RTL Rule (Arabic First) | ✅ مكتمل |
| القرار المعماري: Public Entry Point (Storefront) | ✅ مكتمل |
| القرار المعماري: Store Auth Actions | ✅ مكتمل |
| القرار المعماري: Role Routing | ✅ مكتمل |
| القرار المعماري: Dual Navigation | ✅ مكتمل |
| القرار المعماري: Documentation | ✅ مكتمل |

---

## الشاشات المنفذة

| الشاشة | الملف | المسار | الوصف |
|---|---|---|---|
| My Customers | `src/pages/customers/CustomersPage.tsx` | `/customers` | كروت عملاء مع بحث نصي، ضغط ← ملف العميل |
| Customer Profile | `src/pages/customers/CustomerProfilePage.tsx` | `/customers/:id` | 7 أقسام: بيانات العميل، إجراءات سريعة، آخر نشاط، فرص، معلومات، زيارات، طلبات، تايم لاين |
| My Orders | `src/pages/orders/OrdersPage.tsx` | `/orders` | كروت طلبات بأربعة أسطر مطابقة للمرجع |
| Order Detail / Invoice | `src/pages/orders/OrderDetailPage.tsx` | `/orders/:id` | يستخدم InvoiceView لعرض الفاتورة |
| New Order | `src/pages/orders/OrderNewPage.tsx` | `/orders/new` | إنشاء طلب: شركات ← منتجات ← سلة ← مراجعة ← إرسال |
| Visit Screen | `src/pages/visits/VisitScreen.tsx` | `/visits/screen` | 5 خطوات: عميل ← موقع ← بدء ← تنفيذ ← إنهاء |
| Visit Detail | `src/pages/visits/VisitDetailPage.tsx` | `/visits/:id` | تفاصيل الزيارة مع إنهاء الزيارة |
| Work Day | `src/pages/sales-rep/SalesRepWorkDay.tsx` | `/dashboard` | مؤشرات، إجراءات سريعة (6 أزرار)، فرص بيع، آخر نشاط |
| Account Page | `src/pages/account/AccountPage.tsx` | `/account` | حساب العميل (ملخص، عناوين، طلبات، كشف حساب) |
| Storefront (Public) | `src/pages/storefront/CompaniesPage.tsx` | `/storefront` | الصفحة الافتراضية—عامة، لا تحتاج تسجيل دخول |
| Storefront Products (Public) | `src/pages/storefront/StorefrontPage.tsx` | `/storefront/products` | تصفح المنتجات—عامة، لا تحتاج تسجيل دخول |

### الشاشات المشتركة

| المكون | الملف | الوصف |
|---|---|---|
| InvoiceView | `src/components/shared/InvoiceView.tsx` | مكون الفاتورة الموحد: جدول منتجات، معلومات عميل/مندوب، موقع تنفيذ، تايم لاين، PDF A4/A5، واتساب |
| StatusBadge | `src/components/shared/StatusBadge.tsx` | عرض حالة الطلب/الزيارة/التحصيل مع ألوان وأيقونات |

---

## الشاشات قيد التنفيذ (مقترحة)

| الشاشة | الأولوية | الملاحظات |
|---|---|---|
| New Customer | عالية | نموذج إضافة عميل جديد — المرجع موجود في `NEW_CUSTOMER_REFERENCE.md` |
| اعتماد الطلبات (Order Approval) | متوسطة | 31 طلباً بحالة `submitted` تنتظر الاعتماد |
| تحصيل المدفوعات | متوسطة | 6 تحصيلات بحالة `pending` |
| قائمة الزيارات | منخفضة | عرض الزيارات السابقة |

---

## القرارات المعتمدة

### نظام الفاتورة الموحد (InvoiceView)
- مكون واحد `InvoiceView` يستخدم في `OrderDetailPage` ومن ملف العميل
- جدول منتجات مجمع حسب الشركة (company-grouped)
- ثلاثة أقسام معلومات: العميل، مندوب المبيعات، موقع التنفيذ
- سجل التغييرات (timeline) من `order_status_history`
- PDF: A4 (كامل) و A5 (مضغوط) عبر `window.print()` و `window.open()`
- واتساب: رسالة منسقة تطابق قالب المرجع القديم تماماً
- **RTL**: `dir="rtl"` على `<html>` — جميع الجداول والعناوين والنصوص تظهر من اليمين لليسار
- أرقام الهواتف والرموز: `dir="ltr"` للحفاظ على اتجاه القراءة الصحيح

### My Customers (حسب المرجع)
- كرت: اسم العميل **bold** في السطر الأول
- كرت: هاتف + عنوان بالرمادي في السطر الثاني (بدون فاصل)
- بحث نصي client-side: الاسم، الهاتف، العنوان
- بدون أزرار إجراءات على الكروت
- ضغط ← CustomerProfilePage

### My Orders (حسب المرجع)
- كرت من 4 أسطر:
  1. `طلب شراء / فاتورة` + رقم الطلب | حالة (نص عادي)
  2. 👤 اسم العميل - هاتف (إن وجد)
  3. 📍 عنوان العميل (إن وجد)
  4. 🧑‍💼 مندوب المبيعات - هاتف
  5. التاريخ - الإجمالي
- بدون أزرار أو فلاتر
- ضغط ← OrderDetailPage / InvoiceView

### إنشاء الطلب
- يستخدم `governed_create_order` RPC (ينشئ كـ `draft`)
- ثم `supabase.from('orders').update()` لتعديل `status = 'submitted'` + `subtotal` + `total_amount`
- إدراج `order_status_history` للانتقال `draft → submitted`
- سبب عدم وجود RPC `governed_submit_order` — لا يوجد في قاعدة البيانات

### الزيارات
- يستخدم `governed_create_visit(p_google_maps_link)` لبدء الزيارة
- يستخدم `governed_checkout_visit(p_visit_result, p_notes)` لإنهاء الزيارة
- زيارة نشطة واحدة فقط لكل مندوب (يتم التحقق منها)
- رابط Google Maps إلزامي قبل بدء الزيارة (بدون وصف نصي للموقع)

---

## قواعد التنقل المعتمدة (Global Navigation Rules)

### القاعدة A: اسم العميل ← CustomerProfilePage
أي اسم عميل يظهر للمستخدم يجب أن يكون قابلاً للضغط ويفتح `/customers/:id`

**الأماكن المطبقة:**
- ✅ My Customers — كامل الكرت (`CustomersPage.tsx:93`)
- ✅ فرص البيع — اسم العميل (`SalesRepWorkDay.tsx:199`)
- ✅ آخر عميل جديد (`SalesRepWorkDay.tsx:248` سطر `lastCustomer`)
- ✅ تفاصيل الزيارة — اسم العميل (`VisitDetailPage.tsx:91`)
- ✅ ملف العميل — الاسم الرئيسي (وهو نفس الصفحة، لا يحتاج رابط)

### القاعدة B: رقم الطلب ← OrderDetailPage / InvoiceView
أي طلب أو فاتورة أو رقم طلب يظهر للمستخدم يجب أن يكون قابلاً للضغط ويفتح `/orders/:id`

**الأماكن المطبقة:**
- ✅ My Orders — كامل الكرت (`OrdersPage.tsx:104`)
- ✅ فواتير العميل — كرت الطلب (`CustomerProfilePage.tsx:412`)
- ✅ آخر طلب (`SalesRepWorkDay.tsx:228` سطر `lastOrder`)

**ملاحظة:** شاشات المخزن (Warehouse) لها سير عمل خاص — أرقام الطلبات فيها تفتح صفحة التجهيز (`/warehouse/prep/:id`) وليس InvoiceView

---

## المرجع القديم — ما تم نقله

| الملف المرجعي | المصدر | الحالة في المشروع الحالي |
|---|---|---|
| `customers.js` | `domains/field/pages/customers.js` | `CustomersPage.tsx` — كامل الكروت والبحث |
| `orders.js` | `domains/field/pages/orders.js` | `OrdersPage.tsx` — كامل الكروت (4 أسطر) |
| `customer.js` | `domains/field/pages/customer.js` | `CustomerProfilePage.tsx` — جميع الأقسام |
| `order.js` | `domains/field/pages/order.js` | `InvoiceView.tsx` — جدول المنتجات، التجميع بالشركة |
| `groupItems.js` | `services/storefront/groupItems.js` | مدمج في `InvoiceView.tsx` — `groupItems()`, `computeGroupSubtotal()` |
| `whatsapp.js` | `services/whatsapp.js` | مدمج في `InvoiceView.tsx` — `buildWhatsAppMessage()` |

**ملفات المرجع المحفوظة في المشروع:**
- `workspace/tools/runtime-extraction/INVOICE_REFERENCE.md`
- `workspace/tools/runtime-extraction/WHATSAPP_ORDER_REFERENCE.md`
- `workspace/tools/runtime-extraction/ORDER_FLOW_REFERENCE.md`
- `workspace/tools/runtime-extraction/MY_CUSTOMERS_REFERENCE.md`
- `workspace/tools/runtime-extraction/MY_ORDERS_REFERENCE.md`
- `workspace/tools/runtime-extraction/NEW_CUSTOMER_REFERENCE.md`

---

## الملفات الرئيسية المستخدمة

### الصفحات
| الملف | الغرض |
|---|---|
| `src/pages/sales-rep/SalesRepWorkDay.tsx` | شاشة يوم العمل الرئيسية للمندوب |
| `src/pages/customers/CustomersPage.tsx` | قائمة العملاء (بحث + كروت) |
| `src/pages/customers/CustomerProfilePage.tsx` | ملف العميل (7 أقسام) |
| `src/pages/orders/OrdersPage.tsx` | قائمة الطلبات (كروت 4 أسطر) |
| `src/pages/orders/OrderNewPage.tsx` | إنشاء طلب جديد |
| `src/pages/orders/OrderDetailPage.tsx` | تفاصيل الطلب (يستخدم InvoiceView) |
| `src/pages/visits/VisitScreen.tsx` | شاشة الزيارة (5 خطوات) |
| `src/pages/visits/VisitDetailPage.tsx` | تفاصيل الزيارة |
| `src/pages/account/AccountPage.tsx` | حساب العميل (صفحة العميل النهائي) |

### المكونات المشتركة
| الملف | الغرض |
|---|---|
| `src/components/shared/InvoiceView.tsx` | مكون الفاتورة الموحد (جدول، PDF، واتساب) |
| `src/components/shared/StatusBadge.tsx` | عرض الحالة مع ألوان |

### التنسيق والمسارات
| الملف | الغرض |
|---|---|
| `src/utils/format.ts` | `formatCurrency`, `formatDate`, `formatDateTime`, `formatCurrencyShort` |
| `src/routes/index.tsx` | جميع مسارات التطبيق + التوجيه العام (Public/Protected) |
| `src/layouts/AppLayout.tsx` | هيكل التطبيق العام (Public vs Authenticated layout) |
| `src/components/shared/TopBar.tsx` | الشريط العلوي مع Dual Navigation (متجر/لوحة تحكم) |
| `src/components/shared/BottomNav.tsx` | الشريط السفلي مع روابط حسب نوع المستخدم |
| `src/pages/dashboard/DashboardPage.tsx` | توجيه الدور (Role Routing) إلى dashboard المناسب |
| `src/pages/storefront/CompaniesPage.tsx` | نقطة الدخول العامة (Companies + Auth Actions) |
| `src/pages/storefront/StorefrontPage.tsx` | المتجر العام (Products + Auth Actions + Dual Nav) |

### ملفات التوثيق
| الملف | الغرض |
|---|---|
| `workspace/tools/project-state/CURRENT_RUNTIME_IMPLEMENTATION.md` | (**هذا الملف**) مرجع تشغيلي للجلسات |
| `workspace/tools/runtime-extraction/*.md` | مواصفات المرجع القديم (6 ملفات) |

---

## البيانات الحالية (من Supabase)

| الجدول | العدد | ملاحظات |
|---|---|---|
| العملاء | 25 | في `customers` |
| المنتجات | 1201 | مع 2710 `product_units` |
| الموظفين | 16 | في `employees` |
| مندوبي المبيعات | 7 | `employee_type = 'sales'` |
| الطلبات | 41 | منها 31 `submitted` |
| الزيارات | 6 | جميعها `active` |
| التحصيلات | 6 | جميعها `pending` |
| دوال PL/pgSQL | 89 | governed_*, dashboard_*, auth_*, delivery_*, warehouse_* |

### RPCs الرئيسية المستخدمة
| RPC | الوظيفة |
|---|---|
| `get_governed_customers` | جلب العملاء حسب صلاحية المستخدم |
| `get_governed_customer` | جلب عميل واحد |
| `get_governed_orders` | جلب الطلبات حسب الصلاحية |
| `get_governed_order` | جلب طلب واحد |
| `get_governed_visits` | جلب الزيارات |
| `get_governed_visit` | جلب زيارة واحدة |
| `get_dashboard_sales` | مؤشرات لوحة المبيعات |
| `governed_create_order` | إنشاء طلب (كـ draft) |
| `governed_create_visit` | إنشاء زيارة |
| `governed_checkout_visit` | إنهاء الزيارة |
| `governed_create_customer` | إنشاء عميل جديد |

**ملاحظة:** لا يوجد RPC `governed_submit_order` — الانتقال `draft → submitted` يتم عبر `supabase.from('orders').update()` مباشرة + إدراج في `order_status_history`

---

## Build Status
```
tsc --noEmit → EXIT: 0 (نظيف)
```

---

## الخطوات القادمة المقترحة

| المهمة | الأولوية | التفاصيل |
|---|---|---|
| **New Customer** | عالية | نموذج إضافة عميل جديد — المرجع في `NEW_CUSTOMER_REFERENCE.md`، يستخدم `governed_create_customer` RPC |
| **اعتماد الطلبات (Order Approval)** | متوسطة | 31 طلباً بحالة `submitted` — يحتاج شاشة اعتماد تظهر للمدير/المشرف |
| **تحصيل المدفوعات** | متوسطة | 6 تحصيلات بحالة `pending` — شاشة تحصيل مع تسجيل الدفع |
| **قائمة الزيارات** | منخفضة | عرض تاريخ الزيارات مع إمكانية التصفية |
| **إنشاء حساب عام (Public Signup)** | منخفضة | زر "إنشاء حساب جديد" موجود حالياً معطل — يحتاج شاشة تسجيل للعملاء الجدد |
| **شاشات مفقودة** | منخفضة | Supervisor Dashboard, Chairman Dashboard, Super Admin Dashboard — كلها تستخدم ManagementDashboard كـ fallback |
| **Vite build fix** | منخفضة | `@rolldown/pluginutils` dependency issue — غير مرتبط بكود المشروع |

---

## القرارات المعمارية المعتمدة (Architecture Decisions)

### DECISION 1 — GLOBAL RTL RULE (Arabic First)

**القرار:** المشروع بالكامل يعتمد `dir="rtl"` كقاعدة أساسية. جميع الشاشات الحالية والمستقبلية تلتزم بـ:
- RTL Content
- RTL Layout
- RTL Navigation
- RTL Cards
- RTL Headers
- RTL Tables
- RTL Dashboards

**ممنوع:** RTL Text + LTR Layout — يجب أن يبدأ التصميم بصرياً من اليمين.

**التنفيذ:**
- `index.html`: `<html lang="ar" dir="rtl">` — الجذر
- جميع flex/grid layouts تبدأ من اليمين (`flex-row` في RTL: start = right)
- `justify-between`: المحتوى الأهم في أول DOM (يمين RTL)، المحتوى الثانوي في آخر DOM (يسار RTL)
- `text-right`/`text-left`: تستخدم للاتجاه الفيزيائي الصحيح للعناصر العربية
- أرقام الهواتف والرموز: `dir="ltr"` للحفاظ على اتجاه القراءة
- PDF: `<html dir="rtl">` مستقل في نافذة الطباعة

### DECISION 2 — PUBLIC ENTRY POINT

**القرار:** الصفحة الافتراضية عند فتح الموقع هي `/storefront` (المتجر العام).

**التفاصيل:**
- الزوار يستطيعون تصفح الشركات والمنتجات والبحث بدون تسجيل دخول
- الصفحات العامة: `/storefront`, `/storefront/products`, `/login`
- الصفحات المحمية تتطلب تسجيل الدخول

**التنفيذ:**
- `src/routes/index.tsx`: عندما لا يوجد token، يتم عرض المتجر + صفحات الدخول
- `src/layouts/AppLayout.tsx`: عندما لا يوجد token، يتم عرض layout عام بدون TopBar/BottomNav

### DECISION 3 — STORE AUTH ACTIONS

**القرار:** داخل المتجر توجد أزرار واضحة لـ:
- تسجيل الدخول
- إنشاء حساب جديد

**التفاصيل:**
- تظهر الأزرار في المتجر (CompaniesPage و StorefrontPage) عندما لا يكون المستخدم مسجلاً
- بعد تسجيل الدخول: تظهر أزرار لوحة التحكم/الطلبات بدلاً من auth actions

**التنفيذ:**
- `src/pages/storefront/CompaniesPage.tsx`: أزرار تسجيل الدخول + إنشاء حساب (معطل)
- `src/pages/storefront/StorefrontPage.tsx`: أزرار تسجيل الدخول + إنشاء حساب (معطل) + Dual Nav للمستخدمين المسجلين

**ملاحظة:** "إنشاء حساب جديد" موجود كزر معطل—شاشة التسجيل للعملاء لم يتم إنشاؤها بعد.

### DECISION 4 — ROLE ROUTING

**القرار:** بعد تسجيل الدخول، يتم التوجيه حسب نوع المستخدم وصلاحياته.

**المسارات الحالية:**

| نوع المستخدم | الشاشة | حالة الشاشة |
|---|---|---|
| Customer | `/storefront` (Storefront) | ✅ موجودة |
| Sales Rep | `SalesRepWorkDay` | ✅ موجودة |
| Warehouse | `WarehouseDashboard` | ✅ موجودة |
| Transport/Delivery | `TransportDashboard` | ✅ موجودة |
| Sales Manager | `SalesDashboard` | ✅ موجودة |
| Supervisor | `ManagementDashboard` (fallback) | ❌ شاشة مخصصة غير موجودة |
| Admin | `ManagementDashboard` (fallback) | ❌ شاشة مخصصة غير موجودة |
| Chairman | `ManagementDashboard` (fallback) | ❌ شاشة مخصصة غير موجودة |
| Super Admin | `ManagementDashboard` (fallback) | ❌ شاشة مخصصة غير موجودة |

**التنفيذ:**
- `src/pages/dashboard/DashboardPage.tsx`: تحديد dashboard بناءً على `user.roles`
- `src/routes/index.tsx`: التوجيه الافتراضي يعتمد على `identity_type`

### DECISION 5 — DUAL NAVIGATION

**القرار:** بعد تسجيل الدخول، يستطيع المستخدم التنقل بين المتجر ولوحة التحكم من أي مكان.

**التنفيذ:**
- **TopBar** (`src/components/shared/TopBar.tsx`): أزرار "المتجر" و "لوحة التحكم" تظهر حسب الصفحة الحالية (إذا كنت في المتجر يظهر زر "لوحة التحكم" والعكس)
- **BottomNav** (`src/components/shared/BottomNav.tsx`): روابط تنقل مقسمة حسب نوع المستخدم:
  - العميل: المتجر, الطلبات, حسابي
  - الموظف: الرئيسية, المتجر, الطلبات, الزيارات, المزيد
- **StorefrontPage**: أزرار "لوحة التحكم" للموظفين أو "حسابي"/"طلباتي" للعملاء

### DECISION 6 — DOCUMENTATION

**القرار:** جميع القرارات المعمارية موثقة في هذا الملف (`CURRENT_RUNTIME_IMPLEMENTATION.md`).

**التفاصيل:**
- يتم تحديث الملف بعد كل قرار معماري جديد
- الملف هو المرجع التشغيلي الأساسي للجلسات القادمة
- يغطي: ما تم تنفيذه، الشاشات، القرارات، القواعد، البيانات، RPCs، الخطوات القادمة

---
