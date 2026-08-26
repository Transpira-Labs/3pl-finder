# Domain Pitfalls

**Domain:** Brownfield Next.js sales platform fork (GTM Pipeline → Poveda Distributors)
**Researched:** 2026-08-11
**Applies to:** Next.js fork + Google Maps/Places API + Docker Compose local deployment + Supabase-to-Postgres migration

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or production incidents.

---

### Pitfall 1: Docker Compose Postgres Data Loss on Container Stop

**What goes wrong:** The default Postgres Docker image stores data inside the container's writable layer. Every `docker compose down` destroys all data. A non-technical user who runs `docker compose down` (thinking it's like "quit the app") loses the entire database — contacts, pipeline, analytics history.

**Why it happens:** Docker containers are ephemeral by design. Without a named volume explicitly declared, data lives inside the container.

**Consequences:** Complete data loss. Irreversible without backups. For a 2-person sales team, this could mean losing months of prospect history.

**Prevention:**
- Declare a named volume in `docker-compose.yml` for Postgres data directory (`/var/lib/postgresql/data`)
- Add volume declaration at the top-level `volumes:` section — without this declaration Docker Compose errors on startup
- Use named volumes (not bind mounts) — bind mounts cause UID/GID permission errors when the container's postgres user (UID 999) can't write to a host directory owned by another UID
- Add automated backup script (simple `pg_dump` on cron) as part of initial setup
- Document for users: "Never run `docker compose down -v` — it deletes all data"

**Detection warning signs:**
- `docker-compose.yml` has no `volumes:` top-level section
- Postgres service has no `volumes:` entry
- First sign of trouble: app starts but shows empty pipeline after a restart

**Phase:** Address in the Docker setup phase before any data migration from Supabase.

---

### Pitfall 2: NEXT_PUBLIC_ Variables Are Baked Into Docker Images at Build Time

**What goes wrong:** Next.js (including v16 with Turbopack) statically inlines every `NEXT_PUBLIC_*` variable as a string literal during `next build`. This means if you build the Docker image with `NEXT_PUBLIC_GOOGLE_MAPS_KEY=abc`, that key is frozen in the image. Deploying the same image to a different machine or changing the key requires a full rebuild — not just a redeploy.

**Why it happens:** The Turbopack/Webpack bundler performs string replacement at build time. The variable does not exist at runtime in client-side code — only the resolved string does.

**Consequences:**
- Google Maps API key changes require rebuilding and redistributing the Docker image
- Promoting one image across environments (dev → staging → prod) is impossible without workarounds
- Accidentally prefixing a secret with `NEXT_PUBLIC_` ships it in the JavaScript bundle in plaintext — visible in browser DevTools

**Prevention:**
- Keep Google Maps key server-side only: create a Next.js API route that proxies Places API calls. Never expose the key in client-side code.
- For any truly public config that must reach the browser, use the `next-runtime-env` pattern or an `/api/config` endpoint that server components fetch
- At build time: pass only non-sensitive, environment-agnostic values as `NEXT_PUBLIC_`
- Audit all `NEXT_PUBLIC_` usages in the forked GTM Pipeline codebase before rebranding

**Detection warning signs:**
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in any `.env` file or `Dockerfile`
- Google Maps JS API loaded client-side with a key directly in the bundle

**Phase:** Address during the rebranding/environment setup phase, before Docker image build is finalized.

---

### Pitfall 3: Supabase Auth Functions Don't Exist on Plain Postgres

**What goes wrong:** The GTM Pipeline uses Supabase Postgres which ships with the `auth` schema and `auth.uid()` function. These are Supabase-specific extensions that do not exist in a standard Postgres Docker image. Any Row-Level Security (RLS) policies referencing `auth.uid()` will silently fail or throw errors after migration.

**Why it happens:** Supabase extends Postgres with its own authentication schema, GoTrue service, and helper functions. Plain Postgres knows nothing about these.

**Consequences:**
- RLS policies that call `auth.uid()` return errors or empty result sets
- If RLS was enabled on tables but policies are broken, every query returns zero rows — the app appears to work but shows no data
- JWT secret mismatches between Supabase's auth tokens and the app's expected format break session validation

**Prevention:**
- Audit every table in the GTM Pipeline for RLS policies before migration. Run `SELECT schemaname, tablename, policyname, qual FROM pg_policies;` against the Supabase instance.
- If RLS policies reference `auth.uid()`, they must be rewritten to use the application's own session/JWT approach or dropped entirely and replaced with application-level authorization
- For a single-tenant local deployment (one client, one machine), RLS may be unnecessary overhead — consider disabling it and relying on app-layer auth instead
- Test with a real user login against the Docker Postgres before declaring migration complete

**Detection warning signs:**
- Dashboard shows no data after migration but no visible errors
- `pg_policies` view returns rows with `auth.uid()` in the `qual` column
- Auth tokens from the app's new auth system are JWTs signed with a different secret than Supabase expected

**Phase:** Address first in the Supabase-to-Docker Postgres migration phase. This is a blocker for all other features.

---

### Pitfall 4: Google Places API Cost Spiral from Unmasked Fields and No Quota Limit

**What goes wrong:** The new Places API (v1, mandatory since legacy deprecation in March 2025) bills per field category, not per request. Requesting any single "Enterprise" tier field — opening hours, phone number, website, ratings — upgrades the entire call to the Enterprise SKU, which costs significantly more than Basic. A developer adding one convenient field for store display can multiply per-call cost by 5-10x without realizing it.

Additionally: budget alerts in Google Cloud **do not stop API usage**. You will receive an email alert and continue being charged. Only quota limits stop calls.

**Why it happens:**
- Field mask (`X-Goog-FieldMask` header) is required but easy to set too broadly (e.g., `*` returns all fields and bills at the highest tier)
- Developers unfamiliar with SKU tiers add fields thinking "it's just display data"
- No hard quota is set by default on new Google Cloud projects

**Consequences:** For a small distributor, a single bug (infinite retry loop, crawl bot hitting the store discovery page) could generate a $500-$2000 bill in hours. Google's $200/month free credit provides some buffer but does not protect against spikes.

**Prevention:**
- Set a **per-day quota limit** in Google Cloud Console for Places API (Nearby Search, Place Details) at project creation — before writing any code. Set it 20% below your absolute maximum to account for billing system lag.
- Define field masks explicitly and minimally. For store discovery: only request `displayName`, `formattedAddress`, `location`, `types` (all Basic tier). Add `internationalPhoneNumber`, `regularOpeningHours` only if the UI specifically needs them.
- Route all Places API calls through a server-side Next.js API route — never call from client side — so the key is never exposed and you can add rate limiting middleware
- Implement caching: Places API allows caching results for up to 30 days. Cache store discovery results in Postgres and refresh on a schedule, not on every user request.
- Monitor the Billing dashboard weekly for the first month after launch

**Detection warning signs:**
- Field mask contains `*` or any Enterprise-tier field name
- Places API calls made directly from client-side JavaScript
- No quota limit set in Google Cloud Console
- No caching layer — every user search triggers a fresh API call

**Phase:** Address during the Google Maps/Places API integration phase, before any UI is built on top of it.

---

### Pitfall 5: Docker Compose Startup Race Condition (App Starts Before Postgres is Ready)

**What goes wrong:** `depends_on: [db]` in Docker Compose only waits for the Postgres *container to start*, not for Postgres to be *ready to accept connections*. The Next.js app starts, immediately tries to connect to Postgres, gets a connection refused error, and crashes. On restart, it may work — or it may not, depending on timing.

**Why it happens:** Docker Compose's `depends_on` without a `condition: service_healthy` does not understand application-level readiness. Postgres takes several seconds to initialize on first run (especially when creating the database and running migrations).

**Consequences:** Non-technical users see the app fail on first `docker compose up`. They restart it, maybe it works, maybe not. Unreliable startup erodes trust and generates support burden.

**Prevention:**
- Add a `healthcheck` to the Postgres service using `pg_isready`:
  ```yaml
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 5
  ```
- Change the Next.js service `depends_on` to:
  ```yaml
  depends_on:
    db:
      condition: service_healthy
  ```
- Add application-level connection retry logic as a secondary defense (Prisma/pg connection poolers retry by default, but configure explicitly)

**Detection warning signs:**
- `docker-compose.yml` has `depends_on: [db]` without `condition: service_healthy`
- First `docker compose up` sometimes fails, second attempt always succeeds

**Phase:** Address in Docker setup phase during initial scaffold.

---

### Pitfall 6: Forked Repo Accumulates Security Debt Because Upstream Security Patches Are Missed

**What goes wrong:** The GTM Pipeline is a fork, not a dependency. Upstream security patches to Next.js, its dependencies, or the GTM Pipeline itself do not automatically propagate. Vulnerabilities in Next.js (there were 9 fixed in July 2026 alone) will silently accumulate in the fork until someone manually checks.

**Why it happens:** A fork is a snapshot. Unlike an npm dependency that `npm audit` can flag, upstream git commits are invisible until you explicitly check them. The Twilio, SalesHandy, and Supabase client libraries the original repo uses all have their own vulnerability surfaces.

**Consequences:** A sales platform holds prospect contact data and potentially payment context. An unpatched auth bypass or SSRF vulnerability in a 6-month-old fork is a realistic liability for a small business.

**Prevention:**
- Pin a **fork maintenance schedule**: check the upstream GTM Pipeline repo for new commits monthly; check `npm audit` weekly (automate via CI or a simple cron job)
- Enable GitHub Dependabot on the forked repo for automated dependency alerts
- Subscribe to Next.js security announcements (nextjs.org/blog)
- When Next.js ships a security patch, prioritize applying it within 1 week
- Document which upstream commits have been reviewed — keep a `UPSTREAM_SYNC.md` log

**Detection warning signs:**
- Fork is more than 2 months behind upstream with no audit log
- `npm audit` output ignored or unreviewed
- No Dependabot or equivalent configured on the repo

**Phase:** Establish policy in the initial setup phase; ongoing operational concern.

---

## Moderate Pitfalls

Mistakes that cause delays, data integrity issues, or technical debt.

---

### Pitfall 7: Google Maps API Key Restriction Mismatch for Server-Side Calls

**What goes wrong:** Google recommends restricting API keys by HTTP referrer (for browser/client-side use) or by IP address (for server-side use). The Places API explicitly does **not** support HTTP referrer restrictions for server-side calls. If you create one key with referrer restrictions and try to use it in a Docker container (server-side), calls fail with a "referer not allowed" error. If you restrict by IP but your Docker host's IP changes, calls stop working.

**Why it happens:** Developers copy the "restrict by referrer" guidance intended for Maps JS API into server-side Places API configurations.

**Prevention:**
- Use two separate API keys: one browser-restricted key for Maps JavaScript API (map display only), one IP-restricted key for server-side Places API calls
- For local Docker deployment with a fixed machine, restrict the server key to the machine's static IP or local network CIDR
- Never use an unrestricted key in production — even local deployment

**Phase:** Address during Google Maps integration phase when API key provisioning is done.

---

### Pitfall 8: Rebranding Misses Hardcoded Strings and Vendor-Specific IDs

**What goes wrong:** Sales platforms accumulate business-specific strings in unexpected places: email templates, PDF export headers, Twilio caller ID display names, SalesHandy sender profiles, analytics event labels, and error messages. A surface-level find-and-replace of "GTM Pipeline" → "Poveda Distributors" misses these.

**Why it happens:** The original repo was built for a specific business. Strings like company name, support email, and legal notices are scattered across templates, config files, and sometimes hardcoded in component JSX.

**Consequences:** Customers receive emails signed "GTM Pipeline Support". Twilio calls show the wrong caller ID. PDF reports have the wrong header. These erode client trust immediately.

**Prevention:**
- Before rebranding, run a comprehensive string audit: `grep -r "GTM\|Pipeline\|[original company name]" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md"`
- Centralize all brand strings in a single `config/brand.ts` file (company name, support email, logo path, legal name) and replace all hardcoded instances with references
- Check external service configurations explicitly: Twilio console (caller ID, SMS sender), SalesHandy (sender name, email signature), any email template service

**Phase:** Address in the rebranding phase as a checklist, not an afterthought.

---

### Pitfall 9: Next.js Standalone Docker Build Missing Static Assets and `sharp`

**What goes wrong:** Next.js `output: 'standalone'` mode (recommended for Docker) creates a `.next/standalone` directory that does NOT include `public/` or `.next/static/`. If the Dockerfile doesn't explicitly copy these, the app runs but serves 404s for all images, fonts, and static assets. Separately, the `sharp` image optimization library — a native binary — is frequently excluded from the standalone trace or built for the wrong CPU architecture (e.g., built on macOS ARM, runs on Linux x86).

**Why it happens:** Next.js documentation covers standalone mode but the asset copying requirement is in a separate note that's easy to skip. `sharp` is a native module whose architecture binding must match the target OS/CPU exactly.

**Consequences:** App starts successfully in Docker, but all images are broken. On first user demo, the interface looks broken.

**Prevention:**
- Dockerfile must explicitly include:
  ```dockerfile
  COPY --from=builder /app/public ./public
  COPY --from=builder /app/.next/static ./.next/static
  ```
- Install `sharp` explicitly in the Docker runner stage: `RUN npm install sharp`
- If building on macOS (ARM) for Linux deployment, either build inside Docker (`docker buildx`) or use `--platform linux/amd64` flag
- Use Alpine base images cautiously — Alpine uses musl libc, and `sharp` ships glibc binaries by default. Add `libc6-compat` or use a Debian-based image.

**Phase:** Address when building the initial Docker Compose scaffold.

---

### Pitfall 10: Twilio and SalesHandy Webhooks Require Publicly Accessible URLs

**What goes wrong:** Twilio webhooks (inbound call/SMS status callbacks) and SalesHandy email tracking callbacks must reach a publicly accessible HTTPS URL. In a local Docker Compose deployment, the app runs on `localhost` — not publicly accessible. Webhooks will fail silently or visibly, breaking call tracking and email open/click tracking.

**Why it happens:** Webhook-based integrations assume a networked server. Local deployments are behind NAT/firewall.

**Consequences:** Inbound call status won't update in the pipeline. Email open/click tracking breaks. For a sales platform, this cripples two core features.

**Prevention:**
- For local deployment intended for a single office network: determine if the router can be configured for port forwarding with a static external IP or DDNS service. This is the simplest permanent solution.
- As an alternative: set up a small, inexpensive VPS (e.g., $6/month DigitalOcean droplet) to receive webhooks and forward to the local machine via a tunnel (Cloudflare Tunnel is free and stable, unlike ngrok free tier which changes URLs on restart)
- Document this constraint clearly in setup documentation: "Twilio callback features require external internet access to this machine"
- Do not use ngrok free tier in production — URL changes on every restart, requiring manual Twilio console updates each time

**Phase:** Address during integration testing phase; document as a deployment prerequisite.

---

## Minor Pitfalls

Mistakes that cause annoyance and are fixable but waste time.

---

### Pitfall 11: `docker compose down` vs `docker compose stop` Confusion

**What goes wrong:** Non-technical users learn one command — usually `docker compose down` — and use it for everything. `down` removes containers and (with `-v`) volumes. `stop` halts containers but preserves them. If user documentation doesn't distinguish these clearly, data loss is one command flag away.

**Prevention:**
- Provide a simple `start.sh` / `stop.sh` wrapper script in the project root
- `stop.sh` should run `docker compose stop` (not `down`)
- `start.sh` should run `docker compose up -d`
- Include a large warning comment in `docker-compose.yml`: "DO NOT run docker compose down -v — this deletes all data"

**Phase:** Address in Docker setup phase when writing user-facing documentation.

---

### Pitfall 12: Forked Repo License Not Verified Before Commercial Use

**What goes wrong:** If the GTM Pipeline repo uses GPL (or a copyleft variant), forking for a commercial client deployment may trigger source-disclosure requirements. If it uses a non-standard or proprietary license, commercial use may be prohibited outright. Many developers assume "it's on GitHub, so it's free to use" — this is not true.

**Why it happens:** License files are easy to overlook. GitHub displays license badges but developers don't always read the terms.

**Consequences:** Legal exposure for the client if license terms are violated. MIT and Apache 2.0 are safe for commercial use; GPL requires disclosure; some "source available" licenses prohibit commercial use entirely.

**Prevention:**
- Before any other work: read the `LICENSE` file in the GTM Pipeline repository
- If GPL: confirm whether the deployment model (internal tool, not distributed software) triggers the copyleft obligation. Running GPL software internally as a SaaS-like tool generally does not require disclosure; distributing it to clients does.
- If license is ambiguous or absent: treat as "all rights reserved" and seek clarification or use an alternative

**Phase:** Verify before project kickoff, before any code is written.

---

### Pitfall 13: Postgres Connection String Format Differences Between Supabase Client and Standard pg/Prisma

**What goes wrong:** The GTM Pipeline was built with the Supabase JS client (`@supabase/supabase-js`), which connects via Supabase's connection pooler URL format and handles auth transparently. Migrating to direct Postgres requires switching to a standard Postgres connection string (`postgresql://user:pass@localhost:5432/dbname`). If Prisma is involved, the `DATABASE_URL` format and connection pool settings differ from Supabase's pooler defaults.

**Prevention:**
- Audit all database connection code in the fork — look for `createClient()` from `@supabase/supabase-js` and replace with the appropriate Prisma/pg client
- Verify connection pool settings: Supabase pooler defaults to PgBouncer transaction mode; direct Postgres connections require explicit pool size configuration to avoid exhausting connections
- Test with a realistic data load, not just a handful of rows — connection pool exhaustion only appears under real usage patterns

**Phase:** Address during the Supabase-to-Docker Postgres migration phase.

---

## Phase-Specific Warnings

| Phase Topic | Pitfall to Watch | Mitigation |
|------------|-----------------|------------|
| Initial fork + license check | Pitfall 12: license violation | Read LICENSE file before any work |
| Docker Compose scaffold | Pitfall 5: startup race | Add `healthcheck` + `condition: service_healthy` |
| Docker Compose scaffold | Pitfall 1: data loss on `down` | Named volume + wrapper scripts |
| Docker Compose scaffold | Pitfall 9: missing static assets + sharp | Copy `public/` and `.next/static` explicitly in Dockerfile |
| Rebranding | Pitfall 8: missed hardcoded strings | String audit + central `brand.ts` config |
| Rebranding | Pitfall 2: NEXT_PUBLIC_ key exposure | Proxy Maps calls server-side |
| Supabase migration | Pitfall 3: auth.uid() RLS breakage | Audit + rewrite or drop RLS policies |
| Supabase migration | Pitfall 13: connection string format | Replace Supabase client, configure pg pool |
| Google Maps integration | Pitfall 4: cost spiral | Set quota limit first, then code |
| Google Maps integration | Pitfall 7: key restriction mismatch | Two keys: browser-restricted + IP-restricted |
| Integration testing | Pitfall 10: webhooks need public URL | Port forwarding or Cloudflare Tunnel |
| Ongoing operations | Pitfall 6: upstream security debt | Monthly upstream check + Dependabot |
| User handoff | Pitfall 11: down vs stop confusion | Wrapper scripts + clear documentation |

---

## Sources

- Google Maps Platform — Manage Costs (official): https://developers.google.com/maps/billing-and-pricing/manage-costs
- Google Places API — Data Fields and Field Masks (official): https://developers.google.com/maps/documentation/places/web-service/data-fields
- Google Maps API Security Best Practices (official): https://developers.google.com/maps/api-security-best-practices
- Places API Migration Overview (official): https://developers.google.com/maps/documentation/places/web-service/legacy/migrate-overview
- Next.js Docker Standalone — Missing sharp (GitHub issue, HIGH confidence): https://github.com/vercel/next.js/issues/65679
- Docker Compose depends_on healthcheck pattern (MEDIUM confidence): https://www.dash0.com/faq/docker-compose-wait-for-container-before-starting-another
- Docker Postgres volume pitfalls (MEDIUM confidence): https://configzen.com/blog/common-pitfalls-docker-compose-postgres
- Next.js NEXT_PUBLIC_ runtime env variables and Docker (MEDIUM confidence): https://nemanjamitic.com/blog/2025-12-13-nextjs-runtime-environment-variables/
- Next.js env variable pitfalls — DEV Community (MEDIUM confidence): https://dev.to/koyablue/the-pitfalls-of-nextpublic-environment-variables-96c
- Supabase RLS — auth.uid() migration pitfalls (MEDIUM confidence): https://designrevision.com/blog/supabase-row-level-security
- Twilio webhooks and ngrok (official Twilio docs): https://www.twilio.com/en-us/blog/test-your-webhooks-locally-with-ngrok-html
- Next.js July 2026 security release (official): https://nextjs.org/blog/july-2026-security-release
- Open source licensing commercial use (MEDIUM confidence): https://promise.legal/startup-legal-guide/ip/open-source
- Google Places SKU billing tiers (MEDIUM confidence): https://nicolalazzari.ai/articles/google-maps-platform-places-routes-js-api-skus
