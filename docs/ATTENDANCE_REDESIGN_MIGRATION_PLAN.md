# ATTENDANCE_REDESIGN_MIGRATION_PLAN

**يُشتق من:** ATTENDANCE_REDESIGN_SPEC.md  
**تاريخ:** 12 June 2026  
**الحالة:** مسودة — تنتظر الاعتماد النهائي قبل التنفيذ  
**اللغة:** عربي للمحتوى + إنجليزي للمصطلحات التقنية

> **⚠️ تنبيه:** لا يُنفَّذ أي من المحتوى التالي حتى اعتماد هذه الوثيقة صراحة.

---

## المحتويات

1. [Database Changes](#1-database-changes)
2. [RPC Changes](#2-rpc-changes)
3. [Frontend Changes](#3-frontend-changes)
4. [Route Impact](#4-route-impact)
5. [Data Migration Impact](#5-data-migration-impact)
6. [Rollout Plan](#6-rollout-plan)
7. [Risk Analysis](#7-risk-analysis)
8. [Decision Checklist — النهائي](#8-decision-checklist--النهائي)
9. [Productivity Ledger — التصميم الموسّع](#9-productivity-ledger--التصميم-الموسّع)
10. [EmployeeDayMapPage — Wireframe تفصيلي](#10-employeedaymappage--wireframe-تفصيلي)
11. [Work Hours Ledger — الحساب لكل Schedule Type](#11-work-hours-ledger--الحساب-لكل-schedule-type)

---

## 1) Database Changes

### 1.1 التغييرات الإجبارية (Must Do)

| # | ملف التغيير | التفاصيل | DDL |
|---|------------|----------|-----|
| 1 | **جدول جديد: `employee_work_policies`** | سياسة عمل لكل موظف: مكان العمل + نوع الدوام + متطلبات التتبع + ساعات الدوام + وقت الدوام | `CREATE TABLE` مع `UNIQUE INDEX` على `employee_id` |
| 2 | **عمود جديد: `work_policy_id` في `workday_sessions`** | FK إلى `employee_work_policies` — يُملأ عند `start_workday` لتجميد السياسة وقت بدء الجلسة | `ALTER TABLE ADD COLUMN` |

#### الجدول الجديد بالتفصيل

```sql
CREATE TABLE IF NOT EXISTS public.employee_work_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,

    -- البعد الأول: مكان العمل
    work_location varchar(20) NOT NULL DEFAULT 'field'
        CHECK (work_location IN ('field', 'office')),

    -- البعد الثاني: نظام الدوام
    schedule_type varchar(20) NOT NULL DEFAULT 'flexible'
        CHECK (schedule_type IN ('fixed_shift', 'flexible', 'hourly')),

    -- التتبع
    tracking_required boolean NOT NULL DEFAULT true,

    -- ساعات العمل
    required_daily_hours decimal(4,2) NOT NULL DEFAULT 8.00,
    shift_start time,              -- مهم لـ fixed_shift فقط
    shift_end time,                -- مهم لـ fixed_shift فقط
    grace_minutes integer NOT NULL DEFAULT 0,

    -- Metadata
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_emp_work_policy ON public.employee_work_policies (employee_id);
```

#### العمود المضاف إلى `workday_sessions`

```sql
ALTER TABLE public.workday_sessions
    ADD COLUMN work_policy_id uuid REFERENCES public.employee_work_policies(id);
```

### 1.2 التغييرات الاختيارية (اختيارك: لا حذف حتى إشعار آخر)

بناءً على قرارك بعدم حذف أي شيء حالياً، التغييرات الاختيارية التالية **مؤجَّلة**:

| # | العنصر | نوع التغيير | الإجراء المقترح | مصيرها حالياً |
|---|--------|-------------|----------------|---------------|
| 3 | `visit_links` | جدول (0 records) | حذف | **مؤجَّل** — لا حذف |
| 4 | `detect_long_stops` | RPC (غير مستخدم) | حذف | **مؤجَّل** — لا حذف |
| 5 | `get_attendance_analysis` | RPC (V1 مكرر) | حذف | **مؤجَّل** — لا حذف |
| 6 | `get_employee_current_location` | RPC (V1 مكرر) | حذف | **مؤجَّل** — لا حذف |

### 1.3 ما الذي لن يتغير إطلاقاً

| الجدول | ملاحظات |
|--------|---------|
| `workday_sessions` | يضاف إليه عمود واحد فقط (`work_policy_id`) — لا تغيير في البنية أو المفاتيح |
| `workday_breaks` | لا تغيير |
| `tracking_points` | لا تغيير — تبقى كاملة إلى الأبد حالياً |
| `workday_settings` | لا تغيير |
| `employees` | لا تغيير (الـ Policy في جدول منفصل) |
| `employee_monthly_targets` | لا تغيير — نظام الأهداف قائم وجاهز |
| `performance_weights_config` | لا تغيير |
| `employee_weight_overrides` | لا تغيير |
| `orders` | لا تغيير |
| `visits` | لا تغيير |
| `collections` | لا تغيير |
| كل جداول النظام الأخرى | لا تتأثر |

### 1.4 ملخص التغيير في قاعدة البيانات

| البند | العدد |
|-------|-------|
| جداول جديدة | 1 (`employee_work_policies`) |
| أعمدة جديدة | 1 (`work_policy_id` في `workday_sessions`) |
| جداول محذوفة | 0 (مؤجَّل) |
| RPCs محذوفة | 0 (مؤجَّل) |
| جداول متأثرة بدون تغيير هيكلي | 0 |

### 1.5 تصنيف Work Policy — كيف نملأ السياسات الحالية؟

بناءً على طلبك "لا تجعل القيم الافتراضية field + flexible + tracking_required=true للجميع"، هذه هي خطة التصنيف والملء:

#### خوارزمية التصنيف التلقائي للموظفين الحاليين

| الفئة | معيار التصنيف | work_location | schedule_type | tracking_required | required_daily_hours |
|-------|--------------|---------------|---------------|-------------------|---------------------|
| **مندوب ميداني** | لديه زيارات (visits) أو طلبات (orders) في آخر 30 يوماً | `field` | `flexible` | `true` | 8.00 |
| **مندوب ميداني دوام ثابت** | لديه زيارات + start_workday قبل 10:00 بانتظام | `field` | `fixed_shift` | `true` | 8.00 (shift_start/shift_end من workday_settings أو 09:00-17:00) |
| **موظف مكتبي** | ليس لديه زيارات/طلبات + Tracking_points = 0 | `office` | `fixed_shift` | `false` | 8.00 |
| **موظف مكتبي مرن** | ليس لديه زيارات/طلبات + ساعات متغيرة | `office` | `flexible` | `false` | 8.00 |
| **غير مصنَّف** | موظف جديد أو لا توجد بيانات كافية | `field` | `flexible` | `false` | 8.00 |

#### لماذا tracking_required=false للموظفين غير المصنَّفين؟

بدلاً من تفعيل التتبع للجميع بشكل أعمى (مما قد يُنتج إنذارات انقطاع تتبع خاطئة لموظفين لا يحتاجونه)، نبدأ بـ `tracking_required=false` ثم يُفعِّله المدير يدوياً عند الحاجة.

#### ترتيب التنفيذ

1. **Seed Script تلقائي:** يُصنِّف كل الموظفين حسب الخوارزمية أعلاه
2. **مراجعة المدير:** يُفتح AttendanceSettingsPage بعد التحديث لمراجعة التصنيفات وتعديلها
3. **موظفين جدد مستقبلاً:** عند إضافة موظف جديد → `employee_work_policies` تنشأ تلقائياً بقيم: `field + flexible + tracking_required=false + 8 ساعات` — ويُعدِّلها المدير يدوياً

#### Seed Script — مثال منطقي (وليس SQL تنفيذياً)

```
لكل employee في employees:
    إذا employee لديه visits أو orders في آخر 30 يوماً:
        ← field + flexible + tracking_required=true
        (إذا start_workday قبل 10:00 بانتظام → fixed_shift)
    وإلا إذا employee لديه tracking_points:
        ← field + flexible + tracking_required=true
    وإلا:
        ← office + fixed_shift + tracking_required=false
```

#### مخاطرة التصنيف التلقائي

| المخاطرة | الاحتمال | خطة التخفيف |
|----------|----------|-------------|
| موظف ميداني جديد ليس لديه زيارات بعد → يُصنَّف مكتبي | **منخفض** — الموظف الجديد عادة يكون في تدريب | يُعدِّله المدير يدوياً بعد أول أسبوع |
| موظف مكتبي لديه tracking_points قديمة → يُصنَّف ميداني | **منخفض جداً** — tracking_points لموظف مكتبي نادرة | يُعدِّله المدير يدوياً |
| موظف لديه orders لكنه ليس ميدانياً (مشرف) | **موجود** — بعض المشرفين يسجلون طلبات | يُعدِّله المدير يدوياً إلى office + tracking_required=false |

**الخلاصة:** التصنيف التلقائي هو **اقتراح أولي** وليس تصنيفاً نهائياً. المدير لديه الصلاحية الكاملة لتعديل أي policy عبر AttendanceSettingsPage.

---

## 2) RPC Changes

### 2.1 RPCs جديدة (5)

| # | الـ RPC | التوقيع | الغرض | تخدم |
|---|---------|---------|-------|------|
| 1 | `get_employee_work_policy` | `(p_token uuid, p_employee_id uuid)` | قراءة work policy لموظف واحد | AttendancePage, EmployeeDayMapPage |
| 2 | `upsert_employee_work_policy` | `(p_token uuid, p_employee_id uuid, p_work_location varchar, p_schedule_type varchar, p_tracking_required boolean, p_required_daily_hours decimal, p_shift_start time, p_shift_end time, p_grace_minutes int)` | إنشاء/تحديث policy لموظف | AttendanceSettingsPage |
| 3 | `batch_upsert_work_policies` | `(p_token uuid, p_policies jsonb)` | تعديل جماعي للسياسات (يستقبل array) | AttendanceSettingsPage |
| 4 | `get_daily_target_vs_actual` | `(p_token uuid, p_employee_id uuid, p_date date)` | Target vs Actual ليوم واحد — يُحتسب من monthly_target / أيام الشهر | EmployeeDayMapPage, AttendancePage |
| 5 | `get_employee_multi_day_map` | `(p_token uuid, p_employee_id uuid, p_start_date date, p_end_date date, p_sample_rate int DEFAULT NULL)` | Route + أحداث لفترة زمنية (أيام متعددة) — مع تكثيف النقاط للفترات الطويلة | EmployeeDayMapPage (Multi-Period) |

### 2.2 RPCs ستعاد كتابتها (10)

| # | الـ RPC | النسخة الحالية | التغيير المطلوب | المخاطرة |
|---|---------|---------------|-----------------|----------|
| 1 | `get_my_workday_status` | V1 | **توسيع:** إضافة `today_orders`, `today_sales`, `today_collections`, `today_new_customers`, `daily_target_vs_actual`, `work_location`, `schedule_type` | **منخفضة** — إضافة حقول فقط، لا تغيير في التوقيع |
| 2 | `get_employee_workday_history` | V1 | **V1 → V2:** إضافة governance (`check_capability`), توسيع summary مع composite score، Productivity Ledger، أيام بدون طلبات، مسافة، tracking point count | **متوسطة** — تغيير كامل في التوقيع والمخرجات |
| 3 | `get_live_workday_overview` | V1 | **توسيع:** إضافة فلاتر `tracking_required`, `work_location`, `schedule_type`، إضافة `team_target_vs_actual`، تعديل `connection_status` ليشمل `not_applicable` | **متوسطة** — فلاتر جديدة قد تؤثر على أداء الاستعلام |
| 4 | `get_team_map` | V1 | **تعديل:** إضافة `WHERE tracking_required = true` فقط — الموظف المكتبي لا يظهر على الخريطة + إضافة `work_location` للمخرجات | **منخفضة** — تصفية فقط |
| 5 | `get_workday_report` | V1 | **توسيع:** إضافة حسابات مختلفة حسب `schedule_type` (late/early فقط لـ `fixed_shift`)، إضافة `target_vs_actual`، مسافة فقط لـ `tracking_required = true` | **متوسطة** — تغيير في منطق الحساب |
| 6 | `get_employee_day_timeline` | V2 (موجود) | **توسيع:** إضافة `orders`, `collections`, `new_customers`, `long_stops` كأحداث في الـ Timeline | **منخفضة** — إضافة events فقط |
| 7 | `get_alerts` | V1 | **إعادة كتابة كاملة:** ديناميكي — يُحتسب 10 أنواع تنبيه من البيانات الحالية (لا حاجة لجدول `operational_alerts`) | **متوسطة** — منطق جديد كلياً |
| 8 | `start_break` | V1 | **إضافة CHECK:** رفض إذا كان هناك break مفتوح (`ALREADY_ON_BREAK`) | **منخفضة** — إضافة validation |
| 9 | `end_break` | V1 | **إضافة CHECK:** رفض إذا break_id غير موجود أو مغلق (`BREAK_NOT_FOUND`, `ALREADY_CLOSED`) | **منخفضة** — إضافة validation |
| 10 | `start_workday` | V1 | **إضافة قراءة policy:** قراءة `employee_work_policies` للموظف + تخزين `work_policy_id` في `workday_sessions` عند بدء الجلسة | **منخفضة** — إضافة قراءة من جدول جديد |

### 2.3 RPCs ستبقى بدون تغيير (13)

| # | الـ RPC | ملاحظات |
|---|---------|---------|
| 1 | `end_workday` | لا تغيير — ينهي الجلسة فقط |
| 2 | `sync_tracking_points` | لا تغيير — جاهز لاستقبال Batch من Tracking Engine مع `captured_at` |
| 3 | `get_workday_settings` | لا تغيير |
| 4 | `update_workday_settings` | لا تغيير |
| 5 | `get_employee_detail` | لا تغيير — V2 جيد مع `last_location` |
| 6 | `get_employee_day_map` | لا تغيير — V2 جيد مع Haversine + stops + visits |
| 7 | `cleanup_tracking_data` | لا تغيير |
| 8 | `auto_cleanup_tracking_data` | لا تغيير — يبقى no-op (لا يحذف tracking_points) |
| 9-17 | 9 Target RPCs | لا تغيير — `get_governed_target_performance`, `get_employee_targets`, إلخ. كاملة وجاهزة |

### 2.4 ملخص تغيير الـ RPCs

| الفئة | العدد |
|-------|-------|
| RPCs جديدة | 5 |
| RPCs معدلة | 10 |
| RPCs بدون تغيير | 13 |
| RPCs محذوفة | 0 (مؤجَّل) |
| **المجموع** | **28** |

---

## 3) Frontend Changes

### 3.1 Services

| الملف | الحالة | التغيير |
|-------|--------|---------|
| `src/services/attendance.ts` | **موسَّع** | إضافة دوال: `getEmployeeWorkPolicy`, `upsertEmployeeWorkPolicy`, `batchUpsertWorkPolicies`, `getDailyTargetVsActual`, `getAlertsV2`, `getEmployeeMultiDayMap`, `getEmployeeWorkdayHistoryV2` |
| `src/services/trackingEngine.ts` | **جديد** | Tracking Runtime: `setInterval(30s)`, GPS capture, IndexedDB, flush, `visibilitychange`, `beforeunload` |
| `src/services/trackingQueue.ts` | **جديد** | IndexedDB CRUD (`add`, `getAll`, `delete`, `clear`), batch sending (100/دفعة), retry logic |
| `src/services/location.ts` | لا تغيير | `captureLocation()` موجود وجاهز لاستخدام Tracking Engine |
| `src/services/targets.ts` | لا تغيير | نظام الأهداف جاهز |

### 3.2 New Components

| # | المكون | الوظيفة | الخدمة | الحالة |
|---|--------|---------|--------|--------|
| 1 | `TimeRangeFilter` | فلتر زمني موحد (quick dates: اليوم/أمس/7 أيام/هذا الشهر/الشهر السابق + custom range) | — (UI only) | **جديد** |
| 2 | `TargetVsActualBar` | شريط تقدم مع نسبة مئوية + لون (أخضر ≥ 80%، أصفر ≥ 50%، أحمر < 50%) | `getDailyTargetVsActual` | **جديد** |
| 3 | `WorkPolicyBadge` | بطاقة صغيرة تعرض `work_location` (ميداني/مكتبي) + `schedule_type` (دوام ثابت/مرن/بالساعة) | `getEmployeeWorkPolicy` | **جديد** |
| 4 | `AlertsList` | قائمة تنبيهات ديناميكية قابلة للفلترة (حسب النوع، الخطورة، الفريق، الموظف) | `getAlertsV2` | **جديد** |
| 5 | `EmployeeStatusIndicator` | أيقونة الحالة مع لون + نص (🟢 يعمل، 🟡 استراحة، 🔴 انقطاع، ⚪ لم يبدأ، 🏢 مكتبي) | `getLiveWorkdayOverview` | **جديد** |
| 6 | `ProductivityLedgerCard` | **بطاقة الإنتاجية اليومية** — سجل موحد لكل يوم: ساعات + طلبات + زيارات + تحصيلات + عملاء جدد + مسافة + Composite Score + Best/Worst Day | `getEmployeeWorkdayHistoryV2` | **جديد** |
| 7 | `CompositeScoreCard` | بطاقة الـ Composite Score المرجح (Best/Worst Day Analysis) | `getEmployeeWorkdayHistoryV2` | **جديد** |

### 3.3 Pages — التغيير بالتفصيل

#### AttendancePage (`/attendance`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| Work Policy badge | **يُضاف** | عرض work_location + schedule_type في أعلى البطاقة |
| أزرار الإجراءات (بدء/إنهاء/استراحة) | **يبقى** — مع تحسين | إضافة حالة "قيد التتبع" عند tracking_required = true |
| Target vs Actual لليوم | **يُضاف** | شريط تقدم لكل KPI: طلبات، مبيعات، زيارات، تحصيلات، عملاء جدد، ساعات |
| Productivity Ledger المصغَّر | **يُضاف** | بطاقة صغيرة تعرض إنتاجية اليوم: صافي الساعات، المسافة، عدد النقاط |
| Tracking status | **يُضاف** (إذا tracking_required = true) | 🟢 متصل / 🟡 متأخر / 🔴 منقطع + آخر تحديث + زر "عرض مسار اليوم" |
| الخريطة | **يُضاف** (إذا tracking_required = true) | رابط إلى EmployeeDayMapPage للمسار اليومي |
| التصميم العام | **إعادة بناء** | من بطاقة بسيطة إلى مركز إنتاجية يومي متكامل |

#### LiveMonitoringPage (`/attendance/live`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| العدادات السريعة | **إعادة تصميم** | 8 عدادات: يعمل، استراحة، انقطاع، لم يبدأ، مكتبي، تنبيه نشط + Target vs Actual للفريق |
| الخريطة (Leaflet) | **إعادة تصميم** | نقاط خضراء (نشط)، صفراء (استراحة)، حمراء (انقطاع) + Popup غني + Clustering |
| قائمة الموظفين | **إعادة تصميم** | فرز متعدد، فلاتر (فرق، work_location، schedule_type، tracking)، صورة + حالة + مدة + إنتاجية |
| فلتر زمني | لا حاجة | دائماً اليوم الحالي |
| آخر التنبيهات | **يُضاف** | شريط سفلي يعرض آخر 3-5 تنبيهات نشطة |
| Target vs Actual للفريق | **يُضاف** | عدادات عليا تعرض إجمالي أداء الفريق مقابل الهدف |
| TeamMap دمج | **غير مطبَّق** | بناءً على قرارك — TeamMap تبقى مستقلة |

#### TeamMapPage (`/attendance/team-map`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| الخريطة | **يبقى** | Leaflet map مع نقاط الموظفين الميدانيين |
| قائمة الموظفين | **يبقى** — تحسين UI | إضافة معلومات work_location + حالة التتبع |
| Work Policy filter | **يُضاف** | فلتر حسب work_location + schedule_type |
| Target vs Actual للفريق | **يُضاف** | بطاقة صغيرة في أعلى الخريطة |
| EmployeeStatusIndicator | **يُضاف** | لكل موظف في القائمة أو الـ Popup |
| الدمج مع LiveMonitoring | **غير مطبَّق** | تبقى شاشة مستقلة (قرارك) |

#### ReportsPage (`/attendance/reports`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| TimeRangeFilter | **يُضاف** | فلتر زمني موحد: اليوم، أمس، 7 أيام، هذا الشهر، الشهر السابق، مخصص |
| ملخص الفترة | **إعادة بناء** | أيام العمل، صافي الساعات، إجمالي الطلبات والمبيعات والتحصيلات، متوسط يومي، أيام بدون طلبات/زيارات |
| Target vs Actual | **يُضاف** | جدول مقارنة: الهدف vs المنفذ vs النسبة لكل KPI |
| Productivity Ledger | **يُضاف** | دفتر إنتاجية كامل: ساعات + طلبات + زيارات + تحصيلات + عملاء جدد + مسافة |
| جدول الموظفين | **إعادة بناء** | Sortable + فلاتر (work_location, schedule_type, فريق) + كل المؤشرات |
| Work Policy filter | **يُضاف** | فلتر حسب work_location + schedule_type |
| Best/Worst Day | **يُضاف** | لكل موظف: أفضل وأسوأ يوم مع Composite Score |

#### AlertsPage (`/attendance/alerts`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| آلية التنبيهات | **إعادة بناء كاملة** | من V1 ثابت إلى ديناميكي — 10 أنواع تُحتسب من البيانات الحالية |
| فلاتر | **يُضاف** | فلتر حسب: النوع، الخطورة، الفريق، الموظف، الحالة (نشط/مغلق/الكل) |
| قائمة التنبيهات النشطة | **إعادة بناء** | وقت + نوع + خطورة + موظف + وصف + إجراءات (تحقق، عرض مسار، اتصل) |
| قائمة التنبيهات المُغلقة | **يُضاف** | آخر 24 ساعة (للعلم فقط — مغلق تلقائياً أو يدوياً) |
| مستقبلية — Alert History | **التصميم يسمح** | عند إضافة جدول `operational_alerts` مستقبلاً، الفلاتر والـ UI جاهزة للتوسع |

#### HistoryPage (`/attendance/history`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| آلية البحث | **إعادة بناء** | من بحث بـ UUID إلى بحث بـ: الموظف + التاريخ (أو فترة) |
| TimeRangeFilter | **يُضاف** | فلتر زمني موحد |
| Productiviy Ledger للموظف | **يُضاف** | سجل كامل: ساعات + طلبات + زيارات + تحصيلات + عملاء جدد + مسافة |
| قائمة الأيام | **إعادة بناء** | جدول يومي: تاريخ، بداية، نهاية، صافي، طلبات، مبيعات، نقاط، مسافة، Composite Score |
| رابط لكل يوم | **يبقى** | كل يوم → EmployeeDayMapPage |
| ملخص الفترة | **يُضاف** | إجمالي + متوسط + أفضل/أسوأ يوم + مقارنة بالشهر السابق |

#### EmployeeDayMapPage (`/attendance/map/:employeeId/:date`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| Leaflet map + Polyline | **يبقى** | Core logic صحيح — لا تغيير |
| نقط بداية/نهاية | **يبقى** | CircleMarker أخضر/أحمر |
| نقاط زيارات (Marker) | **يبقى** | مع تحسين Popup |
| المسافة + التوقفات | **يبقى** | Haversine + long stop detection |
| Timeline | **يبقى** — توسيع | إضافة أحداث: orders, collections, new_customers, long_stops (بالإضافة إلى sessions/breaks/visits الموجودة) |
| Multi-Period | **يُضاف** | TimeRangeFilter → دعم 7 أيام / شهر / مخصص مع تكثيف النقاط |
| Target vs Actual لليوم | **يُضاف** | بطاقة Target vs Actual بجانب الـ KPI cards |
| Work Policy info | **يُضاف** | عرض policy الموظف (إذا tracking_required = false → إخفاء الخريطة) |
| Productivity Ledger لليوم | **يُضاف** | بطاقة إنتاجية اليوم كاملة |
| زر رجوع ذكي | **يُضاف** | حسب المصدر (Attendance أو LiveMonitoring) |
| تحسين UI للـ Timeline | **ألوان حسب النوع** | أزرق (زيارة)، أخضر (طلب)، بنفسجي (تحصيل)، ذهبي (عميل جديد)، برتقالي (توقف طويل) |

#### AttendanceSettingsPage (`/attendance/settings`)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| تبويب Work Policies | **يُضاف** | جدول إدارة سياسات العمل: employee_id + work_location + schedule_type + tracking_required + required_daily_hours + shift_start + shift_end + grace_minutes |
| تعديل فردي | **يُضاف** | لكل موظف: تعديل policy مباشرة |
| تعديل جماعي | **يُضاف** | Batch: تحديد مجموعة موظفين وتطبيق policy واحدة |
| بحث وفلترة | **يُضاف** | حسب الاسم، الفريق، work_location، schedule_type |
| الإعدادات الحالية | **يبقى** | تبويب الإعدادات العامة不改 |

#### EmployeeProfilePage (`/attendance/profile/:id` — خارج مسار attendance)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| تبويب الحضور | **يُضاف** | Productivity Ledger للموظف: ساعات + طلبات + زيارات + تحصيلات + عملاء جدد + مسافة |
| Work Hours Ledger | **يُضاف** | إجمالي الشهر، متوسط اليوم، أفضل/أسوأ يوم، مقارنة بالشهر السابق |
| Target vs Actual شهري | **يُضاف** | أداء الموظف مقابل أهدافه الشهرية مع نسب الإنجاز |
| Work Policy | **يُضاف** | عرض policy الحالية للموظف |

#### UpperManagementDashboard (خارج مسار attendance)

| العنصر | الحالة | التفاصيل |
|--------|--------|----------|
| Attendance widget | **تحديث** | أخذ Work Policy بالاعتبار: المكتبيون لا يظهرون كـ "connected" أو "lost" |
| تنبيهات حرجة | **يُضاف** | عرض تنبيهات حرجة فقط (غياب، انقطاع تتبع طويل) |

### 3.4 ملخص تغيير Frontend

| الفئة | العدد |
|-------|-------|
| Service files جديدة | 2 (`trackingEngine.ts`, `trackingQueue.ts`) |
| Service files موسَّعة | 1 (`attendance.ts`) |
| Components جديدة | 7 |
| Pages — تحسين تدريجي | 9 |
| Pages — حذف | 0 |
| **إجمالي الصفحات المتأثرة** | **9** |

### 3.5 Time Range Standard — الفلتر الزمني الموحَّد

بناءً على طلبك "توحيد الفلاتر الزمنية في كل شاشات الحضور":

#### الخيارات الإلزامية (موحَّدة عبر كل الشاشات)

| الخيار | القيمة (من - إلى) | الاستخدام |
|--------|-------------------|-----------|
| اليوم | `today 00:00` → `today 23:59` | AttendancePage, EmployeeDayMapPage, LiveMonitoringPage |
| أمس | `yesterday 00:00` → `yesterday 23:59` | ReportsPage, HistoryPage, EmployeeDayMapPage |
| آخر 7 أيام | `today - 7 days` → `today` | ReportsPage, HistoryPage, EmployeeDayMapPage |
| آخر 30 يوم | `today - 30 days` → `today` | ReportsPage, HistoryPage |
| هذا الشهر | `month_start` → `today` | ReportsPage, HistoryPage, EmployeeProfilePage |
| الشهر السابق | `prev_month_start` → `prev_month_end` | ReportsPage, HistoryPage, EmployeeProfilePage |
| نطاق مخصص | `user picks from` → `user picks to` | ReportsPage, HistoryPage, EmployeeDayMapPage |

#### توزيع الفلتر على الشاشات

| الشاشة | الفلتر الموحَّد | ملاحظات |
|--------|----------------|---------|
| AttendancePage | **لا يُعرض** | دائماً اليوم الحالي — لا حاجة لفلتر |
| LiveMonitoringPage | **لا يُعرض** | دائماً اليوم الحالي — لا حاجة لفلتر |
| TeamMapPage | **لا يُعرض** | دائماً اليوم الحالي — لا حاجة لفلتر |
| ReportsPage | ✅ **موحَّد (كل الخيارات)** | فلتر أساسي |
| HistoryPage | ✅ **موحَّد (كل الخيارات)** | فلتر أساسي |
| EmployeeDayMapPage | ✅ **موحَّد (كل الخيارات)** | اليوم افتراضياً، يُغيِّر المستخدم للفترات المتعددة |
| EmployeeProfilePage | ✅ **موحَّد (هذا الشهر / الشهر السابق فقط)** | يظهر افتراضياً بيانات الشهر الحالي |
| AlertsPage | **لا يُعرض** | التنبيهات لحظية — لا حاجة لفلتر زمني (لكن يوجد فلتر نوع/حالة) |

#### التنفيذ

مكون `TimeRangeFilter` واحد يُستخدم في كل الشاشات بنفس الواجهة:

```typescript
interface TimeRangeFilterProps {
  defaultValue?: TimeRangeOption;  // 'today' | 'yesterday' | 'last_7' | 'last_30' | 'this_month' | 'prev_month' | 'custom'
  onChange: (range: { from: Date; to: Date; label: string }) => void;
  showCustom?: boolean;  // true للشاشات التي تدعم custom
}
```

---

## 4) Route Impact

### 4.1 Routes الحالية

| المسار | الصفحة | التغيير |
|--------|--------|---------|
| `/attendance` | AttendancePage | **يبقى** — إعادة بناء المحتوى فقط |
| `/attendance/live` | LiveMonitoringPage | **يبقى** — إعادة تصميم المحتوى فقط |
| `/attendance/team-map` | TeamMapPage | **يبقى** — إعادة تصميم المحتوى (قرارك: يبقى مستقلاً) |
| `/attendance/reports` | ReportsPage | **يبقى** — إعادة بناء المحتوى فقط |
| `/attendance/alerts` | AlertsPage | **يبقى** — إعادة بناء المحتوى فقط |
| `/attendance/history` | HistoryPage | **يبقى** — إعادة بناء المحتوى فقط |
| `/attendance/map/:employeeId/:date` | EmployeeDayMapPage | **يبقى** — إضافة دعم الفترات: `?from=&to=` |
| `/attendance/settings` | AttendanceSettingsPage | **يبقى** — توسيع المحتوى فقط |

### 4.2 Routes الجديدة

| المسار | الصفحة | ملاحظات |
|--------|--------|---------|
| لا يوجد | لا يوجد | جميع Routes موجودة مسبقاً — لا حاجة لمسارات جديدة |

### 4.3 Routes المحذوفة

| المسار | السبب |
|--------|-------|
| لا يوجد | بناءً على قرارك: لا حذف لأي Route |

### 4.4 تغييرات في الـ URL parameters

| الصفحة | التغيير |
|--------|---------|
| `EmployeeDayMapPage` | إضافة `?from=YYYY-MM-DD&to=YYYY-MM-DD` للفترات المتعددة — المسار الأصلي `/map/:employeeId/:date` يبقى للتوافق |

### 4.5 ملخص التغيير في Routes

| الفئة | العدد |
|-------|-------|
| Routes باقية بدون تغيير | 8 |
| Routes جديدة | 0 |
| Routes محذوفة | 0 |
| Routes مع تغيير parameters | 1 (EmployeeDayMapPage — إضافة query params) |

---

## 5) Data Migration Impact

### 5.1 بيانات موجودة ستتأثر

| البيانات | التأثير | الإجراء |
|----------|---------|---------|
| `workday_sessions` الموجودة | **بدون `work_policy_id`** (قبل إضافة العمود) | العمود `work_policy_id` يقبل `NULL` — الجلسات القديمة تبقى بدون policy. هذا مقبول لأن التقارير المستقبلية ستستخدم policy وقت الجلسة. |
| `employees` | **لا تتأثر** | Work policy في جدول منفصل — لا تغيير في `employees` |

### 5.2 Backfill المطلوب

| المهمة | الإجراء | الأولوية | المخاطرة |
|--------|---------|----------|----------|
| تعبئة `employee_work_policies` للموظفين الحاليين | **تلقائي + يدوي:** Seed Script يصنِّف تلقائياً (راجع 1.5)، ثم المدير يُراجع ويُعدِّل عبر AttendanceSettingsPage | **عالية** — ضرورية قبل تشغيل `start_workday` المعدّل | **منخفضة** — النظام يستخدم default policy إذا لم توجد |
| تعبئة `work_policy_id` للجلسات القديمة | **غير مطلوب** — العمود `NULL` مقبول للجلسات السابقة للتصميم الجديد | **غير مطلوب** | لا يوجد |

### 5.3 المخاطر على البيانات الحالية

| المخاطرة | الاحتمال | مستوى الخطورة | خطة التخفيف |
|----------|----------|---------------|-------------|
| فقدان `tracking_points` أثناء التحديث | **مستحيل** — لا تغيير في الجدول | **منخفض** | لا مساس بالجدول |
| فقدان `workday_sessions` | **مستحيل** — إضافة عمود فقط | **منخفض** | `ADD COLUMN` لا يؤثر على البيانات الموجودة |
| `start_workday` يفشل للموظفين بدون policy | **متوسط** — إذا لم تكن policy موجودة | **متوسط** | الحل: `start_workday` يقرأ policy، إذا لم توجد → يستخدم default policy (field + flexible + tracking_required = true + 8 ساعات) |
| تقارير قديمة تختلف بعد التحديث | **متوسط** — `get_workday_report` المعدل قد يحسب valores مختلفة | **منخفض** | الحل: التقارير القديمة تستخدم `work_policy_id = NULL` كـ "قبل التصميم الجديد" ولا تُحتسب لها late/early |

### 5.4 ملخص الهجرة

| البند | التفاصيل |
|-------|----------|
| هل هناك حاجة لـ `ALTER TABLE` على جداول موجودة؟ | نعم — `workday_sessions` يضاف إليه عمود (غير مؤثر على البيانات) |
| هل هناك حاجة لـ `UPDATE` على بيانات موجودة؟ | لا — العمود الجديد يقبل `NULL` |
| هل هناك حاجة لإدخال بيانات أولية؟ | **نعم** — `employee_work_policies` تحتاج بيانات أولية لكل موظف (يدوياً أو عبر seed script) |
| هل هناك خطورة على البيانات الحالية؟ | **منخفضة جداً** — كل التغييرات إضافية، لا حذف أو تعديل لبيانات موجودة |
| هل يمكن العودة (Rollback)؟ | **نعم** — `DROP TABLE employee_work_policies` + `ALTER TABLE workday_sessions DROP COLUMN work_policy_id` (لكن يُفضّل الإبقاء) |

---

## 6) Rollout Plan

### Phase 1 — Database + Work Policy Foundation (اليوم 1-3)

**الهدف:** تجهيز القاعدة + تفعيل Work Policy مع تصنيف ذكي للموظفين الحاليين.

| المهمة | المخرجات | الاختبار |
|--------|----------|----------|
| 1. إنشاء `employee_work_policies` | جدول جديد | `SELECT * FROM employee_work_policies` |
| 2. إضافة `work_policy_id` إلى `workday_sessions` | عمود جديد | `SELECT work_policy_id FROM workday_sessions` |
| 3. Seed Script — تصنيف الموظفين الحاليين (راجع 1.5) | كل موظف لديه policy مصنَّفة تلقائياً | التحقق من صحة التصنيف لكل موظف |
| 4. واجهة AttendanceSettingsPage — تبويب Work Policies | تمكين المدير من مراجعة وتعديل التصنيفات | إضافة/تعديل/بحث policy |
| 5. RPCs جديدة للـ Policy | `get_employee_work_policy`, `upsert_employee_work_policy`, `batch_upsert_work_policies` | استدعاء RPC بـ token صالح |
| 6. تعديل `start_workday` | يقرأ policy ويخزن `work_policy_id` | بدء يوم → التحقق من `work_policy_id` في الجلسة |
| 7. RPCs جديدة للـ Target vs Actual | `get_daily_target_vs_actual` | استدعاء مع employee_id + date |

**المخاطرة:** منخفضة — التغييرات إضافية ولا تؤثر على النظام الحالي. التصنيف التلقائي هو اقتراح أولي وليس نهائياً.

---

### Phase 2 — RPCs Rewrite + Alerts (اليوم 4-8)

**الهدف:** إعادة كتابة RPCs مع الحفاظ على التوافق مع الواجهات الحالية.

| المهمة | المخرجات | الاختبار |
|--------|----------|----------|
| 1. `get_my_workday_status` — توسيع | إضافة today_orders, today_sales, etc. | مقارنة النتيجة مع البيانات الفعلية |
| 2. `get_employee_workday_history` — V2 | Governance + Productivity Ledger | استدعاء مع موظف له سجل |
| 3. `get_live_workday_overview` — توسيع | فلاتر جديدة + team target vs actual | اختبار كل فلتر |
| 4. `get_team_map` — تعديل | filtering tracking_required | موظف مكتبي لا يظهر |
| 5. `get_workday_report` — توسيع | حسابات حسب schedule_type | fixed_shift يظهر late، flexible لا |
| 6. `get_employee_day_timeline` — توسيع | orders + collections + new_customers + long_stops | التحقق من كل نوع حدث |
| 7. `get_alerts` — V2 (ديناميكي) | 10 أنواع تنبيه محسوبة | اختيار شرط لكل نوع والتأكد من حسابه |
| 8. `start_break` + `end_break` — CHECKs | رفض break مكرر/مغلق | محاولة break مزدوج → خطأ |
| 9. RPC جديد: `get_employee_multi_day_map` | Route لفترة زمنية | استدعاء مع 7 أيام → نقاط مكثفة |

**المخاطرة:** متوسطة — بعض RPCs المعدلة قد تغير مخرجاتها (خاصة `get_workday_report` و `get_my_workday_status`). تحتاج اختبار دقيق مع البيانات الحالية.

---

### Phase 3 — Frontend: Services + Components (اليوم 9-12)

**الهدف:** بناء الخدمات والمكونات الجديدة بدون تغيير في الشاشات.

| المهمة | المخرجات | الاختبار |
|--------|----------|----------|
| 1. توسيع `attendance.ts` | دوال جديدة لجميع الـ RPCs الجديدة والمعدلة | استدعاء كل دالة وتحقق من النتيجة |
| 2. إنشاء `trackingEngine.ts` | Tracking Runtime | timer 30s, GPS, IndexedDB |
| 3. إنشاء `trackingQueue.ts` | IndexedDB CRUD + batch send | حفظ نقاط، إرسال، حذف |
| 4. `TimeRangeFilter` component | فلتر زمني موحد | اختبار كل خيار (quick + custom) |
| 5. `TargetVsActualBar` component | شريط تقدم مع لون ونسبة | تغيير القيم والتحقق من اللون |
| 6. `WorkPolicyBadge` component | بطاقة work_location + schedule_type | إظهار كل التركيبات |
| 7. `AlertsList` component | قائمة تنبيهات + فلاتر | اختبار كل فلتر |
| 8. `EmployeeStatusIndicator` component | أيقونة حالة | كل حالة تظهر بشكل صحيح |
| 9. `ProductivityLedgerCard` component | بطاقة إنتاجية متكاملة | عرض بيانات اليوم مع كل المؤشرات |
| 10. `CompositeScoreCard` component | بطاقة Best/Worst Day | حساب Composite Score وعرضه |

**المخاطرة:** منخفضة — المكونات جديدة ولا تؤثر على الشاشات الحالية.

---

### Phase 4 — Frontend: Pages Redesign (اليوم 13-20)

**الهدف:** إعادة تصميم كل الشاشات حسب التصميم الجديد.

| المهمة | المخرجات | الاختبار |
|--------|----------|----------|
| **الأسبوع 1 (اليوم 13-16):** | | |
| 1. AttendancePage — إعادة بناء | مركز إنتاجية يومي | Work Policy + Target vs Actual + tracking status + زر المسار |
| 2. LiveMonitoringPage — إعادة تصميم | مركز عمليات ميدانية | عدادات + خريطة + قائمة + Target vs Actual + تنبيهات |
| 3. TeamMapPage — تحسين | خريطة تفاعلية مستقلة | نقاط + Work Policy filter + EmployeeStatus |
| **الأسبوع 2 (اليوم 17-20):** | | |
| 4. ReportsPage — إعادة بناء | TimeRangeFilter + Productivity Ledger + Target vs Actual + جدول | كل الفلاتر، الفرز، المقارنة |
| 5. AlertsPage — إعادة بناء | AlertsList ديناميكي + فلاتر | 10 أنواع تنبيه، فلترة |
| 6. HistoryPage — إعادة بناء | TimeRangeFilter + EmployeeSearch + Productivity Ledger + سجل يومي | البحث، عرض السجل |
| 7. EmployeeDayMapPage — تحسين | TimeRangeFilter + Multi-Period + Timeline موسّع + Target vs Actual + Productivity Ledger | فترة يوم، 7 أيام، شهر |
| 8. AttendanceSettingsPage — توسيع | تبويب Work Policies Management | إضافة/تعديل/بحث |
| 9. EmployeeProfilePage — توسيع | تبويب حضور مع Productivity Ledger | عرض بيانات الشهر، أفضل/أسوأ يوم |

**المخاطرة:** متوسطة-مرتفعة — أكبر تغيير في المشروع. تحتاج تنسيق مع الـ RPCs الجديدة.

---

### Phase 5 — Tracking Engine Integration + Testing (اليوم 21-23)

**الهدف:** ربط Tracking Engine بالشاشات واختبار شامل.

| المهمة | المخرجات |
|--------|----------|
| 1. ربط Tracking Engine بـ AttendancePage | tracking_required = true → Engine يبدأ مع start_workday ويتوقف مع end_workday |
| 2. Runtime Restore | فتح التطبيق مع يوم نشط → Engine يعيد التشغيل تلقائياً + flush Queue |
| 3. Offline Recovery | قطع الإنترنت → نقاط في IndexedDB → عودة الإنترنت → flush |
| 4. اختبار 10 أنواع Alerts | كل تنبيه يُحتسب بشكل صحيح |
| 5. اختبار آلية العمل لكل schedule_type | fixed_shift: late/early, flexible: ساعات فقط, hourly: حساب دقيق |
| 6. اختبار Multi-Period Map | 7 أيام، شهر، مخصص — نقاط مكثفة، أحداث، مسافة |
| 7. اختبار Timeline التشغيلي | كل الأحداث (orders, collections, new_customers, long_stops) |
| 8. اختبار Productiviy Ledger | كل المؤشرات في بطاقة واحدة، Best/Worst Day, مقارنة شهرية |

**المخاطرة:** متوسطة — مشاكل تكامل بين الـ RPCs الجديدة والـ Frontend.

---

### 6.1 Rollout Summary

| المرحلة | الأيام | المحتوى | المخاطرة |
|---------|--------|---------|----------|
| Phase 1 | 1-3 | Database + Work Policy + AttendanceSettingsPage | **منخفضة** |
| Phase 2 | 4-8 | RPCs Rewrite + Alerts V2 + CHECKs | **متوسطة** |
| Phase 3 | 9-12 | Frontend Services + 7 Components | **منخفضة** |
| Phase 4 | 13-20 | 9 Pages Redesign | **متوسطة-مرتفعة** |
| Phase 5 | 21-23 | Tracking Engine Integration + Full Testing | **متوسطة** |
| **المجموع** | **23 يوماً** | | |

---

## 7) Risk Analysis

### 7.1 مخاطر قاعدة البيانات

| # | المخاطرة | التأثير | الاحتمال | خطة التخفيف |
|---|----------|---------|----------|-------------|
| 1 | `work_policy_id` يبقى `NULL` لجميع الجلسات (إذا لم يُملأ) | التقارير الجديدة لا تعرف policy الجلسة | **متوسط** — يعتمد على ترتيب التنفيذ | الحل: `start_workday` يملأ `work_policy_id` فوراً عند بدء اليوم. الجلسات القديمة تبقى `NULL` وتُعامل كـ "غير معروف" في التقارير |
| 2 | فقدان بيانات `employee_work_policies` (حذف غير مقصود) | تفقد كل الـ policies | **منخفض** — حذف الجدول نادر | الحل: `ON DELETE CASCADE` على `employee_id` فقط — لا يوجد CASCADE من الجدول إلى الجلسات. الجلسات تبقى حتى لو حُذفت الـ policy |
| 3 | تعارض UNIQUE INDEX (`uq_emp_work_policy`) مع محاولة إدراج policy مكررة | خطأ | **منخفض** — التطبيق يستخدم upsert وليس insert | الحل: استخدام `INSERT ... ON CONFLICT DO UPDATE` لضمان upsert |

### 7.2 مخاطر RPCs

| # | المخاطرة | التأثير | الاحتمال | خطة التخفيف |
|---|----------|---------|----------|-------------|
| 4 | RPCs القديمة لا تزال مستخدمة من قبل Frontend الحالي (أثناء التحديث) | كسر في الواجهة الحالية | **متوسط** — أثناء Phase 2 | الحل: استراتيجية "side-by-side" — إصدار V2 من RPCs بإسماء جديدة أو بنفس الاسم مع معاملات إضافية. لا حذف للـ V1 حتى Phase 5 |
| 5 | `get_alerts` V2 (ديناميكي) يستهلك أداء عالياً مع عدد كبير من الموظفين | بطء في تحميل AlertsPage | **منخفض** — عدد الموظفين محدود | الحل: حساب alerts فقط للموظفين النشطين (الذين لديهم session مفتوحة أو بدأوا اليوم) + إضافة LIMIT |
| 6 | `get_live_workday_overview` المعدل يستعلم جداول أكثر (employee_work_policies, employee_monthly_targets) | زيادة وقت الاستجابة | **منخفض** | الحل: استخدام `LEFT JOIN` + فهارس على `employee_id` في كل الجداول |
| 7 | `get_employee_multi_day_map` لفترة شهر قد يُرجع كمية كبيرة من البيانات | بطء في Frontend | **متوسط** — مع عدد كبير من النقاط | الحل: `p_sample_rate` الافتراضي = 30 دقيقة للفترات > 7 أيام — يقلل عدد النقاط |

### 7.3 مخاطر التتبع (Tracking Engine) — توثيق القيود

بناءً على طلبك "توثيق واضح جداً للقيود":

#### ماذا يعمل Tracking Engine؟

| السيناريو | هل التتبع يعمل؟ | ماذا يحدث؟ |
|-----------|----------------|------------|
| التطبيق مفتوح في المقدمة (الشاشة نشطة) | ✅ **نعم** | GPS يلتقط نقطة كل 30 ثانية ← IndexedDB ← يُرسل فوراً |
| المستخدم يفتح تطبيقاً آخر (مثل WhatsApp) ثم يعود خلال دقائق | ⚠️ **مقاطعة مؤقتة** | `visibilitychange` يُشغِّل flush عند العودة. الفقدان: 0-30 ثانية فقط |
| المستخدم يغلق المتصفح أو التبويب | ⚠️ **يتوقف فوراً** | `beforeunload` يحاول flush (قد لا يكتمل). النقاط المحفوظة في IndexedDB آمنة |
| الهاتف مقفول (شاشة سوداء) | ❌ **لا يعمل** | المتصفح يدخل في "سكون" — JS لا ينفذ في الخلفية |

#### ماذا لن يعمل Tracking Engine؟

| السيناريو | لماذا لا يعمل؟ | كم نقطة تُفقد؟ | الحل |
|-----------|---------------|----------------|------|
| المستخدم داخل واتساب لمدة 10 دقائق | المتصفح في الخلفية → JS Timer يتوقف (أو يتباطأ إلى 1% من السرعة) | 0-20 نقطة (حسب دقة المتصفح في تنفيذ timers الخلفية) | عند العودة: `visibilitychange` ← flush كل النقاط المتراكمة |
| المستخدم داخل Google Maps (تطبيق منفصل) لمدة ساعة | التطبيق مقفول تماماً — JS لا ينفذ | كل نقاط الساعة (~120 نقطة) | IndexedDB يحفظ آخر نقطة قبل الدخول في الخلفية. عند العودة: استئناف التتبع + flush |
| المستخدم يغلق المتصفح من الـ Task Manager | لا `beforeunload` — إغلاق قسري | 0-1 نقطة (آخر 30 ثانية كانت في الذاكرة فقط) | IndexedDB يحفظ النقطة فور التقاطها قبل محاولة الإرسال. الحفظ يحدث قبل الإرسال |
| الهاتف مقفول والمستخدم خارج التطبيق لمدة ساعتين | المتصفح "مجمَّد" — لا JS، لا GPS | كل النقاط خلال الساعتين (~240 نقطة) | Runtime Restore: عند فتح التطبيق لاحقاً → `get_my_workday_status` → إذا اليوم نشط → Engine يعيد التشغيل + flush Queue |

#### ملخص أقصى فترة فقدان محتملة

| السيناريو | أقصى فقدان | هل البيانات تضيع للأبد؟ |
|-----------|------------|------------------------|
| التطبيق في الخلفية (visibilitychange يعمل) | **0-30 ثانية** | ❌ لا — flush عند العودة |
| التطبيق مقفول بالكامل (إغلاق قسري) | **0-30 ثانية** | ❌ لا — IndexedDB يحفظ النقاط |
| الهاتف مقفول + تطبيقات أخرى مفتوحة | **كل مدة القفل** | ❌ لا — النقاط لم تُلتقط أصلاً (لا توجد بيانات لتضيع) |
| المتصفح يُغلق فجأة + `beforeunload` لم يعمل | **نقطة واحدة** (آخر 30 ثانية في الذاكرة) | ❌ لا — النقطة الوحيدة التي لم تُحفظ في IndexedBD |
| العودة بعد ساعات من القفل | **كل نقاط فترة القفل** | ❌ لا — لا توجد نقاط أصلاً لأن التتبع لم يعمل |

#### القيد الأهم — توثيق رسمي

```
Tracking Engine في هذه المرحلة:
  - يعمل فقط عندما يكون التطبيق مفتوحاً في المقدمة
  - لا يعمل عندما يكون الهاتف مقفولاً أو المتصفح في الخلفية
  - IndexedDB يضمن عدم فقدان النقاط التي تم التقاطها
  - runtime restore يعيد تشغيل التتبع عند فتح التطبيق لاحقاً

هذا قيد معروف لجميع تطبيقات الويب (PWA) ولا يوجد حل تقني
لتشغيل JavaScript في الخلفية على الهواتف الحديثة.

⚠️ إذا كان التتبع المستمر مطلوباً بغض النظر عن حالة التطبيق →
الحل الوحيد هو تطبيق Native (Android/iOS).
```

#### تأثير هذا القيد على النظام

| التأثير | هل هو مشكلة؟ | التعامل |
|---------|-------------|---------|
| فجوات في Route Map أثناء فترات الخلفية | ✅ مقبول — المسار يظهر "قفزات" بين النقاط | إظهار إشعار "فجوة تتبع" في الـ Timeline |
| انقطاع تتبع لمدة 15 دقيقة → `get_alerts` يُصدر TRACKING_LOST | ✅ هذا متوقع — التنبيه يعمل بشكل صحيح لأنه يكتشف عدم وجود نقاط جديدة | عند عودة المستخدم → اختفاء التنبيه تلقائياً |
| تقارير يومية تظهر نقاطاً أقل من الواقع | ✅ مقبول — المسافة تُحتسب من النقاط الموجودة فقط | إيضاح في التقرير: "تم التقاط X نقطة من Y متوقعة" |

#### مقارنة مع التطبيقات الناتيفية

| الجانب | Tracking Engine (هذا التصميم) | تطبيق Native (مستقبلي) |
|--------|------------------------------|----------------------|
| يعمل في الخلفية | ❌ لا | ✅ نعم |
| يعمل والهاتف مقفول | ❌ لا | ✅ نعم |
| استهلاك البطارية | منخفض (فقط عندما مفتوح) | مرتفع (GPS مستمر) |
| فقدان النقاط | 0-30 ثانية فقط (إذا التقطت) | 0 |
| سهولة التحديث | تلقائي (PWA) | يحتاج App Store update |

### 7.4 مخاطر الواجهة (Frontend)

| # | المخاطرة | التأثير | الاحتمال | خطة التخفيف |
|---|----------|---------|----------|-------------|
| 10 | مستخدم يفتح AttendancePage القديمة (Cache) بعد التحديث | يرى واجهة قديمة مع RPCs جديدة (أو العكس) | **متوسط** — Cache | الحل: إضافة version header في API أو `?v=` في build. توجيه المستخدم لتحديث الصفحة |
| 11 | Alerts ديناميكية — اختفاء التنبيه عند زوال السبب | المستخدم لا يعرف أن تنبيهاً وقع وانتهى | **منخفض** — هذا سلوك متوقع من التصميم الحالي | الحل: في Phase 1 — مقبول. إذا احتجنا تاريخاً → Future Roadmap: جدول `operational_alerts` |
| 12 | تغيير policy موظف في منتصف الشهر | جلسات سابقة مرتبطة بـ policy قديمة وجلسات لاحقة بـ policy جديدة | **مقبول** — هذا هو السلوك المصمَّم | الحل: كل session تخزن `work_policy_id` عند بدئها. التقارير تستخدم policy الـ session وليس policy الحالية — لا التباس |

### 7.5 ملخص المخاطر

| مستوى الخطورة | العدد |
|---------------|-------|
| 🔴 مرتفع | 1 (Tracking Engine في الخلفية) |
| 🟠 متوسط | 5 |
| 🟢 منخفض | 6 |
| **المجموع** | **12** |

---

## 8) Decision Checklist — النهائي

### 8.1 معتمد نهائياً (من ردك الثاني — لا تحتاج إعادة اعتماد)

| # | القرار | الحالة |
|---|--------|--------|
| 1 | ✅ Work Policy جدول جديد (`employee_work_policies`) | معتمد |
| 2 | ✅ الفصل بين `work_location` + `schedule_type` | معتمد |
| 3 | ✅ Tracking اختياري (`tracking_required`) | معتمد |
| 4 | ✅ Productivity Ledger (يحتوي على Composite Score) | معتمد |
| 5 | ✅ Composite Score من الأوزان الموجودة (نظام الأهداف الحالي) | معتمد |
| 6 | ✅ Work Hours Ledger + Net Work Hours كمؤشر أساسي | معتمد |
| 7 | ✅ Target vs Actual في كل الشاشات | معتمد |
| 8 | ✅ Timeline التشغيلي (orders + collections + visits + new_customers + long_stops) | معتمد |
| 9 | ✅ Offline Queue + Recovery (IndexedDB) | معتمد |
| 10 | ✅ Multi-Period Maps (فترات متعددة في EmployeeDayMapPage) | معتمد |
| 11 | ✅ Route Map الكامل (تحسين UI فقط، Core Logic يبقى) | معتمد |
| 12 | ✅ TeamMap يبقى مستقلاً + يُطوَّر | معتمد |
| 13 | ✅ لا حذف لأي شاشة أو Route | معتمد |
| 14 | ✅ Alerts: ديناميكي — Phase 1 مع قابلية إضافة Alert History لاحقاً | معتمد |
| 15 | ✅ تحسين تدريجي (لا إعادة كتابة من الصفر) | معتمد |
| 16 | ✅ الأولوية: Work Policy → RPCs → Components → Attendance Runtime → Pages | معتمد |
| 17 | ✅ أسماء المكونات (TimeRangeFilter, TargetVsActualBar, إلخ) مقبولة | معتمد |
| 18 | ✅ Seed Script مبدئي — مع classification (لا tracking_required=true للجميع) | معتمد |
| 19 | ✅ HistoryPage تبقى مستقلة + إضافة تبويب حضور في EmployeeProfile | معتمد |
| 20 | ✅ Time Range Standard — 7 خيارات موحَّدة عبر كل الشاشات | معتمد |
| 21 | ❌ لا دمج TeamMap مع LiveMonitoring | معتمد |
| 22 | ✅ work_location: ميداني / مكتبي | معتمد |
| 23 | ✅ schedule_type: دوام ثابت / دوام مرن / بالساعة | معتمد |

### 8.2 ما زال يحتاج تأكيداً نهائياً

| # | القرار | الخيارات | ملاحظات |
|---|--------|----------|---------|
| 1 | **EmployeeDayMapPage Wireframe** — هل الترتيب المقترح في Section 10 مناسب؟ | ✅ أوافق / 🔄 تعديل | Wireframe التفصيلي في Section 10 أدناه |
| 2 | **Work Hours Ledger — أمثلة الحساب** — هل الأمثلة الرقمية في Section 11 واضحة؟ | ✅ واضحة / 🔄 تحتاج توضيحاً | أمثلة لكل schedule_type في Section 11 أدناه |
| 3 | **Tracking Engine Limitations** — هل توثيق القيود في Section 7.3 كافٍ وواقعي؟ | ✅ كافٍ / 🔄 يحتاج إضافة | الوثيقة تشرح بوضوح ماذا يعمل وما لا يعمل |
| 4 | **تاريخ بدء التنفيذ** — بعد اعتمادك، متى تريد البدء؟ | ✅ فوراً / 🔄 تاريخ محدد | — |

### 8.3 ملخص القرارات

| الفئة | العدد |
|-------|-------|
| معتمد نهائياً | 23 |
| تحتاج تأكيداً نهائياً | 4 |
| **المجموع** | **27** |

---

## 9) Productivity Ledger — التصميم الموسّع

>> بناءً على طلبك "أريد اعتبار Productivity Ledger جزءاً أساسياً من الرؤية"

### 9.1 المفهوم

Productivity Ledger = تطور لـ Work Hours Ledger من "دفتر ساعات" إلى "دفتر إنتاجية شامل".

لكل يوم:
- ساعات العمل (صافي)
- الطلبات
- الزيارات
- التحصيلات
- العملاء الجدد
- المسافة المقطوعة

### 9.2 الهيكل (Frontend Component فقط — لا جدول جديد)

`ProductivityLedgerCard` هو Component يعرض البيانات (يُحتسب من RPCs الموجودة + الجديدة):

```
┌──────────────────────────────────────────────────┐
│  📋 دفتر الإنتاجية — حسن بكر                     │
│  يونيو 2026                                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────── المؤشرات الشهرية ────────────────────┐ │
│  │  إجمالي ساعات العمل:    157:30   (+12:00) ▲ │ │
│  │  إجمالي الطلبات:        98       (+15)   ▲ │ │
│  │  إجمالي الزيارات:       112      (+20)   ▲ │ │
│  │  إجمالي التحصيلات:      45,000   (+8,000) ▲│ │
│  │  إجمالي العملاء الجدد:  12       (+3)    ▲ │ │
│  │  إجمالي المسافة:        345 كم   (+45)   ▲ │ │
│  └──────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────── متوسط اليوم ─────────────────────────┐ │
│  │  ساعات: 07:09  |  طلبات: 4.5  |  زيارات: 5.1│ │
│  │  تحصيل: 2,045  |  عملاء: 0.5 |  مسافة: 15.7│ │
│  └──────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────── أفضل/أسوأ يوم ────────────────────────┐ │
│  │  🏆 أفضل: 15/06 — 78/100                     │ │
│  │     ساعات: 9:20 | طلبات: 5 | زيارات: 8      │ │
│  │     تحصيل: 3,000 | عملاء: 1 | مسافة: 28 كم   │ │
│  │                                              │ │
│  │  📉 أسوأ: 03/06 — 22/100                     │ │
│  │     ساعات: 4:30 | طلبات: 1 | زيارات: 2      │ │
│  │     تحصيل: 0 | عملاء: 0 | مسافة: 12 كم       │ │
│  └──────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────── مقارنة بالشهر السابق ─────────────────┐ │
│  │  المؤشر      |  هذا الشهر |  السابق |  الفرق │ │
│  │  ساعات       |  157:30    |  145:30  | +8.3% │ │
│  │  طلبات       |  98        |  85      | +15.3%│ │
│  │  زيارات      |  112       |  95      | +17.9%│ │
│  │  تحصيلات     |  45,000    |  38,000  | +18.4%│ │
│  │  عملاء جدد   |  12        |  9       | +33.3%│ │
│  │  مسافة       |  345 كم    |  310 كم  | +11.3%│ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 9.3 مصادر البيانات

| المؤشر | مصدر البيانات | الـ RPC |
|--------|--------------|---------|
| ساعات العمل | `workday_sessions` + `workday_breaks` | `get_employee_workday_history` V2 |
| الطلبات | `orders` | `get_employee_workday_history` V2 |
| الزيارات | `visits` | `get_employee_workday_history` V2 |
| التحصيلات | `collections` | `get_employee_workday_history` V2 |
| العملاء الجدد | `orders` (أول طلب للعميل) | `get_employee_workday_history` V2 |
| المسافة | `workday_sessions.distance_meters` أو محسوب من tracking_points | `get_employee_workday_history` V2 |
| Composite Score | محسوب (الأوزان من نظام الأهداف) | `get_employee_workday_history` V2 |
| مقارنة الشهر السابق | حساب الفرق بين شهرين | `get_employee_workday_history` V2 (مع p_start_date + p_end_date) |

### 9.4 أين يظهر Productivity Ledger؟ — بالتفصيل

#### يومياً (Daily View)

| الشاشة | المحتوى | الحجم | الـ RPC |
|--------|---------|-------|---------|
| **AttendancePage** | إنتاجية اليوم الحالي فقط: ساعات + طلبات + زيارات + تحصيلات + عملاء جدد + مسافة + Target vs Actual + Composite Score | بطاقة متوسطة (أسفل الأزرار) | `get_my_workday_status` (موسَّع) |
| **EmployeeDayMapPage** | إنتاجية اليوم المحدد: نفس المحتوى + Route + Timeline | بطاقة علوية (قبل الخريطة) | `get_daily_target_vs_actual` + `get_employee_workday_history` V2 |

#### شهرياً (Monthly View)

| الشاشة | المحتوى | الحجم | الـ RPC |
|--------|---------|-------|---------|
| **ReportsPage** | **كامل:** إجمالي الشهر لكل مؤشر + متوسط يومي + Best/Worst Day + مقارنة بالشهر السابق | بطاقة كبيرة مع tabs | `get_employee_workday_history` V2 (فترة شهر) |
| **HistoryPage** | **كامل:** لكل موظف: إجمالي الشهر + سجل يومي (جدول) + Best/Worst Day + مقارنة | بطاقة كبيرة + جدول | `get_employee_workday_history` V2 (فترة) |
| **EmployeeProfilePage** | **كامل:** تبويب حضور: إجمالي + متوسط + Best/Worst Day + مقارنة بالشهر السابق | بطاقة كبيرة | `get_employee_workday_history` V2 (شهرين للمقارنة) |

#### المقارنة الشهرية (Month-over-Month)

| أين تظهر؟ | ماذا تظهر؟ |
|-----------|------------|
| ReportsPage | جدول مقارنة لكل مؤشر: هذا الشهر vs الشهر السابق vs الفرق (+/- %) |
| EmployeeProfilePage | نفس الجدول — مع إظهار الاتجاه (▲/▼) |
| HistoryPage | عند اختيار "الشهر السابق" → مقارنة تلقائية مع الشهر الذي قبله |

#### Best / Worst Day

| أين يظهر؟ | ماذا يظهر؟ |
|-----------|------------|
| AttendancePage | غير متاح (يوم واحد فقط — لا يمكن حساب best/worst) |
| ReportsPage | ✅ لكل موظف: التاريخ + Composite Score + تفاصيل ذلك اليوم |
| HistoryPage | ✅ في ملخص الفترة: أفضل يوم + أسوأ يوم مع رابط لكل منهما |
| EmployeeProfilePage | ✅ في تبويب الحضور: بطاقة Best/Worst Day مع Composite Score |
| EmployeeDayMapPage | غير متاح (يوم واحد فقط) |

#### مثال: Best Day في ReportsPage

```
🏆 أفضل يوم: 15/06/2026 — Composite Score: 78/100
  ساعات: 9:20 (117% من 8:00)     ▲
  طلبات: 5 (125% من 4)           ▲
  زيارات: 8 (133% من 6)          ▲
  تحصيل: 3,000 ج.م (120% من 2,500) ▲
  عملاء جدد: 1 (100% من 1)       ✅
  مسافة: 28 كم

📉 أسوأ يوم: 03/06/2026 — Composite Score: 22/100
  ساعات: 4:30 (56% من 8:00)      ▼
  طلبات: 1 (25% من 4)            ▼
  زيارات: 2 (33% من 6)           ▼
  تحصيل: 0 ج.م (0% من 2,500)     ❌
  عملاء جدد: 0 (0% من 1)         ❌
  مسافة: 12 كم
```

### 9.5 لا جدول جديد

Productivity Ledger لا يحتاج جدولاً جديداً — كل البيانات تُحتسب من الجداول الموجودة عبر `get_employee_workday_history` V2. هذا يتوافق مع مبدأ "لا تخزين زائد" ويضمن أن البيانات دائماً محدثة.

### 9.6 ملخص: أين يظهر Composite Score؟

| المكان | Composite Score |
|--------|----------------|
| AttendancePage (يومي) | ✅ يظهر — درجة اليوم الحالي |
| EmployeeDayMapPage (يومي) | ✅ يظهر — درجة اليوم المحدد |
| ReportsPage (شهري) | ✅ يظهر — لكل موظف: أفضل/أسوأ يوم مع Composite Score لكل يوم |
| HistoryPage (فترة) | ✅ يظهر — لكل يوم في الجدول |
| EmployeeProfilePage (شهري) | ✅ يظهر — Best/Worst Day مع Composite Score |
| LiveMonitoringPage | ❌ لا يظهر — شاشة لحظية لا تحتاج تحليلاً تاريخياً |
| TeamMapPage | ❌ لا يظهر — شاشة خريطة فقط |

---

## 10) EmployeeDayMapPage — Wireframe تفصيلي

> بناءً على طلبك "أهم شاشة في النظام — أريد Wireframe تفصيلي قبل التنفيذ"

### 10.1 ترتيب الظهور على الشاشة (من الأعلى للأسفل)

```
┌─────────────────────────────────────────────────────────────────┐
│  [1] HEADER                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  📍 مسار اليوم — حسن بكر                     [🔙 رجوع]     ││
│  │  ميداني | دوام مرن | 8 ساعات | 🟢 يتطلب تتبع              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [2] TIME RANGE FILTER                                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [اليوم] [أمس] [آخر 7 أيام] [هذا الشهر] [الشهر السابق] [مخصص]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [3] PRODUCTIVITY LEDGER + TARGET VS ACTUAL (بطاقة واحدة)       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  📋 إنتاجية اليوم                                   78/100 ││
│  │  ┌────────┬────────┬────────┬────────┬────────┬─────────┐  ││
│  │  │ ساعات  │ طلبات  │ زيارات │ تحصيل  │ عملاء  │ مسافة   │  ││
│  │  │ 08:45  │  5/4   │  8/6   │3,000/  │  1/1   │  28 كم  │  ││
│  │  │ 109%✅ │ 125%✅  │ 133%✅ │2,500✅  │ 100%✅ │         │  ││
│  │  └────────┴────────┴────────┴────────┴────────┴─────────┘  ││
│  │  [📊 عرض كل الإنتاجية → Reports]                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [4] SESSION INFO BAR                                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🟢 بدأ: 09:15  |  🔴 أنهى: 17:30  |  ⏸ استراحة: 00:30   ││
│  │  💪 صافي: 08:45  |  📍 المسافة: 28 كم  |  📌 النقاط: 56   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [5] ROUTE MAP (Leaflet)                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                              ││
│  │  ┌── Leaflet Map ────────────────────────────────────────┐   ││
│  │  │                                                        │   ││
│  │  │   ● بداية (أخضر)                                       │   ││
│  │  │   ─── مسار (Polyline — لون متدرج حسب الزمن)            │   ││
│  │  │   ■ نهاية (أحمر)                                       │   ││
│  │  │   📍 زيارات (Marker)                                   │   ││
│  │  │   ⏸ توقف طويل (أيقونة مثلثة)                           │   ││
│  │  │                                                        │   ││
│  │  │   عند النقر على Marker → Popup:                        │   ││
│  │  │     "زيارة: محل أحمد حسن"                               │   ││
│  │  │     "09:40 - 10:05 (25 دقيقة)"                         │   ││
│  │  │     "[📦 طلب: 1,250 ج.م] [💰 تحصيل: 500 ج.م]"          │   ││
│  │  └────────────────────────────────────────────────────────┘   ││
│  │                                                                ││
│  │  [Toggle: 🗺️ المسار فقط] [📍 مع الزيارات] [⏸ مع التوقفات]     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [6] DETECTED LONG STOPS                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ⏸ توقف طويل: 12:00 - 12:35 (35 دقيقة) — سوبر ماركت النور ││
│  │     [📍 عرض على الخريطة] [🔍 تفاصيل]                        ││
│  │  ⏸ توقف طويل: 14:20 - 15:00 (40 دقيقة) — موقع غير معروف   ││
│  │     [📍 عرض على الخريطة] [🔍 تفاصيل]                        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [7] TIMELINE (تشغيلي)                                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🟢 09:15  بدء يوم العمل                                    ││
│  │     │                                                       ││
│  │  📍 09:40  زيارة: محل أحمد حسن    [📍 عرض على الخريطة]     ││
│  │  📦 10:05  طلب: 1,250 ج.م — أحمد حسن  [📋 تفاصيل الطلب]    ││
│  │  💰 11:10  تحصيل: 500 ج.م — أحمد حسن  [📋 تفاصيل التحصيل]   ││
│  │  🟡 12:00  بداية استراحة                                    ││
│  │  🟢 12:30  نهاية استراحة                                    ││
│  │  📍 12:45  زيارة: سوبر ماركت النور                          ││
│  │  📦 13:20  طلب: 2,300 ج.م                                   ││
│  │  🆕 14:00  عميل جديد: مطعم السلام                           ││
│  │  ⏸ 14:20  توقف طويل (35 دقيقة)  [📍 عرض على الخريطة]       ││
│  │  🔴 16:30  إنهاء يوم العمل                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [8] DAILY SUMMARY (أسفل)                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ملخص اليوم:                                                 ││
│  │  ✅ بدأ في الموعد  |  ✅ أنجز المطلوب  |  ⚠️ استراحة طويلة ││
│  │                                                              ││
│  │  إجمالي المسافة: 28 كم   |   إجمالي النقاط: 56             ││
│  │  إجمالي الزيارات: 8     |   إجمالي الطلبات: 5              ││
│  │  إجمالي التحصيلات: 3,000 ج.م  |  عملاء جدد: 1              ││
│  │  صافي ساعات العمل: 08:45 / 08:00 المطلوبة  ✅ (109%)        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 ماذا يحدث عند تغيير الفترة؟

| الفترة | الخريطة | الـ KPI Cards | الـ Timeline | Target vs Actual |
|--------|---------|---------------|--------------|------------------|
| **اليوم** | كل النقاط (كامل) | إنتاجية اليوم | أحداث اليوم | ✅ يومي |
| **أمس** | كل نقاط أمس | إنتاجية أمس | أحداث أمس | ✅ يومي |
| **7 أيام** | نقاط مكثفة (نقطة/10 دقائق) + Polyline + Clustering | إجمالي 7 أيام + متوسط | كل الأحداث (مرتبة) | ❌ يختفي |
| **شهر** | نقاط مكثفة (نقطة/30 دقيقة) + HeatMap بدلاً من Polyline | إجمالي الشهر + متوسط + Best/Worst | كل الأحداث (مرتبة) مع إجمالي | ✅ شهري |
| **مخصص** | حسب الطول: نقطة/5 دقائق (قصير) أو نقطة/30 دقيقة (طويل) | حسب الفترة | حسب الفترة | حسب الفترة |

### 10.3 ماذا إذا tracking_required = false؟

```
إذا tracking_required = false للموظف المطلوب:
  → [5] ROUTE MAP: لا يظهر — رسالة "هذا الموظف لا يتطلب تتبع"
  → [6] LONG STOPS: لا يظهر — لا توجد نقاط تتبع
  → [4] SESSION INFO: المسافة = "غير مطبَّق"، النقاط = "غير مطبَّق"
  → [3] PRODUCTIVITY LEDGER: يظهر (ساعات + طلبات + زيارات + تحصيلات + عملاء جدد)
  → [7] TIMELINE: يظهر (بدون أحداث تتبع)
```

### 10.4 الشاشة في وضع Multi-Day (7 أيام)

```
عند اختيار "آخر 7 أيام":
  → Header: "مسار 7 أيام — حسن بكر (15-21 يونيو 2026)"
  → الخريطة: نقاط مكثفة + Polyline عريض (يُظهر كل الأيام بلون واحد)
  → الـ KPI Cards: إجمالي 7 أيام + متوسط يومي
  → الـ Timeline: كل الأحداث مرتبة زمنياً عبر الأيام السبعة
  → Target vs Actual: يختفي (لا ينطبق على فترة غير شهرية)
  → Long Stops: مجمَّعة عبر الأيام
  → Daily Summary: يتحول إلى "Weekly Summary"
```

---

## 11) Work Hours Ledger — الحساب لكل Schedule Type

> بناءً على طلبك "توضيح كامل لكيفية الحساب لكل نوع مع أمثلة رقمية حقيقية"

### 11.1 دوام ثابت (fixed_shift)

#### المعادلات

| المؤشر | المعادلة | ينطبق؟ |
|--------|----------|--------|
| **net_hours** | `ended_at - started_at - break_duration` | ✅ دائماً |
| **is_late** | `started_at > shift_start + grace_minutes` | ✅ نعم |
| **late_minutes** | `EXTRACT(EPOCH FROM (started_at - (shift_start + grace_minutes))) / 60` | ✅ إذا is_late |
| **early_departure** | `ended_at < shift_end` | ✅ نعم |
| **early_minutes** | `EXTRACT(EPOCH FROM (shift_end - ended_at))) / 60` | ✅ إذا early_departure |
| **hours_deficit** | `MAX(0, required_daily_hours - net_hours)` | ✅ دائماً |
| **attendance_status** | `CASE WHEN is_late THEN 'late' WHEN early_departure THEN 'early' ELSE 'normal' END` | ✅ |

#### مثال 1: يوم عادي ✅

```
الموظف: أحمد — دوام ثابت 09:00 - 17:00, grace = 15 دقيقة
البيانات:
  started_at  = 09:10 (ضمن grace — ليس late)
  ended_at    = 17:05 (بعد shift_end — ليس early)
  break_start = 12:00, break_end = 12:30 (30 دقيقة)

الحسابات:
  duration      = 17:05 - 09:10 = 7:55 (475 دقيقة)
  break_duration = 30 دقيقة
  net_hours     = 475 - 30 = 445 دقيقة = 7:25

  is_late       = 09:10 > 09:15? → ❌ لا (بالضبط 09:10 ≤ 09:15)
  early_departure = 17:05 < 17:00? → ❌ لا
  hours_deficit = MAX(0, 8:00 - 7:25) = 0:35

الخلاصة:
  ✅ حضر في الوقت
  ✅ غادر بعد الوقت
  ⚠️ ساعات ناقصة 35 دقيقة (استراحة 30 دقيقة + بدأ بعد الدوام بـ 10 دقائق)
```

#### مثال 2: تأخير + انصراف مبكر ❌

```
الموظف: خالد — دوام ثابت 09:00 - 17:00, grace = 0 دقيقة
البيانات:
  started_at  = 09:30 (بعد shift_start بـ 30 دقيقة — late)
  ended_at    = 16:00 (قبل shift_end بـ 60 دقيقة — early)
  break_start = 13:00, break_end = 13:15 (15 دقيقة)

الحسابات:
  duration      = 16:00 - 09:30 = 6:30 (390 دقيقة)
  break_duration = 15 دقيقة
  net_hours     = 390 - 15 = 375 دقيقة = 6:15

  is_late       = 09:30 > 09:00? → ✅ نعم
  late_minutes  = 09:30 - 09:00 = 30 دقيقة
  early_departure = 16:00 < 17:00? → ✅ نعم
  early_minutes = 17:00 - 16:00 = 60 دقيقة
  hours_deficit = MAX(0, 8:00 - 6:15) = 1:45

الخلاصة:
  ❌ تأخر 30 دقيقة
  ❌ انصرف مبكراً 60 دقيقة
  ❌ ساعات ناقصة 1:45 (8:00 - 6:15)
  ⚠️ تنبيهات: LOW_HOURS + (إذا الساعة > 16:00 → NO_START للغد)
```

#### مثال 3: يوم كامل ✅ (مع تجاوز الهدف)

```
الموظف: سامي — دوام ثابت 09:00 - 17:00, grace = 15 دقيقة
البيانات:
  started_at  = 08:50 (قبل shift_start — يعتبر on time)
  ended_at    = 17:30 (بعد shift_end — overtime)
  break       = 30 دقيقة

الحسابات:
  duration      = 17:30 - 08:50 = 8:40 (520 دقيقة)
  net_hours     = 520 - 30 = 490 دقيقة = 8:10

  is_late       = 08:50 > 09:15? → ❌ لا
  early_departure = 17:30 < 17:00? → ❌ لا
  hours_deficit = MAX(0, 8:00 - 8:10) = 0 ✅ (تجاوز الهدف)

الخلاصة:
  ✅ حضر مبكراً
  ✅ غادر متأخراً
  ✅ حقق 8:10 من أصل 8:00 (102%)
```

### 11.2 دوام مرن (flexible)

#### المعادلات

| المؤشر | المعادلة | ينطبق؟ |
|--------|----------|--------|
| **net_hours** | `ended_at - started_at - break_duration` | ✅ دائماً |
| **is_late** | لا يُحتسب | ❌ أبداً |
| **early_departure** | لا يُحتسب | ❌ أبداً |
| **hours_deficit** | `MAX(0, required_daily_hours - net_hours)` | ✅ دائماً |
| **attendance_status** | `CASE WHEN net_hours >= required_daily_hours THEN 'fulfilled' ELSE 'deficit' END` | ✅ |

#### مثال 1: بدأ متأخراً لكن أنجز المطلوب ✅

```
الموظف: حسن — دوام مرن, مطلوب 8 ساعات
البيانات:
  started_at  = 10:00 (لا مشكلة — دوام مرن)
  ended_at    = 19:00
  break       = 12:30 - 13:00 (30 دقيقة)

الحسابات:
  duration      = 19:00 - 10:00 = 9:00 (540 دقيقة)
  net_hours     = 540 - 30 = 510 دقيقة = 8:30
  hours_deficit = MAX(0, 8:00 - 8:30) = 0 ✅

الخلاصة:
  ✅ بدأ في 10:00 — لا مشكلة (دوام مرن)
  ✅ net_hours = 8:30 ≥ 8:00 → حقق المطلوب
  ✅ لا late, لا early — غير مطبقة على flexible
```

#### مثال 2: لم يحقق المطلوب ❌

```
الموظف: محمد — دوام مرن, مطلوب 8 ساعات
البيانات:
  started_at  = 13:00
  ended_at    = 19:00
  break       = 15:00 - 15:15 (15 دقيقة)

الحسابات:
  duration      = 19:00 - 13:00 = 6:00 (360 دقيقة)
  net_hours     = 360 - 15 = 345 دقيقة = 5:45
  hours_deficit = MAX(0, 8:00 - 5:45) = 2:15 ❌

الخلاصة:
  ❌ net_hours = 5:45 < 8:00 → لم يحقق المطلوب
  ❌ hours_deficit = 2:15
  ⚠️ تنبيه: LOW_HOURS (إذا قرب وقت النهاية)
```

#### مثال 3: يوم قصير جداً

```
الموظف: كريم — دوام مرن, مطلوب 8 ساعات
البيانات:
  started_at  = 09:00
  ended_at    = 11:00
  break       = 0

الحسابات:
  net_hours     = 2:00
  hours_deficit = MAX(0, 8:00 - 2:00) = 6:00 ❌❌

الخلاصة:
  ❌ ساعتان فقط من أصل 8 — hours_deficit كبير
  ✅ لا late, لا early — غير مطبقة
  ⚠️ تنبيه: LOW_HOURS + احتمال ABSENCE (إذا لم يسجل start أصلاً)
```

### 11.3 بالساعة (hourly)

#### المعادلات

| المؤشر | المعادلة | ينطبق؟ |
|--------|----------|--------|
| **net_hours** | `ended_at - started_at - break_duration` | ✅ دائماً — الأهم |
| **is_late** | لا يُحتسب | ❌ أبداً |
| **early_departure** | لا يُحتسب | ❌ أبداً |
| **hours_deficit** | لا يُحتسب — لا يوجد required | ❌ أبداً |
| **target vs actual** | لا ينطبق (لا يوجد target للساعات) | ❌ |

#### مثال 1: يوم كامل

```
الموظف: سائق — بالساعة
البيانات:
  started_at  = 08:00
  ended_at    = 16:00
  break       = 12:00 - 12:30 (30 دقيقة)

الحسابات:
  duration      = 16:00 - 08:00 = 8:00 (480 دقيقة)
  net_hours     = 480 - 30 = 450 دقيقة = 7:30 ⏱️

الخلاصة:
  ✅ يُحتسب له 7.5 ساعة
  ✅ لا late, لا early, لا target
  ✅ الساعات الدقيقة تُستخدم للمحاسبة المالية
```

#### مثال 2: يوم مع استراحات متعددة

```
الموظف: عامل — بالساعة
البيانات:
  started_at    = 07:00
  break_1_start = 09:00, break_1_end = 09:15 (15 د)
  break_2_start = 12:00, break_2_end = 12:20 (20 د)
  ended_at      = 15:00
  (لا break ثالث)

الحسابات:
  duration       = 15:00 - 07:00 = 8:00 (480 دقيقة)
  break_duration = 15 + 20 = 35 دقيقة
  net_hours      = 480 - 35 = 445 دقيقة = 7:25 ⏱️

الخلاصة:
  ✅ 7 ساعات و 25 دقيقة قابلة للفوترة
  ✅ الخصم: 35 دقيقة استراحات
```

### 11.4 جدول مقارنة الأنواع الثلاثة

| المؤشر | دوام ثابت | دوام مرن | بالساعة |
|--------|-----------|----------|---------|
| **net_hours** | `duration - breaks` | `duration - breaks` | `duration - breaks` |
| **is_late?** | `started_at > shift_start + grace` | ❌ لا يُحتسب | ❌ لا يُحتسب |
| **early_departure?** | `ended_at < shift_end` | ❌ لا يُحتسب | ❌ لا يُحتسب |
| **hours_deficit?** | `MAX(0, required - net_hours)` | `MAX(0, required - net_hours)` | ❌ لا يوجد |
| **target vs actual?** | ✅ ينطبق | ✅ ينطبق | ❌ محدود |
| **المؤشر الأهم** | الالتزام بالوقت + الساعات | هل حقق الساعات المطلوبة؟ | net_hours الدقيق للمحاسبة |
| **مناسب لـ** | موظفين إدارة، مصنع | مناديب مبيعات | سائقين، عمال يومية |

### 11.5 كيف يُحتسب Composite Score (لكل الأ types)؟

```
لكل يوم:
  1. net_hours_score    = MIN(actual_net_hours / required_daily_hours × 100, 100)  ← وزن 30%
  2. orders_score       = MIN(actual_orders / daily_target_orders × 100, 100)       ← وزن 25%
  3. visits_score       = MIN(actual_visits / daily_target_visits × 100, 100)       ← وزن 20%
  4. collections_score  = MIN(actual_collections / daily_target_collections × 100, 100) ← وزن 15%
  5. new_customers_score = MIN(actual_new_customers / daily_target_new_customers × 100, 100) ← وزن 10%

  Composite Score = SUM(كل score × وزنها)
  النتيجة: 0 - 100

ملاحظات:
  - الأوزان (30/25/20/15/10) تؤخذ من performance_weights_config في نظام الأهداف
  - إذا لم يكن للموظف target ل某个 KPI → يُحذف ذلك KPI من الحساب وتُعاد توزيع الأوزان
  - للموظف المكتبي (office): فقط net_hours_score يُحتسب (100%) لأن باقي المؤشرات لا تنطبق
```

#### مثال Composite Score

```
حسن بكر — 15 يونيو:
  net_hours: 8:40 من 8:00 → 100% × 30% = 30
  orders:    5 من 4       → 100% × 25% = 25
  visits:    8 من 6       → 100% × 20% = 20
  collections: 3,000 من 2,500 → 100% × 15% = 15
  new_customers: 1 من 1  → 100% × 10% = 10

  Composite Score = 30 + 25 + 20 + 15 + 10 = 100/100 🏆
```

هذه الوثيقة تحدد خطة الهجرة الكاملة من التصميم الحالي إلى التصميم الجديد، بناءً على:

- **23 قراراً معتمداً** منك (Section 8.1)
- **4 قرارات تنتظر التأكيد النهائي** (Section 8.2)
- **Productivity Ledger** كعنصر أساسي في كل التقارير التشغيلية
- **Time Range Standard** موحَّد عبر كل الشاشات
- **EmployeeDayMapPage Wireframe** تفصيلي بترتيب ظهور العناصر
- **Work Hours Ledger** مع أمثلة رقمية لكل schedule type
- **Tracking Engine Limitations** موثَّقة بوضوح مع أقصى فترات الفقدان

### الخطوة التالية

بعد تأكيدك للأسئلة الـ 4 في Section 8.2:
1. أبدأ تحديث `ATTENDANCE_REDESIGN_SPEC.md` ليعكس القرارات النهائية
2. أبدأ التنفيذ حسب Rollout Plan في Section 6 — بعد إذنك صراحة

> ⚠️ لا تنفيذ لأي كود (SQL, RPC, Frontend, Migration) قبل اعتمادك النهائي.
