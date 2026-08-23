# Print templates & document data models (from C:\SAHL\Program\Reports\ar)

> CONFIRMED evidence: 107 xlsx+png template files. Placeholders `<#source.field>` reveal
> exact fields SAHL binds per document. Expression language supports
> `<#if(cond;<#delete row>;)>`, `<#Aggregate(sum;src.fld)>`, `<#Evaluate(#RowPos+1)>`,
> `<#imgsize>`, `<#amount_string>` (tafqeet/تفقيط amount-in-words).

## Document families & their bound fields

### Sale invoice (`form-sale-*`: 80mm/57mm/A4/A5/Delivery/Cafe1-3/DotMatrix/EInvoice)
- Header/data: id, date1, time1, qty, total, additions(+addition1_type), tax1,
  discounts, grand_total, **deposit**, **credit_due**, reference, more,
  **einvoicing_status**, **uuid**
- Lines/items: item_id, title, unit, qty, amount, total, grand_total, tax1,
  discounts, **sn (serial)**, **einvoicing_itemCode**
- Account side: account_title/address/address2/phone/tax_id, balance_before/after
- Other: payment_type, salesman (in daily-report source), user, company/contact_details×3,
  company_logo, tax_id & cr_id (company), category1
- Special variants: **0080 Delivery note**, **0090 Installment Contract**, **0100-0111 Cafe tickets**, **0140 Electronic Invoice**

### Installment contract (`form-sale-0090`) — CONFIRMS أقساط engine
- `instals` datasource: **amount, due_date, cheque_no, cheque_bank, more**
- ⇒ each installment can be a plain amount+date OR carry cheque details;
  contract prints row numbers via Evaluate(RowPos+1); uses deposit + credit_due from sale.

### Receipt (قبض) / Payment (صرف) (`form-receipt/payment-*`)
- data: id, date1, amount, **category1**, account_id(optional→delete-row if empty), more
- account_title + balance_before/balance_after ⇒ receipt/payment prints customer balance delta.

### Cash transfer (`form-cashtransfer-*`)
- data: id, date1, amount, cashbox_title, more
- **cashbox_balance_before / cashbox_balance_after**

### Account statement (`account-statement-*`)
- Row: date1, id, kind_, money_in, money_out, balance, more, discounts
- Nested ITEMS rows per statement line (items.qty/title/unit/grand_total…)
- Aggregates: total_sales, total_sales_returns, total_purchases, total_purchases_returns,
  total_receipts, total_payments, **total_instals**, balance_before/after, balance_string(تفقيط)

### Daily report (`report-daily-*`)
Ten sources (matches Users.ini grids):
Sales, RetSales(**return_inv_id**, salesman), SaleQuotes(salesman), Purchases,
RetPurchases(return_inv_id), Invents(store,qty,reference), Transfers(store,**store_to**),
Adjusts(store,qty,reference), Payments(category1,account), Receipts(category1,account).
Common: id,date1,item_id,code1,title,unit,qty,amount,discounts,grand_total,payment_type_,
store,reference,salesman,createdby.
Summary tokens: SumCash*/SumCredit* split per family, SumCount*, SumTotal*,
**BankSum*** set (OpenBalance,Receipts,Payments,Sales,Purchases,Returns,InvoicesExpenses,Net,FinalBalance)
⇒ BANK accounts aggregated separately from CASH boxes in the daily report.

## Import/export templates
- `Template1.xlsx` / `TemplateNested1.xlsx` are GALLERY report bases (RTL sheet, data band on
  row 4, defined name `__Data__`), not import forms. ExcelTemplatesVersion=2 in Options.ini
  tracks their format version. An actual Excel-import feature is INFERRED from
  Options.ini/Excel templates but its UI entry point remains UNKNOWN.

## Engine notes
- Templates are XLSX with placeholder text cells → SAHL renders them (Gallery system),
  selectable per user («ByUser») per document type (Options.ini GalleryTemplates maps defaults:
  sale=0070-A5, returnsale/receipt/payment=0010-80mm, purchase/invent/transfer/adjust=0020-A4,
  account-statement=0010-A4, report-daily=0010-80mm).
