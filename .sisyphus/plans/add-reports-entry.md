
# Plan: Add Missing "Reports" Entry Point to Sales Manager CC Page

## Context

Activity Reports recovery is complete (4 files restored from SQLite DB). The route `/reports/activity`
exists at `src/routes/index.tsx:166` but **no navigation entry passes the required `scope` state**.
The page crashes when accessed without `location.state.scope`.

The Sales Manager CC page (`SalesManagerCCPage.tsx`) currently lacks a "Reports" tab, which is the
natural home for the Activity Reports entry point.

## Changes

### File: `src/pages/sales-manager/SalesManagerCCPage.tsx`

Add a new "التقارير" (Reports) tab to the Sales Manager CC page that navigates to the activity
reports page with the correct scope.

**Changes:**

1. **Add `useNavigate` import** (line 1) — already imported
2. **Add `nav` usage** — already has `const nav = useNavigate()` (line 28)
3. **Add new tab** after the existing operations tab (after line 463):
   ```tsx
   <TabButton
     active={activeTab === 'reports'}
     onClick={() => nav('/reports/activity', { state: { scope: 'team' } })}
     icon="📋"
     label="التقارير"
   />
   ```

### File: `src/routes/index.tsx`

Verify the route exists (it does at line 166). No changes needed.

## Verification

1. Navigate to `/cc` as a Sales Manager
2. Click the "التقارير" tab
3. Verify navigation to `/reports/activity` with `scope: 'team'`
4. Verify Activity Reports page loads with team data
5. Test scope switching (company/team/self) via filters

## Scope

- **Minimal change**: 1 new tab button in SalesManagerCCPage
- **No refactoring**: existing tabs untouched
- **No new files**: leverages existing route and page
