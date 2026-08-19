-- ============================================================================
-- ENFORCE SINGLE-ROOT EMPLOYEE HIERARCHY (database-level invariant)
-- DATE: 2026-09-21
--
-- BUSINESS RULE
--   Employee WRQ1003 is the ONLY allowed root employee in the hierarchy.
--     - WRQ1003 MUST have manager_id IS NULL.
--     - Every other employee MUST have manager_id NOT NULL.
--     - Every non-root employee's manager chain MUST eventually resolve to
--       WRQ1003 (no orphans, no disconnected subtrees, no second root).
--     - No manager chain cycle is allowed.
--
-- ENFORCEMENT (database-level, not UI)
--   1. BEFORE trigger on public.employees (INSERT / UPDATE / DELETE):
--        - rejects setting the root's manager_id to anything other than NULL
--        - rejects any non-root employee with manager_id NULL
--        - rejects any manager chain that does not resolve to WRQ1003
--          (bounded traversal detects both disconnection and cycles)
--        - rejects deletion of the root employee
--   2. Partial UNIQUE INDEX allowing at most ONE employee row with
--      manager_id IS NULL (defense-in-depth for the single-root rule).
--
-- The root is identified by its authoritative employee CODE 'WRQ1003';
-- its employee ID is resolved from the database at enforcement time.
-- No personal information is hardcoded.
--
-- Reuses the existing hierarchy source (public.employees.manager_id).
-- ADDITIVE ONLY: no columns, RPC signatures, roles, or permissions changed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_single_root_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_root_id uuid;
  v_current uuid;
  v_steps int;
  v_total int;
BEGIN
  -- Root is identified by its authoritative code.
  IF TG_OP = 'DELETE' THEN
    IF OLD.code = 'WRQ1003' THEN
      RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: root employee WRQ1003 cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  -- Root row (insert or update) must keep manager_id NULL.
  IF NEW.code = 'WRQ1003' THEN
    IF NEW.manager_id IS NOT NULL THEN
      RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: root employee WRQ1003 must have manager_id NULL';
    END IF;
    RETURN NEW;
  END IF;

  -- Every non-root operation requires the root to exist first.
  SELECT id INTO v_root_id FROM public.employees WHERE code = 'WRQ1003';
  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: root employee WRQ1003 does not exist; create it first';
  END IF;

  -- Non-root employee must always have a manager.
  IF NEW.manager_id IS NULL THEN
    RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: only the root employee WRQ1003 may have manager_id NULL';
  END IF;

  -- Manager must exist (the FK also enforces this; checked here for a clear error).
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = NEW.manager_id) THEN
    RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: manager_id references a non-existent employee';
  END IF;

  -- Walk the manager chain; it must reach the root within a bounded number of
  -- steps. Exceeding the employee count + 1 means a cycle or a disconnected
  -- subtree exists -> reject.
  --
  -- NOTE: inside a BEFORE UPDATE trigger the table still holds the OLD value of
  -- the row being modified, so when the walk reaches the row itself (NEW.id)
  -- the NEW manager_id must be used as that row's outgoing edge. This correctly
  -- detects cycles that involve the modified row (e.g. X->Y combined with
  -- setting Y.manager_id = X).
  SELECT count(*) INTO v_total FROM public.employees;
  v_current := NEW.manager_id;
  v_steps := 0;
  LOOP
    IF v_current = v_root_id THEN
      RETURN NEW;
    END IF;
    v_steps := v_steps + 1;
    IF v_steps > v_total + 1 THEN
      RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: manager chain does not resolve to root WRQ1003 (cycle or disconnected)';
    END IF;
    IF v_current = NEW.id THEN
      v_current := NEW.manager_id;
    ELSE
      SELECT manager_id INTO v_current FROM public.employees WHERE id = v_current;
    END IF;
    IF v_current IS NULL THEN
      RAISE EXCEPTION 'HIERARCHY_RULE_VIOLATION: manager chain does not resolve to root WRQ1003 (disconnected)';
    END IF;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.enforce_single_root_hierarchy() IS
  'Database-level invariant: WRQ1003 is the only allowed root; every other employee must resolve to it (no NULL managers, no orphans, no cycles, no root deletion)';

DROP TRIGGER IF EXISTS trg_enforce_single_root_hierarchy ON public.employees;
CREATE TRIGGER trg_enforce_single_root_hierarchy
BEFORE INSERT OR UPDATE OR DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_root_hierarchy();

-- Defense-in-depth: at most ONE employee row may have manager_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_single_null_manager
  ON public.employees ((1))
  WHERE manager_id IS NULL;
