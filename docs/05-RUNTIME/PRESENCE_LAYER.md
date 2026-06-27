# Operational Presence Layer

## الهدف التشغيلي

إظهار **سبب حالة الاتصال** لكل موظف في الوقت الفعلي، بدلاً من مجرد أيقونة ملونة.

**قبل:**
```
🟢 متصل
```

**بعد:**
```
🟢 متصل
آخر نشاط: زيارة منذ 3 دقائق
```

---

## مصدر البيانات

### RPCs المستخدمة (بدون تغيير — البيانات موجودة بالفعل)

| RPC | الشاشات المستخدمة فيها |
|-----|----------------------|
| `get_live_workday_overview` | OperationsCenter, UpperManagementDashboard |
| `get_team_map` | TeamMapPage, MapTab |
| `get_live_attendance_map` (أو `get_coverage_map`) | CoverageMapPage |

### الحقول المستخدمة

| الحقل في RPC | المصدر في SQL | شرح |
|-------------|---------------|------|
| `connection_status` | محسوب من `last_activity_at` | `connected` / `delayed` / `lost` / `no_data` |
| `last_activity_at` | `combined_activity` CTE | آخر توقيت نشاط من أي مصدر من المصادر الـ5 |
| `last_activity_type` | `combined_activity` CTE | نوع آخر نشاط |

### CTE المصدر (في RPC)

```sql
session_activity AS (
    SELECT ws.employee_id, ws.last_seen_at AS activity_at,
        'heartbeat'::text AS activity_type
    FROM active_sessions ws
    WHERE ws.last_seen_at IS NOT NULL
),
tracking_activity AS (
    SELECT DISTINCT ON (tp.employee_id)
        tp.employee_id, tp.recorded_at AS activity_at,
        'gps'::text AS activity_type
    FROM public.tracking_points tp
    WHERE tp.recorded_at >= CURRENT_DATE
    ORDER BY tp.employee_id, tp.recorded_at DESC
),
visit_activity AS (
    SELECT v.employee_id, MAX(v.check_in_at) AS activity_at,
        'visit'::text AS activity_type
    FROM public.visits v WHERE v.check_in_at::date = CURRENT_DATE
    GROUP BY v.employee_id
),
order_activity AS (
    SELECT public.resolve_employee_id(o.owner_id) AS employee_id,
        MAX(o.created_at) AS activity_at,
        'order'::text AS activity_type
    FROM public.orders o WHERE o.created_at::date = CURRENT_DATE
    GROUP BY public.resolve_employee_id(o.owner_id)
),
collection_activity AS (
    SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
        MAX(c.created_at) AS activity_at,
        'collection'::text AS activity_type
    FROM public.collections c WHERE c.created_at::date = CURRENT_DATE
    GROUP BY public.resolve_employee_id(c.owner_id)
),
combined_activity AS (
    SELECT employee_id, activity_at, activity_type FROM session_activity
    UNION ALL SELECT employee_id, activity_at, activity_type FROM tracking_activity
    UNION ALL SELECT employee_id, activity_at, activity_type FROM visit_activity
    UNION ALL SELECT employee_id, activity_at, activity_type FROM order_activity
    UNION ALL SELECT employee_id, activity_at, activity_type FROM collection_activity
),
last_activity AS (
    SELECT DISTINCT ON (employee_id)
        employee_id, activity_at AS last_activity_at,
        activity_type AS last_activity_type
    FROM combined_activity
    ORDER BY employee_id, activity_at DESC NULLS LAST
)
```

### أنواع النشاط وترجمتها

| القيمة من RPC | الترجمة | يظهر عندما |
|--------------|---------|-----------|
| `heartbeat` | نبض النظام | app_open, app_resume, record_heartbeat, touch_session_activity |
| `gps` | تتبع GPS | تم إرسال نقاط تتبع حديثة |
| `visit` | زيارة | تم تسجيل دخول إلى زيارة |
| `order` | طلب | تم إنشاء طلب جديد |
| `collection` | تحصيل | تم إنشاء تحصيل جديد |

### `connection_status` وترجمتها

| القيمة من RPC | الأيقونة | الترجمة | المعنى |
|--------------|---------|---------|--------|
| `connected` | 🟢 | متصل | آخر نشاط منذ أقل من 3 دقائق |
| `delayed` | 🟡 | متأخر | آخر نشاط منذ 3-15 دقيقة |
| `lost` | 🔴 | منقطع | آخر نشاط منذ أكثر من 15 دقيقة |
| `no_data` | ⚪ | لا يوجد نشاط | لا يوجد أي نشاط مسجل اليوم |

---

## مكون PresenceLabel

**الملف**: `src/components/shared/PresenceLabel.tsx`

**المدخلات**:
- `connectionStatus: string`
- `lastActivityAt: string | null`
- `lastActivityType: string | null`

**المخرجات**:
```
🟢 متصل
آخر نشاط: زيارة منذ 3 دقائق
```

**حالات خاصة**:
- إذا كان `lastActivityAt = null` ← يعرض "لا يوجد نشاط" بدون نشاط محدد
- إذا كان `lastActivityType` غير معروف ← يعرض القيمة الخام كما هي
- إذا كان الفرق أقل من دقيقة ← يعرض "منذ لحظات"
- إذا كان الفرق أكثر من ساعة ← يعرض "منذ X ساعة"

---

## أماكن العرض في النظام

### 1. OperationsCenter — EmployeeCard (`src/pages/operations-center/components/EmployeeCard.tsx`)

**قبل:**
```
🟢 متصل                    التفاصيل
```

**بعد:**
```
🟢 متصل                    التفاصيل
آخر نشاط: زيارة منذ 3 دقائق
```

تم استبدال الـ 4 `if` blocks (`connected/delayed/lost/no_data`) بمكون `<PresenceLabel>` واحد.

### 2. TeamMap — Popup الخريطة (`src/pages/attendance/TeamMapPage.tsx`)

**قبل:**
```
محمد حافظ
🟢 يعمل — 🟢 متصل
مدة اليوم: 03:45
...
آخر ظهور: 15:30
```

**بعد:**
```
محمد حافظ
🟢 يعمل
🟢 متصل
آخر نشاط: زيارة منذ 3 دقائق
مدة اليوم: 03:45
...
```

تم دمج `connection_status` + `last_activity_at` + `last_activity_type` في سطرين مضغوطين.

### 3. TeamMap — القائمة (List View)

**قبل:**
```
محمد حافظ  [مندوب]  [متصل]
03:45 — آخر ظهور: 15:30
```

**بعد:**
```
محمد حافظ  [مندوب]
03:45  🟢 متصل | آخر نشاط: زيارة منذ 3 دقائق
```

### 4. OperationsCenter — MapTab (`src/pages/operations-center/components/MapTab.tsx`)

**قبل:**
```
محمد حافظ
مندوب مبيعات
3h 45m
آخر ظهور: 15:30
```

**بعد:**
```
محمد حافظ
مندوب مبيعات
3h 45m
🟢 متصل
آخر نشاط: زيارة منذ 3 دقائق
```

### 5. CoverageMap — Popup الموظف (`src/pages/coverage/CoverageMapPage.tsx`)

**قبل:**
```
🆔 EMP001     🏢 مندوب
⏱ 03:45      🟢 متصل
```

**بعد:**
```
🆔 EMP001     🏢 مندوب
⏱ 03:45
🟢 متصل
آخر نشاط: زيارة منذ 3 دقائق
```

---

## أمثلة حقيقية

```
محمد حافظ
🟢 متصل
آخر نشاط: طلب منذ 3 دقائق

✅ القرار: المندوب يعمل بنشاط، لا حاجة للتدخل.

---

عمر محسن
🟢 متصل
آخر نشاط: نبض النظام منذ 12 دقيقة

⚠️ القرار: لا يوجد نشاط تجاري منذ 12 دقيقة. آخر نشاط كان مجرد نبض نظام.
ربما المندوب متوقف في الطريق أو واجه مشكلة.

---

محمود ربيع
🟡 متأخر
آخر نشاط: نبض النظام منذ 18 دقيقة

🔴 القرار: آخر 18 دقيقة لا يوجد أي نشاط تجاري أو GPS.
يجب الاتصال به لمعرفة السبب.

---

حسين علي
🔴 منقطع
آخر نشاط: نبض النظام منذ 55 دقيقة

🔴 القرار: انقطاع كامل. اتصال فوري.

---

خالد عبد الله
⚪ لا يوجد نشاط

🔴 القرار: المندوب لم يبدأ يوم العمل بعد. اتصال للسؤال عن التأخير.
```

---

## حالات عدم وجود نشاط

عندما تكون `last_activity_at = null`:

```
⚪ لا يوجد نشاط
```

هذا يعني أن المندوب:
- لم يرسل نبض نظام (لا يوجد `touch_session_activity` ولا `record_heartbeat`)
- لا توجد نقاط GPS اليوم
- لا زيارات ولا طلبات ولا تحصيلات

في هذه الحالة:
- `connection_status = 'no_data'`
- لا يظهر أي `last_activity_type` (لأنه `null`)
- المندوب إما لم يبدأ يوم العمل أو بدأ النظام للتو دون أي نشاط

---

## قيود معروفة

### 1. `customer` ليس مصدراً مستقلاً في CTE

عند إنشاء عميل جديد، يتم استدعاء `touch_session_activity()` (عبر `lifeSignalService.notifyBusiness('customer_created')`)، لكن الـ CTE لا يستعلم جدول `customers` مباشرة. النتيجة:

- `last_activity_at` يتحدث ← `connection_status` يتحدث ✅
- `last_activity_type` يظهر `heartbeat` (وليس `customer`) ⚠️

لذلك، إنشاء عميل جديد يظهر في Presence Layer كـ "نبض النظام" وليس "عميل جديد".

**الحل المستقبلي**: إضافة `customer_activity` CTE إلى الـ RPCs.

### 2. SalesManagerCC غير متأثر

`get_sales_manager_cc` RPC (المستخدم في SalesManagerCCPage) **لم يتم تحديثه** بواسطة Phase A tracking fix. لا يزال يستخدم `tracking_points.synced_at` فقط لـ `connection_status` و `last_seen_at`.

لذلك:
- هذا التعديل لا يؤثر على SalesManagerCC
- `last_activity_at` و `last_activity_type` غير متاحين في هذا الـ RPC

**الحل المستقبلي**: تحديث `get_sales_manager_cc` RPC لاستخدام `last_activity` CTE.

### 3. `app_open` و `app_resume` يظهران كـ `heartbeat`

نظراً لأن `touch_session_activity()` تحدث `workday_sessions.last_seen_at`، والـ RPC يقرأ `last_seen_at` كمصدر `'heartbeat'`:

- `app_open` → `touch_session_activity()` → `last_seen_at` → يظهر في Presence Layer كـ `heartbeat`
- `app_resume` → نفس السلسلة

السلوك صحيح من الناحية التقنية لكنه لا يميز بين "المندوب فتح التطبيق" و "نبض النظام التلقائي". كلاهما يظهر كـ `heartbeat`.

---

## الملفات المعدلة

| الملف | نوع التعديل |
|-------|------------|
| `src/components/shared/PresenceLabel.tsx` | **جديد** — مكون PresenceLabel |
| `src/pages/operations-center/components/EmployeeCard.tsx` | تعديل — إضافة PresenceLabel |
| `src/pages/attendance/TeamMapPage.tsx` | تعديل — إضافة PresenceLabel في popup + list |
| `src/pages/operations-center/components/MapTab.tsx` | تعديل — إضافة PresenceLabel في popup |
| `src/pages/coverage/CoverageMapPage.tsx` | تعديل — إضافة PresenceLabel في popup |

**لم يتغير**: لا RPCs جديدة، لا جداول جديدة، لا Migrations.
