# Centralized Supabase Configuration

AUTHORITATIVE SOURCE: `D:\Projects\Access Tokens new`

This directory is the single project-local reference for the **current** Supabase
project that the Web app must always target. It contains **non-secret identifiers only**.

---

## CURRENT SUPABASE PROJECT

| Field | Value |
|---|---|
| Project name | `alahram-project` |
| Project ref | `fpsepeuykcioelcmkuup` |
| API URL | `https://fpsepeuykcioelcmkuup.supabase.co` |
| Region | `eu-west-1` |
| DB pooler host | `aws-1-eu-west-1.pooler.supabase.com` |
| DB user | `postgres.fpsepeuykcioelcmkuup` |
| DB port / database | `5432` / `postgres` |
| Dashboard | `https://supabase.com/dashboard/project/fpsepeuykcioelcmkuup` |

## OLD PROJECT — DO NOT USE

| Field | Value |
|---|---|
| Project ref | `gbcbejejgpvltuhbztbx` |
| API URL | `https://gbcbejejgpvltuhbztbx.supabase.co` |

> The old project **must not** be used by any active Web runtime, deployment,
> migration, or database-writing workflow.

## Secrets policy

- **Never** hard-code secret keys into application source code.
- **Never** commit service-role keys, management tokens, database passwords, PATs,
  or other secrets to Git.
- Secrets are stored in **git-ignored local/locked locations only**:
  - `.env.local` (project root) — Supabase URL/anon key + service key + DB password.
  - GitHub repository **secrets** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, ...) — CI only.
- `current-project.json` is safe to commit because it contains no secret values.

## Using this configuration

| Purpose | How |
|---|---|
| Web development | `.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (already current) |
| Web deployment | `.github/workflows/deploy.yml` reads GitHub secrets (must be set to current values) |
| Supabase migrations | Management API `POST https://api.supabase.com/v1/projects/fpsepeuykcioelcmkuup/database/query` with the Management API token (PAT) |
| RPC / database updates | `postgres.fpsepeuykcioelcmkuup` @ `aws-1-eu-west-1.pooler.supabase.com` via `pg`, or the Management API SQL endpoint |
| Edge Functions | `supabase functions deploy --project-ref fpsepeuykcioelcmkuup` (config in `supabase/config.toml`) |
| Database inspection | Root `*.cjs`/`*.mjs` diagnostic scripts (already repointed to the current project) |

## Verification target

```text
Web Supabase client     -> https://fpsepeuykcioelcmkuup.supabase.co
Customers screen (RPC)  -> get_governed_customers (exists in current DB)
Login (RPC)             -> login(p_phone, p_password)
Edge Function calls     -> <env URL>/functions/v1/... (current project)
```