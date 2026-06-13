# TARGET ROLE MODEL

> **Date:** 2026-06-13
> **Type:** Definitive mapping table — old → target roles, capabilities, workspace routing, authority hierarchy
> **Authority:** Owner-defined organizational model (OWNER_KNOWLEDGE_BASE/02_ORGANIZATIONAL_MODEL.md)

---

## 1. ROLE HIERARCHY (Owner-Defined)

```
الإدارة العليا  (Upper Management)          ← unified: SUPER_ADMIN, ADMIN, CHAIRMAN, EXECUTIVE_MANAGER
     │
     ├── مدير بيع  (Sales Manager)           ← replaces: supervisor/مشرف مبيعات, سوبر فايزر
     │     │
     │     └── مندوب مبيعات  (Sales Rep)     ← canonical: مندوب مبيعات (not مندوب)
     │
     ├── سيلز داخلي  (Internal Sales)         ← NEW — no legacy mapping
     │
     ├── مشرف عام  (General Supervisor)       ← existing: general_supervisor, generalsupervisor, مشرف تنفيذي
     │     │
     │     └── مدير مخزن  (Warehouse Manager) ← existing: warehouse_manager, warehousemanager
     │
     └── عميل  (Customer)                     ← identity_type = 'customer'
```

---

## 2. DEFINITIVE OLD → TARGET MAPPING

### 2.1 Upper Management (الإدارة العليا)

Maps to a unified `is_upper_management()` check rather than a single role name:

| Old Role(s) | Variants | Target | Route | Notes |
|-------------|----------|--------|-------|-------|
| `SUPER_ADMIN` | `سوبر أدمن`, `سوبرادمن`, `superadmin`, `super_admin` | **الإدارة العليا** | `UpperManagementDashboard` | Full system access |
| `ADMIN` | `أدمن`, `ادمن`, `administrator` | **الإدارة العليا** | `UpperManagementDashboard` | Full system access |
| `CHAIRMAN` | `رئيس مجلس الإدارة`, `رئيس مجلس الادارة` | **الإدارة العليا** | `UpperManagementDashboard` | Full system access |
| `EXECUTIVE_MANAGER` | `مدير تنفيذي`, `المدير التنفيذي`, `executive_director`, `executive` | **الإدارة العليا** | `UpperManagementDashboard` | Maps to upper management dashboard |

### 2.2 Sales Management

| Old Role(s) | Variants | Target | Route | Notes |
|-------------|----------|--------|-------|-------|
| `Sales Manager` | `مدير البيع`, `مدير مبيعات`, `sales_manager`, `salesmanager` | **مدير بيع** | `SalesManagerWorkspace` | Canonical role — canonical AR name: `مدير البيع` |
| `supervisor` | `مشرف مبيعات` | **مدير بيع** (retired → absorbed) | `SalesManagerWorkspace` | LEGACY — redirect to sales manager workspace |
| `سوبر فايزر` | — | **مدير بيع** (retired → absorbed) | `SalesManagerWorkspace` | LEGACY — redirect to sales manager workspace |
| `مشرف` | — | **مدير بيع** (retired → absorbed) | `SalesManagerWorkspace` | LEGACY — quick-links only |

### 2.3 Sales Representative

| Old Role(s) | Variants | Target | Route | Notes |
|-------------|----------|--------|-------|-------|
| `مندوب مبيعات` | `sales_rep`, `salesrep` | **مندوب مبيعات** | `SalesRepWorkspace` | Canonical — no change |
| `مندوب` | — | **مندوب مبيعات** | `SalesRepWorkspace` | LEGACY abbreviation — normalized |

### 2.4 General Supervisor

| Old Role(s) | Variants | Target | Route | Notes |
|-------------|----------|--------|-------|-------|
| `general_supervisor` | `generalsupervisor`, `مشرف تنفيذي` | **مشرف عام** | `GeneralSupervisorWorkspace` | Canonical — rename to target Arabic name |
| `warehouse_manager` | `warehousemanager`, `مدير مستودع` | **مدير مخزن** (under مشرف عام) | `WarehouseManagerWorkspace` | Subordinate role |

### 2.5 New Roles

| Target Role | Route | Notes |
|-------------|-------|-------|
| **سيلز داخلي** | `InternalSalesWorkspace` | NEW — needs workspace component, route entry, roles mapping |
| **عميل** | `CustomerDashboard` | Already exists as `identity_type = 'customer'` — no change |

### 2.6 Non-Target Roles — Deprecated

These exist in the system but are NOT part of the owner-defined model. They should be disabled from active routing and frozen (no new access):

| Role | Arabic | Current Route | Recommended Action |
|------|--------|---------------|-------------------|
| `warehouse` (not manager) | `مستودع` | `WarehouseManagerWorkspace` | Route to مدير مخزن workspace with reduced access |
| `delivery` | `توصيل`, `مدير نقل` | `DeliveryWorkspace` | Freeze — keep only if explicitly re-approved |
| `collector` | `محصل` | `CollectorWorkspace` | Freeze — keep only if explicitly re-approved |
| `accountant` | `محاسب` | `AccountantWorkspace` | Freeze — keep only if explicitly re-approved |
| `purchasing_manager` | `مدير مشتريات` | `PurchasingWorkspace` | Freeze — keep only if explicitly re-approved |
| `secretary` | `سكرتير` | `SecretaryWorkspace` | Freeze — keep only if explicitly re-approved |
| `security` | `أمن`, `امن` | `SecurityWorkspace` | Freeze — keep only if explicitly re-approved |
| `buffet` | `بوفيه` | `BuffetWorkspace` | Freeze — keep only if explicitly re-approved |
| `data_entry` | `مدخل بيانات` | `DataEntryWorkspace` | Freeze — keep only if explicitly re-approved |

---

## 3. CAPABILITY MODEL

### 3.1 Upper Management Capabilities (Automatic Bypass)

Server-side `check_capability` must implement a true bypass:

```sql
CREATE OR REPLACE FUNCTION is_upper_management(p_employee_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_employee_id UUID := COALESCE(p_employee_id, auth.uid());
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM employee_roles er
        JOIN roles r ON r.id = er.role_id
        WHERE er.employee_id = v_employee_id
        AND r.name IN ('SUPER_ADMIN', 'ADMIN', 'CHAIRMAN', 'EXECUTIVE_MANAGER')
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

This function becomes the single source of truth — 4 role strings in one place instead of 35+ RPCs.

### 3.2 Capability Definition

| Target Role | Required Capabilities | Inherited From |
|-------------|----------------------|----------------|
| الإدارة العليا | ALL (automatic bypass via `is_upper_management()`) | System |
| مدير بيع | `manage_team_sales`, `approve_orders`, `view_team_reports`, `manage_visits`, `manage_new_customers` | Sales management |
| مندوب مبيعات | `create_orders`, `create_visits`, `my_reports`, `manage_customers` | Sales execution |
| مشرف عام | `view_all_operations`, `approve_inventory`, `manage_warehouse`, `view_reports` | Operations supervision |
| مدير مخزن | `manage_inventory`, `process_returns`, `view_stock`, `manage_transfers` | Warehouse operations |
| سيلز داخلي | `create_phone_orders`, `manage_internal_customers`, `view_inventory` | Internal sales |
| عميل | `view_orders`, `view_invoices`, `my_account` | Customer portal |

### 3.3 CAPABILITY CHECK → Replace `r.name IN (...)`

**OLD pattern (brittle):**
```sql
IF EXISTS (
    SELECT 1 FROM employee_roles er
    JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = p_employee_id
    AND r.name IN ('SUPER_ADMIN', 'CHAIRMAN', 'ADMIN')
) THEN
    RETURN QUERY SELECT * FROM target_data;  -- full visibility
END IF;
```

**NEW pattern (resilient):**
```sql
IF is_upper_management(p_employee_id) THEN
    RETURN QUERY SELECT * FROM target_data;
END IF;
```

For non-upper-management gates:
```sql
IF check_capability(p_employee_id, 'approve_orders') THEN
    -- allow operation
END IF;
```

---

## 4. ROUTING TABLE

| Target Role | DashboardPage.tsx Route | Workspace Component |
|-------------|------------------------|---------------------|
| الإدارة العليا | `UpperManagementDashboard` | `UpperManagementDashboard` |
| مدير بيع | `SalesManagerWorkspace` | `SalesManagerWorkspace` |
| مندوب مبيعات | `SalesRepWorkspace` | `SalesRepWorkspace` |
| مشرف عام | `GeneralSupervisorWorkspace` | `GeneralSupervisorWorkspace` |
| مدير مخزن | `WarehouseManagerWorkspace` | `WarehouseManagerWorkspace` |
| سيلز داخلي | `InternalSalesWorkspace` | **NEW** |
| عميل | `CustomerDashboard` | `CustomerDashboard` |

---

## 5. DATABASE CONSTANTS

```sql
-- one-time migration: create target roles if not exist
INSERT INTO roles (name, description, is_system) VALUES
    ('سيلز داخلي', 'Internal Sales - phone/office orders', true)
ON CONFLICT (name) DO NOTHING;
```

```sql
-- one-time migration: flag mapping
CREATE TABLE IF NOT EXISTS role_normalization (
    old_role_name TEXT PRIMARY KEY,
    target_role_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'mapped'
        CHECK (status IN ('mapped', 'retired_absorbed', 'deprecated_frozen', 'new')),
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO role_normalization (old_role_name, target_role_name, status) VALUES
    ('SUPER_ADMIN', 'الإدارة العليا', 'mapped'),
    ('ADMIN', 'الإدارة العليا', 'mapped'),
    ('CHAIRMAN', 'الإدارة العليا', 'mapped'),
    ('EXECUTIVE_MANAGER', 'الإدارة العليا', 'mapped'),
    ('مدير البيع', 'مدير بيع', 'mapped'),
    ('مدير مبيعات', 'مدير بيع', 'retired_absorbed'),
    ('Sales Manager', 'مدير بيع', 'mapped'),
    ('مندوب مبيعات', 'مندوب مبيعات', 'mapped'),
    ('مشرف تنفيذي', 'مشرف عام', 'mapped'),
    ('general_supervisor', 'مشرف عام', 'mapped'),
    ('warehouse_manager', 'مدير مخزن', 'mapped'),
    ('سيلز داخلي', 'سيلز داخلي', 'new'),
    ('supervisor', 'مدير بيع', 'retired_absorbed'),
    ('مشرف مبيعات', 'مدير بيع', 'retired_absorbed'),
    ('سوبر فايزر', 'مدير بيع', 'retired_absorbed'),
    ('warehouse', 'مدير مخزن', 'deprecated_frozen'),
    ('delivery', null, 'deprecated_frozen'),
    ('collector', null, 'deprecated_frozen'),
    ('accountant', null, 'deprecated_frozen'),
    ('purchasing_manager', null, 'deprecated_frozen'),
    ('secretary', null, 'deprecated_frozen'),
    ('security', null, 'deprecated_frozen'),
    ('buffet', null, 'deprecated_frozen'),
    ('data_entry', null, 'deprecated_frozen')
ON CONFLICT (old_role_name) DO UPDATE SET
    target_role_name = EXCLUDED.target_role_name,
    status = EXCLUDED.status;
```

---

## 6. FRONTEND NORMALIZATION FUNCTION

```typescript
// src/utils/roleNormalization.ts
export type TargetRole =
  | 'الإدارة العليا'
  | 'مدير بيع'
  | 'مندوب مبيعات'
  | 'مشرف عام'
  | 'مدير مخزن'
  | 'سيلز داخلي'
  | 'عميل';

const roleMapping: Record<string, TargetRole> = {
  'SUPER_ADMIN': 'الإدارة العليا',
  'ADMIN': 'الإدارة العليا',
  'CHAIRMAN': 'الإدارة العليا',
  'EXECUTIVE_MANAGER': 'الإدارة العليا',
  'سوبر أدمن': 'الإدارة العليا',
  'رئيس مجلس الإدارة': 'الإدارة العليا',
  'أدمن': 'الإدارة العليا',
  'مدير تنفيذي': 'الإدارة العليا',
  'المدير التنفيذي': 'الإدارة العليا',
  'superadmin': 'الإدارة العليا',
  'super_admin': 'الإدارة العليا',
  'administrator': 'الإدارة العليا',
  'executive_director': 'الإدارة العليا',
  'executive': 'الإدارة العليا',

  'مدير البيع': 'مدير بيع',
  'مدير مبيعات': 'مدير بيع',
  'sales_manager': 'مدير بيع',
  'salesmanager': 'مدير بيع',
  'sales': 'مدير بيع',
  'supervisor': 'مدير بيع',
  'مشرف مبيعات': 'مدير بيع',
  'سوبر فايزر': 'مدير بيع',
  'مشرف': 'مدير بيع',

  'مندوب مبيعات': 'مندوب مبيعات',
  'sales_rep': 'مندوب مبيعات',
  'salesrep': 'مندوب مبيعات',
  'مندوب': 'مندوب مبيعات',

  'general_supervisor': 'مشرف عام',
  'generalsupervisor': 'مشرف عام',
  'مشرف تنفيذي': 'مشرف عام',

  'warehouse_manager': 'مدير مخزن',
  'warehousemanager': 'مدير مخزن',
  'مدير مستودع': 'مدير مخزن',
  'warehouse': 'مدير مخزن',
  'مستودع': 'مدير مخزن',

  'سيلز داخلي': 'سيلز داخلي',
};

export function normalizeEmployeeRole(roleName: string): TargetRole {
  return roleMapping[roleName] ?? 'مندوب مبيعات'; // safe default
}

export function isUpperManagement(roleName: string): boolean {
  return normalizeEmployeeRole(roleName) === 'الإدارة العليا';
}
```

---

## 7. DEPRECATED ROLE HANDLING

Non-target roles that are `deprecated_frozen`:
- Continue to exist in DB (no data loss)
- Employee assignments remain unchanged (no permission loss)
- **DashboardPage redirects** these roles to a **GeneralWorkspace** (limited access) instead of their legacy workspace
- No new capability assignments for these roles
- No routing to their legacy workspaces
- Frozen employees retain login access but see only general dashboard

---

*End of TARGET_ROLE_MODEL.md*
