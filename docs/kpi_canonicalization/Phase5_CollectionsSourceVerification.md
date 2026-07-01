# Report 2: Collections Source — Verification

## الادعاء

`get_governed_target_performance` يستخدم `created_at` لتحديد فترة التحصيل، بينما المواصفة تنص على `collected_at`.

## الإثبات — من الـ SQL الفعلي في قاعدة الإنتاج

```sql
employee_collections AS (
    SELECT public.resolve_employee_id(c.owner_id) AS employee_id,
        COALESCE(SUM(c.amount), 0) AS collections_actual
    FROM public.collections c
    WHERE c.created_at >= v_month_start AND c.created_at < v_month_end   -- ← created_at
    GROUP BY public.resolve_employee_id(c.owner_id)
)
```

المشكلة: يستخدم `c.created_at` وليس `c.collected_at`.
كما أنه لا يفلتر بـ `c.status = 'collected'`.

## المواصفة المعتمدة

```
Collections Amount = SUM(amount) WHERE status='collected' AND collected_at IN period
```

## بنود Collections (من قاعدة البيانات)

| العمود | النوع | ملاحظة |
|--------|------|--------|
| `created_at` | timestamptz, NOT NULL | تاريخ إنشاء السند — قد يسبق التحصيل الفعلي |
| `collected_at` | timestamptz, NULLABLE | تاريخ التحصيل الفعلي — يملأ عند الإيداع |
| `status` | varchar | الـ statuses المتوقعة: قد تشمل `collected`, `pending`, `cancelled` |
| `amount` | numeric, NOT NULL | المبلغ |

## التأثير الحالي

| البيان | القيمة |
|--------|--------|
| عدد التحصيلات في يونيو 2026 | **0** (الجدول فارغ) |
| هل يؤثر الآن؟ | **لا** |
| هل سيؤثر مستقبلًا؟ | **نعم** — سيكون هناك اختلاف إذا تم إنشاء سند تحصيل في شهر وتحصيله في شهر آخر |

## هل هو Bug؟

**نعم، هو Bug في تعريف KPI فقط** (يخالف المواصفة المعتمدة)، لكن **ليس له تأثير تشغيلي حاليًا** لأن الجدول فارغ.

## الحل المقترح

تغيير استعلام `employee_collections` في `get_governed_target_performance` من:

```sql
WHERE c.created_at >= v_month_start AND c.created_at < v_month_end
```

إلى:

```sql
WHERE c.collected_at >= v_month_start AND c.collected_at < v_month_end
  AND c.status = 'collected'
```

هذا التعديل يجب أن يكون **Commit مستقل** عن خصم المرتجعات.
