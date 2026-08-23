# SAHL Live Navigation Map (observed)

Legend: `→` opens; `(tile x,y)` = home dashboard tile center in RESTORED window mode (967×1057 @ -7,0).
All entries OBSERVED unless marked INFERRED/UNKNOWN.

## Home dashboard — TStartForm «ابدأ مع سهل»
21 custom-drawn tiles in 4 rows. Row headers (y≈154) are section openers; other rows are shortcuts.

### Row 1 — section tiles (y=154)
| Tile | Opens |
|------|-------|
| تقارير متنوعة أخرى (9,154) | TReportsForm «تقارير» (content custom-drawn, not Win32-readable) |
| قسم الفواتير (135,154) | TInvoicesForm «الفواتير» list |
| قسم الخزينة (261,154) | TMoneyForm «الخزينة» |
| قسم الحسابات (387,154) | TAccountsForm «الحسابات» |
| قسم البضاعة (513,154) | TItemsForm «البضاعة» |

### Row 2 (y=322)
| Tile | Opens |
|------|-------|
| تحليل المبيعات (135,322) | TReportSalesAnalysisForm «تقرير تحليل المبيعات» |
| الحركة اليومية (261,322) | TReportDailyForm «تقرير الحركة اليومية» |
| حسابات افتتاحية (513,322) | TAccountsForm with a NEW empty account entry visible (opening-balance flow) |
| أصناف افتتاحية (639,322) | TItemsForm «البضاعة» (new-item entry flow) |
| إعداد البرنامج (765,322) | **TOptionsForm** — TOP-LEVEL settings window |
| فيديوهات تدريبية (891,322) | UNKNOWN (not clicked yet) |

### Row 3 (y=481)
| Tile | Opens |
|------|-------|
| الجرد (198,481) wide | TInvoiceForm «جرد مخزن \| جديد» |
| مصروف جديد (387,481) | TMoneyEntryForm «صرف \| جديد» |
| فاتورة شراء جديدة (576,481) wide | TInvoiceForm «شراء \| جديد» |
| فاتورة بيع جديدة (828,481) wide | TInvoiceForm «بيع \| جديد» |

### Row 4 (y=607)
| Tile | Opens |
|------|-------|
| التسوية (135,607) | TInvoiceForm «تسوية مخزن \| جديد» |
| تحويل بضاعة (261,607) | UNKNOWN label on invoice form (not yet opened live) |
| قبض جديد (387,607) | TMoneyEntryForm «قبض \| جديد» |
| مرتجع مشتريات (639,607) | TInvoiceForm «مرتجع شراء \| جديد» |
| عرض أسعار (765,607) | TInvoiceForm «عرض أسعار \| جديد» |
| مرتجع بيع (891,607) | TInvoiceForm «مرتجع بيع \| جديد» |

## Module → action maps

### الفواتير (TInvoicesForm)
- Tabs: Start / بحث عام.
- Buttons: عرض الأصناف، عرض الفواتير، طباعة التقرير، تعديل، طباعة المستند، حذف، إغلاق.
- Radios: نقدى / الكل / آجل.
- Double-click/تعديل path opens TPopupSearchInvoicesForm «بحث عن فاتورة»
  (top-level popup: بحث، تراجع، موافق، تعديل، إغلاق + 4 edits + combo + results grid;
  also embeds hidden TFrameAccounts).

### الخزينة (TMoneyForm)
- درج النقدية combo + CardDetails card.
- Buttons: تحديث، إدخال حركة الخزينة اليومية، تحويل من خزينة لأخرى،
  تحليل المقبوضات، تحليل المصروفات، صرف، قبض، عرض التقرير، طباعة، حذف، تعديل، إغلاق.
- تحليل المقبوضات / تحليل المصروفات → TReportMoneyAnalysisForm[تحليل المقبوضات|المصروفات].
- تحويل من خزينة لأخرى → TMoneyTransferForm «تحويل نقدية من خزينة لأخرى».

### الحسابات (TAccountsForm)
- Filters: checkboxes إظهار الحسابات الغير نشطة فقط، إخفاء الأرصدة الصفرية،
  إظهار الحسابات تحت المراجعة فقط.
- Buttons: جديد، تعديل، حذف، كشف حساب، كشف حساب بالأصناف، أرصدة الحسابات بتاريخ سابق،
  **الشيكات والأقساط**، صرف، قبض، طباعة قائمة الحسابات، تحديث، إغلاق.
- كشف حساب → TReportAccountStatementForm (statement with document actions).
- الشيكات والأقساط → no visible reaction without selected row/data (UNKNOWN, needs test data).

### البضاعة (TItemsForm)
- Buttons: جديد، تعديل، حذف، تعديل أسعار البيع، تقرير حركة الصنف، حركة مخزن،
  تقرير بضاعة مخزن، طباعة قائمة الأصناف، طباعة ملصقات الباركود، تحديث،
  بحث عن رقم سيريال، بحث متقدم، صلاحية الأصناف، إغلاق.

### إعداد البرنامج (TOptionsForm — top-level)
- Tabs: إعدادات عامة / الضرائب / حقول إضافية / إعداد المطعم.

### Global behaviors (OBSERVED)
- Trial nag: periodic TPopupMessageForm with single button «شكرا».
- Closing entry cards with unsaved work: تراجع cancels back to the module card; Esc closes cards.

## AHRAM parity routes (implemented 2026-08)
Mapping of سهل screens above to the real workspace built inside AHRAM (`/sahl/*`, Supabase RPCs):
| سهل screen | AHRAM route |
|---|---|
| فاتورة بيع جديدة / عرض أسعار (TInvoiceForm) | `/sahl/pos` |
| الفواتير (TInvoicesForm) | `/sahl/invoices` |
| الخزينة (TMoneyForm) + تحويل نقدية | `/sahl/treasuries` (+ transfer dialog) |
| قبض جديد / صرف جديد (TMoneyEntryForm) | `/sahl/receipts` · `/sahl/expenses` (drawer selectors) |
| فاتورة شراء / مرتجع بيع / مرتجع شراء / جرد | `/sahl/purchases` · `/sahl/returns` (store+drawer selectors) |
| الأقساط + الشيكات والأقساط | `/sahl/installments` (cheque-linked receipts) · `/sahl/cheques` |
| تقرير الحركة اليومية / المالي / تحليل المبيعات | `/sahl/reports` tabs: اليومي · المالي · تحليل المبيعات · الاستحقاقات · مخزون المخازن |
| إعداد البرنامج (TOptionsForm) | `/sahl/settings` |

Status details per group: see `docs/sahl/AHRAM-PARITY-STATUS.md`.
