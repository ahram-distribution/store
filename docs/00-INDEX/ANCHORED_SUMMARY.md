# Anchored Summary — Current State

> **الهدف**: ملخص تشغيلي للحالة الحالية للنظام. ليس سجل تقدم.

## System Reference

المرجع الرسمي الوحيد للنظام: **`docs/07-AUDITS/SYSTEM_REFERENCE_CURRENT_STATE.md`**

| القسم | المحتوى | الحالة |
|-------|---------|--------|
| **1. Database** | 657 functions, 30+ tables, 18 policies, 172 GRANTs | ✅ موثق |
| **2. API (RPCs)** | ~100+ unique RPCs, ~250+ frontend call sites | ✅ موثق |
| **3. Permissions** | Session auth, capability model, visibility scoping | ✅ موثق |
| **4. Runtime** | Activity, Achievement/KPI, Heartbeat | ✅ موثق |
| **5. Frontend** | Architecture, service layer, direct table access | ✅ موثق |
| **6. Findings** | 16 observations (marked for review) | ✅ موثق |

## Canonical Docs — Current Status

| الوثيقة | الدور | المرجع |
|---------|-------|--------|
| `SYSTEM_REFERENCE_CURRENT_STATE.md` | المرجع الرسمي الأساسي | نفسه |
| `SYSTEM_OF_TRUTH_MAP.md` | قواعد معمارية إلزامية (Prescriptive) | يشير إلى CURRENT_STATE |
| `ACTIVE_ROLE_MODEL.md` | تحليل الأدوار والمتغيرات | يشير إلى CURRENT_STATE Sec 3 |
| `ACTIVE_SCREEN_CATALOG.md` | كتالوج الشاشات الكامل | مرجع مستقل (فريد) |
| `UNIFIED_SMART_SEARCH.md` | توثيق تنفيذ البحث الموحد | مرجع مستقل |
| `FIELD_REP_PRESENCE_POLICY.md` | سياسة حضور المندوبين | مرجع مستقل |
| `BUSINESS_SPECIFICATION_RESERVATION_ALLOCATION.md` | مواصفة أعمال محرك حجز وتخصيص المخزون (قواعد BR-* مؤكدة) | مرجع مستقل (يسبق وثيقة تصميم Schema/RPC) |
| `RESERVATION_ALLOCATION_ARCHITECTURE.md` | معمارية الحجز والتخصيص — Synchronous Recalculation Engine | يشير إلى المواصفة الرسمية |
| `SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md` | تصميم Schema و RPC Contracts — نموذج الحجز المشتق (Derived Reservation) (مُراجَع 2026-08-01: 2 معتمد، 1 مُعدَّل، 1 مؤجَّل؛ بانتظار اعتماد النسخة النهائية قبل التنفيذ) | يشير إلى المعمارية والمواصفة |

## Findings Pending Review

16 Findings في `SYSTEM_REFERENCE_CURRENT_STATE.md` القسم 6. لم نبدأ مراجعتها بعد.

## Current Principle

**كل معلومة لها مكان واحد فقط يتم تحديثه.**  
لا توجد وثيقتان تصفان نفس الجزء من النظام.  
أي تغيير في النظام يتم → تحديث المرجع أولاً → ثم الوثائق التي تشير إليه.
