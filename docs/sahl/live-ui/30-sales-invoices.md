# Sales / Invoices — live observations

## TInvoiceForm «بيع | جديد» (sales POS) — OBSERVED
One form class serves ALL invoice document types; caption changes by mode.

### Toolbar (right side)
- طباعة الباركود، تعديل الأسعار، طباعة F4، حذف الفاتورة، جديد F10، حفظ F9، إغلاق، إعدادات
- حذف F8، المزيد F7، السعر F6، الكمية F5
- حفظ | جديد F12 (save-and-start-next), حفظ | تكرار (items entry only)

### Payment buttons (cash drawer area)
- الخزينة، بطاقة إئتمان، درج النقدية (TDBLookupComboboxEh defaulting to درج النقدية)،
  آجل، خصم الفكة (small-change discount), استعلام
- TEdit values observed: `1` (qty?), `0`, `1` — exact roles not readable.

### Per-mode differences (OBSERVED)
| Mode caption | Extra elements |
|---|---|
| بيع \| جديد | full payment row |
| شراء \| جديد | full payment row |
| مرتجع بيع \| جديد | payment row + «مرتجع من فاتورة» button |
| مرتجع شراء \| جديد | payment row + «مرتجع من فاتورة» button |
| عرض أسعار \| جديد | NO payment row; has «سجل فاتورة بيع» (convert-to-invoice) + checkbox «حجز البضاعة» (reserve stock) |
| جرد مخزن \| جديد | NO payment row, minimal toolbar |
| تسوية مخزن \| جديد | NO payment row, minimal toolbar |

INFERRED: جرد/تسوية reuse the invoice engine for stock-count and stock-adjustment docs;
حجز البضاعة implies quotations can reserve inventory until converted or expired (REQUIRES TEST).

### Search popup — TPopupSearchInvoicesForm «بحث عن فاتورة» (TOP-LEVEL)
- Buttons: بحث (791,179), تراجع (79,77), موافق (212,77), تعديل (482,580), إغلاق (74,580).
- Inputs: 4×TEdit + TComboBox; results in large TDBGridEh.
- Contains hidden TFrameAccounts (customer picker embedded).
- Behavior note: its on-card إغلاق click did NOT close it once (needed WM_CLOSE) —
  possibly focus-dependent. Esc/WM_CLOSE reliable.

### Invoice grid schema (from Users.ini `TInvoiceForm-MainGrid___SALEQUOTE.3`)
item_id, code1, code2, barcode, title, unit, unit_contents, expire_date …
(…discounts… grand_total) — CONFIRMED column names; full list truncated in source capture.

### Keyboard shortcuts (OBSERVED as captions)
F4 print · F5 qty · F6 price · F7 more · F8 delete-line · F9 save · F10 new · F12 save+new.

UNKNOWN / REQUIRES CONTROLLED TEST:
- Actual numbering, totals math, tax application, آجل → customer balance effect,
  مرتجع من فاتورة pick-list behavior, استعلام lookup target, خصم الفكة semantics.
