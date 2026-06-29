# خريطة مصادر البيانات — شاشة تقارير مدير المبيعات

## المبدأ العام

| نوع البيانات | المصدر الإلزامي |
|---|---|
| **الإنجاز** (targets, achievement %, overall score) | `get_governed_target_performance` فقط |
| **النشاط** (attendance, tracking, visits, orders, sales, collections) | مصادر النشاط الحقيقية (live/workday overview) |

لا يتم استبدال بيانات النشاط ببيانات الإنجاز ولا العكس. يتم دمج المصدرين في الجدول.

---

## أعمدة الجدول — مصدر كل عمود

### بيانات أساسية (info)

| العمود | المصدر | التفاصيل |
|---|---|---|
| `employee_name` | `get_governed_target_performance` | تأتي من `hierarchy.managers[].members[].employee_name` |
| `employee_code` | `get_governed_target_performance` | تأتي من `hierarchy.managers[].members[].employee_code` |

### بيانات النشاط (activity)

| العمود | المصدر (today) | المصدر (period) |
|---|---|---|
| `start_time` | `get_live_workday_overview` → `employees[].started_at` | `get_completed_workdays_history` → `employees[].sessions[0].start_time` |
| `end_time` | `get_live_workday_overview` → `ended_employees[].ended_at` | آخر جلسة في `employees[].sessions[].end_time` |
| `net_minutes` | `get_live_workday_overview` → net_minutes أو duration_minutes | `get_completed_workdays_history` → `employees[].summary.total_net_minutes` |
| `break_minutes` | `get_live_workday_overview` → `employees[].break_minutes` | مجموع break_minutes لكل الجلسات |
| `tracking_points` | غير متاح لليوم (0) | `employees[].summary.total_tracking_points` |
| `distance_meters` | غير متاح لليوم (0) | `employees[].summary.total_distance_meters` (⚠️ دائمًا 0 — راجع docs/sahl/distance_calculation.md) |
| `visit_count` | `get_live_workday_overview` → `employees[].visit_count` | `employees[].summary.total_visits` |
| `order_count` | `get_live_workday_overview` → `employees[].order_count` | `employees[].summary.total_orders` |
| `sales_value` | `get_live_workday_overview` → `employees[].sales_value` | `employees[].summary.total_sales_value` |
| `collection_amount` | `get_live_workday_overview` → `employees[].collection_amount` | `employees[].summary.total_collection_amount` |
| `new_customer_count` | `get_live_workday_overview` → `employees[].new_customer_count` | `employees[].summary.total_new_customers` |

### بيانات الإنجاز (achievement)

| العمود | المصدر | التفاصيل |
|---|---|---|
| `sales_target` | `get_governed_target_performance` | `employees[].sales_target` أو `members[].kpis.sales.target` |
| `orders_target` | `get_governed_target_performance` | `employees[].orders_target` أو `members[].kpis.orders.target` |
| `visits_target` | `get_governed_target_performance` | `employees[].visits_target` أو `members[].kpis.visits.target` |
| `customers_target` | `get_governed_target_performance` | `employees[].new_customers_target` أو `members[].kpis.new_customers.target` |
| `sales_pct` | `get_governed_target_performance` | `employees[].sales_achievement_pct` أو `members[].kpis.sales.pct` |
| `orders_pct` | `get_governed_target_performance` | `employees[].orders_achievement_pct` أو `members[].kpis.orders.pct` |
| `visits_pct` | `get_governed_target_performance` | `employees[].visits_achievement_pct` أو `members[].kpis.visits.pct` |
| `customers_pct` | `get_governed_target_performance` | `employees[].new_customers_achievement_pct` أو `members[].kpis.new_customers.pct` |
| `overall_score` | `get_governed_target_performance` | `members[].overall_achievement_score` (من hierarchy) |

---

## RPCs المستخدمة

| RPC | نوع البيانات | متى يُستخدم |
|---|---|---|
| `get_governed_target_performance` | الإنجاز الكامل (targets, actuals, scores) | دائمًا — حسب month/year من الفترة المحددة |
| `get_live_workday_overview` | نشاط اليوم المباشر | فقط عند اختيار "اليوم" |
| `get_completed_workdays_history` | نشاط فترة تاريخية | للأسبوع، الشهر، أو فترة مخصصة |
| `get_employee_workday_history` | جلسات مندوب واحد (drill-down) | عند اختيار مندوب للتفاصيل |
| `get_employee_day_timeline` | خط سير يوم المندوب | عند اختيار مندوب للتفاصيل |

---

## ملاحظات مهمة

1. **أرقام النشاط vs الإنجاز**: أرقام النشاط (زيارات، طلبات، مبيعات) قد تختلف عن أرقام الإنجاز لأنها تأتي من نظام تتبع مختلف (tracking/workday) بينما الإنجاز يأتي من نظام الأداء الشهري. هذا اختلاف مقصود — النشاط يعكس الواقع الميداني، والإنجاز يعكس الأداء المحتسب بعد المرتجعات والخصومات.

2. **المسافة**: `total_distance_meters` من `get_completed_workdays_history` دائمًا 0 حاليًا (يقرأ من حقل `workday_sessions.total_distance_meters` غير المحدث). المسافة الصحيحة متاحة فقط من `get_employee_day_map` ليوم واحد (في شاشة تفاصيل المندوب).

3. **التحصيل**: `collection_amount` من بيانات النشاط فقط — `get_governed_target_performance` لا يحتوي على تحصيل لكل مندوب على حدة.
