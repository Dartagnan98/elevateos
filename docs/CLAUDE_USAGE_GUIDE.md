# ElevateOS Claude Usage Guide

This guide is for Claude Code, Codex, and human operators working inside this
repo. It explains what ElevateOS is, what each feature does, where state lives,
and which commands are safe to suggest when a user asks how to operate it.

## Mental model

ElevateOS is the Claude Code wrapper and local control layer. It starts Claude
Code PTYs as named agents, gives them local files, memory, bus commands,
Telegram hooks, and a Next.js dashboard.

There are two layers:

| Layer | Command | Responsibility |
| --- | --- | --- |
| Elevate Agent gateway | `elevate` | Separate Python/local gateway runtime, model wrapper, memory, Telegram, sessions, embeddings |
| ElevateOS app | `elevateos` | This repo: dashboard, installer, Claude Code PTY agents, templates, skills, bus, PM2/tunnel helpers |

Do not assume these are the same repo. ElevateOS can probe and talk to the
local `elevate` gateway, but it also has its own daemon, state directory, and
Claude Code PTY lifecycle.

## Production readiness baseline

Before calling a checkout production-ready for a local or tunneled install,
verify the following from the repo root:

```bash
npm install
npm run build
npm test
npm --prefix dashboard install
npm --prefix dashboard run build
node dist/cli.js doctor
```

Production requirements:

- Node must satisfy the repo engine, currently `>=20.19.0`.
- Claude Code must be installed and authenticated: `claude --version` and `claude auth status`.
- Dashboard auth must have `AUTH_SECRET` and `ADMIN_PASSWORD`, normally created in `~/.elevate/<instance>/dashboard.env`.
- For PM2 dashboard production mode, build first with `npm --prefix dashboard run build`; PM2 runs `next start`, not `next dev`.
- For remote/tunneled dashboard access, Cloudflare Access or an equivalent outer auth layer should be configured.
- `dangerously_skip_permissions` is off by default. Enable it only for trusted, local-only agents that need Claude Code permission prompts bypassed.
- The dashboard proxy verifies Auth.js JWT session cookies and signed bearer tokens. A cookie name alone is not accepted.
- `/api/media/*` is authenticated by the proxy and then constrained by realpath plus allowed roots.

Expected non-blocking doctor warnings on a local-only install:

- Cloudflare auth or tunnel not configured, if the dashboard is not exposed.
- `GEMINI_API_KEY` missing, if semantic/RAG features are not being used.

## State and config layout

Runtime state is separate from source code:

```text
~/.elevate/<instance>/
  dashboard.env
  .env
  config/
  inbox/
  logs/
  state/
```

Org and agent config live in the source checkout:

```text
orgs/<org>/
  context.json
  config.json
  secrets.env
  agents/<agent>/
    .env
    config.json
    AGENTS.md
    IDENTITY.md
    GOALS.md
    .claude/skills/
```

The dashboard reads local state through `ELEVATE_ROOT` / `CTX_ROOT` and source
files through `ELEVATE_FRAMEWORK_ROOT` / `CTX_FRAMEWORK_ROOT`.

## Feature map

### Installer and setup

Commands:

```bash
elevateos install --instance elevation
elevateos setup --instance elevation
elevateos init elevation --instance elevation
elevateos seed-agents --org elevation --instance elevation
```

What it does:

- Creates `~/.elevate/<instance>` state folders.
- Generates dashboard credentials and the bus signing key.
- Links the `elevateos` CLI globally.
- Seeds starter agents or leaves a blank/custom org depending on flags.
- The interactive wizard can configure Telegram, create agents, generate PM2 config, and start the daemon.

### Agent templates

Templates live under `templates/`.

Main real-estate roles:

| Agent | Role | Typical use |
| --- | --- | --- |
| Avery | Admin/orchestrator | Coordination, transaction checklists, morning brew, routing |
| Marlowe | Marketing | Listing copy, content planning, campaign support |
| Pierce | Sales/analyst | Deal review, comps, follow-up priorities, closing support |
| Reese | Outreach | Lead follow-up drafts, reactivation, inbox triage |

Each agent gets identity files, goals, config, optional crons, local skills, and
Telegram settings. Agents are Claude Code sessions, so their behavior comes from
the prompt files plus runtime environment.

### Daemon and Claude Code PTYs

Commands:

```bash
elevateos start --instance elevation
elevateos stop --instance elevation
elevateos status --instance elevation
elevateos enable <agent> --org <org> --instance elevation
elevateos disable <agent> --org <org> --instance elevation
```

What it does:

- Starts one long-running daemon process.
- Discovers enabled agents under `orgs/<org>/agents/*`.
- Launches each agent through Claude Code using `node-pty`.
- Loads `config.json`, `.env`, org secrets, local skills, local prompt overrides, and bus paths.
- Watches for crashes and can restart agents within configured limits.

Permission model:

- Claude Code permission bypass is off by default.
- Per-agent opt-in: set `dangerously_skip_permissions: true` in the agent config or Dashboard > Agent > Settings.
- Global emergency opt-in: `ELEVATE_DANGEROUSLY_SKIP_PERMISSIONS=1` or `CTX_DANGEROUSLY_SKIP_PERMISSIONS=1`.
- Do not enable bypass for a dashboard reachable by untrusted users.

### File bus

Command:

```bash
elevateos bus --help
```

What it does:

- Provides local JSON/file-backed operations for tasks, messages, events, approvals, heartbeat, knowledge, metrics, and lifecycle actions.
- Gives agents a stable interface that does not require direct database access.
- Stores artifacts under the instance root so the dashboard can render status and outputs.

Common operator actions:

```bash
elevateos bus list-tasks
elevateos bus send-message <agent> normal "message"
elevateos notify-agent <agent> "message"
```

### Dashboard

Commands:

```bash
elevateos dashboard --instance elevation --install --build --open
npm --prefix dashboard run build
npm --prefix dashboard run start
```

What it does:

- Serves the local web UI for agents, chat, tools, crons, memory, leads, outreach, deals, settings, approvals, and media previews.
- Uses NextAuth credentials auth with a local SQLite users table.
- Seeds admin credentials from `~/.elevate/<instance>/dashboard.env`.
- Protects dashboard/API routes through `dashboard/src/proxy.ts`.

Production notes:

- Use `--build` or `next start` for remote/tunnel use.
- Do not expose `next dev` over a tunnel.
- Keep `dashboard/.env.local` populated from `dashboard.env`.
- Local `http://localhost` production starts intentionally use non-secure auth cookies so the CSRF login flow works. Set `NEXTAUTH_URL=https://...` or `AUTH_SECURE_COOKIES=true` when serving only over HTTPS.

### PM2 ecosystem

Commands:

```bash
elevateos ecosystem --instance elevation --org elevation
pm2 start ecosystem.config.js
pm2 save
```

What it does:

- Generates a PM2 app for the daemon.
- Adds a supervised dashboard app when dashboard dependencies are installed.
- Runs the dashboard with `npx next start` after a production build.
- Carries the requested instance and org into PM2 environment variables.

### Worker sessions

Commands:

```bash
elevateos spawn-worker <name> --dir <dir> --prompt "do the task" --model sonnet
elevateos list-workers
elevateos inject-worker <name> "status?"
elevateos terminate-worker <name>
```

What it does:

- Starts ephemeral Claude Code worker PTYs for parallel tasks.
- Uses the requested `--model` when provided.
- Exposes worker status over IPC.
- Does not add long-running crash recovery, Telegram polling, or cron behavior.

### Elevate Agent gateway connector

The dashboard can show and use the separate local `elevate` gateway.

Typical setup:

```bash
elevate config set platforms.api_server.enabled true
elevate config set platforms.api_server.extra.host 127.0.0.1
elevate config set platforms.api_server.extra.port 8642
elevate gateway restart
curl -fsS http://127.0.0.1:8642/health
```

Optional hardening:

```bash
elevate config set platforms.api_server.extra.key "$(openssl rand -hex 32)"
echo "ELEVATE_GATEWAY_API_KEY=<same key>" >> dashboard/.env.local
```

### Telegram

What it does:

- Per-agent `.env` files can define `BOT_TOKEN`, `CHAT_ID`, and allowed-user controls.
- Pollers feed Telegram messages into agent inboxes.
- Agents can draft replies and notify operators.
- Setup validates bot/chat credentials when network access is available.

### Memory and knowledge

What it does:

- The dashboard surfaces memory facts, entities, sessions, embeddings, local knowledge files, and RAG collections where available.
- Agents use bus commands and local files for recall and writeback.
- Missing memory stores should degrade to setup warnings, not crash the dashboard.

### Real-estate data adapters

What it does:

- Reads configured message databases, normalized JSONL source records, filesystem review data, and optional CRM APIs.
- Exposes Leads, Outreach, Deals, Threads, and Morning Brew surfaces.
- Uses org config plus `orgs/<org>/secrets.env` so API key names, headers, endpoints, and DB mappings stay per-customer.

### Media and deliverables

What it does:

- Agents can save outputs that the dashboard renders through `/api/media/*`.
- The route serves files only under `CTX_ROOT`, the framework root, or operator-configured allowed roots.
- The route resolves realpaths to prevent path traversal and symlink escape.
- Markdown render mode escapes raw HTML and blocks dangerous URL schemes.

### Tunnel

Commands:

```bash
elevateos tunnel --instance elevation --help
elevateos tunnel quick --instance elevation --port 3000
elevateos tunnel start --instance elevation --port 3000 --hostname dashboard.example.com
elevateos tunnel status --instance elevation
```

What it does:

- `quick` starts a temporary no-account `trycloudflare.com` tunnel in the foreground for phone testing.
- `start --hostname` creates or reuses a named tunnel, routes the hostname with Cloudflare DNS, writes a per-instance config, and installs a macOS launchd service.
- Tunnel exposure is optional; local-only installs do not need it.
- Persistent phone access requires `cloudflared login` and a hostname on a Cloudflare-managed domain.
- If exposed, use Cloudflare Access or equivalent outer auth in addition to dashboard auth.

### Rollback and uninstall

Commands:

```bash
elevateos uninstall --instance elevation
```

Docs:

```text
docs/ROLLBACK.md
```

What it does:

- Stops local processes and removes generated app artifacts.
- Operator should confirm which local state and customer data should remain before deleting anything manually.

## Common Claude responses

When the user asks "is it healthy?":

```bash
node dist/cli.js doctor
node dist/cli.js status --instance <instance>
pm2 status
```

When the user asks "start production dashboard":

```bash
node dist/cli.js dashboard --instance <instance> --install --build --open
```

When the user asks "start under PM2":

```bash
npm --prefix dashboard run build
node dist/cli.js ecosystem --instance <instance> --org <org>
pm2 start ecosystem.config.js
pm2 save
```

When the user asks "add an agent":

```bash
node dist/cli.js add-agent <name> --org <org> --template <template> --instance <instance>
node dist/cli.js enable <name> --org <org> --instance <instance>
```

When the user asks "let Claude run without approval prompts":

```json
{
  "dangerously_skip_permissions": true
}
```

Only suggest that setting with an explicit warning: it lets Claude Code bypass
permission prompts and should be used only for trusted local agents.

## Do not assume

- Do not confuse this repo with the separate `elevate` gateway repo.
- Do not call a tunneled install production-ready unless dashboard auth, outer tunnel auth, and a strong `AUTH_SECRET` are verified.
- Do not enable permission bypass as a default.
- Do not rely on the system `node` if it is below `20.19.0`.
- Do not expose `npm run dev` / `next dev` to the public internet.
- Do not delete local state, org data, or skill packs unless the user explicitly asks for destructive cleanup.
