/**
 * Minimal Saleshandy Open-API client (plain fetch, like sheets-server.ts).
 *
 * Saleshandy is the lead-generation source: prospects live there, and this client
 * pulls them so they can go through the shared ingestion gate. Auth is the
 * `x-api-key` header (Saleshandy's convention — note it differs from the
 * `api_key` query param). Base overridable via SALESHANDY_API_BASE.
 *
 * Every response is enveloped: `{ message, payload }` on success, and
 * `{ error: true, type, code, message }` on failure.
 */

const BASE = process.env.SALESHANDY_API_BASE || "https://open-api.saleshandy.com/v1";

export function saleshandyConfigured(): boolean {
  return !!process.env.SALESHANDY_API_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request with retry + exponential backoff on 429/5xx (respects Retry-After). */
async function shRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const key = process.env.SALESHANDY_API_KEY;
  if (!key) throw new Error("SALESHANDY_API_KEY is not set");

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? {} : res.json();

    const text = await res.text().catch(() => "");
    // Surface Saleshandy's own error message when it sends one.
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed?.message) detail = parsed.message;
    } catch {
      /* not JSON — keep the raw snippet */
    }
    lastErr = `Saleshandy ${res.status}: ${detail}`;

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    break; // non-retryable (401 bad key, 400 bad params)
  }
  throw new Error(lastErr);
}

/** Unwrap `{ payload }`; tolerate a bare array in case an endpoint skips the envelope. */
function payloadArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const p = (data as { payload?: unknown })?.payload;
  return Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
}

export type SaleshandyProspect = {
  id: string;
  createdAt?: string;
  email?: string;
  verificationStatus?: string;
  /** Prospect data is key/value, not fixed columns — see `prospectFields`. */
  attributes?: { id?: string; key?: string; value?: string }[];
  tags?: { id?: string; name?: string }[];
};

/**
 * Flatten a prospect's `attributes` array into a flat record keyed by the
 * human-readable attribute name ("First Name", "Phone Number", "Company", …).
 *
 * This is what makes the existing ColumnMapping machinery work unchanged: the
 * attribute keys become the "headers" a mapping points at, exactly like a CSV
 * header row or a Sheet's first row. Custom fields the user defined in
 * Saleshandy come through by their own names for free.
 */
export function prospectFields(p: SaleshandyProspect): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of p.attributes ?? []) {
    if (!a?.key) continue;
    const v = a.value == null ? "" : String(a.value).trim();
    if (v !== "") out[a.key] = v;
  }
  // Top-level email wins — `attributes` may carry a stale or blank "Email".
  if (p.email) out["Email"] = p.email;
  return out;
}

/** Tag names on a prospect, lowercased for case-insensitive filtering. */
export function prospectTags(p: SaleshandyProspect): string[] {
  return (p.tags ?? [])
    .map((t) => t?.name?.trim().toLowerCase())
    .filter((n): n is string => !!n);
}

/**
 * One page of prospects. `GET /v1/prospects` requires pageSize + sort + sortBy;
 * it has no "modified since" filter, so incremental sync is done by sorting
 * newest-first and stopping at a createdAt watermark (see saleshandy-source).
 */
export async function listProspects(params: {
  page: number;
  pageSize?: number;
  sort?: "ASC" | "DESC";
  includeCustomFields?: boolean;
}): Promise<SaleshandyProspect[]> {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(Math.min(params.pageSize ?? 100, 100)),
    sort: params.sort ?? "DESC",
    sortBy: "createdAt",
    includeCustomFields: params.includeCustomFields === false ? "false" : "true",
  });
  return payloadArray(await shRequest("GET", `/prospects?${q}`)) as SaleshandyProspect[];
}

/** All distinct tag names in the account — used to populate the filter dropdown. */
export async function listTags(): Promise<string[]> {
  const rows = payloadArray(await shRequest("GET", `/prospects/tags`));
  return rows
    .map((t) => (t as { name?: string })?.name?.trim())
    .filter((n): n is string => !!n);
}

/**
 * Cheap credential probe for the Settings panel: does this key work? Asks for the
 * smallest possible page rather than a dedicated ping endpoint (there isn't one).
 */
export async function verifyKey(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await listProspects({ page: 1, pageSize: 10 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? "request failed" };
  }
}
