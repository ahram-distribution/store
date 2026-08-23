# SAHL Live UI Investigation — Environment & Method

> Source: live observation of the authorized installation `C:\SAHL` (Sahl.exe PID varies).
> Date window: 2026-08-20 → 2026-08-23. All findings below are OBSERVED unless marked otherwise.

## Installation facts (OBSERVED)
- Product title bar: «سهل لإدارة الأعمال   ▼   نسخة غير مرخصة للتجربة فقط   ▼   شركة : الاهرام للتجارة والتوزيع   ▼   مدير النظام»
- **Trial/unlicensed banner permanently visible in the main window caption.**
- Logged in as «مدير النظام» (system administrator), password empty.
- Company in use: الاهرام للتجارة والتوزيع.
- `Log.txt` shows daily logins 8/20→8/23 and:
  «Backup Restore … D:\SAHL Backups\sahl1\sahl1__2026-08-20__01-32pm__auto.SahlBackup3» at 2026-08-23 02:10:48pm
  ⇒ The live database is a restored snapshot of 8/20.
- User prefs (`Users.ini [sahl1___User-1]`, read-only): DefaultStore=1, DefaultBank=1,
  DefaultPaymentType=CASH, DefaultSalesPrice=1, LockAfterMinutes=10.

## UI technology (CONFIRMED via Win32 tree)
- Delphi VCL + AlphaControls skins (TsPanel/TsBitBtn/TsButton), TChromeTabs card bar,
  EhLib grids (TDBGridEh) + TDBLookupComboboxEh + TDBEdit/TDBCheckBox.
- Main window class `TMainForm` hosts a `TCardPanel/TCard` swap area:
  - Home dashboard = `TStartForm[ابدأ مع سهل]`
  - Each module opens as a card INSIDE TMainForm (child window), e.g. TInvoiceForm, TMoneyForm.
  - Some dialogs open as TOP-LEVEL popups instead: `TPopupSearchInvoicesForm`,
    `TPopupMessageForm` (trial nag with single button «شكرا»), `TOptionsForm`.
- Most labels/tiles are custom-drawn panels: NOT readable via Win32 text APIs.
  Readable: BitBtn captions, Edit values, form captions, THintWindow tooltips.
- Grid cell contents (TDBGridEh) are NOT exposed to Win32 — only column schemas are known
  from Users.ini sections (e.g. `TFrameItems-Grid`, `TAccountsForm-Grid`,
  `TInvoiceForm-MainGrid___SALEQUOTE.3`, `TReportDailyForm-*` ×10).

## Window geometry trap (IMPORTANT for any automation)
- Main window alternates between maximized (~1920px wide) and restored (967×1057 @ (-7,0)).
- Tile coordinates differ between the two states. Always re-read rects immediately before clicks.
- Never call ShowWindow on it; use SetForegroundWindow + fresh rects.

## Method used (for reproducibility)
- PowerShell + Add-Type C# P/Invoke: EnumWindows/EnumChildWindows, GetClassName/GetWindowText,
  GetWindowRect, mouse_event clicks, keybd_event keys, WM_CLOSE (0x0010) for stray popups.
- Helper library kept at `C:\Users\joker\AppData\Local\Temp\opencode\SLib.cs`.
- Tooltips captured by parking cursor away, moving onto target, dwelling ~2s, reading THintWindow.

## Global UI hazards (OBSERVED)
- Trial nag `TPopupMessageForm` (single button «شكرا») pops periodically and STEALS FOCUS —
  re-check foreground before every synthetic key/click.
- Validation errors appear as native `#32770` dialogs with English technical messages
  (e.g. field-name errors) and a single OK button.
- Synthetic keyboard input is rejected by skinned DB-aware editors even with correct
  foreground; only real input events or in-app actions change field buffers.

## Safety status
- READ/RUN ONLY: no data entry succeeded, no records created/modified/deleted.
- Entry forms were opened and canceled (تراجع) or closed (إغلاق/Esc) without typing.
- One dirty-buffer incident (stray '0E' in max_balance_out during unfocused probes) was
  blocked by app validation and discarded on card close — full log in 95-controlled-tests.md.
