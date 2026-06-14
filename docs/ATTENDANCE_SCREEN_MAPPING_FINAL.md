# Attendance Screen Mapping — Final Design

> تاريخ الاعتماد: 2026-06-12
> الوضع: مسودة — تنتظر الاعتماد قبل Phase 3

---

## 1. Legacy Screens — المصير النهائي

### AttendancePage (`/attendance`)
- **المصير**: يعاد تصميمها بالكامل
- **السبب**: الشاشة الحالية هي مجرد start/end/break. النهائي سيحتوي على runtime كامل مع work policy badge, target vs actual, اليوم في لمحة, زر بدء/إنهاء اليوم مع bootstrap, ولوحة تحكم مصغرة.
- **الفترة الانتقالية**: تبقى كمدخل مؤقت خلال Phase 3-5.
- **الاستبدال في**: Phase 6 — Employee Self-Service Runtime

### LiveMonitoringPage (`/attendance/live`)
- **المصير**: تستبدل بالكامل بـ Operations Center
- **السبب**: شاشة المراقبة الحالية بسيطة ولا تحتوي على تحليلات أو تنبيهات أو فلاتر. الـ Operations Center الجديد سيجمع live + alerts + analytics في شاشة واحدة.
- **الفترة الانتقالية**: تبقى خلال Phase 3-5 لأن Phase 6 هو موعد الـ UI النهائي.
- **الاستبدال في**: Phase 7 — Operations Center

### TeamMapPage (`/attendance/team-map`)
- **المصير**: تبقى كشاشة مستقلة — تُحسّن تدريجياً
- **السبب**: الخريطة الحية للفريق هي وظيفة قائمة بذاتها ومطلوبة كشاشة مستقلة.
- **التحسينات**: cluster markers, filtering, employee selection → detail.
- **الاستبدال في**: Phase 5 — تحسينات Route Maps

### AlertsPage (`/attendance/alerts`)
- **المصير**: تدمج في Operations Center (لا تبقى كشاشة منفصلة)
- **السبب**: التنبيهات التشغيلية يجب أن تكون لوحة جانبية (panel) داخل Operations Center وليس شاشة منفصلة.
- **الفترة الانتقالية**: تبقى خلال Phase 4-6 كشاشة مؤقتة.
- **الاستبدال في**: Phase 7 — Operations Center Alerts Panel

### ReportsPage (`/attendance/reports`)
- **المصير**: تعاد كتابتها بالكامل
- **السبب**: التقارير الحالية تعرض data فقط. الشاشة النهائية يجب أن تحتوي على Productivity Ledger, Composite Scores, export متقدم, فلاتر مرنة.
- **الفترة الانتقالية**: تبقى خلال Phase 3-6.
- **الاستبدال في**: Phase 6 — Productivity & Analytics Dashboard

### HistoryPage (`/attendance/history`)
- **المصير**: تدمج داخل Employee Workday Detail
- **السبب**: سجل الأيام السابقة يجب أن يكون tab داخل شاشة الموظف وليس صفحة standalone مع input manual للمعرف.
- **الفترة الانتقالية**: تبقى خلال Phase 3-6.
- **الاستبدال في**: Phase 6 — Employee Workday Detail

### EmployeeDayMapPage (`/attendance/map/:employeeId/:date`)
- **المصير**: تعاد كتابتها بالكامل — تصبح جزءاً من Employee Workday Detail
- **السبب**: يحتاج الموظف إلى شاشة واحدة متكاملة: خريطة + جدول زمني + stops + productivity + ملخص اليوم. حالياً هي مجرد مسار على خريطة.
- **الفترة الانتقالية**: تبقى خلال Phase 3-5.
- **الاستبدال في**: Phase 6 — Employee Workday Detail مع Route + Timeline + Ledger

### AttendanceSettingsPage (`/attendance/settings`)
- **المصير**: تبقى كصفحة إعدادات — مع إضافة tabs جديدة
- **السبب**: الإعدادات + work policies + shift templates هي شاشة إدارية ثابتة. الهيكل الحالي (tab عام + tab work policies) صحيح ويحتاج فقط إضافة tab للـ shift templates.
- **التحسينات**: إضافة tab لـ Shift Templates (قوالب الدوام) + Tracking Configuration.
- **الاستبدال في**: Phase 5 — إضافة Shift Templates

---

## 2. Final Screens — الشاشات النهائية بعد المشروع

### 2.1 Employee Self-Service Runtime
- **المسار**: `/attendance`
- **الصلاحية**: جميع الموظفين
- **الوصف**: الشاشة الرئيسية للموظف. تحتوي على:
  - زر بدء/إنهاء يوم العمل (مع Bootstrap Animation)
  - Break — start/end
  - Work Policy Badge (ميداني/مكتبي + دوام ثابت/مرن/بالساعة)
  - Target vs Actual Progress Bar
  - Today KPIs: orders, sales, collections, new customers
  - Net Work Hours Tracker (يحدث live)
  - زر "تفاصيل يومي" → Employee Workday Detail
  - حالة الاتصال (Online/Offline queue)
  - **الإدارة العليا**: تظهر Only Badge "غير خاضع للتقييم" + Start/End فقط

### 2.2 Employee Workday Detail
- **المسار**: `/attendance/employee/:employeeId/:date`
- **الصلاحية**: مشرف, مدير بيع, إدارة عليا + الموظف نفسه
- **الوصف**: الشاشة المتكاملة ليوم عمل موظف واحد. تحتوي على:
  - **Route Map** (Leaflet مع polyline + markers للزيارات)
  - **Day Timeline** (جدول زمني: بداية → زيارات → break → نهاية)
  - **Long Stops** (التوقف الطويل في مكان واحد + السبب)
  - **Productivity Ledger** (طلبات + مبيعات + تحصيلات + عملاء جدد)
  - **Work Hours Breakdown** (حضور/انصراف + استراحات + net hours)
  - **Target vs Actual** (progress + remaining)
  - **Composite Score** (0-100 بناءً على الحضور + الإنتاجية)
  - **Day Summary Card** (حقائق سريعة + حالة اليوم)
  - **History Tabs** (scroll through previous/next days)
  - **Tracking Replay** (إعادة مسار اليوم — مستقبلاً)

### 2.3 Operations Center
- **المسار**: `/attendance/operations`
- **الصلاحية**: مدير بيع, إدارة عليا, مشرف
- **الوصف**: غرفة العمليات — أهم شاشة في النظام. تجمع:
  - **Live Overview** (عدد النشطاء, في زيارات, في استراحة, منقطع)
  - **Alerts Panel** (لوحة جانبية مع تنبيهات مباشرة)
  - **Employee Quick View** (بطاقات مصغرة مع: الاسم, الحالة, مدة اليوم, KPIs)
  - **Filters**: القسم, المنطقة, نوع الدوام, حالة الاتصال
  - **Actions**: فتح Detail, إرسال إشعار, الاتصال
  - **Mini Analytics**: متوسط net hours اليوم, معدل الإنجاز, المتأخرون اليوم
  - **Tab للمنتهين** (الذين أنهوا اليوم مع ملخص)
  - **Tab لمن لم يبدؤوا** (مع إشعارات)

### 2.4 Team Map
- **المسار**: `/attendance/team-map`
- **الصلاحية**: مشرف, مدير بيع, إدارة عليا
- **الوصف**: خريطة حية بكل الفريق. تحسينات عن الحالي:
  - Cluster Markers عند الزحام
  - Filter: section, region, status
  - Employee Selection → يفتح Worker Detail مباشرة
  - Color-coded status (أخضر = يعمل, أزرق = زيارة, أصفر = break, أحمر = انقطاع)
  - Legend + Last update timestamp
  - Click on marker → popup مع ملخص سريع + زر "فتح التفاصيل"

### 2.5 Productivity & Analytics Dashboard
- **المسار**: `/attendance/analytics`
- **الصلاحية**: مدير بيع, إدارة عليا
- **الوصف**: لوحة تحليلية متقدمة:
  - **Attendance Reports** (التقرير الحالي — معزز)
  - **Productivity Ledger** (لكل موظف: orders/sales/collections/customers over time)
  - **Composite Scores** (ترتيب الفريق حسب الأداء)
  - **Best/Worst Day Analysis**
  - **Hourly Trends** (ساعات العمل مقابل الإنتاجية)
  - **Excel/CSV Export**
  - **Date Range Filter** + Employee Filter
  - **Export PDF** (للتقرير الشهري)

### 2.6 Work Policies
- **المسار**: `/attendance/settings#work-policies`
- **الصلاحية**: مدير بيع, إدارة عليا (attendance.configure)
- **الوصف**: موجودة حالياً. إضافة:
  - **Shift Templates** (قوالب دوام: fixed_shift مع start/end/grace)
  - **Bulk Assign** (تعيين policy لمجموعة)
  - **Import/Export** CSV
  - **History Log** (من غير ومتى)

### 2.7 Attendance Settings
- **المسار**: `/attendance/settings#general`
- **الصلاحية**: إدارة عليا (attendance.configure)
- **الوصف**: إعدادات عامة:
  - مواعيد الدوام الرسمية (للمقارنة فقط — لكل موظف policy خاصة)
  - إعدادات التتبع: interval, accuracy threshold
  - Grace period
  - **Tracking Configuration**: offline timeout, sync interval
  - **Alert Thresholds**: متى يُعتبر انقطاعاً، متى يُعتبر break طويلاً

---
> **ملاحظة**: تم إلغاء Supervisor Dashboard بقرار تشغيلي.
> Supervisor يعامل كموظف من ناحية الحضور والانصراف — ليس جهة رقابية مستقلة.

---

## 3. Screen Mapping — Current State

| المسار | الشاشة الحالية | الحالة |
|---|---|---|
| `/attendance` | AttendanceRouter | **يعمل** — يوجّه إلى Runtime للموظف أو Module Home للإدارة |
| `/attendance/runtime` | Employee Self-Service Runtime | **يعمل** |
| `/attendance/operations` | Operations Center | **يعمل** |
| `/attendance/team-map` | TeamMapPage | **موجود — يحتاج تحسين** (خريطة Leaflet) |
| `/attendance/employee/:id/:date` | Employee Workday Detail | **يعمل** |
| `/attendance/settings` | Attendance Settings + Work Policies | **يعمل** |

### تم حذفها (إرث قديم)

| المسار | الشاشة | سبب الحذف |
|---|---|---|
| `/attendance/live` | LiveMonitoringPage | **مُلغى** — مستبدل بـ Operations Center |
| `/attendance/alerts` | AlertsPage | **مُلغى** — مدمج في Operations Center |
| `/attendance/reports` | ReportsPage (قديم) | **مُلغى** — بانتظار Productivity & Analytics Dashboard |
| `/attendance/history` | HistoryPage | **مُلغى** — مدمج في Employee Workday Detail |
| `/attendance/map/:emp/:date` | EmployeeDayMapPage | **مُلغى** — مدمج في Employee Workday Detail |
| `/attendance` (قديم) | AttendancePage (قديم) | **مُلغى** — مستبدل بـ Runtime |
| `/attendance/supervisor` | Supervisor Dashboard | **مُلغى** — بقرار تشغيلي (Supervisor = موظف) |

---

## 4. Employee Experience — حسب الدور

### المندوب (Sales Rep)
| قبل | بعد المشروع |
|---|---|
| فتح الصفحة → يضغط بدء يوم ← يشتغل ← يضغط break ← يضغط نهاية | يفتح الـ Self-Service Runtime → يرى badge + target bar + KPIs الحية + حالة التتبع → يبدأ/ينتهي اليوم → يفتح تفاصيل يومه ليرى خريطته وإنتاجيته |
| ما يعرف كم أنجز اليوم | يعرف: كم طلب, كم مبيعات, كم تحصيل, كم ساعة صافي, كم متبقي |
| ما يعرف إذا متأخر أو منضبط | يعرف وضعه: ملتزم / متأخر / أنجز المستهدف |
| ما عنده تقييم ليومه | عنده Composite Score + Best Day/Worst Day |

### المشرف (Supervisor)
> **تغيير تشغيلي**: Supervisor يعامل كموظف عادي من ناحية الحضور والانصراف.
> لا توجد شاشة رقابية مستقلة للمشرف. يستخدم Operations Center للإدارة العليا ومدير البيع.

| قبل | بعد المشروع |
|---|---|
| يفتح Live → يرى الموظفين النشطين | يستخدم **Team Map** لرؤية الفريق أو **Operations Center** (للمديرين) |
| يفتح الخريطة → يرى كل الفريق (بدون فلتر) | يفتح Team Map → يرى فريقه + فلاتر + employee detail |
| يستخدم History → يكتب employee id يدوياً | يفتح Employee Detail مباشرة من Team Map |
| ما عنده تنبيهات مباشرة | يرى التنبيهات في Operations Center |

### مدير البيع (Sales Manager)
| قبل | بعد المشروع |
|---|---|
| يشوف التقارير الأساسية | يفتح **Productivity & Analytics Dashboard** → يشوف Composite scores, Best/Worst, hourly trends, downloadable reports |
| يستخدم المراقبة المباشرة | Operations Center → كل الفريق + analytics + alerts + إجراءات |
| يضبط إعدادات الدوام | Work Policies → shift templates + bulk assign + history log |
| ما عنده تقييم أداء | يقدر يقيّم المندوبين: Composite Score, إنتاجية, التزام |

### الإدارة العليا (Executive — `attendance_enabled=false`)
| قبل | بعد المشروع |
|---|---|
| ما يظهر لهم شيء خاص | **Operations Center** يظهر "غير خاضع للتقييم" + Start/End فقط |
| لا يتأثرون بالتقارير | جميع التقارير والتحليلات والتنبيهات تستثنيهم تلقائياً |
| ما عنده لوحة قيادة | **Operations Center** كلوحة قيادة عليا: نظرة عامة على أداء الفريق بدون تضمين أنفسهم |

---

## 5. Operations Center — Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  🖥️  غرفة العمليات                [فلتر: □ قسم □ منطقة]   │
│  ┌──────────────────────┬──────────────────────────────────┐│
│  │  COUNTERS            │  ALERTS PANEL                    ││
│  │  ┌────┬────┬────┬──┐│  ┌────────────────────────────┐  ││
│  │  │نشط │زيارة│break│││  │ 🔴 لم يبدأ: 2              │  ││
│  │  │  8 │  3  │  2  │││  │ 🟡 استراحة طويلة: 1        │  ││
│  │  └────┴────┴────┴──┘│  │ ⚠️ انقطاع: 3               │  ││
│  │  ┌────┬────┬────┬──┐│  │ 📅 أمس مفتوح: 1            │  ││
│  │  │قطع │لم يبدأ│منتهي││  └────────────────────────────┘  ││
│  │  │  1 │  3   │  5  ││  │                                ││
│  │  └────┴────┴────┴──┘│  │ 📊 Mini Analytics            ││
│  │                     │  │ متوسط net: 5.2h / 8h         ││
│  │                     │  │ نسبة الإنجاز: 65%             ││
│  │                     │  │ المتأخرون اليوم: 2            ││
│  │                     │  └────────────────────────────────┘│
│  ├──────────────────────┴──────────────────────────────────┤│
│  │  EMPLOYEE CARDS (Layout: Grid)                          ││
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐          ││
│  │  │ 🟢 محمد    │ │ 🔵 أحمد   │ │ 🟡 خالد    │          ││
│  │  │ ميداني-مرن   │ │ مكتبي-ثابت │ │ ميداني-مرن  │          ││
│  │  │ 07:30-15:00 │ │ 08:00-... │ │ 09:00-...  │          ││
│  │  │ طلبات:5     │ │ طلبات:3   │ │ طلبات:0    │          ││
│  │  │ مبيعات:12k  │ │ مبيعات:8k │ │ مبيعات:0   │          ││
│  │  │ [التفاصيل]  │ │ [التفاصيل]│ │ [التفاصيل]  │          ││
│  │  └────────────┘ └────────────┘ └────────────┘          ││
│  │                                                         ││
│  │  ██████████████████████████░░░░░░░░░░ 5h 32m / 8h       ││
│  │  Overall Team Progress Bar                              ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### مكونات Operations Center

| المكوّن | الوصف |
|---|---|
| **Counters Bar** | 8 مربعات رقمية: نشط, في زيارة, استراحة, انقطاع, لم يبدأ, بلا زيارات, بلا طلبات, منتهي |
| **Alerts Panel** | لوحة جانبية (يمين) مع تنبيهات مباشرة مع مرشحات. تظهر أحمر/أصفر حسب الخطورة |
| **Mini Analytics** | متوسط net hours, نسبة الإنجاز, المتأخرون, أفضل/أسوأ أداء |
| **Employee Cards** | بطاقات مصغرة ببيانات الـ Live + KPIs مع أزرار action |
| **Team Progress Bar** | شريط تقدم عام للفريق (إجمالي net hours ÷ إجمالي target) |
| **Filters** | قسم, منطقة, نوع الدوام, حالة الاتصال |
| **Tabs** | (1) النشطون (2) المنتهون (3) لم يبدؤوا (4) الخريطة |

---

## 6. Employee Workday Detail — Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  🔙  يوم عمل: محمد أحمد (REP001) — 2026-06-12 (الخميس)   │
│  🏆 Composite Score: 87 / 100    [← أمس] [اليوم] [غداً →]  │
│  ┌─────────────┬───────────────────────────────────────────┐│
│  │  ROUTE MAP  │  DAY TIMELINE                             ││
│  │  (Leaflet)  │  07:30 🟢 بداية اليوم                     ││
│  │             │  07:45 🔵 زيارة: عميل أحمد (15 د)          ││
│  │   🏠        │  08:30 🔵 زيارة: عميل محمد (30 د)          ││
│  │    \        │  09:15 📦 طلبية: 12,500 ج.م                ││
│  │     ●──●    │  10:00 🟡 استراحة (15 د)                   ││
│  │      \     │  10:30 🔵 زيارة: عميل خالد (45 د)          ││
│  │       ●    │  11:30 💰 تحصيل: 5,000 ج.م                 ││
│  │      /     │  12:00 ⚠️ موقف طويل (40 د): غداء           ││
│  │     ●──●   │  13:00 📦 طلبية: 8,200 ج.م                 ││
│  │    /        │  14:30 ✅ نهاية اليوم                      ││
│  │   🏢        │                                           ││
│  │             │  LONG STOPS                                ││
│  │  Legend:    │  ⚠️ 12:00-12:40 (40 د) — منطقة الغداء     ││
│  │  🟢 عمل     │  ⚠️ 10:30-11:15 (45 د) — منطقة العميل     ││
│  │  🔵 زيارة  │                                           ││
│  │  🟡 استراحة│                                           ││
│  └─────────────┴───────────────────────────────────────────┘│
│                                                             │
│  ┌───────────────────┬───────────────────┬───────────────┐  │
│  │  WORK HOURS       │  PRODUCTIVITY     │  TARGET vs    │  │
│  │  ───────────       │  ───────────      │  ACTUAL        │  │
│  │  حضور: 07:30      │  طلبيات: 5       │  ██████████   │  │
│  │  انصراف: 14:30    │  مبيعات: 20,700  │  ░░░░░░░░░░   │  │
│  │  إجمالي: 7:00     │  تحصيلات: 5,000  │  5.5h / 8h    │  │
│  │  استراحات: 0:45   │  عملاء جدد: 2    │  69% ✅       │  │
│  │  صافي: 6:15       │                  │               │  │
│  │  التأخير: 0 د    │                  │  متبقي: 2.5h  │  │
│  │                   │                  │               │  │
│  └───────────────────┴───────────────────┴───────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  WEEK HISTORY (الأيام السبعة الماضية)                    ││
│  │  ┌────┬────┬────┬────┬────┬────┬────┐                    ││
│  │  │ سبت│ أحد│ إثن│ ثلا│ أرب│ خمي│ جمعة│                    ││
│  │  │5.2h│6.1h│7.0h│4.5h│7.5h│6.2h│  -  │                    ││
│  │  │متأخر│ملتزم│ملتزم│مبكر│ملتزم│ملتزم│إجازة│                    ││
│  │  └────┴────┴────┴────┴────┴────┴────┘                    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### مكونات Employee Workday Detail

| المكوّن | الوصف |
|---|---|
| **Header** | اسم الموظف, التاريخ, اليوم, Composite Score, أزرار التنقل بين الأيام |
| **Route Map** | Leaflet خريطة كاملة: polyline route, markers للزيارات والطلبات والتحصيلات, home/work icons |
| **Day Timeline** | جدول زمني رأسي sorting: كل حدث بساعة + type icon + وصف |
| **Long Stops** | قائمة بالتوقفات الطويلة (>30 د) مع الوقت والمدة والمنطقة |
| **Work Hours** | حضور, انصراف, إجمالي, استراحات, صافي, تأخير, انصراف مبكر |
| **Productivity** | طلبيات, مبيعات, تحصيلات, عملاء جدد — كلها بقيم رقمية |
| **Target vs Actual** | Progress bar مع remaining time |
| **Week History** | 7 أيام سابقة: net hours + attendance status لكل يوم |

---

## 7. Decommission Plan — الشاشات القديمة

### ✅ تم الحذف — Phase 1

| الشاشة | تاريخ الحذف | ملاحظات |
|---|---|---|
| `LiveMonitoringPage` | **14 يونيو 2026** | مستبدل بـ Operations Center |
| `AlertsPage` | **14 يونيو 2026** | مدمج في Operations Center |
| `ReportsPage` | **14 يونيو 2026** | بانتظار Productivity & Analytics Dashboard |
| `HistoryPage` | **14 يونيو 2026** | مدمج في Employee Workday Detail |
| `EmployeeDayMapPage` | **14 يونيو 2026** | مدمج في Employee Workday Detail |
| `AttendancePage` (قديم) | **14 يونيو 2026** | مستبدل بـ Runtime |
| `Supervisor Dashboard` | **14 يونيو 2026** | بقرار تشغيلي |

### ستبقى بعد المشروع

| الشاشة | سبب الإبقاء |
|---|---|
| `TeamMapPage` | شاشة قائمة بذاتها — تحتاج تحسين |
| `AttendanceSettingsPage` | إعدادات + Work Policies + Shift Templates |
| `Operations Center` | تشغيليّة — غرفة العمليات الرئيسية |
| `Employee Workday Detail` | تفاصيل يوم عمل الموظف |
| `Employee Self-Service Runtime` | شاشة الموظف الرئيسية |
| `Productivity & Analytics Dashboard` | **جديدة — لم تنفذ بعد** |

---

## ملخص الشاشات بعد التحديث

| الشاشة | النوع | الحالة |
|---|---|---|
| Employee Self-Service Runtime | **تشغيلية** | ✅ منفذة |
| Operations Center | **رقابية** | ✅ منفذة |
| Team Map Enhanced | **رقابية** | ⚠️ تحتاج تحسين (خريطة Leaflet) |
| Employee Workday Detail | **تحليلية** | ✅ منفذة |
| Productivity & Analytics Dashboard | **تحليلية** | ❌ غير منفذة |
| Attendance Settings | **إدارية** | ✅ منفذة |
| Work Policies | **إدارية** | ✅ منفذة |
| Supervisor Dashboard | — | **مُلغى** (بقرار تشغيلي) |
