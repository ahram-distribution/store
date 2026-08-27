# SAHL Licensing Mechanism — Read-Only Analysis

- **Subject:** SAHL installation at `C:\SAHL` (سهل لإدارة الأعمال, Sahl.exe 17.0.0.70, vendor JUSTAGAIN / www.getsahl.com)
- **Date of analysis:** 2026-08-23
- **Method:** file-system inspection, binary string extraction (ASCII + UTF‑16), base64 structure analysis, Authenticode signature verification, read-only registry/service/port queries.
- **Constraints honored:** nothing under `C:\SAHL` was modified; the application was **not** executed; the MySQL database was **not** connected to or altered; no other SAHL installation was accessed; no attempt was made to decrypt, forge, extend, or bypass the license.

---

## 1. License component inventory

| File | Path | Size | Modified | Role |
|---|---|---|---|---|
| `Sahl` (no extension) | `C:\SAHL\Program\Sahl` | 5,490 B | 2026-08-08 (same day as `Sahl.exe`) | **The license/registration data store** — sole license-like artifact on the machine |
| `Sahl.exe` | `C:\SAHL\Program\Sahl.exe` | 6,960,912 B | 2026-08-08 | Main Delphi/Win32 executable; contains the license UI forms and validation logic |
| `ChilkatDelphi32.dll` | `C:\SAHL\Program\ChilkatDelphi32.dll` | 12,638,432 B | 2024-06-29 | Commercial cryptography library referenced by `Sahl.exe` |
| `Options.ini` | `C:\SAHL\Options.ini` | 2,778 B | 2026-08-23 | App configuration; contains `[DB] CloudApiUrl=` (empty) — an optional cloud-endpoint slot |

Files inspected but found **unrelated** to licensing: `Users.ini` (per-user UI/grid preferences only), `Log.txt` (login/backup event log), `UserReports\*.xlsx`, `Program\Audio|Reports|Walls`, remote-support binaries (`AnyDesk`, `TeamViewerQS`, `RustDesk`), OpenSSL tools (`libeay32`, `ssleay32`, `openssl.exe`), `AutoBackup.exe` (no license strings), `CustomerSupport.exe`.

## 2. Format of the license file

Structure measured from `C:\SAHL\Program\Sahl`:

```
total size   : 5,490 bytes
records      : 61 lines
line format  : 88 chars Base64 each (+ CRLF); every line ends "=="
decoded size : exactly 64 raw bytes per record
uniqueness   : all 61 records unique (SHA-1 over text lines)
entropy      : first record's 64 bytes contain 57 distinct byte values
               → indistinguishable from encrypted/compressed data
```

Classification based only on this evidence:

- **Not plain text. Not INI/XML/JSON.** No readable fields, keys, dates, or identifiers anywhere in the file.
- Best description from evidence: a **structured container of fixed-size (64-byte) encrypted/encoded binary records**, Base64-armored one record per line.
- Whether it is signed (signature embedded), and which algorithm is used (AES/RSA/other via Chilkat): **غير محسوم من الأدلة المتاحة**.

## 3. Information contained in the license

**None can be safely identified** — the payload does not decode to readable content.

Specifically, presence of expiration date, activation date, company name, customer ID, machine/device ID, installation ID, product/version ID, feature/module permissions, user limits, branch/store limits: **غير محسوم من الأدلة المتاحة** for every field (the encrypted container *could* hold any of these; the ciphertext proves nothing).

## 4. How the application locates the license

Evidence-based findings:

1. The license file sits **in the same directory as the executable** (`C:\SAHL\Program\`), with the literal name `Sahl` — matching the product name.
2. **No registry footprint**: read-only enumeration of `HKCU\Software`, `HKLM\Software`, `HKLM\Software\WOW6432Node` found **no** keys matching `sahl`, `justagain`, or `getsahl`.
3. **No secondary copy** exists under `%ProgramData%`, `%APPDATA%`, or `%LOCALAPPDATA%` (recursive search returned nothing).

Conclusion supported by evidence: the executable reads its licensing state from the **co-located `Sahl` file next to `Sahl.exe`**. Any additional lookup locations are غير محسوم من الأدلة المتاحة.

## 5. Validation mechanism — what the binary reveals

Delphi form classes compiled into `Sahl.exe` (extracted verbatim):

```
TLICENSEDETAILSFORM      – license details screen
TLICENSELOGINFORM        – license "login" screen
TLICENSENEEDACTIONFORM   – "action required" gating screen
TLICENSETRIALFORM        – trial-mode screen
TPOPUPEXPIREDATE         – expiry-date popup
TSTARTFORM               – start/splash form
TUPDATEFORM              – update mechanism
TSUPERUSERLOGINFORM / TSUPERUSERTASKSFORM / TSUPERUSERTASKSADVFORM
TLOCKFORM                – app lock screen
```

Supporting technical units also compiled in:

- `uMagWmi_S`, `gWmi_h` → a **WMI helper library** is present (capability to query Windows/hardware information). Purpose here (e.g., device fingerprinting vs. generic system info): **غير محسوم من الأدلة المتاحة**.
- `ChilkatDelphi32.dll` reference → commercial crypto capability linked to the app.

No plaintext strings were found for: license algorithms, feature-flag names, license server URLs/API paths (`api/`, `.php`, `/update`, etc. — zero hits), WMI class names (`Win32_*` — zero plaintext hits), volume/machine GUID strings.

## 6. Local vs. online validation

| Aspect | Finding |
|---|---|
| Local file validation | **Certain** — encrypted local store + dedicated local UI forms exist. |
| Online activation/licensing | **غير محسوم من الأدلة المتاحة.** Evidence cuts both ways: `Options.ini [DB] CloudApiUrl=` (currently **empty**) shows the product *has* a cloud-API concept; `TLICENSELOGINFORM` hints at account-style licensing; yet **zero** readable endpoints/URLs exist in the binary, and this machine runs fully offline-local (MySQL service `MySQL_SAHL` on localhost:3306, `Host=localhost`). |
| Network requests related to licensing | None observable from static evidence. The only URLs inside `Sahl.exe` are code-signing PKI infrastructure (Sectigo/DigiCert CRL/OCSP) and vendor websites in version metadata (`www.justagain.com`, `www.getsahl.com`). |

Working characterization: **locally validated encrypted license file; optional online component exists as a capability but is not demonstrably active in this installation.**

## 7. What determines validity / what happens when invalid

From the compiled form names alone:

- A **trial state** exists (`TLICENSETRIALFORM`).
- An **expiry date** concept exists (`TPOPUPEXPIREDATE`).
- A **blocking "need action" flow** exists (`TLICENSENEEDACTIONFORM`) — i.e., the app has a dedicated gate it can put between the user and the workspace.
- License details viewable by the app/user (`TLICENSEDETAILSFORM`).

Exact runtime behavior on invalid/expired license (block at startup? periodic check? module-level denial? grace period?): **غير محسوم من الأدلة المتاحة** — the running application was deliberately never launched during this study.

## 8. Feature/module control by license

Whether specific SAHL modules are unlocked/locked by license content: **غير محسوم من الأدلة المتاحة**. (The encrypted container is the plausible carrier of such flags, but no flag names or permission tables exist in plaintext; the MySQL schema contains **no** license table — enumerated tables: accounts, banks, einvoicing, installments, installments_parts, invoices, invoices_delivery, invoices_items, items, items_units, money, money_invoices, options, stores, stores_items, units, users.)

## 9. Integrity protections observed (distinct from licensing)

Authenticode signatures verified (read-only):

```
Sahl.exe               Valid  CN=JUSTAGAIN, O=JUSTAGAIN, S=Delaware, C=US
                              issuer CN=Sectigo Public Code Signing CA R36
AutoBackup.exe          Valid  CN=JUSTAGAIN
CustomerSupport.exe     Valid  CN=JUSTAGAIN
ChilkatDelphi32.dll     Valid  CN="Chilkat Software..."
libeay32/ssleay32       NotSigned
Program\Sahl (license)  UnknownError  ← unsigned data file (expected)
```

The executable itself is signed and timestamped; the license file is not Authenticode-signed (any integrity binding must be internal to the encrypted records): **غير محسوم من الأدلة المتاحة**.

## 10. Summary answers

1. **Location:** `C:\SAHL\Program\Sahl` (single copy machine-wide).
2. **Format:** Base64-armored structured container; 61 unique records × exactly 64 decoded bytes; high entropy ⇒ encrypted/encoded; exact cipher/signature scheme غير محسوم.
3. **Contents:** unreadable; no field safely identifiable.
4. **Validation:** performed inside `Sahl.exe` (dedicated license forms compiled in; Chilkat crypto linked).
5. **Local/online/hybrid:** local validation certain; online component غير محسوم (empty `CloudApiUrl` slot + license-login form hint at a dormant cloud concept).
6. **Validity factors:** غير محسوم (expiry/trial/need-action concepts proven to exist; their triggers unseen).
7. **Feature control:** غير محسوم.
8. **Expiry/device/company restrictions:** concepts exist in UI (expiry popup, trial form) but concrete values/bindings غير محسوم.
9. **Evidence:** §2 structure math, §4 absence-of-registry/copies sweeps, §5 extracted class names, §9 signature verification — all reproduced above verbatim.
10. **Not determined:** cipher/key handling, signature presence, exact check timing, runtime failure behavior, feature flags, DB-stored registration state (`options.ibd`/`users.ibd` contents unreadable without operating the DB, which was out of scope).

## 11. Compliance statement

- `C:\SAHL` was **not modified** — inspection used read-only file access, string extraction into a temp directory outside `C:\SAHL`, and read-only registry/service/signature queries.
- The application was **never executed**; the database was **never connected to**; no license operation (activate/deactivate/renew/bypass) was attempted.
- **No other SAHL installation** was accessed; external searches touched only `%ProgramData%/%APPDATA%/%LOCALAPPDATA%` to confirm absence of stray license copies.
