# ElevateOS — Rollback (Tier 1)

> Removes ElevateOS without touching customer data or external tool folders. ElevateOS is purely additive in v1, so rollback is safe.

## Steps

```bash
# 1. Stop everything under PM2.
pm2 delete all
pm2 save

# 2. Remove the cloudflared launchd entry, if step 16 of INSTALL was run.
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.elevateos.tunnel.elevation.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.elevateos.tunnel.elevation.plist

# 3. Wipe the install. Customer data roots stay where they are.
rm -rf ~/elevateos
rm -rf ~/.elevate/elevation

# 4. (Optional) If pm2 startup was configured in INSTALL step 15 and you want
#    to remove it entirely, see `pm2 unstartup`. Skip this if the same Mac
#    runs other PM2 apps you want to keep.
```

## Verify rollback

```bash
pm2 status                          # should not list elevation agents or dashboard
ls ~/.elevate/elevation 2>&1      # "No such file or directory"
ls "$ELEVATE_TOOLS_ROOT" 2>/dev/null # optional, external tools root remains untouched
```

## When to roll back

- First-pass install failed and you want a clean slate before retrying.
- The customer decides not to continue with ElevateOS — existing launchd jobs and external skills keep running unchanged.
- Tier 2 introduces a breaking change and you want to start the new install from zero.

## What rollback does NOT touch

- Customer data roots and external tools directories configured through `orgs/<org>/config.json`.
- `~/.claude/` — Claude Code config and any shared MCP servers.
- Homebrew packages installed for prerequisites (`pm2`, `cloudflared`, `jq`).
- Cloudflare tunnel registration on the Cloudflare side. If you want the named tunnel removed from Cloudflare's side too, run `cloudflared tunnel delete elevateos-elevation`.
