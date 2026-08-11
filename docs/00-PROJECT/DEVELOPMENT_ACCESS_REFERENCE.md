# Development Access Reference

> Internal document. Contains all access information required to fully continue development.

---

## 1. Source Code

### Repository
- **URL:** `https://github.com/ahram-distribution/store.git`
- **Default branch:** `main`
- **No additional branches** currently in use
- **No submodules** (`.gitmodules` does not exist)
- **Git config:** `http.postBuffer` set to `524288000` (512 MB) — required due to large binary assets in repo

### Repository-specific notes
- Large binary files in `public/pwa/` (icons, splash screens, brand assets)
- `scripts/build-mobile.cjs` is gitignored and absent from repo
- No `README.md` exists

---

## 2. Supabase

### Project identity
| Property | Value |
|---|---|
| Project Ref | `gbcbejejgpvltuhbztbx` |
| Project Name | "alahram Project" |
| Organization ID | `kpyqwvbvrcnjrzhujjo` |
| API URL | `https://gbcbejejgpvltuhbztbx.supabase.co` |
| Dashboard | `https://supabase.com/dashboard/project/gbcbejejgpvltuhbztbx` |

### Authentication model
The project does **NOT** use Supabase Auth. It uses a custom RPC-based session system:
- Login: `supabase.rpc('login', { p_username, p_password })` → returns `p_token`
- Session validation: `supabase.rpc('validate_session', { p_token })`
- Logout: `supabase.rpc('logout', { p_token })`
- Token stored in `localStorage('session_token')`
- Every RPC call includes `p_token` for server-side authorization

### Client-side connection
- **File:** `src/lib/supabase.ts`
- **Client:** `@supabase/supabase-js` v2.106.2
- **Env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Created with:** anon key only (no session auth — custom token system)

### Management API
- **Token:** Stored in CI secrets (DO NOT commit tokens)
- **SQL endpoint:** `POST https://api.supabase.com/v1/projects/gbcbejejgpvltuhbztbx/database/query`
- **Body format:** `{ "query": "SQL..." }`

### Direct database connection
- **Host:** `db.gbcbejejgpvltuhbztbx.supabase.co`
- **Port:** `5432`
- **Database:** `postgres`
- **Used by:** Root-level `__*.cjs` diagnostic scripts via `pg` driver

### Migrations
- **Directory:** `supabase/migrations/`
- **Count:** 203 SQL migration files
- **Span:** `000_schema.sql` (2026-05-31) through `20270718_surgical_add_order_card_fields_singular.sql`
- **No `config.toml`** — Supabase CLI not initialized locally
- **No `.supabase/` directory** — no local CLI state
- **No Edge Functions** — all server logic is PL/pgSQL RPCs
- **No Storage buckets** — no file/image upload

### Migration approach
SQL migrations are applied via the **Management API** (`POST .../database/query`), not via `supabase db push` or `supabase migration up`. There is no local Supabase instance.

---

## 3. Deployment

### Target
- **Platform:** GitHub Pages
- **Production URL:** `https://ahram-distribution.github.io/store`
- **Base path:** `/store/`

### Workflow
- **File:** `.github/workflows/deploy.yml`
- **Trigger:** Push to `main` branch, or manual `workflow_dispatch`
- **Concurrency group:** `pages` (cancel-in-progress: false)
- **Permissions:** `contents: write`, `pages: write`, `id-token: write`

### Pipeline steps
1. Checkout (`actions/checkout@v7`)
2. Setup Node.js 24 (`actions/setup-node@v6`)
3. `npm ci`
4. Generate build ID from git short SHA
5. `npm run build` with env vars from GitHub secrets/vars
6. Copy `dist/` → `deploy/`, add `404.html` and `.nojekyll`
7. Upload Pages artifact (`actions/upload-pages-artifact@v3`)
8. Deploy to GitHub Pages (`actions/deploy-pages@v4`)
9. Post-deploy: verify `build-manifest.json` reachable after 30s

### Build commands
| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run tsc` | TypeScript type-check |
| `npm run preview` | Preview production build locally |
| `npm run deploy` | **Disabled** — prints error, use `git push` instead |

### Build-time env vars (GitHub Actions)
| Variable | Source | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | `secrets.VITE_SUPABASE_URL` or `secrets.SUPABASE_URL` | Yes |
| `VITE_SUPABASE_ANON_KEY` | `secrets.VITE_SUPABASE_ANON_KEY` or `secrets.SUPABASE_ANON_KEY` | Yes |
| `VITE_APP_NAME` | `vars.VITE_APP_NAME` (default: "Ahram Distribution") | No |
| `VITE_APP_VERSION` | `vars.VITE_APP_VERSION` (default: "1.0.0") | No |
| `VITE_WHATSAPP_NUMBER` | `vars.VITE_WHATSAPP_NUMBER` | No |
| `BUILD_ID` | Auto-generated from git short SHA | Yes |
| `COMMIT_HASH` | Auto-generated from git full SHA | Yes |

### Custom build plugins
- `generate-404`: Copies `dist/index.html` → `dist/404.html` (SPA routing on GitHub Pages)
- `build-manifest`: Generates `dist/build-manifest.json` with SHA-256 hashes of all assets

---

## 4. Local Development

### Requirements
- **Node.js:** v24 (per `deploy.yml`), tested with v26.1.0 locally
- **No `.node-version`** / `.nvmrc` / `.tool-versions` file
- **No `engines`** field in `package.json`
- **Package manager:** npm

### Setup
```bash
# 1. Clone repository
git clone https://github.com/ahram-distribution/store.git
cd store

# 2. Install dependencies
npm install

# 3. Configure environment (see Section 6 for values)
cp .env.example .env.local   # or create manually

# 4. Start dev server
npm run dev
```

### Dev server
- Binds to `0.0.0.0:5173`
- Optional HTTPS via `.certs/dev-cert.pem` and `.certs/dev-key.pem` (self-signed, gitignored)
- VitePWA does NOT register Service Worker in dev mode
- Base path: `/store/`

### Important dev notes
- **Service Worker:** The old production SW may be registered in your browser from a previous deployment. Unregister it via Chrome DevTools → Application → Service Workers before testing dev changes.
- **Manifest:** VitePWA overwrites `public/manifest.webmanifest` during build. In dev, the raw `public/` file is served.
- **TypeScript:** `strict: false`, `noImplicitAny: false`. Many pre-existing type errors exist outside the files we modify.

---

## 5. External Services

### Supabase (backend)
- All business logic via PL/pgSQL RPCs (no Edge Functions, no REST endpoints)
- 203 SQL migrations
- No local Supabase instance — all development against production database
- Management API token for direct SQL execution

### GitHub (deployment + source)
- Source code: `ahram-distribution/store`
- Deployment: GitHub Pages via GitHub Actions

### Leaflet (maps)
- `leaflet` v1.9.4 + `react-leaflet` v5.0.0
- No API key required (OpenStreetMap tiles)
- Used in: CoverageMapPage, TeamMapPage, EmployeeWorkdayDetailPage, LiveActivityCenterPage, TrackingExplorerModal, MapTab

### WhatsApp (deep-linking only)
- `src/lib/whatsapp.ts` — builds messages and opens `wa.me/` links
- No API integration, browser deep-link only
- Default number: `01040880002` (fallback in code)

### No other integrations
- No payment gateways
- No email/SMS services
- No analytics (Google Analytics, Mixpanel, etc.)
- No Mapbox or Google Maps JS API (only `maps.google.com/?q=` deep links)

---

## 6. Credentials Inventory

### `.env.local` (gitignored — local only)

| Variable | Purpose | Used By |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (client) | `src/lib/supabase.ts`, `src/sw.ts`, `src/services/trackingEngine.ts` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (client) | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (server scripts only) | Root `__*.cjs` diagnostic scripts |
| `SUPABASE_DB_PASSWORD` | Direct Postgres password | Root `__*.cjs` diagnostic scripts via `pg` |
| `SUPABASE_DB_HOST` | Postgres host (`db.gbcbejejgpvltuhbztbx.supabase.co`) | Root `__*.cjs` diagnostic scripts |
| `SUPABASE_DB_PORT` | Postgres port (`5432`) | Root `__*.cjs` diagnostic scripts |
| `SUPABASE_DB_NAME` | Postgres database name (`postgres`) | Root `__*.cjs` diagnostic scripts |

### GitHub Secrets

| Secret Name | Purpose |
|---|---|
| `VITE_SUPABASE_URL` (or `SUPABASE_URL`) | Supabase URL for production build |
| `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_ANON_KEY`) | Supabase anon key for production build |

### GitHub Variables (non-secret)

| Variable Name | Purpose | Default |
|---|---|---|
| `VITE_APP_NAME` | App display name | "Ahram Distribution" |
| `VITE_APP_VERSION` | App version string | "1.0.0" |
| `VITE_WHATSAPP_NUMBER` | WhatsApp contact number | — |

### Supabase Management API

| Item | Value | Purpose |
|---|---|---|
| Management API token | Stored in CI secrets | Direct SQL execution, schema changes |
| SQL endpoint | `POST https://api.supabase.com/v1/projects/gbcbejejgpvltuhbztbx/database/query` | Apply migrations |

### Source code (hardcoded — public, not secrets)

| Value | Location | Purpose |
|---|---|---|
| Supabase project ref `gbcbejejgpvltuhbztbx` | Multiple (URLs, API calls) | Project identifier |
| WhatsApp fallback `01040880002` | `src/lib/whatsapp.ts:109` | Default contact when env var missing |
| Google Maps deep link | `src/components/shared/MapButton.tsx`, `src/types/order-display.ts` | Open location in maps (no API key) |

### Local files (gitignored)

| File | Purpose |
|---|---|
| `.certs/dev-cert.pem` | Local HTTPS dev certificate |
| `.certs/dev-key.pem` | Local HTTPS dev key |
| `supabase/.temp/` | Supabase CLI local state |

---

## GitHub Authentication

- **Authentication method:** Fine-grained Personal Access Token.
- **Scope:** Repository `ahram-distribution/store` only.
- **Repository permissions granted:**
  - Actions: Read & Write
  - Administration: Read
  - Contents: Read & Write
  - Environments: Read
  - Metadata: Read
  - Pages: Read & Write
  - Pull Requests: Read & Write
  - Workflows: Read & Write
- **Account permissions:** None.
- **Storage policy:**
  - Never store the token in the repository.
  - Never commit the token.
  - Never print the token in logs.
  - Store it only in the local credential manager or local secure environment.
- **Operational policy:**
  - Use this token for all GitHub API operations and deployment tasks.
  - If authentication fails, verify the token before investigating deployment issues.

---

## 7. Access Verification Checklist

- [x] **Source code access:** Git remote configured, `main` branch accessible
- [x] **Supabase full development:** Management API token documented, project ref known, direct DB connection info available
- [x] **Run migrations:** Via Management API `POST .../database/query` with SQL body
- [x] **Deploy to production:** GitHub push to `main` triggers GitHub Actions → GitHub Pages
- [x] **Modify production deployment:** Push to `main`, or trigger `workflow_dispatch` via GitHub Actions UI
- [x] **Continue development locally:** `.env.local` with 2 required vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), `npm install`, `npm run dev`
- [x] **Service Worker:** Source at `src/sw.ts`, compiled via `injectManifest` strategy, registered via `vite-plugin-pwa`
- [x] **PWA manifest:** Generated by VitePWA from `vite.config.ts` config, source `public/manifest.webmanifest` overridden at build
- [x] **All env var names documented:** 11 total (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`, `VITE_APP_NAME`, `VITE_APP_VERSION`, `VITE_WHATSAPP_NUMBER`, `MOBILE_BUILD`)

### No missing credentials

All required credentials for development and deployment are documented in this file. No additional credentials are needed to:
- Run the application locally
- Apply database migrations
- Deploy to production
- Access the Supabase dashboard
- Modify the service worker
- Access the source repository
