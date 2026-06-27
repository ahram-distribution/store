# Runtime V2 Changelog

> **سجل التغييرات الحي — يُحدث مع كل تغيير تنفيذي**
> آخر تحديث: 2026-06-24 (النشر 3)

---

## 2026-06-24 — Phase 2: Achievement Runtime

### Added
- `runtime.resolve_scope(uuid)` — Centralized scope resolver function
- `runtime.get_achievement(uuid, timestamptz, timestamptz)` — Achievement Facts Runtime
- File: `supabase/migrations/20260624_phase2_achievement_runtime.sql`

### Architecture Decision
- Achievement Runtime returns raw facts only (E01-E04)
- `excluded_events` added to distinguish "no achievement" from "broken data"
- No percentages, scores, rankings, targets in this layer

### Verification
- Tested Omar (REP003), WRQ1006 on June (default) and May ranges

#### Cross-Validation Results
| Test | Event View | Runtime | Status |
|---|---|---|---|
| Omar May — sales | 525,638.60 | 525,638.60 | ✅ |
| Omar May — orders | 3 | 3 | ✅ |
| Omar Jun — visits | 15 | 15 | ✅ |
| WRQ1006 May — sales | 82,465.80 | 82,465.80 | ✅ |
| WRQ1006 May — orders | 13 | 13 | ✅ |
| WRQ1006 total — customers | 2 | 2 | ✅ |

#### Excluded Events Verified
- Omar: 8 excluded (all NULL `delivered_at`) — 7 with `owner_id = identity_id`, 1 with `owner_id = employee_id`
- WRQ1006: 0 excluded (all data clean)

#### Confirmed
- Runtime reads from Event Views only, not Layer 1a
- 100% match between Runtime output and Event Views
- excluded_events provides transparency for broken data
- Distinction between "no achievement" (KPI=0, Excluded=0) and "broken data" (KPI=0, Excluded>0) works

---

## 2026-06-24 — Screens + Runtimes for Sales Rep, Manager, Admin

### Added SQL Functions
- `runtime.get_activity(uuid, timestamptz, timestamptz)` — Activity Facts Runtime (A01-A04)
  - Time filter: day/week/month/custom period
  - Returns: registered_customers, created_orders, completed_visits, recorded_collections
- `runtime.get_achievement_with_targets(uuid, int, int)` — Achievement + Targets (E01-E04 + target/remaining/pct)
  - Each KPI independent: no composite score, no ranking
- `runtime.get_team_achievement(uuid, int, int)` — Team view for managers/admins
  - When manager_id = NULL: returns all company employees
  - Drill-down to individual rep achievement
- `runtime.get_hierarchy(uuid)` — Full org tree via recursive CTE
- File: `supabase/migrations/20260624_salesrep_screens_runtime.sql`

### Added React Screens
- `src/pages/sales-rep/SalesRepActivity.tsx` — `/runtime/activity`
  - Time filter: يوم | أسبوع | شهر | فترة مخصصة
  - Shows: العملاء المسجلون, الطلبات المنشأة, الزيارات المكتملة, التحصيلات
  - Shows excluded events
  - Source annotation: Runtime V2
- `src/pages/sales-rep/SalesRepAchievement.tsx` — `/runtime/achievement`
  - Monthly filter
  - Shows per KPI: الهدف, المنجز, المتبقي, نسبة التحقيق
  - Each KPI independent (no composite)
- `src/pages/sales-manager/TeamAchievement.tsx` — `/runtime/team-achievement`
  - Company-wide view (sorted by sales DESC)
  - Drill-down to individual rep with achievements + targets
  - Summary row with totals

### Hierarchy (Same Source of Truth)
| Level | Access |
|---|---|
| Rep | Self only via `/runtime/activity` + `/runtime/achievement` |
| Sales Manager | Full team via `/runtime/team-achievement` + drill-down |
| Upper Management | All company employees + drill-down |

### Architecture Decision
- Phase 3 (Targets Runtime), Phase 4 (Metrics Runtime) — **SUSPENDED**
- Priority shifted to working screens over more layers
- All screens consume the same Runtime V2 functions
- No modification to existing old screens/screens

---

## 2026-06-24 (النشر 3) — إعادة هيكلة شاشة المندوب + إزالة Target Runtime

### التغييرات

#### الصفحة الرئيسية (`SalesRepWorkDay.tsx` — `/dashboard`)
- **تم الحذف**: قسم الإنجاز الشهري بالكامل (الأهداف، النسب، Progress Bars، المتبقي)
- **تم الحذف**: قسم الإنجاز اليومي (مبيعات منجزة، طلبات مسلمة، زيارات مكتملة)
- **تم التعديل**: النشاط اليومي ← 4 بطاقات حقائق فقط: قيمة المبيعات، الطلبات، الزيارات، العملاء الجدد
  - المصدر: `orders.created_at` (إجمالي قيمة الطلبات المنشأة اليوم)
  - لا توجد أهداف، لا توجد نسب، لا يوجد متبقي
- **تم الحذف**: زر "الأهداف" من الإجراءات السريعة

#### شاشة الإنجاز (`SalesRepAchievement.tsx` — `/runtime/achievement`)
- **تمت الإضافة**: فلاتر الفترات الزمنية (اليوم / أمس / الأسبوع / الشهر / فترة مخصصة)
- **تمت الإضافة**: بطاقة مطابقة البيانات (Reconciliation Card)
  - تعرض لكل KPI: الإنجاز | المستبعد | الإجمالي | الحالة
  - المعادلة: Activity = Achievement + Excluded
  - ✅ إذا كان المستبعد = 0، 🔴 إذا > 0

#### شاشة النشاط (`SalesRepActivity.tsx` — `/runtime/activity`)
- بدون تغيير — كانت تعمل بشكل صحيح (حقائق فقط)

#### إزالة Target Runtime بالكامل
- **تم الإزالة**: Route `/target-runtime` من `routes/index.tsx`
- **تم الإزالة**: زر "الأهداف" من BottomNav
- **تم الإزالة**: جميع روابط target-runtime من:
  - `ModuleLauncherPage.tsx`
  - `UpperManagementDashboard.tsx`
  - `CommandCenterPage.tsx`
  - `ModuleWorkspacePage.tsx`
  - `SalesManagerCCPage.tsx`
- **تم التعديل**: `TargetSeedTool.tsx` ← توجيه Back إلى Dashboard

### الملفات المتأثرة
| الملف | التغيير |
|---|---|
| `src/pages/sales-rep/SalesRepWorkDay.tsx` | حذف الإنجاز الشهري واليومي، تحديث النشاط اليومي، حذف زر الأهداف |
| `src/pages/sales-rep/SalesRepAchievement.tsx` | إضافة فلاتر الفترات + بطاقة المطابقة |
| `src/routes/index.tsx` | إزالة route target-runtime |
| `src/components/shared/BottomNav.tsx` | إزالة زر الأهداف |
| `src/pages/dashboard/ModuleLauncherPage.tsx` | إزالة رابط target-runtime |
| `src/pages/dashboard/UpperManagementDashboard.tsx` | إزالة رابط target-runtime |
| `src/pages/command-center/CommandCenterPage.tsx` | تغيير مسار targets |
| `src/pages/command-center/ModuleWorkspacePage.tsx` | إزالة رابط target-runtime (مرتين) |
| `src/pages/sales-manager/SalesManagerCCPage.tsx` | إزالة زر التارجت |
| `src/pages/admin/TargetSeedTool.tsx` | توجيه Back ← Dashboard |

### المفهوم المعتمد: Pending ≠ Broken Data
- **Activity** = ما قام به المندوب (أوامر منشأة، عملاء مسجلين) — حقائق مجردة
- **Achievement** = ما تم تسليمه فعلياً (أوامر مسلمة، عملاء أول طلب) — حقائق الإنجاز
- **Pending** = Activity − Achievement = أعمال قيد الانتظار (ليست خطأ)
- **Excluded** = بيانات مكسورة فقط (delivered_at=NULL, owner_id=NULL, customer_id=NULL)
- المعادلة: `Activity = Achievement + Pending` لكل مؤشر
- `Excluded` يُحتسب داخل طبقة الإنجاز فقط (Delivered Total = Achieved + Excluded)

### Commits
- `5830cc5` — Rework: remove monthly achievement, remove target-runtime, add period filters
- `68c805b` — Add reconciliation card to achievement page with health status
- `2aa358a` — Changelog: document removal of target-runtime, add reconciliation card

### إثبات المعادلة — عمر محسن (يونيو 2026)
| المقياس | Activity (نشاط) | Achievement (إنجاز) | Pending (قيد الانتظار) | Diff | الحالة |
|---|---|---|---|---|---|
| الطلبات | 9 | 8 | 1 | 0 | ✅ 9 = 8 + 1 |
| المبيعات | 1,493,551.68 | 1,296,057.08 | 197,494.60 | 0.00 | ✅ |
| العملاء | 9 | 5 | 4 | 0 | ✅ 9 = 5 + 4 |

### إثبات المعادلة — الشركة كلها (يونيو 2026)
| المقياس | Activity | Achievement | Pending | Diff | الحالة |
|---|---|---|---|---|---|
| الطلبات | 47 | 10 | 37 | 0 | ✅ |
| المبيعات | 3,004,101.11 | 1,317,512.21 | 1,686,588.90 | 0.00 | ✅ |
| العملاء | 118 | 6 | 112 | 0 | ✅ |

### Excluded = 0 (الشركة كلها)
| نوع الكسر | العدد |
|---|---|
| delivered بدون delivered_at | 0 ✅ |
| owner_id مفقود | 0 ✅ |
| customer_id مفقود | 0 ✅ |
| زيارات مكسورة | 0 ✅ |
| عملاء بدون بيانات | 0 ✅ |

### الخلاصة
**Runtime V2 معتمد نهائياً** — كل المعادلات محققة، لا يوجد كسر في البيانات.
- Activity و Achievement يقرأان من مصدرين مختلفين (Orders جدول vs Event Views)
- Pending = فرق طبيعي بين الإنشاء والتسليم
- Excluded = 0 ← لا توجد بيانات تالفة
| المقياس | الإجمالي | الإنجاز | المستبعد | الفرق |
|---|---|---|---|---|
| المبيعات | 1,317,512.21 | 1,317,512.21 | 0 | ✅ 0.00 |
| الطلبات | 10 | 10 | 0 | ✅ 0 |
| الزيارات | 144 | 144 | 0 | ✅ 0 |
| العملاء | 118 | 118 | 0 | ✅ 0 |
| **الحالة** | | | | **CLEAN** |

### الرابط
`https://ahram-distribution.github.io/store/dashboard`

---

## 2026-06-24 (النشر 4) — شاشات موحدة لنشاط وإنجاز الفريق

### ملخص التغيير
إزالة شاشات المندوب المنفصلة (SalesRepActivity, SalesRepAchievement) وشاشة فريق الإنجاز القديمة (TeamAchievement). استبدالها بشاشتين موحدتين تعملان لجميع الصلاحيات (مندوب/مدير/إدارة عليا).

### التغييرات

#### SQL — RPC جديد ومعدّل
| RPC | الحالة | الوصف |
|-----|--------|-------|
| `public.get_runtime_team_activity` | ✅ جديد | نشاط الفريق/الشركة — `p_manager_employee_id=NULL` = الكل، `=id` = فريق المدير |
| `runtime.get_team_activity` | ✅ جديد | التنفيذ الداخلي — تجميع منفصل لكل مقياس (لا Cross-Join) |
| `public.get_runtime_achievement` | ✅ معدّل | يقبل `p_date_from/p_date_to` إضافة إلى `p_month/p_year` |
| `runtime.get_achievement_with_targets` | ✅ معدّل | دعم الفلاتر الزمنية المرنة (اليوم/أمس/الأسبوع/الشهر/مخصصة) |
| `public.get_runtime_team` | ✅ معدّل | يقبل `p_date_from/p_date_to` + يعيد target/remaining/percentage لكل موظف |
| `runtime.get_team_achievement` | ✅ معدّل | دعم الفلاتر الزمنية + أهداف كل موظف — يستخدم Subqueries منفصلة لتجنب تضخيم Cross-Join |

#### إصلاح خطأ Cross-Join
**المشكلة**: `runtime.get_team_achievement` القديمة كانت تستخدم JOIN متعددة على نفس الفريق (orders LEFT JOIN visits LEFT JOIN customers)، مما يضاعف `SUM(total_amount)` بعدد الزيارات × العملاء.

**مثال**: عمر محسن — 8 طلبات × 17 زيارة × 9 عملاء = 1,224 صف → `SUM` = 1,296,057 × 153 = 198,296,733.24 ❌

**الحل**: Subqueries منفصلة لكل مقياس (order_stats, visit_stats, customer_stats) ثم LEFT JOIN إلى الفريق — كل مقياس يُحسب مرة واحدة فقط.

#### شاشات الواجهة
| المسار | المكون | الوصف |
|--------|--------|-------|
| `/runtime/activity` | `TeamActivity.tsx` | مندوب: نشاطي. مدير: نشاط الفريق. إدارة: نشاط الشركة + نزول |
| `/runtime/achievement` | `TeamAchievement.tsx` | مندوب: إنجازي + أهداف + تسوية. مدير/إدارة: جدول مع أهداف + نزول |

#### دور المستخدم — نفس الشاشة
| الصلاحية | نشاط الفريق | إنجاز الفريق |
|----------|-------------|-------------|
| مندوب | 4 بطاقات نشاط فقط | 4 بطاقات + أهداف + تسوية |
| مدير بيع | إجمالي الفريق + جدول أفراد + نزول للمندوب | إجمالي + جدول مع target/remaining/pct + نزول |
| إدارة عليا | إجمالي الشركة + جدول مديرين + نزول | إجمالي الشركة + جدول بأهداف + نزول لمدير ← مندوب |

#### فلاتر موحدة
- اليوم / أمس / الأسبوع / الشهر / فترة مخصصة — نفس الـ 5 فلاتر في كلتا الشاشتين
- الإنجاز يستخدم الشهر لتحديد الهدف (monthly target) بينما الفلتر الزمني يحدد نطاق الإنجاز المحقق

### الملفات
| الملف | الحالة |
|-------|--------|
| `src/pages/TeamActivity.tsx` | ✅ جديد |
| `src/pages/TeamAchievement.tsx` | ✅ جديد |
| `src/routes/index.tsx` | 🔄 تعديل — إزالة `SalesRepActivity` ← `TeamActivity`، إزالة `TeamAchievement` القديم، إزالة `/runtime/team-achievement` |
| `src/pages/sales-rep/SalesRepActivity.tsx` | ⬆️ لم يعد مستورداً (يحتفظ به للرجوع) |
| `src/pages/sales-rep/SalesRepAchievement.tsx` | ⬆️ لم يعد مستورداً |
| `src/pages/sales-manager/TeamAchievement.tsx` | ⬆️ لم يعد مستورداً |
| `docs/WIREFRAME_TEAM_SCREENS.md` | ✅ جديد — توثيق التصميم |

### الأكواد (Commits)
| Commit | الوصف |
|--------|-------|
| `679d151` | Unified team screens: TeamActivity + TeamAchievement |

### الرابط
`https://ahram-distribution.github.io/store/dashboard` (يتطلب تسجيل دخول)

---

## 2026-06-24 (النشر 5) — الهيكل الهرمي + أزرار التنقل + manager_id

### ملخص التغيير
إصلاح هيكل شاشات الشركة لتعرض المديرين أولاً (وليس كل الموظفين مباشرة)، مع إضافة `manager_id` إلى مخرجات RPC وإضافة أزرار التنقل من لوحة القيادة.

### التغييرات

#### SQL — إضافة manager_id إلى RPCs
| RPC | التغيير |
|-----|---------|
| `runtime.get_team_activity` | إضافة `manager_id` إلى كل سجل |
| `runtime.get_team_achievement` | إضافة `manager_id` إلى كل سجل |

#### شاشة النشاط (`TeamActivity.tsx`)
- **الإدارة العليا**: تعرض صفوف المديرين أولاً (مجمعة حسب `manager_id` مع إجماليات الفريق)، كل مدير ← نزول لأفراد الفريق ← نزول للمندوب
- **المدير**: يعرض فريقهم المباشر فقط ← نزول للمندوب
- **المندوب**: يعرض نشاطه الخاص فقط (4 بطاقات)

#### شاشة الإنجاز (`TeamAchievement.tsx`)
- إعادة كتابة كاملة بنفس الهيكل:
  - **الإدارة العليا**: صفوف المديرين مع أهداف/إنجاز مجمعة
  - **المدير**: فريقهم مع أهداف فردية لكل KPI (نسبة + شريط + قيمة)
  - **المندوب**: 4 بطاقات إنجاز مع الهدف/المتبقي/النسبة/شريط التقدم
- أدوات تحكم الشهر/السنة

#### أزرار التنقل (`ModuleLauncherPage.tsx`)
- **مركز القيادة**: إضافة `نشاط الشركة` ← `/runtime/activity` و `إنجاز الشركة` ← `/runtime/achievement`

### الملفات
| الملف | التغيير |
|-------|---------|
| `src/pages/TeamActivity.tsx` | 🔄 هيكل هرمي (إدارة ← مديرين ← فريق ← مندوب) |
| `src/pages/TeamAchievement.tsx` | 🔄 هيكل هرمي مع أهداف/KPI/أشرطة تقدم |
| `src/pages/dashboard/ModuleLauncherPage.tsx` | 🔄 أزرار نشاط الشركة + إنجاز الشركة |
| `docs/08-CHANGELOG/RUNTIME_V2_CHANGELOG.md` | 🔄 هذا الإدخال |

---

## 2026-06-24 — Phase 1: Event Views

### Added
- Schema `runtime` — Runtime v2 layer
- Schema `runtime_event_views` — Event Views layer
- 5 Event Views:
  - `customer_registered_events` — A01
  - `order_created_events` — A02
  - `order_delivered_events` — E01/E02
  - `visit_completed_events` — A03/E03
  - `collection_recorded_events` — A04
- File: `supabase/migrations/20260624_phase1_event_views.sql`

### Schema Corrections (from initial assumptions)
| Assumption | Reality | Fix |
|---|---|---|
| `customers.created_by` exists | No `created_by` in customers | Use `owner_id` (references employees.id) |
| `visits.is_completed` column | No `is_completed` | Use `status = 'completed'` |
| `visits.check_in_time` / `check_out_time` | Columns are `check_in_at` / `check_out_at` | Corrected column names |
| `collections.collection_date` | Column is `collected_at` | Corrected |
| `collections.payment_type` | Column is `method` | Corrected |

### Verified
- 41 raw delivered → 33 valid → 33 in view
- 8 NULL `delivered_at` excluded (Omar's orders)
- 134/134 completed visits valid
- Collections: 0 data in system

---

## 2026-06-24 — Phase 0: Data Integrity Rules

### Added
- `docs/EVENT_INTEGRITY_RULES_V1.md` — Integrity rules for all 5 event types
- `docs/DATA_HEALTH_RUNTIME_V1.md` — 13 health checks (HC01-HC13)
- Rule: Invalid events do NOT enter Event Views; they DO appear in Data Health Runtime

### Key Finding
- HC01: 8 orders with `status='delivered'` but NULL `delivered_at` — all Omar Mohsen (REP003)
- 7 of these have `owner_id = Omar's identity_id` (not employee_id)
- 1 has `owner_id = Omar's employee_id` (21060)
- Total invisible value: 1,296,057.08 EGP
