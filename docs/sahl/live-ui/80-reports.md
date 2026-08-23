# Reports (التقارير) — live observations

## Dedicated reports screen — TReportsForm «تقارير» (tile تقارير متنوعة أخرى)
- Content area is fully custom-drawn panels (NOT Win32-readable). Only visible control: إغلاق.
- Hover-tooltip sweep across the content found no THintWindow texts at 1.1s dwell.
  Contents remain UNKNOWN without clicking blind tiles (deferred to controlled phase).

## Report cards opened via module buttons (OBSERVED)
| Report card | Opened from | Structure |
|---|---|---|
| TReportDailyForm «تقرير الحركة اليومية» | tile الحركة اليومية | tab ملخص, date range prefilled FULL YEAR (01/01–31/12/2026), عرض التقرير، طباعة |
| TReportSalesAnalysisForm «تقرير تحليل المبيعات» | tile تحليل المبيعات | date range current year, radios نقدى/آجل/الكل, combos, grid, طباعة، عرض تقرير تفصيلى، عرض تقرير مبسط |
| TReportMoneyAnalysisForm[المقبوضات|المصروفات] | الخزينة | month range, 2 grids each w/ طباعة + تقرير تفصيلى, عرض التقرير |
| TReportAccountStatementForm «كشف حساب» | الحسابات | month range, 2 grids, تعديل الفاتورة/حذف الفاتورة/طباعة المستند inside statement |

## Daily report data model (Users.ini — CONFIRMED schema, 19 sections)
TReportDailyForm hosts grids: Sales, RetSales, SaleQuotes, Purchases, RetPurchases,
Invents (جرد), Transfers, Adjusts (تسوية), Payments, Receipts.
⇒ One daily screen aggregates every document family. ملخص tab implies detail tabs exist.

## Print pipeline
- A hidden TPreviewFormEh («معاينة») exists in the process ⇒ print preview window class.
- طباعة buttons appear at both list and report level (طباعة التقرير vs طباعة المستند).

REQUIRES CONTROLLED TEST: actual printed layout, preview contents readability,
تقرير تفصيلى drill-down behavior, sales analysis combo semantics (per store? per user?).
