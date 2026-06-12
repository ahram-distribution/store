# ATTENDANCE_REDESIGN_IMPACT_ANALYSIS

**Supersedes:** TRACKING_RUNTIME_IMPLEMENTATION.md, WORKDAY_FINAL_IMPLEMENTATION_SPEC.md, WORK_HOURS_ANALYTICS_DESIGN.md  
**Status:** ⛔ IMPACT ANALYSIS ONLY — No implementation  
**Date:** 12 June 2026

---

## مقدمة

المشروع لا يبني نظام حضور تقليدي.

المشروع يبني **Operational Workforce Runtime** — نظام يدير وقت العمل والإنتاجية والتحركات لكل موظف حسب طبيعة عمله.

الوثائق السابقة بنيت على افتراض أن جميع الموظفين متشابهون (مندوب مبيعات). هذا الافتراض غير صحيح.

---

## Section 1: الشاشات المرشحة للحذف الكامل

| الشاشة | ملف | سبب الترشيح للحذف |
|--------|-----|-------------------|
| **AttendancePage** | `src/pages/attendance/AttendancePage.tsx` | صممت لمندوب واحد بنموذج تشغيل واحد (start → break → resume → end). لا تدعم Work Policies. لا تعرض إنتاجية حقيقية. تحتاج إعادة بناء كامل على نموذج العمل الفعلي. |
| **LiveMonitoringPage** | `src/pages/attendance/LiveMonitoringPage.tsx` | تعرض كل الموظفين بنفس الطريقة بغض النظر عن طبيعة عملهم. لا تراعي أن بعض الموظفين لا يحتاجون Tracking. لا تدعم الفلاتر حسب Work Policy. |
| **TeamMapPage** | `src/pages/attendance/TeamMapPage.tsx` | لا تحتوي على خريطة تفاعلية (فقط Google Maps links). تعرض كل الموظفين بغض النظر عن Tracking Required. تحتاج إعادة بناء كامل. |
| **ReportsPage** | `src/pages/attendance/ReportsPage.tsx` | التقارير الحالية لا تراعي Work Policies. الحسابات (late/early/ontime) مختلفة لكل نموذج تشغيل. |
| **AlertsPage** | `src/pages/attendance/AlertsPage.tsx` | V1 RPC مع role-name check. الـ Alert logic الحالي لا يراعي Work Policies. 5 أنواع فقط (يحتاج 9+). |
| **HistoryPage** | `src/pages/attendance/HistoryPage.tsx` | شاشة بحث بسيطة. البحث عن session عن طريق UUID — غير مفيد تشغيلياً. يمكن دمج الوظيفة في EmployeeProfile. |
| **EmployeeDayMapPage** | `src/pages/attendance/EmployeeDayMapPage.tsx` | **استثناء — لا يُحذف.** يحتوي على Leaflet map + route polyline + timeline + KPI cards. الوظيفة الأساسية صحيحة. يحتاج إعادة تصميم UI وربط مع Work Policies لكن الـ Core يبقى. |

---

## Section 2: الشاشات التي يمكن إعادة استخدامها

| الشاشة | إعادة الاستخدام | لماذا |
|--------|----------------|-------|
| **EmployeeDayMapPage** | **نعم — إعادة تصميم UI فقط** | الـ Core صحيح: Leaflet map, Polyline, Timeline events, KPI cards, Long stops, Distance. يحتاج: Header جديد يدعم Work Policy, ربط مع Attendance بدلاً من URL manual, تحسين Timeline UI. |
| **AttendanceSettingsPage** | **نعم — توسيع** | موجودة حالياً مع settings الأساسية. تحتاج إضافة Work Policy management. |

### الشاشات التي ستبقى بدون تغيير (خارج نطاق الحضور)

| الشاشة | السبب |
|--------|-------|
| `UpperManagementDashboard.tsx` | Attendance widget الحالي (active/on_break/ended/no_start) لا يزال مفيداً بعد التحسين. |
| `ManagementDashboard.tsx` | لا يحتوي على مكونات حضور. |
| `EmployeeProfilePage.tsx` | تبويب الحضور سيُعاد بناؤه لكن بقية التبويبات (info/org/permissions/targets/audit) لا تتأثر. |

---

## Section 3: تأثير الحذف على المكونات الحالية

### Routes

| Route الحالي | ملف | مصيرها |
|-------------|-----|--------|
| `/attendance` | `AttendancePage` | **ستُستبدل** — الصفحة الجديدة ستحل محلها بنفس الـ Route |
| `/attendance/live` | `LiveMonitoringPage` | **ستُستبدل** — أو تُحذف إذا لم يعد هناك حاجة لشاشة منفصلة |
| `/attendance/team-map` | `TeamMapPage` | **ستُستبدل** |
| `/attendance/reports` | `ReportsPage` | **ستُستبدل** |
| `/attendance/alerts` | `AlertsPage` | **مُحتمل الحذف** — لا وظيفة تشغيلية واضحة |
| `/attendance/history` | `HistoryPage` | **مُحتمل الحذف** — تدمج في EmployeeProfile |
| `/attendance/map/:employeeId/:date` | `EmployeeDayMapPage` | **ستُوسّع** — تبقى بنفس الـ Route مع تحسينات |
| `/attendance/settings` | `AttendanceSettingsPage` | **مُحتمل الإبقاء** — تُوسّع لتدعم Work Policies |

### Components

لا توجد Components مشتركة بين صفحات الحضور حالياً — كل صفحة مكتفية ذاتياً. لذلك الحذف لا يؤثر على مكونات خارجية.

### Services

| Service | التأثير |
|---------|---------|
| `src/services/attendance.ts` | ستبقى وتُوسّع. جميع RPC wrappers الموجودة لا تزال مطلوبة (start/end/break/sync). تضاف دوال جديدة لـ Work Policies. |
| `src/services/location.ts` | سيبقى. `captureLocation()` يخدم Tracking Runtime. |
| `src/services/targets.ts` | لا يتأثر. |

### RPCs

| RPC | الحكم | السبب |
|-----|-------|-------|
| `start_workday` | **يبقى** | الوظيفة الأساسية لم تتغير |
| `end_workday` | **يبقى** | الوظيفة الأساسية لم تتغير |
| `start_break` | **يبقى (مع CHECK مضاف)** | الوظيفة الأساسية لم تتغير |
| `end_break` | **يبقى (مع CHECK مضاف)** | الوظيفة الأساسية لم تتغير |
| `sync_tracking_points` | **يبقى** | الوظيفة الأساسية لم تتغير |
| `get_my_workday_status` | **يبقى (مع توسيع)** | يضاف إليه today_sales, today_orders, إلخ |
| `get_workday_settings` | **يبقى** | لا تغيير |
| `update_workday_settings` | **يبقى** | لا تغيير |
| `get_employee_detail` | **يبقى** | V2 جيد، مع check_capability |
| `get_employee_day_map` | **يبقى** | V2 جيد، مع Haversine + stops + visits |
| `get_employee_day_timeline` | **يبقى** | V2 جيد، مع events من orders/collections/customers |
| `get_employee_workday_history` | **يُعاد كتابته** | يحتاج V2 + توسيع summary |
| `get_live_workday_overview` | **يُعاد تصميمه** | يحتاج فلاتر Work Policy + Tracking Required |
| `get_team_map` | **يُعاد تصميمه** | يحتاج فلاتر Tracking Required |
| `get_workday_report` | **يُعاد تصميمه** | يحتاج Work Policy حسابات مختلفة |
| `get_alerts` | **يُعاد تصميمه** | V1 مع role-name check |
| `get_attendance_analysis` | **يُحذف أو يُعاد** | V1 مع role-name check، وظيفته تغطيها get_workday_report + get_employee_workday_history معاً |
| `get_employee_current_location` | **يُحذف** | V1 مع role-name check — الوظيفة متاحة عبر get_employee_detail (last_location) |
| `detect_long_stops` | **يُحذف** | غير مستخدم — detect_long_stops مضمن في get_employee_day_map |
| `cleanup_tracking_data` | **يبقى** | وظيفة صيانة |
| `auto_cleanup_tracking_data` | **يبقى** | cron job |
| `resolve_alert` | **لا حاجة** | لن ننشئها — alerts تُحتسب بشكل ديناميكي |

### SQL

| كائن SQL | الحكم | السبب |
|----------|-------|-------|
| `public.workday_settings` | **يبقى** | لا يزال مطلوباً للتكوين العام |
| `public.workday_sessions` | **يبقى** | الجدول الأساسي |
| `public.workday_breaks` | **يبقى** | الجدول الأساسي |
| `public.tracking_points` | **يبقى** | الجدول الأساسي للتتبع |
| `public.visit_links` | **مُحتمل الحذف** | 0 records. إذا لم نخطط لاستخدامه → يحذف مع migration لاحقاً |
| `public.tracking_cleanup_log` | **يبقى** | لا مشكلة |
| `app.sessions` function | **يبقى** | أساسي للمصادقة |
| `app.get_subtree_ids` function | **يبقى** | أساسي للـ governance |
| `public.check_capability` function | **يبقى** | أساسي للـ governance |

---

## Section 4: التغييرات في قاعدة البيانات

### جدول جديد: `employee_work_policies`

```sql
CREATE TABLE IF NOT EXISTS public.employee_work_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id),
    work_mode varchar(20) NOT NULL DEFAULT 'flexible_hours'
        CHECK (work_mode IN ('fixed_shift', 'flexible_hours', 'hourly', 'executive')),
    tracking_required boolean NOT NULL DEFAULT true,
    required_daily_hours decimal(4,2) NOT NULL DEFAULT 8.00,
    shift_start time,              -- مهم لـ fixed_shift
    shift_end time,                -- مهم لـ fixed_shift
    grace_minutes integer NOT NULL DEFAULT 0,  -- فترة سماح للتأخير
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_emp_work_policy ON public.employee_work_policies (employee_id);

COMMENT ON TABLE public.employee_work_policies IS
  'سياسة العمل لكل موظف. تحدد نموذج التشغيل ومتطلبات التتبع وساعات العمل.';
COMMENT ON COLUMN public.employee_work_policies.work_mode IS
  'fixed_shift=دوام ثابت, flexible_hours=ساعات مرنة, hourly=محاسبة بالساعة, executive=إدارة عليا';
COMMENT ON COLUMN public.employee_work_policies.tracking_required IS
  'false=لا يحتاج تتبع GPS (موظف مكتب/إدارة), true=مطلوب تتبع';
```

**لماذا جدول منفصل وليس أعمدة في `employees`؟**

| الخيار | المشكلة |
|--------|---------|
| أعمدة في `employees` | جدول employees أصبح كبيراً (20+ عمود). إضافة 7 أعمدة عمودية تشوش البيانات الأساسية. كل موظف عنده policy واحدة فقط لكن الـ policy قد تتغير (ترقية/نقل) — جدول منفصل يتيح الاحتفاظ بالتاريخ. |
| جدول `employee_work_policies` | فصل الـ operational data عن الـ master data. يمكن إضافة حقول جديدة بدون تغيير هيكل employees. يمكن ربط الـ policy بـ Manager (من يراجع ساعات الموظف) في المستقبل. |

### أعمدة جديدة مقترحة في `employees`

لا حاجة لأعمدة جديدة — `employee_work_policies` يعالج كل احتياجات العمل الجديدة.

### جداول ستبقى بدون تغيير

| الجدول | الحالة |
|--------|--------|
| `workday_sessions` | يبقى — يضاف إليه `work_policy_id` (اختياري، FK) لربط الجلسة بالسياسة المطبقة وقت الإنشاء |
| `workday_breaks` | يبقى |
| `tracking_points` | يبقى |
| `workday_settings` | يبقى |
| `employees` | لا تغيير |

### جداول مُحتمل حذفها

| الجدول | الحكم | السبب |
|--------|-------|-------|
| `visit_links` | **مُحتمل الحذف** | 0 records. العلاقة بين الـ session والـ visit مغطاة بـ `visits.employee_id` + `visits.check_in_at::date` |

### إضافة عمود إلى `workday_sessions`

```sql
ALTER TABLE public.workday_sessions
  ADD COLUMN work_policy_id uuid REFERENCES public.employee_work_policies(id);
```

السبب: عند بدء يوم العمل، تُسجل الـ policy المطبقة في ذلك الوقت. إذا تغيرت policy الموظف لاحقاً، الجلسات القديمة تبقى بالـ policy الصحيحة.

---

## Section 5: التغييرات في RPCs

### RPCs ستبقى كما هي

| RPC | ملاحظات |
|-----|---------|
| `start_workday` | يقرأ policy الموظف ويسجلها في الجلسة. المنطق الأساسي لا يتغير. |
| `end_workday` | لا تغيير. |
| `start_break` | تضاف CHECK لـ ALREADY_ON_BREAK. |
| `end_break` | تضاف CHECK لـ BREAK_NOT_FOUND + ALREADY_CLOSED. |
| `sync_tracking_points` | لا تغيير. |
| `get_workday_settings` | لا تغيير. |
| `update_workday_settings` | لا تغيير. |
| `get_employee_detail` | لا تغيير (V2). |
| `get_employee_day_map` | لا تغيير (V2). |
| `get_employee_day_timeline` | لا تغيير (V2). |

### RPCs ستعاد كتابتها

| RPC | سبب إعادة الكتابة |
|-----|-------------------|
| `get_employee_workday_history` | V1 → V2 governance + توسيع summary مع composite score + أيام بدون طلبات + مسافة + tracking point count |
| `get_my_workday_status` | توسيع لإضافة today_orders/today_sales/today_collections/today_new_customers |

### RPCs ستعاد تصميمها بالكامل

| RPC | سبب إعادة التصميم |
|-----|-------------------|
| `get_live_workday_overview` | لا يراعي work_policies. لا يصفي tracking_required=false. لا يفرّق بين fixed_shift (ينتظر بداية الدوام) و flexible_hours (لا يهتم بوقت البداية). |
| `get_team_map` | لا يصفي tracking_required=false. لا يراعي أن موظف المكتب لا يظهر على الخريطة. |
| `get_workday_report` | الحسابات مختلفة لكل work_mode: fixed_shift → late/early مهم. flexible_hours → late/early irrelevant. hourly → المهم هو net_hours. executive → فقط ساعات العمل التقريبية. |
| `get_alerts` | أنواع التنبيهات تختلف حسب work_mode. fixed_shift → تنبيهات تأخير. flexible_hours → لا. hourly → تنبيه قلة ساعات. |

### RPCs مُحتمل حذفها

| RPC | السبب |
|-----|-------|
| `get_attendance_analysis` | V1, duplicate of get_workday_report (الموجود V2 يغطي نفس الوظيفة). |
| `get_employee_current_location` | V1, duplicate of get_employee_detail.last_location. |
| `detect_long_stops` | غير مستخدم — المنطق مضمن في get_employee_day_map. |
| `resolve_alert` | لم تُنشأ بعد — لن ننشئها. |

---

## Section 6: تأثير Work Policy على النظام

### 6.1 على الحضور (AttendancePage)

| Work Mode | سلوك بدء اليوم | سلوك إنهاء اليوم |
|-----------|----------------|-------------------|
| **fixed_shift** | يتحقق من وقت البداية. إذا تأخر > grace_minutes → يُسجل كـ late. | إذا أنهى قبل shift_end → يُسجل early_departure. |
| **flexible_hours** | لا يتحقق من الوقت. يُسجل فقط وقت البداية. | لا يُسجل late/early. فقط يحسب المدة. |
| **hourly** | لا يتحقق من الوقت. | المهم هو net_hours (duration - breaks). المحاسبة على الساعات الفعلية. |
| **executive** | تسجيل بسيط (اختياري). لا قيود على الوقت. | لا يُحتسب late/early. |

### 6.2 على التقارير (Reports)

| المؤشر | fixed_shift | flexible_hours | hourly | executive |
|--------|-------------|----------------|--------|-----------|
| تأخير | ✅ يُحتسب | ❌ لا | ❌ لا | ❌ لا |
| انصراف مبكر | ✅ يُحتسب | ❌ لا | ❌ لا | ❌ لا |
| ساعات العمل | ✅ مدة الجلسة | ✅ مدة الجلسة | ✅ net_hours فقط | ✅ تقريبي |
| الاستراحات | ✅ تُحتسب | ✅ تُحتسب | ✅ تُخصم من الساعات | ✅ تُحتسب |
| أيام بدون طلبات | ✅ | ✅ | ✅ | لا ينطبق |

### 6.3 على التقييم (EmployeeProfile summary)

| المؤشر | fixed_shift | flexible_hours | hourly | executive |
|--------|-------------|----------------|--------|-----------|
| الالتزام بالدوام | مهم | غير مهم | غير مهم | غير مهم |
| صافي ساعات العمل | مهم | مهم | **الأهم** | تقريبي |
| الإنتاجية (طلبات/زيارات) | مهم | مهم | مهم | غير مهم |
| عدد أيام العمل | مهم | مهم | مهم | تقريبي |

### 6.4 على التتبع

| Work Mode | Tracking Required افتراضي |
|-----------|--------------------------|
| fixed_shift (مندوب) | ✅ نعم |
| flexible_hours (مندوب/مشرف) | ✅ نعم |
| hourly (عمال/سائقين) | ✅ نعم |
| executive (إدارة عليا) | ❌ لا |

### 6.5 تحديث AttendanceSettingsPage

يُضاف زر/تبويب لإدارة `employee_work_policies` لكل موظف — يسمح للإدارة العليا بتعيين:
- Work Mode
- Tracking Required (yes/no)
- Required Daily Hours
- Shift Start/End (لفئة fixed_shift)
- Grace Period

---

## Section 7: تأثير Tracking Required على Tracking Runtime

### 7.1 على Tracking Engine

```
قبل بدء trackingEngine.start():
  قراءة employee_work_policies WHERE employee_id = current_user
  إذا tracking_required = false:
    → لا تبدأ الـ setInterval
    → لا تفتح IndexedDB
    → engine.isRunning = false
    → (نقطة start و end فقط تُرسل من start_workday و end_workday)
```

### 7.2 على Live Monitoring

```
get_live_workday_overview:
  لكل موظف نشط:
    - اقرأ work_mode + tracking_required
    - إذا tracking_required = false:
        → connection_status = 'not_applicable'
        → لا يحتسب ضمن connection_loss_count
        → لا يظهر في last_points
    - إذا tracking_required = true:
        → connection_status يُحتسب كالمعتاد من tracking_points
```

### 7.3 على Team Map

```
get_team_map:
  WHERE tracking_required = true
    → فقط الموظفون الذين يحتاجون تتبع يظهرون على الخريطة
  WHERE tracking_required = false
    → لا يظهرون (موظف مكتب ليس له موقع)
```

### 7.4 على Route Map

```
EmployeeDayMapPage:
  إذا tracking_required = false للموظف:
    → route فارغ (0 نقاط tracking)
    → مسافة = 0
    → رسالة: "لا يتطلب تتبع"
    → عرض فقط session info (بداية/نهاية)
```

### 7.5 على التقارير

```
get_workday_report:
  لكل موظف:
    - tracking_required = false:
        → distance_meters = null
        → tracking_point_count = null
        → connection_status = 'not_applicable'
    - tracking_required = true:
        → كل البيانات كالمعتاد
```

---

## Section 8: تصور الشاشات الجديدة — Wireframe + وصف تشغيلي

### شاشة 1: AttendancePage (جديد)

**المسار:** `/attendance`

**الوصف:** مركز الموظف الذاتي — يعرض يوم عمله الحالي بشكل متكامل.

```
┌──────────────────────────────────────────────────────────────┐
│  [← رجوع]  [الحضور والانصراف]                    [⏱ 08:45] │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────── ─ ─── ─ ─── ─ ─── ─ ─── ─ ─── ─ ─── ─ ─── ┐ │
│  │  [اسم الموظف]    [الصلاحية]    [نموذج العمل]             │ │
│  │  حسن بكر         مندوب مبيعات  دوام مرن                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌───────📊 إنتاجية اليوم ─────────────────────────────────┐ │
│  │  [08:15 بداية]  [08:45 المدة]  [0 استراحة]  [8:45 صافي]│ │
│  │                                                         │ │
│  │   الطلبات:  3     المبيعات:  8,500 ج.م                  │ │
│   زيارات:  5     تحصيلات:  2,200 ج.م (2)                  │ │
│   عملاء جدد: 0    المسافة: 12.5 كم (24 نقطة)              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌───────📍 آخر موقع ────────────────────────────────────┐ │
│  │  🟢 متصل    منذ دقيقتين    [عرض على الخريطة]           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌───────⏳ الإجراءات ────────────────────────────────────┐ │
│  │                                                         │ │
│  │  [ ■ أخذ استراحة ]    [ ■ إنهاء يوم العمل ]            │ │
│  │                                                         │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**السلوك التشغيلي:**
- عند بدء اليوم: زر واحد "بدء يوم العمل" → يصبح الأزرار أعلاه
- بيانات الإنتاجية تُحدّث كل 30 ثانية من `get_my_workday_status`
- المسافة ونقاط التتبع من آخر session info
- "عرض على الخريطة" → يفتح EmployeeDayMapPage لذلك اليوم
- إذا tracking_required = false: لا يظهر المسافة/النقاط/الموقع
- إذا break مفتوح: الزر يصبح "مواصلة العمل"

### شاشة 2: WorkforceOverview (بديل LiveMonitoring + TeamMap)

**المسار:** `/attendance/overview`

**الوصف:** لوحة قيادة تشغيلية موحدة — تجمع live monitoring + team map في شاشة واحدة.

```
┌──────────────────────────────────────────────────────────────┐
│  [← رجوع]  [نظرة عامة على القوى العاملة]     [🔄 كل 30 ث] │
├──────────────────────────────────────────────────────────────┤
│  ┌─────── الفلاتر ─────────────────────────────────────────┐│
│  │  [كل الموظفين ▼]  [كل نماذج العمل ▼]  [Tracking ▼]   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── عدادات ──────────────────────────────────────────┐│
│  │  12  │  3   │  0   │  1   │  2    │  5   │  2   │       ││
│  │ يعمل │ استراحة│زيارة│انقطاع│لم يبدأ│أتموا│مكتب  │       ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── خريطة تفاعلية ──────────────────────────────────┐│
│  │  [Leaflet Map]                                          ││
│  │  • مناديب (نقاط خضراء مع صور)                          ││
│  │  • مشرفين (نقاط زرقاء)                                  ││
│  │  • توقف طويل (أيقونة خاصة)                              ││
│  │  • Polyline: آخر 10 نقاط لكل موظف (عند اختياره)        ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── قائمة الموظفين ─────────────────────────────────┐│
│  │  [صورة] اسم الموظف     |  المدة  |  الحالة |  إنتاجية ││
│  │  [🟢] حسن بكر           |  08:45  |  يعمل   |  78%    ││
│  │  [🔴] أحمد محمد         |  07:30  |  استراحة|  45%    ││
│  │  [⚪] محمود علي         |  —      |  لم يبدأ|  0%     ││
│  │  [🔵] خالد عمر          |  08:00  |  مكتب   |  92%    ││
│  │  ...                                                   ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**السلوك التشغيلي:**
- **فلاتر:** حسب Work Mode (كل/fixed_shift/flexible_hours/hourly/executive) + حسب Tracking Required (كل/مطلوب/غير مطلوب)
- **العدادات:** active, on_break, on_visit, connection_lost, not_started, ended, no_tracking (جديد)
- **الخريطة:** توضح فقط الموظفين مع tracking_required=true. كل موظف له حالة لونية. عند النقر على موظف → يظهر مساره آخر 10 نقاط + نافذة معلومات
- **القائمة:** فرز حسب الحالة/المدة/الإنتاجية. اسم الموظف → رابط → EmployeeDayMapPage
- **Tracking Required = false:** يظهرون في العداد "مكتب" ولا يظهرون على الخريطة

### شاشة 3: WorkReports (بديل ReportsPage)

**المسار:** `/attendance/reports`

**الوصف:** تقارير تشغيلية متكاملة لكل الموظفين مع دعم Work Policies.

```
┌──────────────────────────────────────────────────────────────┐
│  [← رجوع]  [التقارير التشغيلية]                              │
├──────────────────────────────────────────────────────────────┤
│  ┌─────── TimeRangeFilter ─────────────────────────────────┐│
│  │  [اليوم] [أمس] [7 أيام] [هذا الشهر] [الشهر السابق] [مخصص]││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── ملخص الفترة ────────────────────────────────────┐│
│  │  22 يوم عمل  |  157 ساعة صافي  |  4.2 يوم/أسبوع        ││
│  │  إجمالي الطلبات: 98  |  متوسط 4.5 طلب/يوم              ││
│  │  إجمالي المبيعات: 285,000 ج.م  |  متوسط 12,955 ج.م/يوم││
│  │  إجمالي التحصيلات: 45,000 ج.م  |  متوسط 2,045 ج.م/يوم ││
│  │  أيام بدون طلبات: 3  |  أيام بدون زيارات: 1            ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── فلتر الموظفين ──────────────────────────────────┐│
│  │  [كل نماذج العمل ▼]  [ترتيب: ▼]  [بحث: ...]           ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── جدول الموظفين ──────────────────────────────────┐│
│  │  الموظف  │ أيام │ صافي │ طلبات │ مبيعات │ تحصيل │...│ ││
│  │  حسن بكر │  22  │157:00│  45   │125,000 │18,000 │    │ ││
│  │  أحمد محمد│  20 │140:30│  32   │ 98,000 │22,000 │    │ ││
│  │  ...     │      │      │       │        │       │    │ ││
│  │  ▲ فرز حسب: صافي ساعات العمل (تنازلي)                   ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**السلوك التشغيلي:**
- **الملخص:** يعتمد على الفلتر الزمني — يظهر summary لكل الفترة لجميع الموظفين
- **فلتر الموظفين:** حسب Work Mode + بحث بالاسم + ترتيب حسب أي عمود
- **الجدول:** كل موظف سطر واحد، مع المؤشرات الأساسية. اسم الموظف → رابط → EmployeeDayMapPage
- **Work Policy:** أيام العمل تُحتسب فقط للـ completed sessions. أيام بدون طلبات/زيارات/تحصيلات لكل موظف
- **التأخير والانصراف المبكر:** يُحتسب فقط لـ fixed_shift. للبقية يُظهر "غير مطبق"

### شاشة 4: EmployeeAttendanceProfile (تحسين EmployeeProfilePage > تبويب الحضور)

**المسار:** `/employees/:id` ← تبويب الحضور

**الوصف:** سجل حضور متكامل لكل موظف مع جدول يومي وملخص شهري.

```
┌──────────────────────────────────────────────────────────────┐
│  [البيانات الأساسية] [الهيكل] [الصلاحيات] [الأهداف]         │
│  [ملخص الحضور] [سجل النشاطات]                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────── سياسة العمل ────────────────────────────────────┐│
│  │  نموذج العمل: دوام مرن  |  ساعات مطلوبة: 8 ساعات       ││
│  │  تتبع مطلوب: نعم         |  فترة السماح: 0 دقيقة        ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── TimeRangeFilter ────────────────────────────────┐│
│  │  [هذا الشهر ▼]  [< يونيو 2026 >]                       ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── ملخص الشهر ────────────────────────────────────┐│
│  │  أيام العمل:    22                                    ││
│  │  صافي الساعات:   157:00  (متوسط يومي: 7:08)           ││
│  │  إجمالي الطلبات: 98     (متوسط يومي: 4.5)             ││
│  │  إجمالي المبيعات: 285,000 ج.م                         ││
│  │  أيام بدون طلبات: 3    أيام بدون زيارات: 1            ││
│  │  أفضل يوم: 15/06 (78/100)  أسوأ يوم: 03/06 (22/100)   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────── سجل يومي (22 يوم) ─────────────────────────────┐│
│  │  التاريخ │ بداية│ نهاية │صافي│استراحة│ طلبات│ مبيعات│كم ││
│  │  15/06   │08:10 │17:30  │8:40│ 00:30 │  5   │12,500│42 ││
│  │  14/06   │08:05 │16:50  │7:50│ 00:20 │  3   │ 8,200│35 ││
│  │  ...     │      │       │    │       │      │      │   ││
│  │  [كل يوم ← رابط → EmployeeDayMapPage]                  ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### شاشة 5: EmployeeDayMapPage (تحسين — موجود + يُوسّع)

**المسار:** `/attendance/map/:employeeId` (date من الفلتر بدلاً من URL)

**الوصف:** شاشة تفاصيل يوم الموظف — خريطة + جدول زمني + توقفات + ملخص.

ما هو موجود ولا يُغيَّر:
- Leaflet map مع Polyline
- نقاط البداية/النهاية (CircleMarker)
- نقاط الزيارات (Marker مع أيقونة)
- Popup مع وقت لكل نقطة
- Distance + Long stops
- Timeline مع events
- Summary tab

ما يُضاف:
- TimeRangeFilter (اختيار اليوم)
- معلومات Work Policy للموظف
- إذا tracking_required=false → رسالة "لا يتطلب تتبع" وإخفاء الخريطة
- Navigation مباشر من AttendancePage و WorkforceOverview

---

## Section 9: خطة التنفيذ المقترحة

### المبدأ: 3 مراحل منفصلة. كل مرحلة تعتمد على التي قبلها. لا تبدأ مرحلة قبل اعتماد المرحلة السابقة.

---

### المرحلة 0: الأساس — Tracking Runtime + SQL

**المدة المقدرة:** 3-4 أيام

**الهدف:** تشغيل التتبع الفعلي + تصحيح SQL الأساسي.

| المكون | التغيير |
|--------|---------|
| **Database** | جدول `employee_work_policies` + عمود `work_policy_id` في `workday_sessions` |
| **RPCs** | `start_workday` يقرأ policy ويخزنها. `start_break` + `end_break` → CHECKs. |
| **Backend** | `trackingEngine.ts` + `trackingQueue.ts` |
| **Frontend** | `attendance.ts` +syncTrackingPoints. ربط `AttendancePage.tsx` بالمحرك. |

**النتيجة المرئية:** لا شيء يظهر للمستخدم مباشرة. Tracking يبدأ العمل في الخلفية.

---

### المرحلة 1: البيانات — RPCs الموسعة

**المدة المقدرة:** 2-3 أيام

**الهدف:** جهّز كل RPCs لتعمل بـ Work Policies.

| المكون | التغيير |
|--------|---------|
| **Database** | لا تغيير (المرحلة 0 أنشأت الجدول) |
| **RPCs** | `get_employee_workday_history` (V2). `get_my_workday_status` (توسيع). `get_live_workday_overview` (تصفية حسب tracking_required). `get_team_map` (تصفية). `get_workday_report` (تصميم جديد مع Work Policy). |
| **Frontend** | لا تغيير كبير — فقط types/new RPC calls |

**النتيجة المرئية:** لا شيء يظهر للمستخدم. البيانات جاهزة في Backend.

---

### المرحلة 2: الشاشات الجديدة

**المدة المقدرة:** 5-7 أيام

**الهدف:** بناء الشاشات الجديدة على البيانات الجاهزة.

| المكون | التغيير |
|--------|---------|
| **Frontend** | `AttendancePage.tsx` — إعادة بناء (مركز ذاتي مع إنتاجية). `WorkforceOverview.tsx` — لوحة موحدة (خريطة + قائمة). `WorkReports.tsx` — تقارير قابلة للفرز. `EmployeeProfilePage.tsx` — تبويب حضور متكامل. `EmployeeDayMapPage.tsx` — تحسين. `TimeRangeFilter.tsx` — جديد. |
| **Routes** | إضافة `/attendance/overview` + تحديث `/attendance` + تحديث `/attendance/reports` |

**النتيجة المرئية:** المستخدم يرى الشاشات الجديدة.

---

### المرحلة 3: التحسينات — الحذف والتنظيف

**المدة المقدرة:** 1-2 أيام

**الهدف:** حذف الشاشات القديمة بعد التأكد من أن الجديدة تعمل.

| المكون | التغيير |
|--------|---------|
| **Frontend** | حذف `LiveMonitoringPage.tsx`, `TeamMapPage.tsx`, `ReportsPage.tsx`, `AlertsPage.tsx`, `HistoryPage.tsx` |
| **Routes** | حذف المسارات القديمة |
| **Database** | حذف `visit_links` table (اختياري) |
| **RPCs** | حذف `get_attendance_analysis`, `get_employee_current_location`, `detect_long_stops` (اختياري) |

**النتيجة المرئية:** تطبيق أنظف، مسارات أقل، كود أقل.

---

## الجدول الزمني الإجمالي

| المرحلة | الأيام | الاعتماديات |
|---------|--------|-------------|
| 0 — Tracking Runtime + SQL | 3-4 | لا شيء |
| 1 — RPCs موسعة | 2-3 | المرحلة 0 |
| 2 — شاشات جديدة | 5-7 | المرحلة 1 |
| 3 — حذف وتنظيف | 1-2 | المرحلة 2 |
| **الإجمالي** | **11-16 يوم** | — |

---

## الخلاصة

لا يتم تنفيذ أي شيء في هذه المرحلة.

هذه الوثيقة هي Impact Analysis فقط.

الوثائق السابقة (`TRACKING_RUNTIME_IMPLEMENTATION.md`, `WORK_HOURS_ANALYTICS_DESIGN.md`, `WORKDAY_FINAL_IMPLEMENTATION_SPEC.md`) أصبحت قديمة جزئياً بسبب إضافة Work Policies وتغيير الرؤية.

**الوثائق الجديدة المطلوبة بعد اعتماد هذا التحليل:**
1. `ATTENDANCE_REDESIGN_SPEC.md` — المواصفات التفصيلية للشاشات الجديدة
2. `ATTENDANCE_REDESIGN_MIGRATION.md` — الـ SQL migration الكامل

**بانتظار قرارك:**
1. هل توافق على اتجاه إعادة التصميم؟
2. هل توافق على هيكل `employee_work_policies`؟
3. هل تبدأ بالمرحلة 0 (Tracking Runtime أولاً) أم تعيد تصميم كل شيء معاً؟
4. هل الشاشات الجديدة المقترحة تقترب من رؤيتك أم تريد تغيير جذري؟
