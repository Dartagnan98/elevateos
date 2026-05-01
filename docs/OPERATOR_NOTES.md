# ElevateOS — Operator Notes

> Things you need to know to run, debug, or change ElevateOS v1. If something here affects a customer workflow, surface it in the walkthrough rather than letting them discover it.

---

## Cron timing in v1 is approximate

Daily and weekly crons drift by up to 24h between daemon restarts. v1 uses `interval`-only crons; anchored real-time scheduling needs both a boot-prompt patch and a dashboard cron API patch (see `docs/SOURCE_FIXES.md` items 5 + 6) and is queued for Tier 2.

**Practical impact:** if the daemon restarts at 6:42 PM, a morning daily-review job can fire at 6:42 PM the next day instead of the intended morning window. We mitigate this with **hour-gate prompts** + **daily sentinel files** so the job only actually runs during the configured morning window even if the cron tick fires off-hours. See "Sentinel pattern" below.

---

## Cron interval forms — the v1-safe set

The dashboard cron API accepts `^\d+[smhd]$` (e.g., `4h`, `12h`, `168h`). Saving any of those without the daemon-side conversion path means the cron silently no-ops at boot. Live conversion paths:

- **Startup prompt** (`src/daemon/agent-process.ts:482-485`) — converts `1h`, `2h`, `4h`, `6h`, `12h`, `24h`, and `Nm`.
- **Continue/restart prompt** (`:482-492`) — converts only `1h`, `6h`, `24h`, and `Nm`.

So `4h` and `12h` work on a fresh start but become ambiguous after `--continue`. v1 avoids them.

**Allowed forms in Tier 1 crons:**
- `10m`, `30m`, `1h`, `6h`, `24h`
- `Nm` for any **N ≤ 59** (e.g., `15m`, `45m`)

**Avoid in Tier 1:**
- `4h`, `12h` — work at startup, ambiguous on continue
- `168h` (and any `Nh` outside the conversion table) — unsupported, silently no-ops
- `Nm` for **N > 59** — `Nm` maps to `*/N * * * *` (minute field, max 59). `240m` and `720m` produce invalid cron expressions.

**Sub-day cadences not on the safe list:**
- Every-4h → `interval: "1h"` + hour-gate `if hour not in {00,04,08,12,16,20}, exit silently`
- Every-12h → `interval: "6h"` + hour-gate `if hour not in {08,20}, exit silently`

**Weekly cadences:**
- `interval: "24h"` + day-gate `if output is not Monday (or whichever day), exit silently` + sentinel file at `data/.cron-runs/<job>-$(TZ=America/Vancouver date +%F)` so a daemon restart on the same day doesn't re-fire.

**Time zone:** agent prompts only see UTC by default. Always invoke `TZ=America/Vancouver date +%H` (or `+%A`) explicitly when gating on Vancouver local time.

---

## Sentinel pattern — copy-paste reference

Every self-gated cron writes a daily sentinel and exits early if it already ran today. Elevate has no built-in execution dedup (`src/bus/cron-state.ts:53-76` only records explicit fires), so this is on the prompt itself.

```bash
STAMP=data/.cron-runs/<job-name>-$(TZ=America/Vancouver date +%F)
if [ -f "$STAMP" ]; then exit 0; fi
# ... do the work ...
mkdir -p data/.cron-runs && touch "$STAMP"
```

The whole prompt template for a Monday-only weekly cron looks like:

```
Run TZ=America/Vancouver date +%A. If output is not Monday, exit silently.
Sentinel: STAMP=data/.cron-runs/<job>-$(TZ=America/Vancouver date +%F);
if [ -f "$STAMP" ]; then exit silently. fi
Otherwise: <the actual work>.
On success: mkdir -p data/.cron-runs && touch "$STAMP".
```

If the sentinel directory fills up over time, prune with: `find data/.cron-runs -mtime +30 -delete` (do this from a Tier 2 cleanup cron, not by hand).

---

## `fire_at` semantics — one-shot only

`AgentConfig.cron[].fire_at` (`src/types/index.ts:192-197`) is a **one-shot** trigger by design — fires once at the timestamp, then never again. Not a bug; not a workaround for anchored crons.

For repeating one-shots (e.g., "remind me about this contract subject removal in 7 days"), use the persistent reminder queue in `src/bus/reminders.ts`, not `fire_at`.

---

## Skill ownership map

Each customer-provided skill in `$ELEVATE_TOOLS_ROOT/.claude/skills/` has a single intended owner among ElevateOS agents. INSTALL step 12 copies these to the per-agent `.claude/skills/` directories. Anything not copied at install keeps running in the customer's existing automation and is invisible to ElevateOS — no regression.

| Skill | Owner | Tier 1 copied? | Notes |
|---|---|---|---|
| `gmail-doc-router` | Avery | ✓ | Routes inbound attachments to listing folders. Cron: every 10m. |
| `weekly-listing` | Avery | ✓ (best-effort) | Weekly listing performance report. Cron: Monday + sentinel. |
| `digisign` | Avery | – | Tier 2. |
| `webforms` | Avery | – | Tier 2. |
| `showing-time` | Avery | – | Tier 2 (needs eXp API creds). |
| `market-stats-watcher` | Marlowe | ✓ | Daily Kamloops + Okanagan stats refresh into brew. |
| `marketing` | Marlowe | – | Tier 2. |
| `mlc` | Marlowe | – | Tier 2. |
| `humanizer` | Marlowe | – | Tier 2. |
| `cma` | Pierce | – | Tier 2 (CMA generator). |
| `property-lookup` | Pierce | – | Tier 2. |
| `outreach` | Reese | ✓ | Daily cold/re-engage drafts to approval queue. |
| `outreach-send` | Reese | – | Tier 2 (send half — paired with approval bridge). |
| `draft-inbound` | Reese | ✓ | Drafts replies to incoming iMessages. Cron: every 10m. |
| `graphify` | Shared | – | Tier 2 — knowledge ingestion. |

---

## Approval flow — Tier 1 is read-only

The configured customer approval queue at `data_roots.messages_db` (or wherever the current setup writes drafts) keeps running unchanged. Reese's `draft-inbound` cron writes there through the configured runtime adapter.

ElevateOS dashboard does **not** mirror or write to that queue in v1. Tier 2 builds a sync layer (with explicit polling cadence + idempotency keys) before any cross-write happens. The Approvals page reads ElevateOS's own approval table, not the external customer queue, so it may appear empty in Tier 1 — that's expected.

---

## When something's wrong — quick triage

| Symptom | First check |
|---|---|
| Dashboard 500s on login | `dashboard/.env.local` missing `ADMIN_PASSWORD`. Re-run INSTALL step 4. |
| Telegram bot silent | `pm2 logs <agent>`. Usually `ALLOWED_USER` missing in `orgs/elevation/agents/<agent>/.env`. |
| Cron didn't fire | Check the prompt's hour/day gate matches `TZ=America/Vancouver date +%H` (or `+%A`). Elevate has no scheduler validation, so a typo silently no-ops. |
| Cron ran twice in one day | Sentinel file isn't being written. Check the prompt has the `mkdir -p data/.cron-runs && touch "$STAMP"` line on the success path. |
| Leads page renders blank | `data_roots.messages_db` is missing/schema-mismatched and no normalized connector records exist under `tools/data/sources/<source-id>`. Check Settings > Source Connectors and the dashboard server log. |
| `cli.js status` shows wrong instance | INSTALL step 14 ran without `--instance elevation`. Regenerate ecosystem and restart PM2. |

---

## What's intentionally local-Mac-bound in v1

- `better-sqlite3` in dashboard adapters means dashboard must run on the same machine as `messages.db`.
- CRM API keys in `orgs/<org>/secrets.env` are read via `fs`, not the dashboard process env, because PM2's dashboard env doesn't carry org secrets. The concrete secret name, auth mode, header/prefix or query param, base URL, endpoints, and CRM DB columns come from `integrations.crm`.
- Cloudflare tunnel uses the per-instance `elevateos-<instance>` name. Quick tunnels are temporary `trycloudflare.com` foreground sessions; persistent phone access uses a named tunnel, `cloudflared tunnel route dns`, and a launchd service.

These are known v1 constraints. Hosted dashboard is Tier 3.
