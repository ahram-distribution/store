# Root Cause Report — EmployeeWorkdayDetailPage

> **الهدف**: تحديد سبب عرض "لا توجد نقاط تتبع" / "لا توجد أحداث" / "0 كم" / "لا توجد بيانات ساعات عمل" / "لا توجد استراحات" رغم وجود نشاط فعلى للمناديب.
> 
> **مبدأ**: تحقيق فقط — لا إصلاح في هذا التقرير.

---

## 1. RPCs المستخدمة داخل الشاشة

| # | الـ RPC | السطر في الصفحة | الاستخدام |
|---|--------|----------------|-----------|
| 1 | `get_governed_employee` | 152 | اسم الموظف فقط |
| 2 | `get_employee_workday_history` | 153 | بيانات الجلسة + السجل (ساعات، استراحات، زيارات، طلبات) |
| 3 | `get_employee_day_map` | 154 | خريطة المسار + نقاط التتبع + المسافة + زيارات العميل + التوقفات |
| 4 | `get_employee_day_timeline` | 155 | الأحداث (بداية/نهاية اليوم، استراحات، زيارات، طلبات، تحصيلات) |
| 5 | `get_daily_target_vs_actual` | 173 | شريط التقدم + آخر 7 أيام |
| 6 | `get_work_hours_ledger` | 199 | سجل ساعات العمل التفصيلي (ledger) |

**ملاحظة**: الصفحة لا تستخدم `attendanceService` — تستدعي `supabase.rpc()` مباشرة.

---

## 2. مصدر كل قسم

| القسم | مصدر RPC | جدول في DB | العمود / الفلتر الرئيسي |
|-------|---------|-----------|------------------------|
| **Summary Card** (بداية/نهاية/مدة/استراحة/مسافة/زيارات/طلبات/مبيعات) | `get_employee_workday_history` | `workday_sessions` + LEFT JOIN `workday_breaks`, `orders`, `collections`, `customers` | `wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to` |
| **Target Progress** | `get_daily_target_vs_actual` | `workday_sessions` + `employee_work_policies` + `employee_monthly_targets` | `wds.status = 'completed'` فقط |
| **خريطة المسار** | `get_employee_day_map` | `tracking_points` | `tp.employee_id = p_employee_id AND tp.recorded_at::date = p_date` |
| **المسافة (كم)** | `get_employee_day_map` | محسوب من `tracking_points` (بعد تصفية GPS drift) | تراكمي بعد فلاتر الدقة والمسافة والسرعة |
| **نقاط التتبع (قائمة)** | `get_employee_day_map` | `tracking_points` | غير مفلتر (كل النقاط) |
| **Visit Locations** | `get_employee_day_map` | `visits` | `v.employee_id = p_employee_id AND v.check_in_at::date = p_date AND v.check_in_latitude IS NOT NULL` |
| **Long Stops** | `get_employee_day_map` | `tracking_points` (محسوب من الفجوات) | فجوة > 5 دقائق بين النقاط المتتالية |
| **الخط الزمني** | `get_employee_day_timeline` | UNION ALL: `workday_sessions`, `workday_breaks`, `visits`, `orders`, `collections`, `customers` | session عبر `v_session_record.id` للاستراحات; employee_id + date للباقي |
| **سجل ساعات العمل** | `get_work_hours_ledger` | **❌ غير معروف — RPC مفقود (انظر القسم 4)** | **❌** |
| **سجل الاستراحات (تفصيلي)** | `get_employee_day_timeline` (يُشتق frontend) | `workday_breaks` عبر `workday_sessions` | `wb.session_id = v_session_record.id` |

---

## 3. تدفق البيانات لكل قسم

```
Database → RPC → Frontend
```

### 3.1 Route Map + Tracking Points + Distance

```
tracking_points (employee_id, recorded_at::date = p_date)
    → get_employee_day_map
        ← IF permission denied: { error: 'FORBIDDEN' }
        ← IF no session found:   { session: {nulls}, route: [], ... } — MA يزال يعيد المسار
        ← IF data exists:        { session: {...}, route: [...], total_distance_km: "...", ... }
    → EmployeeWorkdayDetailPage
        ← mapRes.data && !mapRes.data.error → setMapData(...)
        ← mapData null → "لا توجد نقاط تتبع" + "0 كم" أو "--"
```

### 3.2 Timeline

```
workday_sessions (session_id) → workday_start, workday_end
workday_breaks (session_id)  → break_start, break_end
visits (employee_id, date)   → visit_start, visit_end
orders (resolve_employee_id, date) → order_created
collections (resolve_employee_id, date) → collection_taken
customers (resolve_employee_id, date) → new_customer
    → get_employee_day_timeline (UNION ALL)
        ← IF permission denied: { error: 'FORBIDDEN' }
        ← IF no events:         { events: [] }
        ← IF events exist:      { events: [{...}] }
    → EmployeeWorkdayDetailPage
        ← timelineRes.data && !timelineRes.data.error → setTimeline(...)
        ← timeline null → "لا توجد أحداث"
        ← timeline.events.length === 0 → "لا توجد أحداث"
```

### 3.3 Work Hours Ledger

```
??? (مصدر غير معروف)
    → get_work_hours_ledger (❌ RPC غير موجود)
        ← خطأ: RPC does not exist
        ← ledgerRes.data = null/error
    → EmployeeWorkdayDetailPage
        ← workHoursLedger null → "لا توجد بيانات"
```

### 3.4 Break History (Detailed)

```
workday_breaks (session_id = v_session_record.id)
    → get_employee_day_timeline (ضمن UNION ALL)
        ← break_start / break_end events
    → BreakHistoryTable (frontend)
        ← يحسب الاستراحات من events (break_start → break_end)
        ← لو ما في events → "لا توجد استراحات في الخط الزمني"
```

---

## 4. نقطة الانكسار — 3 أسباب جذرية

### ⚠️ السبب الجذري A: `get_work_hours_ledger` غير موجود (MISSING RPC)

**الدليل القاطع**: 104 ملفات SQL في `supabase/migrations/` — ولا ملف واحد يحتوي على `CREATE OR REPLACE FUNCTION get_work_hours_ledger`.

```
C:\Projects\store\supabase\migrations\*.sql
    → grep "get_work_hours_ledger" → صفر نتيجة
```

| الموقع | ماذا يحدث |
|--------|-----------|
| قاعدة البيانات | لا يوجد RPC باسم `get_work_hours_ledger` |
| استدعاء RPC | `supabase.rpc('get_work_hours_ledger', ...)` → خطأ (RPC غير موجود) |
| `ledgerRes.data` | `null` أو object يحوي `error` |
| `workHoursLedger` | يبقى `null` |
| الواجهة | "لا توجد بيانات ساعات عمل" |

**السيناريوهات المحتملة**:
1. الـ RPC لم يُنشأ أبداً — خطأ فني (مفقود من الملفات والـ DB)
2. الـ RPC أُنشئ يدوياً في Supabase SQL Editor لكنه لم يُهاجر (lost in next deploy)
3. الـ RPC موجود لكن اسمه مختلف أو باراميتراته مختلفة

---

### ⚠️ السبب الجذري B: صلاحية `attendance.view_timeline` غير ممنوحة للمستخدم

**هذا هو المرجح لاختفاء نقاط التتبع + الأحداث**

نظام الصلاحيات غير موحد بين RPCs:

| RPC | التحقق من الصلاحية | RPC نفسه |
|-----|-------------------|---------|
| `get_employee_workday_history` | `is_upper_management()` OR `get_visible_employee_ids()` | `20260727_fix_attendance_detail_rpcs.sql:542` |
| `get_employee_day_map` | `check_capability(p_token, 'attendance.view_timeline')` + subtree | `20260727_fix_attendance_detail_rpcs.sql:219` |
| `get_employee_day_timeline` | `check_capability(p_token, 'attendance.view_timeline')` + subtree | `20260727_fix_attendance_detail_rpcs.sql:45` |

**السيناريو**:
- المستخدم لديه صلاحية `attendance.view_history` أو هو من الإدارة العليا → `get_employee_workday_history` ينجح → `session` يُملأ → كل التفاصيل تظهر
- المستخدم **لا يملك** صلاحية `attendance.view_timeline` → `get_employee_day_map` و `get_employee_day_timeline` يعيدان `{ error: 'FORBIDDEN' }`
- الواجهة تتحقق `if (mapRes.data && !mapRes.data.error)` → شرط فاشل → `mapData` يبقى `null`
- `if (timelineRes.data && !timelineRes.data.error)` → شرط فاشل → `timeline` يبقى `null`

**النتيجة**: المستخدم يرى تفاصيل الجلسة (اسم الموظف، ساعات العمل، عدد الزيارات، عدد الطلبات) لكن كل الأقسام المعتمدة على `get_employee_day_map` و `get_employee_day_timeline` تظهر فارغة.

**الأقسام المتأثرة**:
- ✓ ملخص اليوم (يعمل — من history)
- ✗ خريطة المسار — "لا توجد نقاط تتبع"
- ✗ المسافة — "0 كم"
- ✗ نقاط التتبع — 0 نقطة
- ✗ Visit Locations — مخفية (ضمن Route Map)
- ✗ Long Stops — "لا توجد توقفات طويلة"
- ✗ الخط الزمني — "لا توجد أحداث"
- ✗ سجل الاستراحات التفصيلي — "لا توجد استراحات" (يعتمد على timeline events)
- ✓ سجل ساعات العمل — "لا توجد بيانات" (لأن الـ RPC نفسه مفقود — سبب جذري منفصل A)

---

### ⚠️ السبب الجذري C: عدد نقاط التتبع صفر (لكن database بها بيانات)

حتى لو صلاحية `view_timeline` موجودة، نقاط التتبع قد تكون فارغة لعدة أسباب:

| السبب | التفاصيل |
|-------|---------|
| **GPS filter threshold** | `get_employee_day_map` يستخدم `p_min_distance_threshold = 20` متر. لو كل النقاط أقرب من 20 متر من بعض → `v_total_distance = 0`. لكن المسار نفسه لا يزال يُعرض (v_route يُبنى من كل النقاط قبل الفلترة) |
| **GPS accuracy filter** | `p_max_accuracy = 50` متر. لو accuracy > 50 → النقاط تُستبعد من حساب المسافة (لكن تبقى في المسار) |
| **لا يوجد workday_session** | لو `workday_sessions` لا يحتوي صف لهذا الموظف في هذا التاريخ → `v_session_record` يكون NULL. لكن route لا يزال يُستعلم. الفرق: visit_locations تعمل (لأنها تعتمد على employee_id + date وليس session_id) |
| **Tracking Points غير مفعلة** | Tracking Queue/Engine لا يُرسل نقاط (مشكلة معروفة في build الحالي) |

**لكن**: النتيجة النهائية لهذا السبب هي "0 نقطة تتبع" فقط — وليس اختفاء كل الأقسام. المشكلة المبلغ عنها تشمل 5 أقسام فارغة مما يشير إلى سبب جذري أوسع (A و B).

---

## 5. ملخص — شجرة القرار

```
هل session موجود؟ (get_employee_workday_history)
│
├── لا → "لا توجد بيانات لهذا اليوم" (لا يوجد workday_session لهذا اليوم)
│
└── نعم → الصفحة تعرض تفاصيل اليوم
        │
        ├── get_employee_day_map ← هل المستخدم لديه attendance.view_timeline?
        │   │
        │   ├── لا → mapData null → "لا توجد نقاط تتبع" + "0 كم"
        │   │
        │   └── نعم → هل توجد tracking_points لهذا الموظف في هذا التاريخ؟
        │           │
        │           ├── لا → route فارغ → "لا توجد نقاط تتبع"
        │           │
        │           └── نعم → يعرض الخريطة والنقاط والمسافة
        │
        ├── get_employee_day_timeline ← هل المستخدم لديه attendance.view_timeline?
        │   │
        │   ├── لا → timeline null → "لا توجد أحداث"
        │   │
        │   └── نعم → هل توجد أحداث (workday_start, visits, orders, ...)؟
        │           │
        │           ├── لا → events [] → "لا توجد أحداث"
        │           │
        │           └── نعم → يعرض الخط الزمني
        │
        └── get_work_hours_ledger ← هل RPC موجود؟
            │
            ├── لا (مؤكد بنسبة 100%) → ledgerRes به خطأ → "لا توجد بيانات"
            │
            └── نعم → هل توجد بيانات Ledger؟
                    │
                    ├── لا → "لا توجد بيانات"
                    │
                    └── نعم → يعرض السجل
```

---

## 6. التوصيات للتحقق (قبل الإصلاح)

| # | ما يتم التحقق منه | كيف |
|---|-----------------|-----|
| 1 | هل `get_work_hours_ledger` موجود على production Supabase؟ | `SELECT proname FROM pg_proc WHERE proname = 'get_work_hours_ledger'` |
| 2 | هل المستخدم لديه `attendance.view_timeline`؟ | `SELECT check_capability('TOKEN_HERE', 'attendance.view_timeline')` |
| 3 | هل `attendance.view_timeline` ممنوحة لدور المستخدم أو مباشرة؟ | فحص `employee_capabilities` و `role_capabilities` |
| 4 | هل البيانات موجودة فعلاً لموظف معين؟ | `SELECT COUNT(*) FROM tracking_points WHERE employee_id = '...' AND recorded_at::date = '2026-06-22'` |
| 5 | هل `workday_sessions` موجود لهذا الموظف والتاريخ؟ | `SELECT id, status FROM workday_sessions WHERE employee_id = '...' AND date = '2026-06-22'` |

---

## 7. القرارات المطلوبة

بناءً على هذا التقرير، الخيارات المتاحة:

### Option 1: إصلاح شامل
```
1. إنشاء RPC مفقود: get_work_hours_ledger
2. منح صلاحية attendance.view_timeline للمستخدمين المطلوبين (أو تغيير صلاحية RPCs)
3. (اختياري) إزالة GPS drift filters المؤقتة لتأكيد ظهور النقاط
```

### Option 2: حذف الأجزاء المعطلة
```
1. إزالة قسم "سجل ساعات العمل" (يعتمد على RPC مفقود — غير مستخدم في أي شاشة أخرى)
2. إزالة قسم "نقاط التتبع" (قيمة تشغيلية منخفضة — "0 نقطة" يربك المستخدم)
3. إبقاء الخريطة والخط الزمني مع إصلاح الصلاحيات
```

### Option 3: إصلاح جزئي + حذف
```
1. إصلاح صلاحية attendance.view_timeline (السبب الأكبر)
2. حذف قسم "سجل ساعات العمل" (RPC مفقود — لا فائدة من إنشائه لوحده)
3. إزالة جدول "نقاط التتبع" التفصيلي من الواجهة
```

---

## 8. ملاحظات إضافية

1. **`resolve_employee_id` ليس سبباً**: الدالة تعمل بشكل صحيح — تبحث أولاً عن `employees.id`, ثم `employees.identity_id`. لو owner_id يخزن identity ID، الحل يعمل. لو owner_id يخزن شيئاً آخر (رقم سلسلة أو NULL)، `resolve_employee_id` يعيد NULL وتفشل المطابقة. لكن هذا لا يفسر اختفاء tracking_points (التي لا تستخدم `resolve_employee_id`).

2. **فجوة تاريخية في `get_work_hours_ledger`**: الـ RPC مرجع في الكود (من `20260723_phase7_work_hours_analytics_v2.sql`) لكنه لم يُنشأ أبداً كميغراشن. هذا يشير إلى أن الـ RPC كان مزمناً للمرحلة 7 من attendance v2 لكنه لم يكتمل.

3. **`get_employee_day_map` يعيد المسار حتى لو `v_session_record` فارغ**: استعلام `tracking_points` لا يعتمد على `workday_sessions` — فقط على `employee_id` و `date`. حتى لو لم يبدأ الموظف يومه رسمياً، نقاط التتبع تظهر (إذا كانت موجودة).

4. **فخ `get_daily_target_vs_actual`**: الـ RPC يشترط `status = 'completed'` لحساب ساعات العمل. لأي session نشط اليوم، `current_net_seconds` = 0 و `progress_pct` = 0. هذا خطأ منفصل — لا يفسر المشكلة المبلغ عنها لكنه يفسر لماذا يرى المستخدم target progress = 0% ليوم نشط.
