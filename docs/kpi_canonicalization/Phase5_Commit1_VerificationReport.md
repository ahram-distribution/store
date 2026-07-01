# Verification Report — Commit 1

### Migration: `20261231_fix_activity_submitted_at.sql`
### Date: June 30, 2026
### Scope: `runtime.get_activity` + `runtime.get_team_activity`

---

## 1. What was changed

| قبل | بعد |
|-----|-----|
| `o.created_at >= p_date_from AND o.created_at < p_date_to` | `o.submitted_at >= p_date_from AND o.submitted_at < p_date_to` |
| `o.status != 'cancelled'` | `o.status NOT IN ('draft', 'cancelled')` |

Applied to two functions:
- `runtime.get_activity` — السطر A02
- `runtime.get_team_activity` — CTE `order_stats`

---

## 2. Results (Jun 2026 — all scopes)

| المستوى | OLD Orders | NEW Orders | تغير؟ | OLD Sales | NEW Sales | تغير؟ |
|---------|-----------|-----------|-------|----------|----------|-------|
| **الشركة** | 56 | 56 | لا | 3,196,184.16 | 3,196,184.16 | لا |
| **خالد سعيد (مدير)** | 1 | 1 | لا | 110,081.67 | 110,081.67 | لا |
| **حسين علي (مندوب)** | 5 | 5 | لا | 206,854.52 | 206,854.52 | لا |
| **حسن بكر** | 12 | 12 | لا | 92,138.98 | 92,138.98 | لا |
| **عمر محسن** | 10 | 10 | لا | 1,560,097.68 | 1,560,097.68 | لا |
| **محمد حافظ** | 7 | 7 | لا | 179,799.00 | 179,799.00 | لا |
| **محمود ربيع** | 18 | 18 | لا | 843,028.80 | 843,028.80 | لا |

---

## 3. لماذا لم تتغير الأرقام؟

**سبب مثبت:** 56 من 56 طلبًا (100%) لشهر يونيو 2026 لهم `submitted_at` و `created_at` في نفس الشهر تمامًا. الفرق الزمني بين الحقلين أقل من ثانية ولا يعبر أي حد شهري.

معناه: أي استعلام عن شهر كامل سيعيد نفس النتيجة. لكن التعديل يضمن صحة الحساب للبيانات المستقبلية.

---

## 4. هل التعديل فعال فعلاً؟ (مثبت)

- `runtime.get_activity`: يستخدم `o.submitted_at` ✅ و `NOT IN ('draft', 'cancelled')` ✅
- `runtime.get_team_activity`: يستخدم `o.submitted_at` ✅ و `NOT IN ('draft', 'cancelled')` ✅
- Live RPC `get_runtime_activity` (حسين علي): يُرجع `orders=5` و `sales=206,854.52` ✅

---

## 5. هل تأثرت KPIs الأخرى؟

| KPI | قبل | بعد | تغير؟ |
|-----|-----|-----|-------|
| Completed Visits (29) | 29 | 29 | لا |
| Registered Customers (28) | 28 | 28 | لا |
| Sales Achievement | بدون تغيير | بدون تغيير | لا (يستخدم `get_achievement` وليس `get_activity`) |
| Target Calculations | بدون تغيير | بدون تغيير | لا (يستخدم `employee_monthly_targets`) |
| `customer_registered_events` view | COALESCE | COALESCE | لا |

---

## 6. الخلاصة

| الاختبار | النتيجة |
|----------|---------|
| Company totals لم تتغير | ✅ |
| Per-manager totals لم تتغير | ✅ |
| Per-rep totals لم تتغير | ✅ |
| Completed Visits لم يتغير | ✅ |
| Registered Customers لم يتغير | ✅ |
| Achievement KPIs لم تتغير | ✅ |
| الـ Migration فعال (confirmed in pg_proc) | ✅ |
| Live RPC يعمل بشكل صحيح | ✅ |

### ✅ Commit 1 — معتمد
