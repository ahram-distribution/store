import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SECURITY: the Management API token lives here as a function secret and never
// reaches the browser. Set it at deploy time with:
//   supabase secrets set MGMT_TOKEN=sbp_...
// (A literal SUPABASE_-prefixed name would be ignored by the CLI, so we use
// MGMT_TOKEN and read it here; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// injected automatically by the Edge Runtime.)
const MGMT_TOKEN = Deno.env.get("MGMT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const MGMT_API = "https://api.supabase.com/v1/projects";

// Executive administration gate — mirrors src/utils/roleNormalization.
const EXEC_ROLES = new Set(["الإدارة العليا", "الرئيس التنفيذي", "executive_director"]);

function projectRef(): string {
  try {
    const u = new URL(SUPABASE_URL);
    return u.hostname.split(".")[0];
  } catch {
    return "";
  }
}

// Explicit CORS allowlist — no wildcard. Local dev (Vite preview/dev), the
// production GitHub Pages origin, and the Capacitor desktop/mobile WebView.
// The caller's own origin is echoed back only when it is in this list.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.0.165:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://ahram-distribution.github.io",
  "capacitor://localhost",
  "http://localhost",
]);

const CORS_METHODS = "GET, OPTIONS";
const CORS_HEADERS = "authorization, content-type, apikey, x-client-info";

// Periods the owner screen may select. usage.api-counts only documents the
// intervals 15min|30min|1hr|3hr|1day|3day|7day (verified from the public
// OpenAPI spec AND live against the token), so a 30-day period is reported as
// "unsupported" — nullable points — never estimated or fabricated.
const PERIOD_TO_COUNTS_INTERVAL: Record<string, string | null> = {
  "24h": "1day",
  "7d": "7day",
  "30d": null,
};
const VALID_PERIODS = Object.keys(PERIOD_TO_COUNTS_INTERVAL);

// Returns "" when no Origin header (non-browser caller — no CORS needed),
// the exact origin when it is allowed, or null when it is explicitly disallowed.
function allowedOrigin(req: Request): string | null {
  const origin = (req.headers.get("Origin") || "").trim();
  if (!origin) return "";
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(origin: string): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (origin) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", CORS_METHODS);
    h.set("Access-Control-Allow-Headers", CORS_HEADERS);
  }
  return h;
}

function json(data: unknown, status = 200, origin = ""): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

async function mgmtGet(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ref = projectRef();
  if (!ref || !MGMT_TOKEN) return { ok: false, status: 503, data: { message: "usage-monitor not configured" } };
  const resp = await fetch(MGMT_API + "/" + ref + path, {
    headers: { Authorization: "Bearer " + MGMT_TOKEN, "User-Agent": "ahram-usage-monitor" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: resp.ok, status: resp.status, data: body };
}

// Best-effort: fixed read-only SQL executed against the project database. These
// queries never write and only aggregate sizes, giving us genuinely measured
// figures for the Free-plan resources (database + storage) instead of guesses.
async function mgmtQueryReadOnly(sql: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ref = projectRef();
  if (!ref || !MGMT_TOKEN) return { ok: false, status: 503, data: { message: "usage-monitor not configured" } };
  const resp = await fetch(MGMT_API + "/" + ref + "/database/query/read-only", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + MGMT_TOKEN,
      "Content-Type": "application/json",
      "User-Agent": "ahram-usage-monitor",
    },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: resp.ok, status: resp.status, data: body };
}

async function withRetryRead(sql: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  let last: { ok: boolean; status: number; data: unknown } = { ok: false, status: 503, data: null };
  for (let i = 0; i < 2; i++) {
    last = await mgmtQueryReadOnly(sql);
    if (last.ok) return last;
    if (last.status === 429 || last.status >= 500) {
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      continue;
    }
    break;
  }
  return last;
}

async function withRetry(path: string, attempts = 3): Promise<{ ok: boolean; status: number; data: unknown }> {
  let last: { ok: boolean; status: number; data: unknown } = { ok: false, status: 503, data: null };
  for (let i = 0; i < attempts; i++) {
    last = await mgmtGet(path);
    if (last.ok) return last;
    // Retry on 429 / transient 5xx once per attempt
    if (last.status === 429 || last.status >= 500) {
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      continue;
    }
    break;
  }
  return last;
}

// Real edge-function invocation counts from the DOCUMENTED Management API
// endpoint (v1-get-project-function-combined-stats). We sum request_count over
// the hourly buckets of a 1day interval for every project edge function.
// This is a measured figure — the ONLY Egress/MAU/billing-cycle numbers live in
// the private, session-only Dashboard API (app.supabase.com/api/platform/...)
// which is deliberately NOT available outside a browser dashboard session.
async function fetchEdgeInvocations(): Promise<{
  invocations_24h_total: number | null;
  per_function: { id: string; slug: string; invocations: number }[] | null;
}> {
  const list = await withRetry("/functions", 1);
  if (!list.ok) return { invocations_24h_total: null, per_function: null };
  const functions = Array.isArray(list.data)
    ? (list.data as { id?: string; slug?: string }[])
    : [];
  if (functions.length === 0) return { invocations_24h_total: 0, per_function: [] };
  const per_function: { id: string; slug: string; invocations: number }[] = [];
  let total = 0;
  for (const f of functions) {
    if (!f.id) continue;
    const r = await withRetry(
      "/analytics/endpoints/functions.combined-stats?function_id=" + encodeURIComponent(f.id) + "&interval=1day",
      1,
    );
    if (!r.ok || typeof r.data !== "object" || r.data === null) continue;
    const result = (r.data as { result?: unknown }).result;
    if (!Array.isArray(result)) continue;
    let sum = 0;
    for (const bucket of result) {
      if (bucket && typeof bucket === "object") {
        const n = Number((bucket as { request_count?: number }).request_count);
        if (Number.isFinite(n)) sum += n;
      }
    }
    per_function.push({ id: f.id, slug: f.slug || f.id, invocations: sum });
    total += sum;
  }
  return { invocations_24h_total: per_function.length > 0 ? total : null, per_function: per_function.length > 0 ? per_function : null };
}

// Best-effort: per-endpoint request counts from edge_logs for the selected
// period. The Logflare-compatible logs.all surface in this project only answers
// simple "select event_message ... order by timestamp desc limit N" queries
// (count()/group-by and where-filters on logs.all are rejected by the backend),
// and log retention here is minimal — so we aggregate the fetched rows
// ourselves and report row availability honestly. Failures are tolerated.
async function fetchTopEndpoints(): Promise<{ rows: number; endpoints: { method: string; url: string; count: number }[] } | null> {
  const r = await withRetry(
    "/analytics/endpoints/logs.all?sql=" +
      encodeURIComponent("select event_message from edge_logs order by timestamp desc limit 2000"),
    2,
  );
  if (!r.ok || typeof r.data !== "object" || r.data === null) return null;
  const d = r.data as { result?: unknown; error?: unknown };
  if (d.error || !Array.isArray(d.result)) return null;
  const byUrl = new Map<string, { method: string; url: string; count: number }>();
  for (const row of d.result) {
    if (!row || typeof row !== "object") continue;
    const em = String((row as { event_message?: unknown }).event_message || "");
    if (!em.includes("|")) continue;
    const p = em.split("|").map((s) => s.trim());
    const method = p[0] || "";
    const url = (p[2] || "").split("?")[0];
    if (!url) continue;
    const k = method + " " + url;
    const cur = byUrl.get(k);
    if (cur) cur.count++;
    else byUrl.set(k, { method, url, count: 1 });
  }
  const endpoints = [...byUrl.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  return { rows: d.result.length, endpoints };
}

// Measured database + storage usage. `null` when the read-only query fails so
// the UI can show "unavailable" instead of guessing.
async function fetchResourceSizes(): Promise<{ database_size_bytes: number | null; storage_size_bytes: number | null }> {
  const db = await withRetryRead("select pg_database_size(current_database()) as bytes");
  const storage = await withRetryRead(
    `select coalesce(sum((metadata->>'size')::bigint), 0) as bytes from storage.objects where id is not null`,
  );
  const bytesFrom = (r: { ok: boolean; data: unknown }): number | null => {
    if (!r.ok) return null;
    let rows: unknown = null;
    if (typeof r.data === "object" && r.data !== null) {
      if (Array.isArray(r.data)) rows = r.data;
      else if ("result" in r.data) rows = (r.data as { result?: unknown }).result;
    }
    if (Array.isArray(rows) && rows.length > 0 && rows[0] !== null && typeof rows[0] === "object") {
      const b = Number((rows[0] as { bytes?: number | string }).bytes);
      if (Number.isFinite(b)) return b;
    }
    return null;
  };
  return {
    database_size_bytes: bytesFrom(db),
    storage_size_bytes: bytesFrom(storage),
  };
}

serve(async (req) => {
  // Browser CORS preflight.
  if (req.method === "OPTIONS") {
    const origin = allowedOrigin(req);
    if (origin === null) return json({ error: "cors-origin-denied" }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Explicit-origin enforcement: a browser origin that is not in the allowlist
  // never receives data. Non-browser callers (no Origin) are still served.
  const corsOrigin = allowedOrigin(req);
  if (corsOrigin === null) {
    return json({ error: "cors-origin-denied" }, 403);
  }

  try {
    // ---- caller authorization (server-side, never trusts the browser) ----
    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401, corsOrigin);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: session, error: sessionErr } = await supabase.rpc("validate_session", { p_token: token });
    if (sessionErr || !session || !session.valid) {
      return json({ error: "forbidden" }, 403, corsOrigin);
    }
    const roles: string[] = Array.isArray(session.roles) ? session.roles : [];
    if (!roles.some((r) => EXEC_ROLES.has(String(r)))) {
      return json({ error: "forbidden" }, 403, corsOrigin);
    }

    // ---- measured metrics from the official Supabase Management API ----
    // Both documented api-counts intervals (1day/7day) are always fetched so the
    // client can detect a 24h-vs-daily-avg traffic spike and switch periods
    // without a second round-trip. A 30-day period is NOT a documented interval
    // (verified: rejects with 400), so it is flagged unsupported and the client
    // shows the latest supported window instead of fabricating 30-day data.
    const periodParam = (new URL(req.url).searchParams.get("period") || "24h").trim();
    const period = VALID_PERIODS.includes(periodParam) ? periodParam : "24h";
    const countsInterval = PERIOD_TO_COUNTS_INTERVAL[period] ?? null;

    const [counts7, counts1, total, health, logsProbe, dbSize, edgeInvocations] = await Promise.all([
      withRetry("/analytics/endpoints/usage.api-counts?interval=7day"),
      withRetry("/analytics/endpoints/usage.api-counts?interval=1day"),
      withRetry("/analytics/endpoints/usage.api-requests-count"),
      withRetry("/health?services=auth,db,pooler,realtime,rest,storage,pg_bouncer"),
      withRetry(
        "/analytics/endpoints/logs.all?sql=" + encodeURIComponent("select event_message from edge_logs order by timestamp desc limit 1"),
        1,
      ),
      fetchResourceSizes(),
      fetchEdgeInvocations(),
    ]);
    const resourceSizes = dbSize as unknown as { database_size_bytes: number | null; storage_size_bytes: number | null };

    const pickResult = (x: { ok: boolean; data: unknown }): unknown => {
      if (!x.ok) return null;
      if (typeof x.data === "object" && x.data !== null && "result" in x.data) return (x.data as { result: unknown }).result;
      return x.data;
    };

    const counts_by_service = [
      { interval: "1day", points: pickResult(counts1) },
      { interval: "7day", points: pickResult(counts7) },
    ];

    // Per-endpoint breakdown is best-effort: the logs surface in this project
    // has minimal retention, so the client shows it only when real rows exist.
    let topEndpointsData: unknown = null;
    if (logsProbe.ok) {
      topEndpointsData = await fetchTopEndpoints();
    }

    const payload = {
      meta: {
        project: projectRef(),
        source: "supabase-management-api",
        generated_at_utc: new Date().toISOString(),
        measured: true,
        period: {
          selected: period,
          counts: countsInterval ?? "unsupported",
          edge: "24h",
          endpoints: "24h",
          counts_note:
            countsInterval === null
              ? "استعلام واجهة Supabase لا يدعم 30 يومًا — تُعرض أحدث فترتين مدعومتين (24 ساعة و7 أيام) فقط."
              : "عدد طلبات الخدمات مقاس رسميًا من واجهة Supabase الموثقة.",
        },
      },
      total_requests: pickResult(total),
      counts_by_service,
      health: pickResult(health),
      top_endpoints: topEndpointsData,
      resources: {
        database_size_bytes: resourceSizes?.database_size_bytes ?? null,
        storage_size_bytes: resourceSizes?.storage_size_bytes ?? null,
      },
      edge: {
        invocations_24h_total: edgeInvocations.invocations_24h_total,
        per_function: edgeInvocations.per_function,
      },
      unavailable: {
        egress_bytes:
          "not in the public Management API — real Egress and billing-cycle numbers are served only by the private, session-only Dashboard API (app.supabase.com/api/platform/...) which cannot be used from a server",
        billing_cycle:
          "not in the public Management API — real billing-cycle numbers are served only by the private, session-only Dashboard API (app.supabase.com/api/platform/...) which cannot be used from a server",
      },
    };

    return json(payload, 200, corsOrigin);
  } catch (err) {
    return json({ error: "Internal error", detail: String((err as Error).message || err).slice(0, 300) }, 500, corsOrigin);
  }
});