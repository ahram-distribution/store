# Accounts (الحسابات) — live observations

## TAccountsForm «الحسابات» — OBSERVED
### Filter checkboxes (top)
- إظهار الحسابات الغير نشطة فقط (show inactive only)
- إخفاء الأرصدة الصفرية (hide zero balances)
- إظهار الحسابات تحت المراجعة فقط (show accounts flagged for review)

### Action buttons
جديد · تعديل · حذف · كشف حساب · كشف حساب بالأصناف · أرصدة الحسابات بتاريخ سابق ·
**الشيكات والأقساط** · قبض · صرف · طباعة قائمة الحسابات · تحديث · إغلاق

Layout: left vertical action rail, right large TDBGridEh list.
Grid schema (Users.ini `TAccountsForm-Grid`): id, title, code, balance_in, balance_out,
acc_custom1, phone, email, address, address2, more.

## New/Edit account entry card — OBSERVED (opened via «حسابات افتتاحية» tile; canceled)
- Type radios: **عميل / مورد / مندوب بيع / أخرى** (customer / supplier / sales-rep / other)
- TDBCheckBox «حساب غير نشط» (inactive account flag)
- TCheckBox «ذكرنى بمراجعة الحساب» ⇒ feeds the «تحت المراجعة» filter above
- Buttons: حفظ · تراجع · حفظ | جديد
- Opening-balance flow reuses the same entry (INFERRED from tile naming «افتتاحية»).

### Field map (positions in ~950px-wide window)
- x≈155 column: TDBEdit(416), **name TComboBox(445)**, TDBEdit(474)
- x≈435 column: TDBEdit(416), TDBEdit(445), TDBComboBox(474)
- right x≈715/760: four numeric edits (y 552, 581, 631, 660)
- near radios: TDBEdit(732,334)

### CONFIRMED field: `max_balance_out`
Native error observed while canceling a dirty entry:
«'0E' is not a valid floating point value for field 'max_balance_out'»
⇒ accounts carry a numeric max-balance-out (credit-limit style) field; validation blocks
post AND تراجع paths until fixed. See 95-controlled-tests.md for the incident log.

## كشف حساب — TReportAccountStatementForm — OBSERVED
- Date range prefilled current month (01/08/2026 – 31/08/2026).
- Two grids: upper = documents list, lower = detail (INFERRED from layout + buttons).
- Document-level actions inside the statement: تعديل الفاتورة، حذف الفاتورة، طباعة المستند —
  i.e. the statement is an operations hub, not just a printout.
- عرض التقرير refreshes; طباعة التقرير prints. إغلاق returns to accounts list.
- Closed via Esc after button click failed once (button click needs fresh focus).

## الشيكات والأقساط — OBSERVED: button enabled but click produced NO visible window
when grid empty / no row selected. REQUIRES CONTROLLED TEST with at least one account.

## UNKNOWN / REQUIRES CONTROLLED TEST
- كشف حساب بالأصناف (item-wise statement) contents
- أرصدة الحسابات بتاريخ سابق dialog shape
- قبض/صرف shortcuts from within accounts: do they pre-link the selected account?
- Numbering of accounts (code field auto?)
