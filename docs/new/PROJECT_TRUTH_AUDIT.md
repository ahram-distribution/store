# PROJECT TRUTH AUDIT

> **التاريخ:** 2026-06-15  
> **الهدف:** المرجع الوحيد للحالة الحقيقية الحالية للمشروع قبل أي تطوير جديد  
> **الهيكل الإداري المعتمد:** الإدارة العليا ← مدير بيع ← مندوب ← عميل

---

## فهرس المحتويات

1. [ملخص تنفيذي](#1-ملخص-تنفيذي)
2. [توحيد الوثائق (Priority 1)](#2-توحيد-الوثائق-priority-1)
3. [إنشاء FIX HISTORY (Priority 2)](#3-إنشاء-fix-history-priority-2)
4. [إنشاء OPENCODE RULES (Priority 3)](#4-إنشاء-opencode-rules-priority-3)
5. [حصر الشاشات (Priority 4)](#5-حصر-الشاشات-priority-4)
6. [مراجعة الصلاحيات (Priority 5)](#6-مراجعة-الصلاحيات-priority-5)
7. [مراجعة أخطاء المتصفح (Priority 6)](#7-مراجعة-أخطاء-المتصفح-priority-6)
8. [تبسيط GPS (Priority 7)](#8-تبسيط-gps-priority-7)
9. [تبسيط الكود والقاعدة (Priority 8)](#9-تبسيط-الكود-والقاعدة-priority-8)
10. [الخلاصة والتوصيات](#10-الخلاصة-والتوصيات)
11. [قسم التحديثات](#11-قسم-التحديثات)

---

## 1. ملخص تنفيذي

### أرقام سريعة

| البند | العدد |
|-------|-------|
| إجمالي مساحة المشروع | ~165MB (بدون node_modules) |
| ملفات SQL (migrations) | 99 |
| جداول قاعدة البيانات | 72 |
| RPCs / دوال SQL | 187 (180 ACTIVE, 7 TEST) |
| مسارات (routes) | 82 |
| مكونات صفحات (page components) | ~100+ |
| ملفات خدمات (services) | 19 |
| أنظمة GPS مستقلة | 5 |
| أدوار (roles) مميزة | 22 (52 variant) |
| صلاحيات (capabilities) | ~70+ |
| ملفات وثائق (.md) | ~80+ |
| ملفات وثائق متفرقة بالجذر | 4 (.md) + 4 (.txt) |
| متاجر حالة (stores) | 6 (Zustand) |
| Hooks مخصصة | 4 |
| مهاجرات SQL | 99 (بين 2026-05-31 و 2026-07-22) |

### حالة المشروع العامة

- **التطبيق يعمل بالكامل على بيانات حقيقية** — لا توجد بيانات وهمية (mock data) في أي شاشة
- **معظم الاستعلامات عبر Supabase RPCs محكومة (governed)** — لكن يوجد استثناءات: `AccountPage.tsx` (customer_addresses)، `CompanyManagerPage.tsx` (companies) — خطر أمني
- **نظام الصلاحيات ديناميكي** (roles جدول و capabilities قابلة للتعديل عبر الـ UI)
- **ملف types/database.ts قديم** — يغطي 6 جداول فقط من أصل 72
- **99 مهاجرة SQL في شهرين** — مؤشر على تطور سريع وغير منضبط أحياناً
- **لا يوجد اختبارات آلية** — Playwright موجود في devDependencies لكنه غير مستخدم
- **لا يوجد Code Splitting** — جميع الصفحات محملة eagerly

---

## 2. توحيد الوثائق (Priority 1)

### 2.1 الوضع الحالي

الوثائق موزعة على 7 مواقع رئيسية:

| الموقع | العدد | ملاحظات |
|--------|-------|---------|
| `docs/` (الجذر) | ~35 ملف | مواضيع متفرقة: حضور، GPS، صلاحيات، تصميم |
| `docs/archive/` | ~15 ملف | أرشيف حالات المشروع وتحقيقات |
| `docs/business/` | 5 ملف | قواعد العمل، changelog، roadmap |
| `docs/reports/` | 4 ملف | تقارير التنظيف، blueprint النظام |
| `docs/system-blueprint/` | 21 ملف | **أكبر مجموعة — مخطط النظام الكامل** |
| `docs/technical/` | 3 ملف | قاعدة البيانات، governance، تاريخ المهاجرات |
| `docs/OWNER_KNOWLEDGE_BASE/` | ~30 ملف | قاعدة معرفة المالك (المرجعية) |
| **جذر المشروع** | 4 ملف `.md` + 4 ملف `.txt` | وثائق متفرقة غير منظمة |

### 2.2 مشاكل الوثائق الحالية

1. **تشتت كبير** — المعلومات نفسها موجودة في مواقع متعددة
2. **تكرار** — `system-blueprint/` يحتوي على 21 ملفاً بعضها متكرر (FINAL_CANONICAL_MASTER_REFERENCE و V2)
3. **ملفات قديمة** — `archive/` يحتوي على تحقيقات من مراحل سابقة
4. **ملفات غير ضرورية** — `ChatGPT Image` في `docs/` الجذر
5. **ملاتفي txt بالجذر** — 4 ملفات نصية عربية يجب نقلها أو دمجها
6. **لا يوجد INDEX مركزي** — لا يوجد فهرس يرشد إلى أي وثيقة

### 2.3 توصيات

- [ ] إنشاء `docs/README.md` كفهرس مركزي
- [ ] نقل `system-blueprint/` إلى `docs/archive/system-blueprint/` (أو الاحتفاظ به كمرجع تاريخي)
- [ ] دمج جميع الوثائق المتعلقة بـ (Tracking, Attendance, GPS) في مجلد واحد `docs/tracking/`
- [ ] نقل الـ 4 ملفات `.txt` من الجذر إلى `docs/archive/notes/`
- [ ] نقل ملفات `.md` من الجذر (`_ANCHORED_SUMMARY.md`، `TRACKING_RUNTIME_IMPLEMENTATION.md`، إلخ) إلى `docs/`
- [ ] حذف `ChatGPT Image` أو نقله

### 2.4 هيكل docs/ المقترح

```
docs/
├── README.md                          # INDEX مركزي
├── business/                          # قواعد العمل (BUSINESS_RULES.md, CURRENT_STATE.md, ...)
├── technical/                         # تقني (Database, Governance, Migrations)
├── tracking/                          # كل ما يخص التتبع و GPS والحضور
├── permissions/                       # الصلاحيات والأدوار
├── screens/                           # الشاشات والمسارات
├── owner-knowledge-base/              # قاعدة معرفة المالك
├── archive/                           # ملفات قديمة (مرجع تاريخي)
│   ├── system-blueprint/              # مخطط النظام السابق
│   ├── verification-reports/          # تقارير التحقق السابقة
│   ├── runtime-extraction/            # استخراجات وقت التشغيل
│   └── notes/                         # ملاحظات نصية
└── reports/                           # تقارير
```

---

## 3. إنشاء FIX HISTORY (Priority 2)

### 3.1 الوضع الحالي

**لا يوجد.** لا يوجد ملف FIX HISTORY منظم. المعلومات متفرقة في:
- `docs/business/CHANGELOG.md`
- `docs/reports/PROJECT_CHANGELOG.md`
- عناوين مهاجرات SQL (تشير إلى المشكلة)
- `docs/business/KNOWN_ISSUES.md`

### 3.2 الإجراء المطلوب

إنشاء `FIX_HISTORY.md` في جذر المشروع (أو في `docs/`) بالتنسيق التالي:

```markdown
# FIX HISTORY

## [YYYY-MM-DD] — وصف المشكلة
- **المشكلة:** ...
- **السبب:** ...
- **الإصلاح:** ...
- **الملفات المتأثرة:** ...
- **المهاجرة (Migration):** ...
- **حالة النشر:** ...
```

**يجب إنشاؤه فوراً قبل أي تطوير جديد.**

---

## 4. إنشاء OPENCODE RULES (Priority 3)

### 4.1 الوضع الحالي

**لا يوجد.** لا يوجد ملف `.opencode/` أو `opencode.json` أو `AGENTS.md` في المشروع.

### 4.2 الإجراء المطلوب

إنشاء ملف `.opencode/AGENTS.md` (أو `opencode.json` حسب التنسيق المفضل) يحدد:

1. **قواعد إلزامية لـ OpenCode:**
   - لا إضافة ميزات جديدة دون توثيق الحاجة
   - كل تغيير يجب أن يسجل في FIX HISTORY
   - مراجعة الهيكل الإداري (الإدارة العليا ← مدير بيع ← مندوب ← عميل)
   - التوثيق بالعربية والإنجليزية عند الضرورة

2. **سياق المشروع:**
   - React 19 + TypeScript 6 + Vite 5 + Tailwind v4
   - Supabase + RPCs (governed)
   - Zustand + React Router v7
   - Capacitor v8 (Android + iOS)
   - RTL / Arabic first

3. **محظورات:**
   - لا تعديل مباشر على الجداول (only RPCs)
   - لا إضافة مكتبات جديدة دون إثبات الحاجة
   - لا إضافة صلاحيات جديدة خارج الهيكل الإداري المعتمد

---

## 5. حصر الشاشات (Priority 4)

### 5.1 إجمالي المسارات

| الفئة | العدد | ملاحظات |
|-------|-------|---------|
| مسارات عامة (بدون توكن) | 11 | `/login`, `/register`, `/storefront`, `/daily-deals`, ... |
| مسارات محمية (مع توكن) | 71 | + 2 redirect + 2 catch-all |
| **الإجمالي** | **82** | |

### 5.2 المسارات العامة (بدون توكن)

| المسار | المكون | حالة الاستخدام |
|--------|--------|---------------|
| `/login` | LoginPage | مستخدم |
| `/register` | RegistrationPage | مستخدم |
| `/storefront` | CompaniesPage | مستخدم |
| `/storefront/products` | StorefrontPage | مستخدم |
| `/daily-deals` | DailyDealsPage | مستخدم |
| `/daily-deals/:id` | DailyDealDetailPage | مستخدم |
| `/flash-offers` | FlashOffersPage | مستخدم |
| `/flash-offers/:id` | FlashOfferDetailPage | مستخدم |
| `/tiers` | TierSystemPage | مستخدم |
| `/auctions` | AuctionsPage | مستخدم |
| `/auctions/:id` | AuctionDetailPage | مستخدم |

### 5.3 المسارات المحمية حسب الصلاحية

| المسار | الصلاحية المطلوبة | المكون |
|--------|-------------------|--------|
| `/orders/:id/edit` | `orders.update` | OrderEditPage |
| `/orders/approval-queue` | `orders.approve` | ApprovalQueuePage |
| `/visits/*` (4 مسارات) | `visits.create` | VisitsPage, VisitScreen, NewVisitPage, VisitDetailPage |
| `/customers/new` | `customers.create` | NewCustomerPage |
| `/collections` | `collections.read` | CollectionsPage |
| `/collections/new` | `collections.create` | NewCollectionPage |
| `/daily-deals/manage` | `deals.manage` | DailyDealsManagementPage |
| `/flash-offers/manage` | `flash_offers.manage` | FlashOffersManagementPage |
| `/tiers/manage` | `tiers.manage` | TiersManagerPage |
| `/auctions/manage` | `auctions.manage` | AuctionsManagerPage |
| `/credit/manage` | `credit.manage` | CreditManagementPage |
| `/credit/programs/manage` | `credit.program.manage` | CreditProgramsManagerPage |
| `/credit/applications` | `credit.view` | CreditApplicationsPage |
| `/credit/applications/:id` | `credit.review` | CreditReviewPage |
| `/warehouse*` (3 مسارات) | `warehouse.prepare` | WarehousePage, WarehouseReviewPage, WarehousePrepDetail |
| `/delivery` | `delivery.dispatch` | DeliveryPage |
| `/delivery/:id` | `delivery.deliver` | DeliveryDetailPage |
| `/employees` | `employees.manage` | EmployeeManagementPage |
| `/hierarchy` | `employees.manage` | HierarchyPage |
| `/attendance/settings` | `attendance.configure` | AttendanceSettingsPage |
| `/attendance/team-map` | `attendance.view_team_map` | TeamMapPage |
| `/attendance/operations` | `attendance.live_monitor` | OperationsCenterPage |
| `/attendance/employee/:id/:date` | `attendance.view_history` | EmployeeWorkdayDetailPage |
| `/ops/gps-test` | `requireUpperManagement` | GpsTestPage |

### 5.4 Dashboard Workspaces (16 دور مختلف)

| الـ Workspace | الأدوار المستهدفة |
|---------------|------------------|
| UpperManagementDashboard | الإدارة العليا |
| SalesManagerCCPage / SalesDashboard | مدير بيع، مشرف عام |
| SalesRepWorkDay | مندوب مبيعات |
| WarehouseManagerWorkspace / WarehouseDashboard | مدير مخزن |
| ManagementDashboard | سيلز داخلي، وكل الأدوار الأخرى |
| AdminWorkspace | أدمن |
| SuperAdminWorkspace | سوبر أدمن |
| ChairmanWorkspace | رئيس مجلس الإدارة |
| AccountantWorkspace | محاسب |
| CollectorWorkspace | محصل |
| PurchasingManagerWorkspace | مدير مشتريات |
| SecretaryWorkspace | سكرتير |
| SecurityWorkspace | أمن |
| BuffetWorkspace | بوفيه |
| DataEntryWorkspace | مدخل بيانات |
| DeliveryWorkspace | توصيل |

**ملاحظة:** بعض هذه الـ Workspaces قد تكون غير ضرورية بعد تبني الهيكل الإداري النهائي (الإدارة العليا ← مدير بيع ← مندوب ← عميل).

### 5.5 الشاشات التي قد تكون مكررة أو غير مستخدمة

| الشاشة | المشكلة | التوصية |
|--------|---------|---------|
| `CompaniesPage` (storefront) + `CompaniesPage` (mgmt) | اسم مكرر، مساران مختلفان | إبقاء (مختلفان بالمحتوى) |
| `DealsPage` | تعتمد على dailyDeals service، قد تكون زائدة عن DailyDealsPage | مراجعة للإبقاء أو الدمج |
| `SalesManagerCCPage` + `CommandCenterPage` | تداخل في الوظائف | مراجعة |
| `AttendanceRouter` | مجرد توجيه (redirector) | إبقاء (خفيف الوزن) |
| `SuperAdminWorkspace` / `AdminWorkspace` / `ChairmanWorkspace` | خارج الهيكل الإداري النهائي | مراجعة — قد تدمج في الإدارة العليا |
| `AccountantWorkspace` / `CollectorWorkspace` / `SecurityWorkspace` / إلخ | خارج الهيكل الإداري النهائي | يتطلب إثبات حاجة |

---

## 6. مراجعة الصلاحيات (Priority 5)

### 6.1 الأدوار الموجودة حالياً

#### الأدوار الأساسية (في roles table)

| الدور | وصف | is_system |
|-------|------|-----------|
| `SUPER_ADMIN` | Super Admin | true |
| `سوبر أدمن` | سوبر أدمن | true |
| `مدير البيع` | Sales Manager | true |
| `مندوب مبيعات` | Sales Rep | (عادة) |
| `رئيس مجلس الإدارة` | Chairman | true |
| `أدمن` | Admin | true |
| `مشرف مبيعات` | Sales Supervisor | (عادة) |
| `مشرف تنفيذي` | Executive Supervisor | (عادة) |

#### الأدوار غير المزروعة ولكن مشار إليها في الكود

| الدور | مكان الاستخدام | ملاحظة |
|-------|----------------|--------|
| `مدير تنفيذي` | DashboardPage, attendance RPCs | Legacy — يجب استبداله |
| `سوبر فايزر` | RolesTab, EmployeeAnalysisPage | Legacy — يستبدل بمدير بيع |
| `مندوب` | ModuleLauncherPage | مختصر — يجب توحيده |
| `warehouse_manager`, `warehouse` | DashboardPage | خارج الهيكل |
| `delivery`, `collector`, `accountant`, إلخ | DashboardPage | خارج الهيكل |

### 6.2 الهيكل الإداري النهائي مقابل الواقع

| المستوى في الهيكل النهائي | الأدوار الحالية المطابقة | أدوار إضافية موجودة |
|---------------------------|------------------------|-------------------|
| **الإدارة العليا** | `الإدارة العليا` (غير موجود كدور موحد!) | `SUPER_ADMIN`, `سوبر أدمن`, `رئيس مجلس الإدارة`, `أدمن`, `مدير تنفيذي` |
| **مدير بيع** | `مدير البيع` | `مشرف مبيعات`, `مشرف تنفيذي`, `سوبر فايزر`, `مدير مبيعات` |
| **مندوب** | `مندوب مبيعات` | `مندوب` (مختصر) |
| **عميل** | `customer` (identity_type) | — |

### 6.3 الصلاحيات (Capabilities) حسب المجموعة

| المجموعة | عدد الصلاحيات | أمثلة |
|----------|---------------|-------|
| attendance | 8 | configure, live_monitor, view_timeline, view_history, ... |
| targets | 3 | view_all, manage, access |
| credit | 15+ | activate, suspend, reactivate, approve, review, view, manage, ... |
| orders | 8+ | create, read, update, approve, cancel, dispatch, delete, manage |
| customers | 5 | create, read, update, manage, delete |
| collections | 5 | create, read, update, approve, delete |
| returns | 4 | create, read, update, approve |
| visits | 3 | create, read, update |
| deals | 1 | manage (يشمل daily deals + flash offers) |
| tiers | 1 | manage |
| auctions | 1 | manage |
| warehouse | 1 | prepare |
| delivery | 2 | dispatch, deliver |
| **الإجمالي** | **~70+** | |

### 6.4 مشاكل نظام الصلاحيات الحالي

1. **الأدوار مكتوبة بالنص (hardcoded role names)** في أكثر من 32 ملف مهاجرة وظائف RPC
   - يوجد 3 أنماط مختلفة: English trilogy (`'SUPER_ADMIN','CHAIRMAN','ADMIN'`)، Arabic trilogy (`'سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن'`)، Extended
   - إضافة دور جديد يتطلب تعديل جميع الـ RPCs
   - **الحل:** استخدام `is_upper_management()` الموجود بدلاً من hardcoded names

2. **تعدد الأدوار العليا:** 4+ أدوار بدلاً من دور `الإدارة العليا` الموحد
   - `20260720_unify_upper_management_role.sql` بدأ في هذا ولكن لم يكتمل

3. **رمز موظف hardcoded:** `WRQ1002`, `WRQ1004` موجودة في ~25 RPC كاستثناءات للرؤية
   - خطر عالٍ — إذا غادر الموظف أو تغير دوره تنكسر الرؤية

4. **أدوار خارج الهيكل:** محصل، محاسب، أمن، بوفيه، مشتريات، سكرتير، إدخال بيانات
   - هذه الأدوار قد تكون مطلوبة فعلاً أو من مرحلة سابقة

### 6.5 توصيات

- [ ] توحيد جميع أدوار الإدارة العليا في دور واحد: `الإدارة العليا`
- [ ] إزالة hardcoded role names من RPCs واستخدام `is_upper_management()` أو دالة `app.has_role_by_id()`
- [ ] إزالة hardcoded employee codes (`WRQ1002`, `WRQ1004`) واستخدام آلية dynamic
- [ ] مراجعة الأدوار خارج الهيكل (محصل، محاسب، إلخ) وإثبات الحاجة أو الحذف
- [ ] تحديث `DashboardPage` لاستخدام normalizeRole قبل الـ routing

---

## 7. مراجعة أخطاء المتصفح (Priority 6)

### 7.1 الوضع الحالي

**لم يتم إجراء فحص فعلي لأخطاء المتصفح بعد.** هذا يتطلب تشغيل التطبيق في المتصفح وفحص:

### 7.2 Console Errors

تم العثور على 29 استدعاء `console.*` في الكود المصدري:

| الموقع | النوع | العدد |
|--------|-------|-------|
| `src/services/` | console.error + console.warn | 6 |
| `src/lib/whatsapp.ts` | console.log | 2 |
| `src/pages/visits/VisitsPage.tsx` | console.error | 2 |
| `src/pages/visits/VisitScreen.tsx` | console.warn + error | 5 |
| `src/pages/storefront/OrderReviewPage.tsx` | console.log + error | 2 |
| `src/pages/orders/OrderNewPage.tsx` | console.error | 1 |
| `src/pages/auth/RegistrationPage.tsx` | console.error | 1 |
| `src/pages/operations-center/components/MapTab.tsx` | console.log | 4 |
| `src/pages/attendance/TeamMapPage.tsx` | console.error | 1 |
| `src/pages/attendance/EmployeeWorkdayDetailPage.tsx` | console.log + error | 5+ |
| `src/pages/dashboard/WarehouseDashboard.tsx` | console.error | 1 |

**الإجراء المطلوب:**
- [ ] تشغيل التطبيق وفتح Console في المتصفح
- [ ] تسجيل جميع الأخطاء الظاهرة
- [ ] تصنيفها: أخطاء كود / أخطاء شبكة / أخطاء RPC / أخطاء 404
- [ ] إزالة استدعاءات `console.log` غير الضرورية
- [ ] تحويل `console.error` إلى نظام تسجيل مركزي (أو إضافتها إلى `failureLogger`)

### 7.3 Network Errors

- [ ] فحص Network tab في المتصفح للأخطاء
- [ ] تسجيل أي طلبات RPC فاشلة
- [ ] تسجيل أي 404 لأصول ثابتة (images, manifests, etc.)

### 7.4 RPC Errors

- [ ] فحص أخطاء Supabase RPC (عودة null أو error في الاستجابة)
- [ ] التأكد من أن جميع الـ RPCs تعمل مع المستخدمين العاديين (ليس فقط سوبر أدمن)

### 7.5 404 Errors

- [ ] فحص PWA manifests المكررة: `manifest.webmanifest` و `manifest.json`
- [ ] فحص مسارات الأيقونات (icons) في المانيفست

---

## 8. تبسيط GPS (Priority 7)

### 8.1 أنظمة GPS الخمسة المستقلة

| النظام | الملفات | طريقة العمل | البيانات | وضع عدم الاتصال |
|--------|---------|------------|-----------|----------------|
| **S1: gpsService** | `gpsService.ts` | Kernel — API واحد (one-shot + continuous watching) | ذاكرة مؤقتة فقط | لا |
| **S2: TrackingEngine** | `trackingEngine.ts` + `trackingQueue.ts` + `heartbeatService.ts` + `lastSeenTracker.ts` + `sw.ts` + `tracking-service.ts` | مستمر (كل 5 دقائق) أثناء وردية العمل | `tracking_points` جدول + IndexedDB | نعم (Queue + Background Sync) |
| **S3: locationService** | `location.ts` | حفظ نقاط GPS + عكس الإحداثيات (reverse geocoding) + مسافات | `unified_locations` جدول | لا |
| **S4: Event GPS** | `attendance.ts` + صفحات الـ UI | لقطة واحدة في لحظات محددة (بداية/نهاية الوردية، الاستراحة، التسجيل) | `sessions` + `customers` جداول | لا |
| **S5: Order GPS** | `order-display.ts` + صفحات الـ UI | تسجيل مكان تنفيذ الطلب (غير مطبق — null دائماً) | `orders.execution_*` أعمدة | لا |

### 8.2 علاقة الأنظمة ببعضها

```
gpsService (S1) —— المؤسسة —— يستخدمه الكل
    ├── trackingEngine (S2) —— تتبع مستمر
    ├── locationService (S3) —— حفظ وعكس
    ├── Event GPS (S4) —— لحظات محددة
    └── Order GPS (S5) —— (غير مطبق)
```

### 8.3 التحليل

الحقيقة أن هذه ليست 5 أنظمة منفصلة تماماً. هناك:
- **نواة واحدة:** `gpsService.ts` — هي المصدر الوحيد للحصول على GPS
- **4 مستهلكين مختلفين** يخزنون البيانات في 4 جداول مختلفة
- **محرك تتبع متطور (S2)** مع دعم offline و native

### 8.4 مشاكل GPS

1. **تشتت التخزين:** بيانات GPS مخزنة في 4 جداول: `tracking_points`, `unified_locations`, `sessions`, `orders.execution_*`
2. **نظاما تخزين عنوان:** `customer_addresses` (قديم 25 صف) و `unified_locations` (~30 صف) — غير موحدين
3. **Order GPS غير مطبق:** `OrderNewPage` و `OrderReviewPage` يرسلان `null` في جميع حقول GPS
4. **failureLogger غير مستخدم بالكامل:** يوجد في الكود لكنه لا يُستدعى من GPS services

### 8.5 توصيات

- [ ] **لا داعي لدمج الأنظمة الخمسة في واحد** — كل مستهلك له غرض مختلف. لكن يجب توحيد API الـ acquisition
- [ ] توحيد التخزين: هل `unified_locations` يمكن أن يكون المصدر الوحيد لجميع نقاط GPS؟
- [ ] إكمال Order GPS (إرسال location عند إنشاء الطلب)
- [ ] تفعيل `failureLogger` في `gpsService.ts`
- [ ] تحديد أي من `customer_addresses` أو `unified_locations` سيبقى (وترحيل الآخر)
- [ ] توثيق الـ GPS architecture في `docs/tracking/GPS_ARCHITECTURE.md`

---

## 9. تبسيط الكود والقاعدة (Priority 8)

### 9.1 الجداول غير المستخدمة

بناءً على `docs/system-blueprint/06_UNUSED_AND_DUPLICATED.md`:

| الجدول | عدد الصفوف | الحالة | منذ | ملاحظة |
|--------|-----------|--------|------|--------|
| `daily_deals` | 0 | قد يحتاجه المستقبل | — | احتفاظ (feature متوقع) |
| `flash_offers` | 0 | قد يحتاجه المستقبل | — | احتفاظ (feature متوقع) |
| `expenses` | 0 | غير مستخدم | — | مراجعة للحذف |
| `preparation_records` | 0 | غير مستخدم | — | احتفاظ (قيد التطوير) |
| `preparation_exceptions` | 0 | غير مستخدم | — | احتفاظ (تابع للسابق) |
| `credit_contracts` | 0 | غير مستخدم | — | احتفاظ (جزء من سير العمل الائتماني) |
| `employee_advances` | 0 | غير مستخدم | — | مراجعة للحذف |
| `inventory` | ~700 | استخدام غير واضح | — | مراجعة |

### 9.2 دوال RPC غير المستخدمة

| الدالة | الحالة |
|--------|--------|
| `multiline_test` | اختبار — احذف |
| `test_func` | اختبار — احذف |
| `test_ping2` | اختبار — احذف |
| `test_ping3` | اختبار — احذف |
| `test_rpc` | اختبار — احذف |
| `test_setof` | اختبار — احذف |
| `ping` | بقيت من التطوير ولكن قد تكون مفيدة للـ health check |

### 9.3 ملفات خدمات (Services) — تحليل الاستخدام

| الخدمة | الاستخدام | الحالة |
|--------|-----------|--------|
| `auth.ts` | صفحات الدخول والتسجيل | مستخدمة |
| `attendance.ts` | Attendance Runtime | مستخدمة |
| `gpsService.ts` | جميع أنظمة GPS | مستخدمة |
| `trackingEngine.ts` | Attendance Runtime | مستخدمة |
| `trackingQueue.ts` | Tracking Engine (offline) | مستخدمة |
| `heartbeatService.ts` | Tracking Engine | مستخدمة |
| `lastSeenTracker.ts` | Tracking Engine | مستخدمة |
| `failureLogger.ts` | معرفة — غير مستدعاة من أي مكان؟ | **قد تكون غير مستخدمة** |
| `location.ts` | الزيارات والعملاء | مستخدمة |
| `products.ts` | صفحات المنتجات | مستخدمة |
| `dailyDeals.ts` | Daily Deals | مستخدمة |
| `deals.ts` | DealsPage | **قد تكون زائدة عن dailyDeals.ts** |
| `flashOffers.ts` | Flash Offers | مستخدمة |
| `auctions.ts` | Auctions | مستخدمة |
| `credit.ts` | Credit | مستخدمة |
| `tiers.ts` | Tiers | مستخدمة |
| `returns.ts` | Returns | مستخدمة |
| `targets.ts` | Targets/Dashboards | مستخدمة |
| `notificationService.ts` | Capacitor Notifications | مستخدمة |
| `whatsapp.ts` (lib) | WhatsApp integration | مستخدمة |

### 9.4 الصفحات غير المستخدمة

بناءً على تحليل `routes/index.tsx`، جميع الصفحات الـ 100+ مسجلة في routes ويتم استيرادها. لا توجد صفحات غير مستخدمة بشكل واضح، ولكن:

| الصفحة | ملاحظة |
|--------|--------|
| `DynamicSchemaEditor.tsx` | مكون في utils/، قد لا يكون مستخدماً في أي صفحة |
| `ModuleLauncherPage.tsx` | مستخدم — `/launcher/:module` |
| `SubLauncherPage.tsx` | مستخدم — يستدعى من ModuleLauncherPage |

### 9.5 مشاكل أخرى

1. **نظاما عناوين عملاء:** `customer_addresses` (قديم) و `unified_locations` (جديد) — 25 عميل بدون `location_id`
2. **نظاما ترميز عملاء:** `REG-XXXXXXXX` (تسجيل) و `CUS-YYYY-NNNNNN` (إنشاء يدوي) — تنسيقان مختلفان
3. **حقول deprecated:** `orders.snapshot_sender_name/phone/address` (غير مستخدمة)، `customers.email` (يزال يظهر في CustomerProfilePage)
4. **ملف types/database.ts قديم:** يغطي 6 جداول فقط (من أصل 72)
5. **Console.log في الإنتاج:** 29 استدعاء يجب تنظيفها

### 9.6 توصيات

- [ ] حذف دوال `test_*` من قاعدة البيانات
- [ ] مراجعة `deals.ts` — هل يمكن دمجه مع `dailyDeals.ts`؟
- [ ] مراجعة `failureLogger.ts` — تفعيله أو حذفه
- [ ] ترحيل `customer_addresses` إلى `unified_locations`
- [ ] توحيد تنسيق ترميز العملاء
- [ ] حذف `orders.snapshot_sender_*` من الاستعلامات
- [ ] إزالة `customers.email` من CustomerProfilePage
- [ ] تحديث `types/database.ts` أو إنشاء أنواع جديدة شاملة
- [ ] تنظيف `console.log` من جميع الملفات

---

## 10. الخلاصة والتوصيات

### 10.1 الأولويات المقترحة بعد هذا التقرير

| الأولوية | المهمة | الجهد | الأثر |
|----------|--------|-------|-------|
| 1 | توحيد وثائق docs/ تحت `docs/README.md` | منخفض | عالي |
| 2 | إنشاء `FIX_HISTORY.md` | منخفض | عالي |
| 3 | إنشاء `.opencode/AGENTS.md` | منخفض | عالي |
| 4 | حذف دوال `test_*` SQL | منخفض | متوسط |
| 5 | تنظيف `console.log` | منخفض | منخفض |
| 6 | إصلاح `customers.email` في CustomerProfilePage | منخفض | منخفض |
| 7 | ترحيل `customer_addresses` → `unified_locations` | متوسط | عالي |
| 8 | توحيد أدوار الإدارة العليا | عالي | عالي |
| 9 | إزالة hardcoded role names من RPCs | عالي | عالي |
| 10 | إزالة hardcoded employee codes | متوسط | عالي |
| 11 | فحص Browser Errors في runtime | متوسط | متوسط |
| 12 | مراجعة الأدوار خارج الهيكل | متوسط | متوسط |
| 13 | توثيق GPS architecture | منخفض | متوسط |
| 14 | تحديث types/database.ts | متوسط | متوسط |

### 10.2 ملاحظة مهمة

**لا يوجد اختبارات آلية.** Playwright موجود في devDependencies لكن غير مستخدم. هذا خطر كبير لأي تطوير مستقبلي. يوصى بإضافة اختبارات API (لـ RPCs) كحد أدنى قبل أي تغييرات جذرية.

### 10.3 نقاط القوة

1. جميع البيانات حقيقية — لا mock data
2. نظام صلاحيات ديناميكي roles/capabilities عبر UI
3. Governed RPCs — جميع الاستعلامات عبر دوال أمان
4. Snapshot architecture للطلبات (يمنع تغير البيانات التاريخية)
5. دعم التتبع في وضع عدم الاتصال (IndexedDB + Service Worker)
6. دعم منصات متعددة (Web + Android + iOS عبر Capacitor)

### 10.4 نقاط الضعف

1. **غياب FIX HISTORY و OPENCODE RULES** — أولويتان فوريتان
2. **99 مهاجرة SQL في شهرين** — تغييرات كثيرة جداً
3. **hardcoded role names في RPCs** — هش جداً
4. **لا اختبارات آلية** — خطر عالي
5. **وثائق متفرقة** — صعوبة العثور على المعلومة
6. **نظاما عناوين ونظاما ترميز** — ازدواجية
7. **ملف أنواع قديم** — types/database.ts لا يعكس الواقع
8. **أدوار كثيرة خارج الهيكل** — تحتاج مراجعة

---

## 11. قسم التحديثات

| التاريخ | التحديث | الجهة |
|---------|---------|-------|
| 2026-06-15 | الإنشاء الأولي للملف | — |
| — | — | — |

---

*هذا الملف هو المرجع الوحيد للحالة الحالية للمشروع. يجب تحديثه بعد كل تغيير جوهري.*
