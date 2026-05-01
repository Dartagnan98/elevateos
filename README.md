# ElevateOS

**A real-estate operating system for solo agents and small teams, wrapped as a local Elevate Agent control center.**

> v1 — local-Mac-bound by design for customer-owned data and agent runtimes. Hosted dashboard is a future tier.

---

## What it is

ElevateOS is the app/control layer for a local Elevate Agent gateway. It keeps the real-estate dashboard, prompts, skills, knowledge base, LightRAG-style memory files, and customer-owned state local, while the Python `elevate` CLI runs the agent gateway underneath it.

The product split is intentional:

| Layer | Command | Purpose |
|---|---|---|
| **Elevate Agent CLI** | `elevate` | Local agent gateway, model wrapper, Telegram, memory, sessions, embeddings |
| **ElevateOS App** | `elevateos` | Real-estate dashboard, installer, prompts, skills, knowledge-base and memory views |

The first packaged vertical is a real-estate operating system for solo agents and small teams:

| Agent | Role | Tagline |
|---|---|---|
| **Avery** | Admin / orchestrator | "your transaction coordinator" |
| **Marlowe** | Marketing | "your marketing director" |
| **Pierce** | Sales / analyst | "your closing specialist" |
| **Reese** | Outreach | "your inside sales agent" |

They share a file bus, file iMessages and emails, draft replies for your approval, run weekly performance reports, and wake you up with a morning brew that pulls from each agent's domain.

---

## Architecture (v1)

```
~/elevateos/                            ← this repo
├── src/                                ← Elevate CLI/daemon/bus
├── dashboard/                          ← Elevate Next.js dashboard
│   └── src/app/(dashboard)/leads/      ← NEW Tier 1 page
├── templates/{avery,marlowe,pierce,reese}/  ← real-estate agent templates
├── customer-templates/elevation/       ← org scaffolding (data_roots, secrets.env example)
├── sop-pack/realestate/v1/             ← SOPs (Tier 1: 1 canary, Tier 2: full pack)
└── docs/                               ← INSTALL, ROLLBACK, OPERATOR_NOTES, etc.
```

State + per-org config (created by INSTALL):

```
~/.elevate/elevation/                 ← ElevateOS state dir (created by `elevateos install`)
└── dashboard.env                       ← admin password, root, instance, port

~/elevateos/orgs/elevation/             ← per-org config (created by `elevateos init`)
├── context.json                        ← org name, timezone, orchestrator
├── config.json                         ← data_roots + integration config
├── secrets.env                         ← CRM_API_KEY, ANTHROPIC_API_KEY, GMAIL_OAUTH_TOKEN
└── agents/{avery,marlowe,pierce,reese}/
    ├── .env                            ← per-agent BOT_TOKEN/CHAT_ID/ALLOWED_USER
    ├── config.json                     ← crons (interval-only in v1)
    ├── AGENTS.md / IDENTITY.md / GOALS.md
    └── .claude/skills/                 ← copied from the configured skills root at install
```

---

## Install

See `docs/INSTALL.md` for the full 16-step procedure.

Short version on a customer Mac, with prerequisites already in place:

```bash
git clone git@github.com:Dartagnan98/elevateos.git
cd elevateos
npm install && npm run build
node dist/cli.js install --instance elevation
# Default install seeds Executive Assistant, Outreach, Marketing, and Social Media.
# Use --starter-org <org> to change the starter org, or --no-starter-agents for
# a blank/custom template install.
```

After install, `localhost:3000` shows the dashboard with local agent chat, tools, crons, memory, and settings surfaces. Telegram and gateway connectors can be configured after the local dashboard is up.

---

## What's in v1

- **Branding sweep** — Elevation course palette from the blueprint/template: navy header blue `#1B2A4A`, copper/orange `#CE823E`, forest logo green `#044B35`, off-white `#F7F7F7`, Manrope typography, and an ElevateOS wordmark/favicon swap.
- **Elevate-native connector** — separate `elevateos` app command, `~/.elevate/<instance>` app state roots, local gateway probing at `http://127.0.0.1:8642`, and a dashboard Settings tab that mirrors runtime identity, APIs, Telegram/messages, redacted secrets, cron, skills, memory, and sessions.
- **Memory Graph** — Obsidian-style local graph view over Elevate memory facts, entities, turn-journal sessions, embeddings, knowledge files, and RAG collections.
- **Four agent templates** — orchestrator, marketing, analyst, outreach roles with real-estate-specific Situation Playbooks and pass-4-safe `interval` crons.
- **Real-estate data adapters** — lazy-open SQLite reader for `messages.db`, normalized `tools/data/sources/<source-id>` JSONL connector records, fs-based review reader, and configurable CRM API client. API-key env names, auth headers, endpoint paths, and DB column mappings come from org config + `secrets.env`.
- **Leads, Outreach, and Deals pages** — server-rendered dashboard surfaces, missing-DB safe via discriminated unions, with normalized source connector fallback.
- **One canary SOP** — `sop-pack/realestate/v1/avery/fintrac-id-verification.md`.
- **Install + rollback docs** — full 16-step install with Codex pass-4 safety baked in (heredoc env write, template-direct agent creation, safe-interval verification, skills-first copy, required `--instance` and `--org` flags).

## Working On Features

- **Desktop app shell** — package ElevateOS as a local desktop app that can install, launch, stop, restart, and inspect the local Elevate Agent gateway without needing Telegram or a terminal-first workflow.
- **OpenClaw-style local connector** — make the app connect to the local CLI/gateway through a clear pairing/connection flow, show whether the gateway is reachable, and guide the user through reconnecting when it is down.
- **One-click installer and updater** — ship an installer that can bootstrap the dashboard, gateway config, local state folders, PATH entries, and updates while keeping user memory/data local and uninstall-safe.
- **Gateway lifecycle controls** — dashboard buttons for start, stop, restart, logs, health, active sessions, stuck-process detection, and safe shutdown so hidden long-running sessions are visible before they burn tokens.
- **Agent chat without Telegram** — each agent detail page should support direct local chat through the gateway, while Telegram remains an optional channel per agent.
- **Elevate Agent Hub parity** — dashboard-created orchestration agents should write to the local Elevate gateway registry and reflect back into the CLI Agent Hub snapshot.
- **Bidirectional settings sync** — ElevateOS settings changes should write through to the Elevate CLI/gateway source of truth, and CLI/gateway changes should reflect back into ElevateOS without requiring manual file edits or restart confusion.
- **Safe agent renaming** — dashboard profile edits can rename the display name/role while keeping the stable `agent_id` intact. True slug/ID renames need a migration path for runs, memory, Telegram settings, delegation references, and existing dashboard URLs before they are enabled.
- **Visible specialist execution** — queued agent runs should be claimable by named agents such as Executive Assistant, Admin, Outreach, Marketing, and Social Media, with live status/events visible in the dashboard instead of invisible background work.
- **Agent CRUD hardening** — add edit/disable/delete controls for gateway-managed agents with explicit warnings around data retention and references.
- **Agent-specific channels** — Telegram bot tokens, pairing codes, allowed users, and message routing should be configurable per agent, with gateway-wide token reuse available when appropriate.
- **Rules and access settings** — per-agent dashboard controls for operating instructions, approval policy, allowed/blocked tools, filesystem roots, browser/shell access, and local Mac permissions, backed by structured config so the gateway can enforce them instead of only displaying markdown.
- **Premium skills and licensing boundary** — keep the base wrapper customer-owned, but gate paid Elevate skills, updates, templates, and support through a license/subscription layer that does not expose private skill packs in the public repo.
- **Local memory operations** — memory graph, recent memory, recurring memory, semantic search, daily organization jobs, embeddings status, and session/day segmentation should be visible and controllable from the dashboard.
- **Token and latency observability** — show per-session token usage, cache-read vs fresh-token accounting, repeated tool-output bloat, slow runs, active prompts, and the profile/toolset currently used by Telegram, dashboard chat, and delegated agents.
- **Skill and prompt inspector** — dashboard views for installed skills, enabled tools, prompt profiles, cron jobs, and agent instructions so the user can see exactly what the agent will load before it runs.
- **Local data export/import** — backup and restore flows for agents, settings, sessions, memory, embeddings metadata, Telegram config, and license state without touching unrelated local repos.
- **Production security pass** — tighten auth defaults, local secret redaction, CORS, destructive-action confirmations, audit logs, gateway API key handling, and uninstall behavior before a public installer release.

## What's deferred to Tier 2

- Approval bridge between Elevate's queue and the configured customer draft queue.
- KB upload + folder-ingest endpoints + UI.
- Dedicated Threads, Listings, and Marketing dashboard pages.
- Anchored real-time crons (boot-prompt patch + dashboard cron API patch).
- 9 more SOPs.
- Version-controlled skill packaging for customer-specific data-root adapters.

## What's deferred to Tier 3

- npm package boundaries (`@elevateos/cli`, `@elevateos/dashboard`, `@elevateos/sop-pack`).
- npm package one-liner (`npx @elevateos/install`).
- Hosted dashboard option (remote agent/API bridge).
- Customer #2.

---

## Maintenance

This repo is the ElevateOS application. Source-level fixes and portability notes are tracked in `docs/SOURCE_FIXES.md`.

---

## Docs

- `docs/INSTALL.md` — 16-step install procedure.
- `docs/ROLLBACK.md` — clean removal without touching customer data or external tool folders.
- `docs/OPERATOR_NOTES.md` — cron semantics, sentinel pattern, skill ownership map, triage table.
- `docs/SOURCE_FIXES.md` — source-level bugs we worked around, with proposed fixes.
- `docs/SKILLS_AUDIT.md` — customer skill inventory, data-root requirements, target agent owners.

---

## License

MIT. See `LICENSE`.
