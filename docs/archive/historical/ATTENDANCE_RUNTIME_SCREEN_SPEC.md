# Employee Attendance Runtime — Screen Spec

> التصميم النهائي لشاشة الحضور والانصراف الجديدة
> Rev: 2 — 2026-06-12 (المعتمد)

---

## 1. Overview

شاشة جديدة كلياً للموظف لإدارة يومه العملي.

**ممنوع** استخدام أي كود من `AttendancePage` القديمة — لا JSX ولا Components ولا Layout.

تعتمد فقط على Phase 1 (Work Policies) + Phase 2 (Work Hours, KPIs, Target).

مصممة Mobile-First للاستخدام الميداني.

المسار: `/attendance/runtime`

---

## 2. Wireframe

```
┌────────────────────────────────────────────────┐
│  HEADER AREA                                    │
│  ┌────────────┬────────────────────────────────┐│
│  │  [Avatar]  │  الاسم: محمد أحمد              ││
│  │            │  الكود: REP001                  ││
│  │            │  [ميداني] [دوام مرن]            ││
│  │            │  آخر تحديث: 20 ثانية           ││ ← NEW
│  └────────────┴────────────────────────────────┘│
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  CLOCK AREA                                │   │
│  │                                            │   │
│  │         ⏰  07:30:45                      │   │
│  │         الوقت الحالي                       │   │
│  │                                            │   │
│  │  ┌──────────────┬──────────────────────┐   │   │
│  │  │  مدة اليوم   │  صافي العمل          │   │   │
│  │  │  07:15       │  06:30               │   │   │
│  │  └──────────────┴──────────────────────┘   │   │
│  │  ┌──────────────┬──────────────────────┐   │   │
│  │  │  الاستراحات  │  الحضور              │   │   │
│  │  │  00:45       │  07:30               │   │   │
│  │  └──────────────┴──────────────────────┘   │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  TARGET VS ACTUAL                          │   │
│  │  المستهدف: 8 ساعات                        │   │
│  │  ████████████████░░░░░░░░ 82%             │   │
│  │  6.5h / 8h     متبقي 1.5h                 │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  TODAY KPIs                                │   │
│  │  ┌──────┬──────┬──────┬──────┐             │   │
│  │  │ طلبيات│مبيعات│تحصيلات│عملاء │             │   │
│  │  │   5   │20,700│ 5,000 │  2   │             │   │
│  │  └──────┴──────┴──────┴──────┘             │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  TODAY'S SUMMARY CARD (جديد)              │   │
│  │  ┌──────┬──────┬──────┬──────┬──────┐     │   │
│  │  │ساعات │صافي  │الهدف │طلبات │مبيعات│     │   │
│  │  │07:15 │06:30 │  8h  │  5   │20.7ك│     │   │
│  │  ├──────┼──────┼──────┼──────┼──────┤     │   │
│  │  │تحصيل│عملاء │نسبة  │      │      │     │   │
│  │  │5,000│  2   │ 82%  │      │      │     │   │
│  │  └──────┴──────┴──────┴──────┴──────┘     │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  LAST 7 DAYS (Mini)                        │   │
│  │  ┌──┬──┬──┬──┬──┬──┬──┐                    │   │
│  │  │س │أ │إ │ث │أ │خ │ج │                    │   │
│  │  │5 │6 │7 │4 │7 │6 │-│ ← ساعات           │   │
│  │  │🔴│🟢│🟢│🟡│🟢│🟢│⚪│ ← الحالة         │   │
│  │  └──┴──┴──┴──┴──┴──┴──┘                    │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  ACTIONS (Bottom)                          │   │
│  │                                            │   │
│  │  [حالة اليوم: 🟢 يعمل — مدة 7:15]         │   │
│  │                                            │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │       ☕  أخذ استراحة                 │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  │                                            │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │       📋  ملخص اليوم                 │  │   │ ← NEW
│  │  └──────────────────────────────────────┘  │   │
│  │                                            │   │
│  │  ┌──────────────────────────────────────┐  │   │
│  │  │       ⛔  إنهاء يوم العمل             │  │   │
│  │  └──────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────┘   │
└────────────────────────────────────────────────┘
```

---

## 3. Screen Sections (بالترتيب)

### 3.1 Header

| الحقل | المصدر |
|---|---|
| اسم الموظف | اسم من policy data أو `full_name` |
| الكود الوظيفي | `employee_code` |
| Work Location Badge | `get_my_workday_status` → `work_location` |
| Schedule Type Badge | `get_my_workday_status` → `schedule_type` |
| Attendance Status Badge | `get_my_workday_status` → `attendance_enabled` |
| **Last Sync Indicator** | **آخر وقت استجابة ناجحة من `get_my_workday_status`** |
| Avatar | Placeholder initials (دائرة بالحرف الأول) |

**RPC**: `get_my_workday_status` (polling كل 30s)

**Last Sync Indicator**:
- يحسب الفرق بين `now()` وآخر استجابة ناجحة
- < 30 ثانية: "آخر تحديث الآن"
- < 60 ثانية: "آخر تحديث منذ X ثانية"
- ≥ 60 ثانية: "آخر تحديث منذ X دقائق"
- > 5 دقائق: لون برتقالي (تحذيري)

**Attendance Badge Rules**:
- `attendance_enabled = true`: لا يُظهر badge خاص (طبيعي)
- `attendance_enabled = false`: يُظهر badge "غير خاضع للتقييم" بخلفية رمادية
- لا policy (null): يُظهر badge "غير مصنف" بخلفية صفراء

### 3.2 Clock Area

| الحقل | المصدر |
|---|---|
| الساعة الحالية | `new Date()` — local (تحديث كل ثانية) |
| مدة اليوم | `duration_minutes` → format HH:MM |
| صافي العمل | `net_work_minutes` → format HH:MM |
| الاستراحات | `break_minutes` → format HH:MM |
| وقت الحضور | `started_at` → format HH:MM |

**RPC**: `get_my_workday_status` (polling كل 30s)
**تحديث محلي**: الـ timer يستمر بين الـ polls عن طريق حساب الفرق من `started_at` كل ثانية

**attendance_enabled=false**: يبقى Clock Area كاملاً — المدة والصافي والاستراحات كلها تظهر طبيعي.

### 3.3 Target vs Actual

| الحقل | المصدر |
|---|---|
| المستهدف اليوم | `daily_target_vs_actual.target_hours` |
| الساعات الفعلية | `daily_target_vs_actual.current_net_hours` |
| نسبة الإنجاز | `daily_target_vs_actual.progress_pct` |
| الوقت المتبقي | `daily_target_vs_actual.remaining_seconds` |
| نوع الجدول | `daily_target_vs_actual.schedule_type` |

**RPC**: تُجلب ضمن `get_my_workday_status` (لا حاجة لاستدعاء منفصل)

**اللون**:
- ≥100%: أخضر
- ≥70%: أزرق
- <70%: برتقالي

**attendance_enabled=false**: هذا القسم **يُخفى بالكامل** — لا Target ولا تقييم ولا محاسبة.

### 3.4 Today KPIs

| الحقل | المصدر |
|---|---|
| عدد الطلبيات | `today_orders` |
| قيمة المبيعات | `today_sales` (formatted مع فاصل الآلاف) |
| قيمة التحصيلات | `today_collections` (formatted) |
| العملاء الجدد | `today_new_customers` |

**RPC**: `get_my_workday_status`

بطاقات 2×2 بأيقونات:
- طلبيات → 🛒 (ظل أزرق)
- مبيعات → 💰 (ظل أخضر)
- تحصيلات → 📥 (ظل برتقالي)
- عملاء جدد → 👤 (ظل بنفسجي)

**attendance_enabled=false**: هذا القسم **يُخفى بالكامل** — لا KPIs ولا إنتاجية.

### 3.5 Today's Summary Card (جديد)

بطاقة تنفيذية واحدة بين KPIs و Last 7 Days.

| الحقل | المصدر |
|---|---|
| ساعات العمل اليوم | `duration_minutes` → HH:MM |
| صافي ساعات العمل | `net_work_minutes` → HH:MM |
| الهدف اليوم | `daily_target_vs_actual.target_hours` |h |
|نسبة الإنجاز | `daily_target_vs_actual.progress_pct` |% |
|عدد الطلبات | `today_orders` |
| قيمة المبيعات | `today_sales` (مختصر: 20.7k) |
| قيمة التحصيلات | `today_collections` (مختصر) |
| العملاء الجدد | `today_new_customers` |

**Layout**: بطاقة واحدة بعرض كامل، تنقسم إلى صفين:
- الصف الأول: ساعات | صافي | الهدف | طلبات | مبيعات — 5 أعمدة
- الصف الثاني: تحصيلات | عملاء | نسبة الإنجاز | — 3 أعمدة (أو 4 مع remaining)

**الهدف**: أن يرى المندوب وضعه الحالي بالكامل في مكان واحد دون التنقل بين الأقسام.

**RPC**: `get_my_workday_status` (نفس البيانات موجودة مسبقاً)

**attendance_enabled=false**: **يُخفى بالكامل** — لا ملخص تقييم.

### 3.6 Last 7 Days (Mini History)

| الحقل | المصدر |
|---|---|
| الأيام السبعة الماضية | `daily_target_vs_actual.last_7_days` (array) |
| net_hours لكل يوم | `last_7_days[n].net_hours` |
| met_target لكل يوم | `last_7_days[n].met_target` (boolean) |

**RPC**: ضمن `get_my_workday_status` → `daily_target_vs_actual.last_7_days`

شريط أفقي صغير:
- 7 أعمدة (يوم + ساعات)
- أيقونة ✅ / ❌ أسفل كل يوم
- ⚪ للأيام التي لا توجد بها بيانات

**attendance_enabled=false**: **يُخفى بالكامل**.

### 3.7 Actions (ثابت في الأسفل)

أربع حالات:

#### الحالة A: اليوم لم يبدأ (status = null)
| الزر | الإجراء |
|---|---|
| ▶️ بدء يوم العمل | `start_workday` مع GPS + device_status |

#### الحالة B: اليوم نشط + غير في استراحة
| الزر | الإجراء |
|---|---|
| ☕ أخذ استراحة | `start_break` مع reason = "استراحة" |
| 📋 ملخص اليوم | يفتح Bottom Sheet مع full summary |
| ⛔ إنهاء يوم العمل | `end_workday` مع GPS + device_status |

#### الحالة C: اليوم نشط + في استراحة
| الزر | الإجراء |
|---|---|
| ▶️ مواصلة العمل | `end_break` مع break_id |
| 📋 ملخص اليوم | يفتح Bottom Sheet مع full summary |
| ⛔ إنهاء يوم العمل | `end_workday` مع إغلاق الـ break أولاً |

#### الحالة D: اليوم منتهي
| الزر | الإجراء |
|---|---|
| 📋 ملخص اليوم | يفتح Bottom Sheet مع full summary (ثابت) |
| ▶️ بدء يوم عمل جديد | `start_workday` |

**attendance_enabled=false**: تبقى جميع الأزرار كما هي (بدء/إنهاء/استراحة/ملخص) — الإعفاء من التقييم وليس من الاستخدام.

#### Daily Summary Bottom Sheet

عند الضغط على "📋 ملخص اليوم":

```
┌──────────────────────────────────┐
│  📋  ملخص اليوم                  │
│  ─────────────────────           │
│                                  │
│  وقت الحضور    07:30            │
│  وقت الانصراف  14:45            │
│  إجمالي اليوم  07:15            │
│  الاستراحات    00:45            │
│  صافي العمل    06:30            │
│  ─────────────────────           │
│  عدد الطلبيات       5           │
│  قيمة المبيعات    20,700 ج.م    │
│  قيمة التحصيلات    5,000 ج.م    │
│  العملاء الجدد        2         │
│  ─────────────────────           │
│  الهدف اليوم     8 ساعات        │
│  تم الإنجاز      6.5 ساعات      │
│  نسبة الإنجاز    82%            │
│  ─────────────────────           │
│  🟢 يعمل حالياً                 │
│                                  │
│  [إغلاق]                         │
└──────────────────────────────────┘
```

**RPC**: لا حاجة — جميع البيانات موجودة في `get_my_workday_status`.

**attendance_enabled=false**: الـ Bottom Sheet يظهر المدة والصافي فقط (بدون طلبيات/مبيعات/تحصيلات/عملاء/هدف/نسبة).

---

## 4. Data Flow

```
Mount
  ├→ get_my_workday_status()
  │   ├→ status: null → عرض "قبل البدء" مع زر البدء
  │   ├→ status: 'active' → عرض شاشة العمل + timer
  │   └→ status: 'completed' → عرض الشاشة النهائية + ملخص
  │
  └→ setInterval(fetch, 30_000) ← poll كل 30 ثانية
      └→ تحديث lastSyncTime ← آخر تحديث ناجح

Local Timer (setInterval 1s):
  ├→ إذا status = 'active':
  │   └→ duration = now - started_at
  │   └→ net = duration - break_minutes
  │   └→ تحديث عرض الساعة + المدة + الصافي (بدون RPC)
  └→ تحديث lastSyncIndicator (كل ثانية من آخر poll)

Actions:
  ├→ start_workday → fetchStatus()
  │   └→ toast.success + تحديث كل شيء
  ├→ end_workday → fetchStatus()
  │   └→ toast مع attendance_status + late/early info
  ├→ start_break → fetchStatus()
  │   └→ toast + timer يوقف حساب net
  └→ end_break → fetchStatus()
      └→ toast + timer يستأنف حساب net

Modal / Bottom Sheet:
  └→ لا RPC — يعرض من البيانات المخزنة في state
```

---

## 5. RPC Usage Summary

| RPC | متى | التردد |
|---|---|---|
| `get_my_workday_status(p_token)` | تحميل أولي + تحديث دوري | كل 30s |
| `start_workday(token, lat, lng, device_status)` | ضغط زر البدء | عند الطلب |
| `end_workday(token, session_id, lat, lng, device_status)` | ضغط زر النهاية | عند الطلب |
| `start_break(token, session_id, lat, lng, reason)` | ضغط زر الاستراحة | عند الطلب |
| `end_break(token, session_id, break_id)` | ضغط زر العودة من الاستراحة | عند الطلب |

**لا يوجد RPC جديد مطلوب** — كل البيانات تُجلب ضمن `get_my_workday_status` المعدل (Phase 2).

**لا يوجد تعديل على قاعدة البيانات** — كل الحقول موجودة مسبقاً.

---

## 6. States

### Loading State
```
┌──────────────────────────────────┐
│                                  │
│           ⏳                     │
│     جاري التحميل...             │
│                                  │
└──────────────────────────────────┘
```

### Error State
```
┌──────────────────────────────────┐
│                                  │
│        ⚠️                        │
│   حدث خطأ في تحميل البيانات     │
│                                  │
│   [محاولة مرة أخرى]             │
│                                  │
└──────────────────────────────────┘
```

### Before Work — يوم لم يبدأ
```
┌──────────────────────────────────┐
│  Header (info only + sync)       │
│                                  │
│    🏁  اليوم لم يبدأ بعد        │
│    أنت على وشك بدء يوم جديد      │
│                                  │
│  ┌────────────────────────────┐  │
│  │  🟢  بدء يوم العمل         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### Active — يعمل حالياً
(كل الأقسام: Header + Clock + Target + KPIs + Summary + 7 Days + Actions)

### On Break — في استراحة
```
┌──────────────────────────────────┐
│  Header + Last Sync              │
│  Clock Area (يتوقف الـ timer)    │
│  Target vs Actual (ثابت)         │
│  Today KPIs (ثابت)               │
│  Today's Summary (ثابت)          │
│  Last 7 Days (ثابت)              │
│                                  │
│  🟡  في استراحة منذ 00:15       │
│                                  │
│  ┌────────────────────────────┐  │
│  │  ✅  مواصلة العمل          │  │
│  ├────────────────────────────┤  │
│  │  📋  ملخص اليوم            │  │
│  ├────────────────────────────┤  │
│  │  ⛔  إنهاء اليوم           │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### Completed — اليوم منتهي
```
┌──────────────────────────────────┐
│  Header + Last Sync              │
│                                  │
│  ✅  تم إنهاء اليوم بنجاح       │
│                                  │
│  ┌──────────┬─────────────────┐  │
│  │ إجمالي   │ صافي العمل      │  │
│  │ 07:15    │ 06:30           │  │
│  └──────────┴─────────────────┘  │
│  ┌──────────┬─────────────────┐  │
│  │ الحضور   │ الانصراف        │  │
│  │ 07:30    │ 14:45           │  │
│  └──────────┴─────────────────┘  │
│                                  │
│  Target vs Actual (ثابت)        │
│  Today KPIs (ثابت)              │
│  Today's Summary (ثابت)         │
│  Last 7 Days (ثابت)             │
│                                  │
│  ┌────────────────────────────┐  │
│  │  📋  ملخص اليوم            │  │
│  ├────────────────────────────┤  │
│  │  🟢  بدء يوم جديد          │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 7. Mobile Layout (375px × 812px — iPhone)

| القسم | الارتفاع التقريبي |
|---|---|
| Header (مع Last Sync) | 90px |
| Clock Area | 180px |
| Target vs Actual | 80px |
| Today KPIs | 120px |
| **Today's Summary Card** | **80px** |
| Last 7 Days | 80px |
| Actions (ثابت بالأساس) | 180px |
| **الإجمالي** | **810px** (يدخل ضمن شاشة واحدة مع Scroll بسيط) |

على الشاشات الصغيرة جداً (<360px):
- Clock Area: يقلص إلى 4 أرقام بشكل أفقي أصغر
- **Today's Summary**: يدمج مع آخر صف من KPIs
- Last 7 Days: يختفي ويُستبدل بـ "عرض الأيام السبعة" → modal

---

## 8. Color Palette

| العنصر | اللون |
|---|---|
| الخلفية | gradient `from-blue-50 to-white` |
| نص أساسي | `text-gray-800` |
| نص ثانوي | `text-gray-500` |
| Badge ميداني | bg `blue-100` text `blue-700` |
| Badge مكتبي | bg `emerald-100` text `emerald-700` |
| Badge دوام ثابت | bg `purple-100` text `purple-700` |
| Badge دوام مرن | bg `indigo-100` text `indigo-700` |
| Badge بالساعة | bg `amber-100` text `amber-700` |
| Badge غير خاضع | bg `gray-100` text `gray-500` |
| Badge غير مصنف | bg `yellow-100` text `yellow-700` |
| Progress bar ≥100% | gradient `green-500 → green-600` |
| Progress bar ≥70% | gradient `blue-500 → blue-600` |
| Progress bar <70% | gradient `amber-500 → amber-600` |
| KPI icon bg | حسب كل KPI (blue, green, amber, purple) |
| زر بدء | bg `green-600` hover `green-700` |
| زر break | bg `amber-500` hover `amber-600` |
| زر نهاية | bg `red-500` hover `red-600` |
| زر عودة من break | bg `amber-500` hover `amber-600` |
| زر ملخص اليوم | bg `indigo-100` text `indigo-700` |
| Sync indicator < 30s | `text-green-600` |
| Sync indicator < 5m | `text-gray-400` |
| Sync indicator > 5m | `text-amber-600` |

---

## 9. File Structure

```
src/
  pages/
    attendance/
      runtime/
        AttendanceRuntimePage.tsx   ← الشاشة الرئيسية الجديدة (state machine)
        components/
          RuntimeHeader.tsx          ← Header + badges + last sync
          RuntimeClockArea.tsx       ← Clock + timers
          RuntimeTargetProgress.tsx  ← Target vs Actual bar
          RuntimeKpiGrid.tsx         ← Today KPIs 2×2
          RuntimeTodaySummary.tsx    ← Today's Summary Card (NEW)
          RuntimeWeekMini.tsx        ← Last 7 days strip
          RuntimeActions.tsx         ← Bottom actions (state machine)
          RuntimeDailySummaryModal.tsx ← Bottom Sheet modal (NEW)
        index.ts                    ← export { default as AttendanceRuntimePage }
```

**ممنوع** استخدام أي import من `AttendancePage.tsx` القديمة أو أي ملف داخل `pages/attendance/` (عدا `runtime/`).

---

## 10. ما الذي يبقى من Legacy (مؤقتاً)

| العنصر القديم | المصير |
|---|---|
| `AttendancePage.tsx` | يبقى في المسار `/attendance` — لن يُمسح |
| `formatDuration` في القديم | مستقل — الشاشة الجديدة تكتب دالتها الخاصة |
| `getCurrentPosition` | ينتقل إلى util مشترك `src/utils/geolocation.ts` |
| `getBatteryLevel` | ينتقل إلى util مشترك `src/utils/battery.ts` |
| `WorkdayStatus` interface القديم | مستقل — الشاشة الجديدة تعرّف `RuntimeStatus` الخاص بها |
| Toast (react-hot-toast) | يُستخدم مباشرة (نفس المكتبة) |
| supabase client | يُستخدم مباشرة |

---

## 11. Route

```tsx
{/* المسار القديم — يبقى للـ Legacy */}
<Route path="/attendance" element={<ProtectedRoute employeeOnly><AttendancePage /></ProtectedRoute>} />

{/* المسار الجديد — Runtime */}
<Route path="/attendance/runtime" element={<ProtectedRoute employeeOnly><AttendanceRuntimePage /></ProtectedRoute>} />
```

بعد اعتماد الشاشة الجديدة بالكامل:
- `AttendancePage` القديمة تبقى كـ Legacy لمدة انتقالية
- يمكن إعادة توجيه `/attendance` إلى `/attendance/runtime` في Phase 6
- لا تُحذف `AttendancePage` حتى تكتمل Phase 7

---

## 12. اعتبارات Offline

المستخدم ميداني وقد يفقد الاتصال:
- الـ timer المحلي يستمر في العمل حتى بدون اتصال
- أزرار الإجراءات (start/end/break) تُعطل مع رسالة "يتطلب اتصال"
- جميع البيانات تبقى من آخر تحديث ناجح لـ `get_my_workday_status`
- **Last Sync Indicator** يتحول إلى لون برتقالي بعد 5 دقائق
- الـ Daily Summary Modal يعمل من البيانات المخزنة (حتى بدون اتصال)
- **الحل الكامل للـ offline (IndexedDB queue)** سيكون جزءاً من Phase 3 (Tracking)

---

## 13. Test Scenarios

| السيناريو | المتوقع |
|---|---|
| موظف جديد ليس له policy | Badge "غير مصنف" — يظهر Header + Clock + Start/End فقط (بدون target/KPIs/summary/7days) |
| موظف attendance_enabled=false | Badge "غير خاضع للتقييم" — Header + Clock + Start/End/Break + ملخص المدة فقط. يختفي Target/KPIs/Summary/7Days |
| موظف Fixed Shift | Badge "دوام ثابت" — يظهر target bar مع late/early عند الإنهاء |
| موظف Hourly | Badge "بالساعة" — target bar يظهر بدون تقييم late/early |
| إنهاء اليوم مع تأخير | Toast يظهر "⏰ تم تسجيل تأخير X دقيقة" |
| Break طويل | Timer يوقف حساب net hours + يعرض مدة break |
| Multiple sessions (chaotic) | مجموع اليوم = مجموع كل الجلسات + break محسوب لكل جلسة |
| فقدان الاتصال | Timer يستمر — الأزرار تُعطل — آخر تحديث يتحول للبرتقالي |
| العودة من break | Timer يستأنف — toast "تمت العودة من الاستراحة" |
| بعد منتصف الليل (session跨越日期) | لا تظهر — اليوم ينتهي مع نهاية الجلسة الأولى |

---

## 14. خلاصة — لا تغييرات مطلوبة على الـ Backend

| البند | الحالة |
|---|---|
| RPC جديد مطلوب | **لا** — `get_my_workday_status` يُرجع كل شيء |
| تعديل قاعدة بيانات | **لا** |
| حقل جديد | **لا** |
| override جديد | **لا** |
| Seed جديد | **لا** |
