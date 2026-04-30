import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CLI_NAME, PRODUCT_NAME, TUNNEL_NAME_BASE, getStateRoot } from '../utils/elevate.js';

const CLOUDFLARED_CERT = join(homedir(), '.cloudflared', 'cert.pem');
const CLOUDFLARED_CONFIG = join(homedir(), '.cloudflared', 'config.yaml');

interface TunnelConfig {
  tunnelId?: string;
  tunnelName?: string;
  tunnelUrl?: string;
  port?: number;
  createdAt?: string;
}

function getTunnelName(instance: string): string {
  return `${TUNNEL_NAME_BASE}-${instance}`;
}

function getPlistLabel(instance: string): string {
  return `com.elevateos.tunnel.${instance}`;
}

function getPlistPath(instance: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${getPlistLabel(instance)}.plist`);
}

function getTunnelConfigPath(instance: string): string {
  return join(getStateRoot(instance), 'tunnel.json');
}

function readTunnelConfig(instance: string): TunnelConfig {
  try {
    return JSON.parse(readFileSync(getTunnelConfigPath(instance), 'utf-8'));
  } catch {
    return {};
  }
}

function writeTunnelConfig(instance: string, config: TunnelConfig): void {
  const configPath = getTunnelConfigPath(instance);
  mkdirSync(getStateRoot(instance), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function checkPlatform(): void {
  if (process.platform !== 'darwin') {
    console.error(`  ${CLI_NAME} tunnel requires macOS (uses launchd for persistence).`);
    console.error(`  On Linux/Windows, run cloudflared manually: cloudflared tunnel run ${TUNNEL_NAME_BASE}-<instance>`);
    process.exit(1);
  }
}

function checkCloudflared(): string {
  try {
    const version = execSync('cloudflared --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }).trim();
    return version;
  } catch {
    console.error('  cloudflared is not installed.');
    console.error('  Install with: brew install cloudflared');
    process.exit(1);
  }
}

function checkAuth(): void {
  if (!existsSync(CLOUDFLARED_CERT)) {
    console.error('  Not authenticated with Cloudflare.');
    console.error('  Run: cloudflared login');
    console.error(`  Then re-run: ${CLI_NAME} tunnel start`);
    process.exit(1);
  }
}

function getCloudflaredPath(): string {
  // Prefer `which cloudflared` (honours user PATH), fall back to common Homebrew locations
  try {
    const fromWhich = execSync('which cloudflared', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (fromWhich) return fromWhich;
  } catch { /* fall through to candidates */ }

  const candidates = [
    '/opt/homebrew/bin/cloudflared', // Apple Silicon
    '/usr/local/bin/cloudflared',    // Intel Mac
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      console.warn(`  warning: cloudflared not on PATH — falling back to ${p}`);
      return p;
    }
  }
  console.warn('  warning: cloudflared not found on PATH or in common install locations');
  return 'cloudflared';
}

function detectNodePath(): string {
  // process.execPath is the absolute path to the current node binary — most reliable.
  try {
    return join(process.execPath, '..').replace(/\/$/, '');
  } catch {
    return '/usr/local/bin';
  }
}

function detectCloudflaredPath(): string {
  try {
    const cfPath = execSync('which cloudflared', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (cfPath) return join(cfPath, '..').replace(/\/$/, '');
  } catch { /* fall through */ }
  const candidates = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'];
  for (const p of candidates) {
    if (existsSync(p)) {
      console.warn(`  warning: cloudflared not on PATH — falling back to ${join(p, '..')}`);
      return join(p, '..').replace(/\/$/, '');
    }
  }
  console.warn('  warning: cloudflared directory not found — defaulting to /opt/homebrew/bin');
  return '/opt/homebrew/bin';
}

interface CloudflaredTunnel {
  id: string;
  name: string;
  deleted_at?: string;
}

interface CloudflaredCreateOutput {
  id: string;
  name: string;
}

function findExistingTunnel(instance: string): CloudflaredTunnel | null {
  const tunnelName = getTunnelName(instance);
  try {
    const output = execSync('cloudflared tunnel list --output json', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    });
    const tunnels: CloudflaredTunnel[] = JSON.parse(output);
    // Filter out deleted tunnels — reuse only active ones
    return tunnels.find((t) => t.name === tunnelName && !t.deleted_at) ?? null;
  } catch {
    return null;
  }
}

function createTunnel(instance: string): CloudflaredTunnel {
  const tunnelName = getTunnelName(instance);
  let output = '';
  try {
    output = execSync(`cloudflared tunnel create --output json ${tunnelName}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (err) {
    console.error('  Failed to create tunnel:', err);
    process.exit(1);
  }
  try {
    const created: CloudflaredCreateOutput = JSON.parse(output);
    return { id: created.id, name: created.name };
  } catch {
    // JSON parse failed — fall back to listing
    const tunnel = findExistingTunnel(instance);
    if (!tunnel) {
      console.error('  Tunnel was created but could not be found in list. Try running again.');
      process.exit(1);
    }
    return tunnel;
  }
}

function writeCloudflaredConfig(tunnelId: string, port: number): void {
  const credFile = join(homedir(), '.cloudflared', `${tunnelId}.json`);
  const config = [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credFile}`,
    `ingress:`,
    `  - service: http://localhost:${port}`,
  ].join('\n') + '\n';
  writeFileSync(CLOUDFLARED_CONFIG, config, 'utf-8');
}

function writePlist(instance: string, port: number): void {
  const cfPath = getCloudflaredPath();
  const nodeBinDir = detectNodePath();
  const cfBinDir = detectCloudflaredPath();
  const tunnelName = getTunnelName(instance);
  const plistLabel = getPlistLabel(instance);
  const plistPath = getPlistPath(instance);
  const ctxRoot = getStateRoot(instance);
  const logDir = join(ctxRoot, 'logs', 'tunnel');

  mkdirSync(logDir, { recursive: true });

  const launchdPath = [
    nodeBinDir,
    cfBinDir,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .join(':');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plistLabel}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${cfPath}</string>
        <string>tunnel</string>
        <string>--no-autoupdate</string>
        <string>run</string>
        <string>${tunnelName}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>30</integer>

    <key>StandardOutPath</key>
    <string>${logDir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${logDir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${homedir()}</string>
        <key>PATH</key>
        <string>${launchdPath}</string>
        <key>ELEVATE_ROOT</key>
        <string>${ctxRoot}</string>
        <key>CTX_ROOT</key>
        <string>${ctxRoot}</string>
    </dict>
</dict>
</plist>
`;

  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(plistPath, plist, 'utf-8');
  chmodSync(plistPath, 0o644);
}

function isServiceLoaded(instance: string): boolean {
  // `launchctl list <label>` exits 0 if service is registered (loaded), non-zero otherwise
  const result = spawnSync('launchctl', ['list', getPlistLabel(instance)], { stdio: 'pipe' });
  return result.status === 0;
}

function getUid(): string {
  try {
    return execSync('id -u', { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return String(process.getuid ? process.getuid() : 501);
  }
}

function loadService(instance: string): void {
  // Bootout first in case of stale registration, then bootstrap fresh
  const uid = getUid();
  const plistLabel = getPlistLabel(instance);
  const plistPath = getPlistPath(instance);
  spawnSync('launchctl', ['bootout', `gui/${uid}/${plistLabel}`], { stdio: 'pipe' });
  spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'pipe' });

  // Try modern bootstrap (macOS 10.10+, preferred on Sonoma)
  const result = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    // Fallback to legacy load for older macOS
    const legacyResult = spawnSync('launchctl', ['load', '-w', plistPath], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    if (legacyResult.status !== 0) {
      throw new Error(`Failed to load service: ${legacyResult.stderr || legacyResult.stdout}`);
    }
  }
}

function unloadService(instance: string): void {
  const uid = getUid();
  const plistLabel = getPlistLabel(instance);
  const plistPath = getPlistPath(instance);

  // Try modern bootout first (macOS 10.10+)
  const result = spawnSync('launchctl', ['bootout', `gui/${uid}/${plistLabel}`], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    // Fallback to legacy unload
    spawnSync('launchctl', ['unload', '-w', plistPath], { stdio: 'pipe' });
  }
}

// ─── Sub-commands ─────────────────────────────────────────────────────────────

const startCommand = new Command('start')
  .option('--instance <id>', 'Instance ID', 'default')
  .option('--port <port>', 'Dashboard port', '3000')
  .description('Create (or reuse) the Cloudflare tunnel and start it as a launchd service')
  .action(async (options: { instance: string; port: string }) => {
    const port = parseInt(options.port, 10);
    const tunnelName = getTunnelName(options.instance);
    const plistPath = getPlistPath(options.instance);

    checkPlatform();
    console.log(`\n${PRODUCT_NAME} Tunnel\n`);

    // 1. Check cloudflared installed
    const version = checkCloudflared();
    console.log(`  cloudflared: ${version}`);

    // 2. Check auth
    checkAuth();
    console.log(`  Cloudflare auth: OK`);

    // 3. Find or create tunnel
    let tunnel = findExistingTunnel(options.instance);
    if (tunnel) {
      console.log(`  Tunnel: ${tunnel.name} (${tunnel.id}) — reusing existing`);
    } else {
      console.log(`  Creating tunnel '${tunnelName}'...`);
      tunnel = createTunnel(options.instance);
      console.log(`  Tunnel: ${tunnel.name} (${tunnel.id}) — created`);
    }

    const tunnelUrl = `https://${tunnel.id}.cfargotunnel.com`;

    // 4. Write cloudflared config.yaml
    writeCloudflaredConfig(tunnel.id, port);
    console.log(`  Config: ${CLOUDFLARED_CONFIG}`);

    // 5. Write launchd plist
    writePlist(options.instance, port);
    console.log(`  Plist: ${plistPath}`);

    // 6. Load launchd service
    if (isServiceLoaded(options.instance)) {
      console.log(`  Service: already running — reloading`);
    }
    loadService(options.instance);
    console.log(`  Service: loaded (auto-starts on login)`);

    // 7. Wait briefly for tunnel to connect, then health-check
    console.log(`  Waiting for tunnel to connect...`);
    let connected = false;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = execSync('curl -sf http://localhost:20241/ready', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 3000,
        });
        if (res.includes('OK') || res.trim() === '') {
          connected = true;
          break;
        }
      } catch { /* not ready yet */ }
    }
    if (connected) {
      console.log(`  Tunnel: connected to Cloudflare edge`);
    } else {
      console.log(`  Tunnel: service started (health check timed out — may still be connecting)`);
    }

    // 8. Persist tunnel config
    writeTunnelConfig(options.instance, {
      tunnelId: tunnel.id,
      tunnelName: tunnel.name,
      tunnelUrl,
      port,
      createdAt: new Date().toISOString(),
    });

    console.log(`\n  Dashboard URL: ${tunnelUrl}`);
    console.log(`  TUNNEL_URL saved to: ${getTunnelConfigPath(options.instance)}\n`);
    console.log(`  The tunnel will restart automatically after reboot.`);
    console.log(`  Start the dashboard with: ${CLI_NAME} dashboard\n`);
  });

const stopCommand = new Command('stop')
  .option('--instance <id>', 'Instance ID', 'default')
  .description('Stop the Cloudflare tunnel launchd service')
  .action(async (options: { instance: string }) => {
    checkPlatform();
    const plistPath = getPlistPath(options.instance);

    if (!existsSync(plistPath)) {
      console.log(`  Tunnel service is not installed. Run: ${CLI_NAME} tunnel start`);
      return;
    }

    if (!isServiceLoaded(options.instance)) {
      console.log('  Tunnel service is not running.');
      return;
    }

    unloadService(options.instance);
    console.log('  Tunnel service stopped.');
    console.log(`  (The tunnel config is preserved — run \`${CLI_NAME} tunnel start\` to restart)\n`);
  });

const statusCommand = new Command('status')
  .option('--instance <id>', 'Instance ID', 'default')
  .description('Show tunnel URL and running status')
  .action(async (options: { instance: string }) => {
    checkPlatform();
    console.log(`\n${PRODUCT_NAME} Tunnel Status\n`);

    // cloudflared installed?
    let cfVersion = 'not installed';
    try {
      cfVersion = execSync('cloudflared --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }).trim();
    } catch { /* noop */ }
    console.log(`  cloudflared: ${cfVersion}`);

    // Auth?
    console.log(`  Cloudflare auth: ${existsSync(CLOUDFLARED_CERT) ? 'OK' : 'not authenticated (run: cloudflared login)'}`);

    // Tunnel exists?
    const tunnelName = getTunnelName(options.instance);
    const tunnel = findExistingTunnel(options.instance);
    console.log(`  Tunnel '${tunnelName}': ${tunnel ? `exists (${tunnel.id})` : 'not created'}`);

    // Service running?
    const running = isServiceLoaded(options.instance);
    console.log(`  Service (launchd): ${running ? 'running' : 'stopped'}`);

    // Saved config
    const config = readTunnelConfig(options.instance);
    if (config.tunnelUrl) {
      console.log(`  Dashboard URL: ${config.tunnelUrl}`);
    } else {
      console.log(`  Dashboard URL: not set (run: ${CLI_NAME} tunnel start)`);
    }

    if (config.createdAt) {
      console.log(`  Tunnel created: ${new Date(config.createdAt).toLocaleString()}`);
    }

    console.log('');
  });

const urlCommand = new Command('url')
  .option('--instance <id>', 'Instance ID', 'default')
  .description('Print the tunnel URL (for scripting)')
  .action(async (options: { instance: string }) => {
    const config = readTunnelConfig(options.instance);
    if (!config.tunnelUrl) {
      console.error(`No tunnel URL found. Run: ${CLI_NAME} tunnel start`);
      process.exit(1);
    }
    process.stdout.write(config.tunnelUrl + '\n');
  });

// ─── Parent command ───────────────────────────────────────────────────────────

export const tunnelCommand = new Command('tunnel')
  .description('Manage Cloudflare tunnel for persistent dashboard access')
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(statusCommand)
  .addCommand(urlCommand);

// Default action: run start when `elevate tunnel` is called with no subcommand
tunnelCommand.action(async () => {
  await startCommand.parseAsync([], { from: 'user' });
});
