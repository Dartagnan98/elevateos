# ElevateOS

**A real-estate operating system for solo agents and small teams, wrapped as a local Elevate Agent control center.**

> v1 — customer #0 is Skyleigh McCallum (Forever Real Estate / EXP). Local-Mac-bound by design. Hosted dashboard is a future tier.

---

## What it is

Four persistent Claude Code agents that run on your Mac, talk to you on Telegram, and surface a single web dashboard for everything that matters during a real-estate day:

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
~/.elevate/elevation/                 ← Elevate state dir (created by `elevate install`)
└── dashboard.env                       ← admin password, root, instance, port

~/elevateos/orgs/elevation/             ← per-org config (created by `elevate init`)
├── context.json                        ← org name, timezone, orchestrator
├── config.json                         ← data_roots → ~/skyleigh-tools/data/...
├── secrets.env                         ← LOFTY_API_KEY, ANTHROPIC_API_KEY, GMAIL_OAUTH_TOKEN
└── agents/{avery,marlowe,pierce,reese}/
    ├── .env                            ← per-agent BOT_TOKEN/CHAT_ID/ALLOWED_USER
    ├── config.json                     ← crons (interval-only in v1)
    ├── AGENTS.md / IDENTITY.md / GOALS.md
    └── .claude/skills/                 ← copied from ~/skyleigh-tools/ at install
```

---

## Install

See `docs/INSTALL.md` for the full 16-step procedure.

Short version on Skyleigh's Mac, with prerequisites already in place:

```bash
git clone git@github.com:Dartagnan98/elevateos.git
cd elevateos
npm install && npm run build
node dist/cli.js install --instance elevation
# … (steps 4–16: seed env, build dashboard, init org, add agents, patch templates,
#    drop secrets, copy skills, generate ecosystem, start PM2)
```

After install, four Telegram bots come online and `localhost:3000` shows the branded dashboard with a working **Leads** page reading from her existing `~/skyleigh-tools/data/messages.db`.

---

## What's in v1

- **Branding sweep** — Elevation course palette from the blueprint/template: navy header blue `#1B2A4A`, copper/orange `#CE823E`, forest logo green `#044B35`, off-white `#F7F7F7`, Manrope typography, and an ElevateOS wordmark/favicon swap.
- **Elevate-native wrapper** — `elevate` CLI branding, `~/.elevate/<instance>` state roots, per-instance tunnel names, and a dashboard Settings tab for local runtime identity.
- **Four agent templates** — orchestrator, marketing, analyst, outreach roles with real-estate-specific Situation Playbooks and pass-4-safe `interval` crons.
- **Real-estate data adapters** — lazy-open SQLite reader for `messages.db`, fs-based brew reader, Lofty API client (reads `LOFTY_API_KEY` directly from `secrets.env` since the dashboard PM2 env doesn't carry org secrets).
- **Leads page** — server component, `dynamic='force-dynamic'`, missing-DB safe via discriminated unions.
- **One canary SOP** — `sop-pack/realestate/v1/avery/fintrac-id-verification.md`.
- **Install + rollback docs** — full 16-step install with Codex pass-4 safety baked in (heredoc env write, template-direct agent creation, safe-interval verification, skills-first copy, required `--instance` and `--org` flags).

## What's deferred to Tier 2

- Approval bridge between Elevate's queue and Skyleigh's existing draft queue.
- KB upload + folder-ingest endpoints + UI.
- Threads, Listings, Marketing, Deals dashboard pages.
- Anchored real-time crons (boot-prompt patch + dashboard cron API patch).
- 9 more SOPs.
- Path-templating in skills (move from `/Users/admin/skyleigh-tools/...` to `${data_roots.*}`).

## What's deferred to Tier 3

- npm package boundaries (`@elevateos/cli`, `@elevateos/dashboard`, `@elevateos/sop-pack`).
- `npx @elevateos/install` one-liner.
- Hosted dashboard option (remote agent/API bridge).
- Customer #2.

---

## Maintenance

This repo is the ElevateOS application. Source-level fixes and portability notes are tracked in `docs/SOURCE_FIXES.md`.

---

## Docs

- `docs/INSTALL.md` — 16-step install procedure.
- `docs/ROLLBACK.md` — clean removal without touching `~/skyleigh-tools/`.
- `docs/OPERATOR_NOTES.md` — cron semantics, sentinel pattern, skill ownership map, triage table.
- `docs/SOURCE_FIXES.md` — source-level bugs we worked around, with proposed fixes.
- `docs/SKILLS_AUDIT.md` — Skyleigh's 15 skills, hardcoded paths, target agent owners.

---

## License

MIT. See `LICENSE`.
