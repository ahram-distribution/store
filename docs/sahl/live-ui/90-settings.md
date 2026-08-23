# Settings (إعداد البرنامج) — TOptionsForm — live observations

Top-level window with TChromeTabs + TPageControl. Tabs OBSERVED:
إعدادات عامة / الضرائب / حقول إضافية / إعداد المطعم.

## Tab: إعدادات عامة
- Company name TDBEdit: «الاهرام للتجارة والتوزيع».
- Currency pair: code edit `EG` + symbol edit `EGP`.
- Default price type: «سعر البيع» (which price list applies by default).
- Checkbox: «استخدم سعر بيع الصنف الأخير للعميل ، حتى لو اختلف عن السعر الحالى للصنف حتى…»
  ⇒ **per-customer last-price override** feature.
- TsButton «المزيد …» (advanced/more options dialog — UNKNOWN contents).
- Three admin lists (right column), each with جديد/تعديل/حذف triplet and its own grid:
  INFERRED = stores / treasuries(drawers) / price lists (exact titles custom-drawn, unreadable).
  REQUIRES CONTROLLED TEST to name them.

## Tab: الضرائب
- TDBCheckBoxEh «تفعيل خصائص الفوترة الإلكترونية (يجب الالتزام بتفعيل الفوترة الإليكترونية طبقا للقانون فى بلدك)»
  ⇒ built-in e-invoicing compliance switch.
- Two tax groups (purchase & sale), each with: rate TDBEdit[0], name TDBEdit,
  checkboxes «أضف الضريبة تلقائيا لفاتورة الشراء/البيع».

## Tab: حقول إضافية (custom fields)
~25 empty TDBEdit fields laid out in rows (y≈359/466/573/709) + 4 numeric defaults `0`
(y≈759) + 2 more. ⇒ user-definable extra text/number fields for documents/items
(exact mapping per entity UNKNOWN).

## Tab: إعداد المطعم (restaurant mode)
18 TComboBox in a 6×3 matrix ⇒ table-area / order-type mappings (labels custom-drawn,
unreadable). CONFIRMS SAHL ships a restaurant vertical config inside the same binary.

## Behavior notes
- Window is TOP-LEVEL (not an in-main card); closes via its own إغلاق button.
- All edits were left untouched; no settings modified during investigation.
