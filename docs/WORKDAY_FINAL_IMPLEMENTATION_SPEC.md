# WORKDAY_FINAL_IMPLEMENTATION_SPEC

**Target:** System-wide Attendance & Tracking Runtime  
**Status:** ⛔ SPECIFICATION ONLY — No implementation  
**Last Updated:** 11 June 2026 — Expanded with Analytics Phase

---

## 0. PHASE OVERVIEW — ثلاث مراحل تنفيذ

### المرحلة 0 — Tracking Runtime (أساسي)
إنشاء محرك التتبع الفعلي. بدون هذه المرحلة، كل البيانات فارغة.

**موضّح في:** `TRACKING_RUNTIME_IMPLEMENTATION.md`

### المرحلة 1 — Analytics Layer (جاري)
البنية التحتية للتقارير والتحليلات. تعتمد على نقاط التتبع من المرحلة 0.

**محتوى هذه الوثيقة.**

### المرحلة 2 — شاشات المراقبة (تعتمد على 0+1)
تحسين الشاشات الموجودة لإظهار البيانات الحقيقية. لا شاشات جديدة.

---

## 7. متطلبات المرحلة 1 — Analytics Layer

### 7.1 Route Map حقيقية في EmployeeDayMapPage

**الهدف:** شاشة `EmployeeDayMapPage` (الموجودة حالياً في `/attendance/map/:employeeId/:date`) تعرض مساراً كاملاً بدلاً من نقاط متفرقة.

**ما هو موجود فعلاً ✅:**
- `get_employee_detail` RPC (V2, check_capability, كامل البيانات)
- `get_employee_day_map` RPC (V2, مسار + Haversine + توقفات + زيارات)
- `get_employee_day_timeline` RPC (V2, أحداث كاملة مع orders/collections/customers)
- `EmployeeDayMapPage.tsx` — Leaflet خريطة مع Polyline, markers, tabs (timeline/stops/summary)

**ما ينقص ❌:**
- Navigation من LiveMonitoringPage → EmployeeDayMapPage
- الفلتر الزمني الموحد (حالياً date من URL param فقط)

**خطة التنفيذ:**
- رابط في `LiveMonitoringPage.tsx`: كل موظف → `navigate(/attendance/map/${employeeId})`
- استبدال URL-param date بـ `TimeRangeFilter` component

### 7.2 الفلتر الزمني الموحد

**الهدف:** مكون React واحد (`TimeRangeFilter`) يُستخدم في كل الصفحات.

**الصفحات المستهدفة:**

| الصفحة | حالياً | بعد الفلتر الموحد |
|--------|--------|-------------------|
| LiveMonitoringPage | دائماً اليوم | اليوم + أمس + 7 أيام + شهر + مخصص |
| TeamMapPage | دائماً اليوم | اليوم + أمس + 7 أيام + شهر + مخصص |
| ReportsPage | from/to inputs مزدوجان | TimeRangeFilter موحد |
| EmployeeDayMapPage | date من URL param | TimeRangeFilter |
| EmployeeProfilePage (حضور) | selMonth/selYear | TimeRangeFilter |

**القيم:**
```
' اليوم', 'أمس', 'آخر 7 أيام', 'هذا الشهر', 'الشهر السابق', 'فترة مخصصة'
```

**الواجهة (Props):**

```typescript
interface TimeRangeFilterProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  presets?: TimeRangePreset[]
}

interface TimeRange {
  from: string  // ISO date
  to: string    // ISO date
  label: string // العرض
}
```

**المكون:** `src/components/TimeRangeFilter.tsx` — مشترك لكل التطبيق.

### 7.3 سجل ساعات العمل اليومية في EmployeeProfilePage

**الهدف:** تبويب "ملخص الحضور" في `EmployeeProfilePage` يعرض جدولاً يومياً.

**البيانات المطلوبة لكل يوم:**
- التاريخ
- مدة العمل (start_time → end_time أو now())
- مدة الاستراحات (SUM من workday_breaks)
- صافي ساعات العمل (المدة - الاستراحات)

**المصدر:** `get_employee_workday_history` RPC (موجود حالياً لكن V1 — يحتاج تحديث إلى V2).

**التعديلات على RPC:**
- `get_employee_workday_history` → V2 governance (check_capability + subtree_ids)
- إضافة `net_minutes` (duration_minutes - break_seconds/60)
- إضافة `sales_value` (SUM orders.total_amount لذلك اليوم)
- إضافة `order_count`

**التعديلات على UI (EmployeeProfilePage.tsx):**

التبويب الحالي `attendance` يحتوي على:
- ملخص بسيط (أيام العمل، صافي الساعات، أيام متأخر/مبكر/في الموعد)

يُضاف إليه:
- جدول يومي: `[التاريخ] [مدة العمل] [الاستراحة] [الصافي]`
- مع امكانية scroll للشهر كامل
- الأيام مرتبة تنازلياً (أحدث يوم أولاً)

### 7.4 ملخص الشهر في EmployeeProfilePage

**الهدف:** نفس تبويب الحضور — إضافة قسم ملخص شهري.

**البيانات:**
- إجمالي ساعات العمل (مجموع duration_minutes)
- إجمالي الاستراحات (مجموع break_minutes)
- صافي ساعات العمل (إجمالي - إجمالي استراحات)
- عدد أيام العمل (sessions مع status = 'completed')
- متوسط ساعات العمل اليومية (صافي / عدد الأيام)
- أطول يوم عمل (MAX net_minutes)
- أقل يوم عمل (MIN net_minutes لـ completed sessions)

**المصدر:** `get_employee_workday_history` RPC الحالي يعيد `summary` مع `total_days`, `late_days`, `early_departure_days`, `ontime_days`. نحتاج توسيعه.

**توسيع RPC `get_employee_workday_history`:**
- إضافة: `total_duration_minutes`, `total_break_minutes`, `total_net_minutes`
- إضافة: `max_net_day`, `min_net_day`
- إضافة: `total_sales_value`, `total_orders`, `total_visits`

### 7.5 تقارير الإدارة العليا في ReportsPage

**الهدف:** `ReportsPage` (الموجودة في `/attendance/reports`) تعرض تقارير قابلة للفرز.

**ما هو موجود فعلاً ✅:**
- `get_workday_report` RPC (V2, summary + employees)
- `get_attendance_analysis` RPC (V1)
- `ReportsPage.tsx` — يعرض جدول + summary + CSV export

**ما ينقص ❌:**
- الفرز حسب أي عمود

**خطة التنفيذ:**
- إضافة أزرار فرز (asc/desc) لكل عمود: ساعات العمل، صافي الساعات، الزيارات، الطلبات، المبيعات، التحصيلات
- ربط `TimeRangeFilter` بدلاً من from/to inputs
- إضافة navigation: اسم الموظف → `EmployeeDayMapPage`

**الفرز يتم على الـ Frontend (لأن RPC يعيد كل البيانات):**

```typescript
const [sortField, setSortField] = useState<string>('net_hours')
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

const sorted = [...report].sort((a, b) => {
  const diff = (a[sortField] ?? 0) - (b[sortField] ?? 0)
  return sortDir === 'desc' ? -diff : diff
})
```

### 7.6 شاشة الموظف الذاتية في AttendancePage

**الهدف:** `AttendancePage` (الموجودة في `/attendance`) تعرض بيانات إنتاجية حقيقية للموظف.

**ما هو موجود فعلاً ✅:**
- `get_my_workday_status` RPC — يعيد: status, duration, break minutes, net work minutes, visit count
- AttendancePage تعرض: حالة اليوم، المدة، الاستراحات، الصافي، الزيارات

**ما ينقص ❌:**
- عدد الطلبات اليوم
- قيمة المبيعات اليوم
- عدد التحصيلات اليوم
- قيمة التحصيلات اليوم
- عدد العملاء الجدد اليوم

**خطة التنفيذ:**

توسيع `get_my_workday_status` RPC لإضافة:
- `today_orders: int`
- `today_sales: decimal`
- `today_collections: int`
- `today_collections_amount: decimal`
- `today_new_customers: int`

أو إنشاء RPC جديد `get_my_today_summary`.

في UI:
```
الطلبات: 5
المبيعات: 12,500 ج.م
التحصيل: 3,200 ج.م (2)
العملاء الجدد: 1
الزيارات: 8
```

تضاف ضمن البطاقات الموجودة حالياً (تحت المدة/الاستراحات/الصافي).

### 7.7 العلاقات بين الشاشات — Navigation Links

**الهدف:** ربط كل شاشات الحضور بعضها ببعض.

```
UpperManagementDashboard
  │
  ├── "الحضور والانصراف" widget → LiveMonitoringPage
  │
  LiveMonitoringPage
  │
  ├── اسم الموظف → EmployeeDayMapPage
  │
  TeamMapPage
  │
  ├── اسم الموظف → EmployeeDayMapPage
  │
  ReportsPage
  │
  ├── اسم الموظف → EmployeeDayMapPage
  │
  EmployeeProfilePage ("ملخص الحضور")
  │
  ├── تاريخ → EmployeeDayMapPage (نفس الموظف + ذلك التاريخ)
```

---

## 8. تغييرات RPC في المرحلة 1

| RPC | الحالة | التغيير |
|-----|--------|---------|
| `get_employee_workday_history` | V1 → V2 | check_capability + net_minutes + sales_value + order_count + summary توسيع |
| `get_my_workday_status` | توسيع | إضافة today_orders, today_sales, today_collections, today_collections_amount, today_new_customers |
| الباقي | V2 ✅ | لا تغيير |

---

## 9. تغييرات Frontend في المرحلة 1

| الصفحة | التغيير |
|--------|---------|
| `TimeRangeFilter.tsx` (جديد) | مكون الفلتر الزمني الموحد |
| `LiveMonitoringPage.tsx` | إضافة رابط → EmployeeDayMapPage |
| `TeamMapPage.tsx` | إضافة رابط → EmployeeDayMapPage + auto-refresh |
| `ReportsPage.tsx` | TimeRangeFilter + فرز + رابط EmployeeDayMapPage |
| `EmployeeProfilePage.tsx` | جدول يومي + ملخص شهري + TimeRangeFilter |
| `EmployeeDayMapPage.tsx` | TimeRangeFilter بدلاً من URL param |
| `AttendancePage.tsx` | إضافة بطاقات الإنتاجية اليومية |

---

## 10. ما لا يتغير

- جميع SQL functions للتتبع (`sync_tracking_points`, `start_workday`, إلخ) — لا تغيير
- `get_live_workday_overview` — لا تغيير
- `get_team_map` — لا تغيير
- `get_employee_detail` — موجود ✅
- `get_employee_day_map` — موجود ✅
- `get_employee_day_timeline` — موجود ✅
- `get_workday_report` — موجود ✅
- `get_attendance_analysis` — لا تغيير (اختياري)
- `UpperManagementDashboard.tsx` — لا تغيير (يستخدم attendance widget فقط)

---

*End of Specification — Pending Approval*
