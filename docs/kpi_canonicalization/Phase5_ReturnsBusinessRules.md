# Report 1: Returns Business Rules — Impact on Achievement

## دورة حياة المرتجع

```
pending → inspecting → approved / rejected
               ↑
    (مراجعة)     (فحص)     (اعتماد / رفض)
```

## الأسئلة والإجابات

| السؤال | الإجابة | المصدر |
|--------|---------|--------|
| متى تعتبر المرتجعات نهائية؟ | عند **الاعتماد (`status = 'approved')** فقط | `governed_approve_return` + CHECK constraint |
| هل كل المرتجعات تخصم؟ | **لا** — فقط `approved` | `07_RETURN_RULES.md` + الكود |
| هل الخصم بقيمة المرتجع؟ | بقيمة **الأصناف المرتجعة فقط**، بقيمة شرائها الأصلية | `credit_note_amount` = Σ(items × original_unit_price) |
| أم بقيمة الأصناف فقط؟ | الأصناف فقط، بسعر الطلب الأصلي | `order_items.total_price / order_items.piece_quantity` |
| هل المرتجع الجزئي يخصم جزءًا؟ | **نعم** — كل return_item يخصم بنسبة ما رجع فعلاً | `_return_qty_to_pieces()` لكل صنف على حدة |
| هل المرتجع الكامل يلغي الطلب؟ | **لا** — الطلب يبقى `delivered`. الـ `credit_note_amount` يخصم فقط. | الكود لا يعدل `orders.status` |
| كم حالة للمرتجع؟ | 4: `pending`, `inspecting`, `approved`, `rejected` | CHECK constraint + `return_status_history` |

## كيف يؤثر على الإنجاز (Achievement)

```
Effective Sales     = Delivered Sales - SUM(approved_returns.credit_note_amount)
Effective Orders    = Delivered Orders - COUNT(full_returns) 

حيث full_return = order حيث مجموع كميات المرتجعات المعتمدة >= مجموع كميات الطلب الأصلي
```

## ما يجب تغييره في `runtime.get_achievement`

حاليًا `runtime.get_achievement` يحسب فقط:

```sql
-- E01: Delivered Sales
SELECT SUM(total_amount) FROM order_delivered_events
-- E02: Delivered Orders  
SELECT COUNT(*) FROM order_delivered_events
```

**لا يخصم المرتجعات** — بينما `get_governed_target_performance` يفعل:

```sql
v_company_effective_sales := GREATEST(v_company_delivered_sales - v_company_return_deductions, 0);
v_company_effective_orders := GREATEST(v_company_delivered_orders - v_company_full_returns, 0);
```

## التأثير الحالي

| البيان | القيمة |
|--------|--------|
| عدد المرتجعات في يونيو 2026 | **0** (الجدول فارغ) |
| هل يؤثر الآن؟ | **لا** |
| هل سيؤثر مستقبلًا؟ | **نعم** — سيكون هناك اختلاف بين Achievement Tab و Target Page |

## الحل المقترح

إضافة استعلام خصم المرتجعات إلى `runtime.get_achievement`:

```sql
-- بعد E01/E02 الحاليين، أضف:
-- Return Deductions
SELECT COALESCE(SUM(r.credit_note_amount), 0)::numeric,
       COUNT(DISTINCT CASE WHEN ...full_return_logic... THEN r.order_id END)::int
INTO v_return_deductions, v_full_returns
FROM returns r
JOIN orders o ON o.id = r.order_id
WHERE o.owner_id IN (v_employee_id, v_identity_id)
  AND r.status = 'approved'
  AND r.created_at >= p_date_from  -- أو r.updated_at?
  AND r.created_at < p_date_to;

-- ثم استخدم:
v_effective_sales := GREATEST(v_sales - v_return_deductions, 0);
v_effective_orders := GREATEST(v_orders - v_full_returns, 0);
```

**سؤال مفتوح:** هل نستخدم `r.created_at` أم `r.updated_at` (وقت الاعتماد) لتحديد الفترة؟ المرتجع يمكن إنشاؤه في شهر والموافقة عليه في شهر آخر.
