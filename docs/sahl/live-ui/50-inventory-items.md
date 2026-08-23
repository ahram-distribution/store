# Items / Inventory (البضاعة) — live observations

## TItemsForm «البضاعة» — OBSERVED
### Action buttons
جديد · تعديل · حذف · تعديل أسعار البيع · تقرير حركة الصنف · حركة مخزن · تقرير بضاعة مخزن ·
طباعة قائمة الأصناف · طباعة ملصقات الباركود · تحديث · بحث عن رقم سيريال · بحث متقدم ·
صلاحية الأصناف · إغلاق

Two grids visible in list mode (main items grid + secondary INFERRED units/prices panel).

Grid schemas (Users.ini):
- `TFrameItems-Grid`: id, code1, code2, barcode, title, unit, store_qty, qty, category1,
  price1, price_min, avg_cost, last_cost, last_purchased, more
  ⇒ per-row: store quantity vs total qty, min price, average cost, last cost, last purchase date.
- `TItemsForm-Grid___.2` + UnitsGrid ⇒ separate units grid editor.

## New item entry card — OBSERVED (via «أصناف افتتاحية» tile; canceled without typing)
- Checkboxes:
  - «صنف غير نشط» (inactive item)
  - «أضف لقائمة الأصناف السريعة» (add to quick-list — POS favorites)
  - «خدمة ليس لها كمية» (**service item, no stock tracking**)
- Buttons: حفظ · تراجع · حفظ | جديد · **حفظ | تكرار** (save & duplicate)

## Inventory document types using the invoice engine (OBSERVED captions)
| Tile | Card caption |
|---|---|
| الجرد | جرد مخزن \| جديد (stock count) |
| التسوية | تسوية مخزن \| جديد (adjustment) |
| تحويل بضاعة | not yet opened live (UNKNOWN caption) |

REQUIRES CONTROLLED TEST: barcode label printing options, serial search flow,
تعديل أسعار البيع bulk price edit, صلاحية الأصناف (expiry/validity) screen,
store-transfer behavior and its document numbering.
