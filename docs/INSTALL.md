# ElevateOS — Install (Tier 1)

> Customer Mac install only. v1 is local-Mac-bound by design for customer-owned data and local agent runtimes — hosted dashboard is Tier 3.

## Prerequisites

- macOS, admin user with a local tools/data root that contains any customer-provided `.claude/skills/` packages.
- Node 20.19+ or 22.12+ (`node -v`)
- npm 10+ (`npm -v`)
- Git
- Python Elevate Agent CLI (`elevate`) installed and configured if you want the dashboard chat/memory connector live on first boot
- PM2 (`npm i -g pm2`)
- cloudflared (`brew install cloudflared`) if you want phone/remote dashboard access
- jq (`brew install jq`)

## Steps

```bash
# One-line bootstrap. Installs/updates ~/elevateos, links `elevateos`,
# seeds the starter agent roster, configures the local gateway when `elevate`
# exists, and launches the dashboard.
curl -fsSL https://raw.githubusercontent.com/Dartagnan98/elevateos/main/install.mjs | node
```

Set `ELEVATEOS_LAUNCH=0` if you only want to install/update without launching the app.
By default, `elevateos install` creates the starter `skyleigh-elevate` org with Executive Assistant, Outreach, Marketing, and Social Media agents. Use `--starter-org <org>` to change the org name, or `--no-starter-agents` for a blank/custom install.

For phone access during install, add `--with-cloudflare`. For a persistent phone URL, first put a domain on Cloudflare, run `cloudflared login`, then pass `--cloudflare-hostname dashboard.example.com`.

Manual install:

```bash
# 0. Preflight — fail fast if anything is missing.
for bin in node npm git pm2 jq; do
  command -v "$bin" >/dev/null || { echo "Missing $bin; install it before continuing"; exit 1; }
done
command -v elevate >/dev/null || echo "Elevate Agent CLI not found yet; dashboard install can continue, gateway connector waits for it"
command -v cloudflared >/dev/null || echo "cloudflared not found yet; install it later for phone/remote access"

# 1. Clone.
cd ~
git clone git@github.com:Dartagnan98/elevateos.git
cd elevateos

# 2. Install + build CLI. (Dashboard build comes after install seeds the env.)
npm install
npm run build

# 3. Initialize the ElevateOS instance. Writes ~/.elevate/elevation/ + dashboard.env.
#    This custom Elevation template flow adds its own agents below, so it skips
#    the default starter roster.
node dist/cli.js install --instance elevation --no-starter-agents

# 3b. Enable the local Elevate Agent HTTP gateway for the app connector.
#     This keeps the runtime local while giving ElevateOS a stable app API.
elevate config set platforms.api_server.enabled true
elevate config set platforms.api_server.extra.host 127.0.0.1
elevate config set platforms.api_server.extra.port 8642
elevate gateway restart
curl -fsS http://127.0.0.1:8642/health

# Optional production hardening for the local gateway API:
#   elevate config set platforms.api_server.extra.key "$(openssl rand -hex 32)"
#   echo "ELEVATE_GATEWAY_API_KEY=<same key>" >> dashboard/.env.local

# 4. Seed dashboard/.env.local directly from ~/.elevate/elevation/dashboard.env.
#
#    DO NOT use `node dist/cli.js dashboard --instance elevation` here — that
#    command also spawns a detached Next dev server on port 3000
#    (src/cli/dashboard.ts:141-170), which would collide with PM2 in step 15.
{
  echo "ELEVATE_INSTANCE_ID=elevation"
  echo "ELEVATE_ROOT=$HOME/.elevate/elevation"
  echo "ELEVATE_FRAMEWORK_ROOT=$HOME/elevateos"
  echo "CTX_INSTANCE_ID=elevation"
  echo "CTX_ROOT=$HOME/.elevate/elevation"
  cat ~/.elevate/elevation/dashboard.env
} > dashboard/.env.local
chmod 600 dashboard/.env.local

# 5. Build the dashboard with elevation env.
ELEVATE_INSTANCE_ID=elevation ELEVATE_ROOT="$HOME/.elevate/elevation" \
  npm --prefix dashboard install
ELEVATE_INSTANCE_ID=elevation ELEVATE_ROOT="$HOME/.elevate/elevation" \
  npm --prefix dashboard run build

# 6. Initialize the org. Init writes its own context.json — overwrite it
#    with the elevation version so orchestrator: "avery" sticks.
node dist/cli.js init elevation --instance elevation
cp customer-templates/elevation/context.json orgs/elevation/context.json

# 7. Add agents from the real-estate templates directly.
#    add-agent accepts any directory under templates/. It still regenerates
#    SYSTEM.md from orgs/elevation/context.json, so the org context remains
#    authoritative while AGENTS.md, skills, and config.json come
#    from the ElevateOS templates.
node dist/cli.js add-agent avery   --template avery   --org elevation --instance elevation
node dist/cli.js add-agent marlowe --template marlowe --org elevation --instance elevation
node dist/cli.js add-agent pierce  --template pierce  --org elevation --instance elevation
node dist/cli.js add-agent reese   --template reese   --org elevation --instance elevation

# 8. Verify real-estate templates landed and crons use the v1-safe intervals.
node <<'NODE'
const fs = require('fs');
const agents = ['avery', 'marlowe', 'pierce', 'reese'];
const required = ['AGENTS.md', 'IDENTITY.md', 'GOALS.md', 'config.json'];
const allowed = new Set(['10m', '30m', '1h', '6h', '24h']);
let failed = false;
for (const agent of agents) {
  const dir = `orgs/elevation/agents/${agent}`;
  for (const file of required) {
    if (!fs.existsSync(`${dir}/${file}`)) {
      console.error(`Missing ${dir}/${file}`);
      failed = true;
    }
  }
  const cfg = JSON.parse(fs.readFileSync(`${dir}/config.json`, 'utf8'));
  for (const cron of cfg.crons || []) {
    if (!cron.interval || !allowed.has(cron.interval)) {
      console.error(`${agent}/${cron.name}: unsafe interval ${cron.interval || '(missing)'}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
NODE

# 9. Drop in real-estate adapter config (data_roots).
cp customer-templates/elevation/config.json orgs/elevation/config.json

# 10. Replace init.ts's secrets.env with our example (init wrote per-org
#     BOT_TOKEN/CHAT_ID at org level — wrong for our per-agent Telegram model).
cp customer-templates/elevation/secrets.env.example orgs/elevation/secrets.env

# 11. Drop per-agent .env templates.
for agent in avery marlowe pierce reese; do
  cp customer-templates/elevation/agents/$agent/.env.example \
     orgs/elevation/agents/$agent/.env
done

# 12. Copy referenced skills BEFORE first agent boot.
#
#    Cron prompts reference these skills. If the skills aren't present when
#    the daemon starts, crons fire into nothing.
: "${ELEVATE_TOOLS_ROOT:?Set ELEVATE_TOOLS_ROOT to the folder containing .claude/skills}"
mkdir -p orgs/elevation/agents/avery/.claude/skills
mkdir -p orgs/elevation/agents/marlowe/.claude/skills
mkdir -p orgs/elevation/agents/reese/.claude/skills
cp -R "$ELEVATE_TOOLS_ROOT/.claude/skills/gmail-doc-router"      orgs/elevation/agents/avery/.claude/skills/
cp -R "$ELEVATE_TOOLS_ROOT/.claude/skills/weekly-listing"        orgs/elevation/agents/avery/.claude/skills/ 2>/dev/null || true
cp -R "$ELEVATE_TOOLS_ROOT/.claude/skills/market-stats-watcher"  orgs/elevation/agents/marlowe/.claude/skills/
cp -R "$ELEVATE_TOOLS_ROOT/.claude/skills/draft-inbound"         orgs/elevation/agents/reese/.claude/skills/
cp -R "$ELEVATE_TOOLS_ROOT/.claude/skills/outreach"              orgs/elevation/agents/reese/.claude/skills/

# 13. Fill in credentials.
nano orgs/elevation/secrets.env                # CRM_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
nano orgs/elevation/config.json                # data_roots + CRM provider/base URL/auth/endpoints
nano orgs/elevation/agents/avery/.env          # BOT_TOKEN, CHAT_ID, ALLOWED_USER
nano orgs/elevation/agents/marlowe/.env
nano orgs/elevation/agents/pierce/.env
nano orgs/elevation/agents/reese/.env
chmod 600 orgs/elevation/secrets.env orgs/elevation/agents/*/.env

# 14. Generate the PM2 ecosystem file.
#     Both flags are REQUIRED — they default to "default" otherwise.
node dist/cli.js ecosystem --instance elevation --org elevation

# 15. Start daemon + dashboard under PM2.
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # follow PM2's printed sudo command

# 16. (Optional) Cloudflare Tunnel for phone access.
#
# Temporary/no-account link. Keep the terminal open; this URL changes when
# cloudflared stops and has no uptime guarantee.
node dist/cli.js tunnel quick --instance elevation --port 3000

# Persistent/free Cloudflare URL. Requires a free Cloudflare account and a
# domain managed by Cloudflare. This creates or reuses "elevateos-elevation",
# routes DNS, writes ~/.elevate/elevation/cloudflared/config.yaml, and installs
# ~/Library/LaunchAgents/com.elevateos.tunnel.elevation.plist so it restarts
# after the Mac logs in.
brew install cloudflared
cloudflared login
node dist/cli.js tunnel start --instance elevation --port 3000 --hostname dashboard.example.com
node dist/cli.js tunnel status --instance elevation
```

## Cloudflare persistence model

There are two Cloudflare modes:

- `elevateos tunnel quick` uses `trycloudflare.com`. It is free and does not require an account, but it is a foreground development tunnel. The URL changes whenever the process stops.
- `elevateos tunnel start --hostname <host>` uses a named Cloudflare Tunnel. It is persistent on the Mac through launchd, but it needs `cloudflared login` and a public hostname on a domain in the Cloudflare account. Cloudflare routes that hostname to the tunnel using `cloudflared tunnel route dns`.

For full persistence after reboot, keep both layers supervised:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # follow the printed sudo command

node dist/cli.js tunnel start --instance elevation --port 3000 --hostname dashboard.example.com
```

Tunnel alone does not add outer identity protection. For Internet-facing production use, add Cloudflare Access on the hostname so the dashboard login is behind Cloudflare's auth gate too.

## Verify

After step 15, `elevateos status --instance elevation` should show the ElevateOS daemon/dashboard health. `elevate gateway status` should show the Python Elevate Agent gateway health. Visit `http://localhost:3000` and log in with the admin password from `~/.elevate/elevation/dashboard.env`. The Leads page should render from either `data_roots.messages_db` or normalized records under `tools/data/sources/<source-id>`. Settings > Elevate Agent should show whether the local gateway endpoint is reachable. Memory Graph should show local memory facts/entities/sessions when `~/.elevate/memory_store.db` exists, and still render with setup warnings before memory has been written.

Each Telegram bot should send a "Booting up..." message to the chat ID you set in step 13. If a bot is silent, check `~/.elevate/elevation/logs/<agent>/stderr.log`.

## When something's wrong

- **Dashboard 500s on login** → `dashboard/.env.local` missing `ADMIN_PASSWORD`. Re-run step 4.
- **Agent silent** → `pm2 logs <agent>` to see startup errors. Often `.env` missing `ALLOWED_USER`.
- **Cron didn't fire** → check the prompt's hour/day gate matches `TZ=America/Vancouver date +%H` (or `%A`). Elevate has no scheduler validation, so a typo silently no-ops.
- **Leads page renders blank** → `orgs/elevation/config.json` `data_roots.messages_db` path doesn't exist, sqlite schema doesn't match `messages-db.ts`, and no normalized source connector records exist under `tools/data/sources/<source-id>`. Check Settings > Source Connectors and the dashboard server log.

## Rollback

`docs/ROLLBACK.md` covers full removal. Customer data and external tools folders are untouched by ElevateOS — the install is purely additive.
