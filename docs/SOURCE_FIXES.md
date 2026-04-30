# Source Fix Notes

> This file lists source-level issues we worked around or patched in ElevateOS v1. Each entry includes the file:line reference, the current ElevateOS behavior, and the next fix when one remains.

---

## 1. KB collection-filter mismatch

**Where:** `dashboard/src/app/api/kb/search/route.ts`
**What:** Endpoint used to derive the collection name from `scope + agent` and ignore the client-sent `collection` param.
**ElevateOS status:** Fixed. `collection` is now validated and used as the explicit query target; `scope + agent` is only the fallback.
**Next fix:** Add upload/folder-ingest endpoints so operators can create and refresh collections from the UI.

---

## 2. Tunnel name and launchd label hardcoded

**Where:** `src/cli/tunnel.ts`
**What:** Tunnel names and launchd labels must be per-instance so two local installs cannot collide.
**ElevateOS status:** Fixed. Tunnel names now use `elevateos-<instance>` and launchd labels use `com.elevateos.tunnel.<instance>`.
**Next fix:** Move Cloudflare config writing away from the global `~/.cloudflared/config.yaml` if multi-tunnel concurrency becomes a real requirement.

---

## 3. Ecosystem dashboard runs in dev mode

**Where:** `src/cli/ecosystem.ts:87-102`
**What:** PM2's dashboard app runs `npm run dev` instead of `next start`. Slower, larger memory footprint, and recompiles every request. Also assumes `dashboard/.env.local` already exists — if missing, login fails because `ADMIN_PASSWORD` isn't seeded.
**ElevateOS workaround:** INSTALL step 4 explicitly seeds `dashboard/.env.local` from `~/.elevate/<instance>/dashboard.env` via heredoc, then step 5 runs `npm --prefix dashboard run build`. Once a Tier 2 PR lands, switch ecosystem.ts to `next start` against the prebuilt output.
**Proposed fix:** Generate ecosystem with `next start` against `dashboard/.next`, plus an explicit dependency on `npm run build` having run.

---

## 4. Ecosystem / start instance default fallback

**Where:** `src/cli/ecosystem.ts:7-13`, `src/cli/start.ts:91-99`
**What:** If `--instance` is omitted, both commands silently default to instance `default`. Daemon then reads `CTX_INSTANCE_ID || 'default'` (`src/daemon/index.ts:221-224`), so the wrong instance starts.
**ElevateOS workaround:** INSTALL step 14 requires `--instance elevation --org elevation` explicitly. Documented in OPERATOR_NOTES.
**Proposed fix:** Make `--instance` required (no default). Or fail with a clear error if `~/.elevate/<instance>/` doesn't exist.

---

## 5. Dashboard cron API rejects raw `cron`

**Where:** `dashboard/src/app/api/agents/[name]/crons/route.ts:91-98`
**What:** Validates body with `^\d+[smhd]$` regex. Rejects anchored cron expressions even though `AgentConfig.cron` exists in the type and the daemon would accept them in principle.
**ElevateOS workaround:** Tier 1 uses `interval`-only crons + self-gating prompts (`TZ=America/Vancouver date +%H` + sentinel files). Documented in OPERATOR_NOTES.
**Proposed fix:** Accept either `interval` (current regex) or `cron` (5- or 6-field cron expression). Reject if both or neither are set.

---

## 6. Boot prompt only converts `interval`

**Where:** `src/daemon/agent-process.ts:482-485`
**What:** When the daemon boots an agent, it constructs the cron list by reading `entry.interval` and converting to `*/N * * * *` form. `entry.cron` is silently ignored.
**ElevateOS workaround:** Same as #5 — `interval`-only.
**Proposed fix:** Honor `entry.cron` first; fall back to `interval` conversion. Required for Tier 2 anchored times.

---

## 7. Dashboard agent-create allowlist hardcoded

**Where:** `dashboard/src/app/api/agents/route.ts:14-15,89-94`
**What:** Allowlist is the literal `['agent', 'orchestrator', 'analyst']`. UI-driven creation of custom-template agents (e.g., `--template avery`) fails with a 400, even when the template exists on disk.
**ElevateOS workaround:** All four agents are created via the CLI (`node dist/cli.js add-agent`) in INSTALL step 7, never through the dashboard UI.
**Proposed fix:** Replace the hardcoded array with `fs.readdirSync(templatesRoot)` and validate against the on-disk template directory list.

---

## 8. `list-skills` path inconsistency

**Where:** Top-level CLI `src/cli/list-skills.ts:113-116` scans `agentDir/skills`. Bus subcommand `src/cli/bus.ts:1468-1474` scans `agentDir/.claude/skills`.
**What:** Two code paths read skills from different directories. The running PTY agent (Claude Code) only sees `.claude/skills`, so `dist/cli.js list-skills` lies about what an agent can actually run.
**ElevateOS workaround:** INSTALL step 12 copies all referenced skills into `.claude/skills/`. SKILLS_AUDIT documents the discrepancy.
**Proposed fix:** Standardize on `.claude/skills/` (the path Claude Code actually reads) and update top-level `list-skills.ts` to match.

---

## 9. `dashboard` CLI command does two things

**Where:** `src/cli/dashboard.ts:111-124` (env write) and `:141-170` (detached server spawn).
**What:** The single `dashboard` subcommand both writes `dashboard/.env.local` AND spawns a detached `next dev` on port 3000. There's no way to do just the env-write step. PM2's ecosystem also binds port 3000, so calling this from an install script orphans one server and crash-loops the other.
**ElevateOS workaround:** INSTALL step 4 reproduces the env-write logic via heredoc — does NOT call `cli.js dashboard` at all.
**Proposed fix:** Split into two flags: `--write-env` (writes `.env.local` only) and `--start` (current spawn behavior). Or split into two subcommands.

---

## 10. Continue/restart prompt narrower than startup

**Where:** `src/daemon/agent-process.ts:482-485` (startup) vs `:482-492` (continue).
**What:** Startup prompt converts `1h/2h/4h/6h/12h/24h/Nm`. Continue/restart prompt only converts `1h/6h/24h/Nm`. So `4h` and `12h` survive cold boot but become ambiguous after `--continue`. Plus `Nm` maps to `*/N * * * *` (minute field, max 59), so `Nm` for N > 59 produces an invalid cron expression.
**ElevateOS workaround:** All Tier 1 crons use only `10m/30m/1h/6h/24h` plus `Nm` for N ≤ 59. Sub-day cadences (every-4h, every-12h) and weekly cadences are simulated with the next safe interval + an hour/day-gate prompt + a daily sentinel file. Documented in OPERATOR_NOTES.
**Proposed fix:** Align startup and continue prompts on the same conversion table. Add an explicit guard against `Nm` for N > 59 with a clear error.

---

## 11. Dashboard env doesn't include org secrets

**Where:** `src/cli/dashboard.ts:111-124` writes auth/root/instance/port only. `src/pty/agent-pty.ts:80-95` loads `orgs/<org>/secrets.env` for PTYs, not the dashboard server. PM2's dashboard env (`src/cli/ecosystem.ts:87-98`) sets `PORT` only.
**What:** Dashboard server-side adapters that need API keys cannot rely on the PM2 dashboard process env.
**ElevateOS workaround:** `dashboard/src/lib/realestate/crm-client.ts` reads the configured secret name from `integrations.crm.api_key_env`, then resolves it from `orgs/<org>/secrets.env` via `fs.readFileSync` + an inline dotenv parser. Auth header/prefix or query-param mode, base URL, endpoints, and DB column mappings are configured per org. The dashboard exposes the same fields in Settings without returning the raw API key.
**Proposed fix:** Add an opt-in flag (`--load-org-secrets <org>`) that injects keys from `orgs/<org>/secrets.env` into the dashboard's PM2 env. Or have the dashboard read the secrets file lazily on first use, scoped per request via `CTX_ORG`.
