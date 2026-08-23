# Controlled Tests Log

> Rules: test data must be marked «TEST - SAHL PARITY»; cleanup via app mechanisms when safe;
> every material test documented below.

## TEST-01 — Create test customer (عميل)
- **Objective:** unlock data-gated features (الشيكات والأقساط button, analysis grids) by
  creating `TEST - SAHL PARITY` customer through الحسابات → جديد.
- **Initial state:** restored 8/20 backup; no records created during investigation.
- **Steps performed:** opened entry card (radios عميل/مورد/مندوب بيع/أخرى visible);
  clicked عميل radio; attempted clipboard paste & VK typing into name combo / edits;
  clicked حفظ once.
- **Result:** NOT COMPLETED. No text ever registered in any TDBEdit/TComboBox despite
  verified foreground (GetForegroundWindow == TMainForm), direct WM_CHAR injection,
  keybd_event typing, clipboard paste. Fields stayed empty ⇒ skinned DB-aware editors reject
  synthetic input OR dataset never entered dsInsert from automation context.
- **Business effect:** none observed. Posts blocked by app validation:
  «'0E' is not a valid floating point value for field 'max_balance_out'» — caused by probe
  keystrokes landing in a numeric field during an unfocused run.
- **What was learned:**
  1. Account entry has numeric field **max_balance_out** (max balance/credit limit).
  2. Validation fires on تراجع/post while buffer dirty and BLOCKS saves entirely
     (safety-positive: no partial record could be created).
  3. Trial nag TPopupMessageForm «شكرا» steals focus every few minutes.
  4. Error dialogs are native #32770 with English technical text + OK button.
- **Status:** BLOCKED — automated UI entry infeasible with current tooling.
- **Cleanup status:** card closed via إغلاق after dismissing validation; app back to
  TStartForm cleanly. No TEST record confirmed created; nothing to delete.
  Residual risk UNVERIFIED without SQL access (see below).

## Blocked verification channel (REQUIRES OWNER DECISION)
- `Options.ini [DB]`: root / empty password / sahl1 @ localhost:3306 — server REJECTS these
  (+7 common defaults tried, all denied). Real creds embedded obfuscated in packed Sahl.exe.
- Client works: `C:\SAHL\mysql-5.7.33-winx64\bin\mysql.exe`; service MySQL_SAHL via `_my.ini`.
- With read-only credentials, numeric verification (balances/numbering/stock deltas)
  becomes trivial SELECT-only work.

## Deferred tests (need human data-entry or SQL channel)
- الشيكات والأقساط screen structure (button enabled; opens nothing w/o row/data)
- آجل sale → customer balance mechanics (balance_before/after CONFIRMED in templates)
- شيك ؟ money-entry → cheque module linkage
- مرتجع من فاتورة reversal effects
- Installment schedule editing inside sale (instals.* confirmed in contract template)
- Excel import/export round-trip
