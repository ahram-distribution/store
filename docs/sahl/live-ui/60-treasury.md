# Treasury (الخزينة) — live observations

## TMoneyForm «الخزينة» — OBSERVED
- Header: درج النقدية combo (cash-drawer selector) + CardDetails card showing drawer info
  (values custom-drawn, not Win32-readable).
- Buttons: تحديث · إدخال حركة الخزينة اليومية · تحويل من خزينة لأخرى · تحليل المقبوضات ·
  تحليل المصروفات · صرف · قبض · عرض التقرير · طباعة · حذف · تعديل · إغلاق.

## Money entry — TMoneyEntryForm «قبض | جديد» / «صرف | جديد» — OBSERVED
Identical structure for receipt (قبض) and payment/expense (صرف):
- أضف الرصيد button («add balance» — quick top-up helper)
- **TCheckBox «شيك ؟»** ⇒ cheques are entered from inside money movements
- TDBLookupComboboxEh درج النقدية (target drawer)
- TEdit[1] (amount), TEdit[0]
- Buttons: جديد F10 · حذف · طباعة F4 · حفظ F9 · إغلاق · حفظ | إغلاق F12
- Post-save options group: checkboxes جديد / إغلاق / طباعة (what happens after حفظ)

REQUIRES CONTROLLED TEST: effect of شيك ؟ on cheque module; account linking of قبض/صرف
(customer/supplier picker presumably appears when linked — UNKNOWN).

## Transfer — TMoneyTransferForm «تحويل نقدية من خزينة لأخرى» — OBSERVED
- TDBLookupComboboxEh درج النقدية (source drawer), TEdit[0] amount
- Buttons: حفظ · تراجع · حفظ | طباعة
- Canceled without saving (no data created).

## Analysis reports — TReportMoneyAnalysisForm[تحليل المقبوضات] / [تحليل المصروفات] — OBSERVED
- Date range prefilled CURRENT MONTH (observed 01/08/2026 – 31/08/2026).
- Two TDBGridEh areas, each with طباعة + «تقرير تفصيلى» (drill-down to detail report).
- عرض التقرير refreshes. إغلاق closes back to TMoneyForm.
- Grid contents empty at time of test (restored DB, no August movements) — data-gated.

UNKNOWN: whether إدخال حركة الخزينة اليومية opens the same TMoneyEntryForm
(INFERRED yes — same pattern as صرف/قبض tiles).

## Daily report linkage (from Users.ini, CONFIRMED schema)
TMoneyEntryForm-invoices_Grid exists ⇒ money entries can show related invoices.
TReportDailyForm grids include Payments & Receipts ⇒ daily report aggregates both.
