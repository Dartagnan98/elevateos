import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, openSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { createServer } from 'net';
import { randomBytes } from 'crypto';
import { CLI_NAME, PRODUCT_NAME, buildRuntimeEnv, getStateRoot } from '../utils/elevate.js';

const IS_WINDOWS = platform() === 'win32';

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        let val = trimmed.slice(idx + 1);
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[trimmed.slice(0, idx)] = val;
      }
    }
  } catch { /* ignore */ }
  return result;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findOpenPort(startPort: number): Promise<number | null> {
  for (let port = startPort; port < startPort + 25 && port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

function openBrowser(url: string): void {
  const { spawn } = require('child_process');
  const command = process.platform === 'darwin'
    ? { bin: 'open', args: [url] }
    : process.platform === 'win32'
      ? { bin: 'cmd', args: ['/c', 'start', '', url] }
      : { bin: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.bin, command.args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Browser launch is best-effort; the URL is printed either way.
  }
}

export const dashboardCommand = new Command('dashboard')
  .option('--port <port>', 'Port to run dashboard on', '3000')
  .option('--instance <id>', 'Instance ID', 'default')
  .option('--build', 'Build for production first (recommended for Cloudflare Tunnel / remote access)')
  .option('--install', 'Install dashboard dependencies first')
  .option('--open', 'Open the dashboard in your browser after launch')
  .description(`Start the ${PRODUCT_NAME} dashboard (Next.js)`)
  .action(async (options: { port: string; instance: string; build?: boolean; install?: boolean; open?: boolean }) => {
    const { execSync, spawn } = require('child_process');

    // Find dashboard directory
    const dashboardDir = findDashboardDir();
    if (!dashboardDir) {
      console.error('Dashboard not found. Expected at ./dashboard or in node_modules.');
      process.exit(1);
    }

    // ─── Load / generate dashboard credentials ────────────────────────────────

    const ctxRoot = getStateRoot(options.instance);
    const dashEnvPath = join(ctxRoot, 'dashboard.env');
    mkdirSync(ctxRoot, { recursive: true });

    let dashCreds: Record<string, string> = {};
    if (existsSync(dashEnvPath)) {
      dashCreds = parseEnvFile(dashEnvPath);
    }

    // Auth secret: env > dashboard.env > auto-generate
    let authSecret = process.env.AUTH_SECRET || dashCreds['AUTH_SECRET'];
    if (!authSecret) {
      authSecret = randomBytes(32).toString('hex');
      console.log('\n  AUTH_SECRET not set — generating one automatically.');
      // Persist it so future runs don't regenerate
      dashCreds['AUTH_SECRET'] = authSecret;
      dashCreds['ADMIN_USERNAME'] = dashCreds['ADMIN_USERNAME'] || 'admin';
      if (!dashCreds['ADMIN_PASSWORD']) {
        dashCreds['ADMIN_PASSWORD'] = randomBytes(12).toString('hex');
        console.log(`  Generated admin credentials saved to: ${dashEnvPath}`);
        console.log(`  (View password with: cat ${dashEnvPath})`);
      }
      const content = Object.entries(dashCreds).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      writeFileSync(dashEnvPath, content, 'utf-8');
      try { chmodSync(dashEnvPath, 0o600); } catch { /* ignore on Windows */ }
    }

    // Admin password: env > dashboard.env > hard fail
    const adminPassword = process.env.ADMIN_PASSWORD || dashCreds['ADMIN_PASSWORD'];
    if (!adminPassword) {
      console.error('\nERROR: ADMIN_PASSWORD is not set.');
      console.error(`Run: ${CLI_NAME} install  (auto-generates dashboard credentials)`);
      console.error(`Or set ADMIN_PASSWORD in your environment or ${dashEnvPath}`);
      process.exit(1);
    }

    const adminUsername = process.env.ADMIN_USERNAME || dashCreds['ADMIN_USERNAME'] || 'admin';

    let selectedPort: number;
    try {
      selectedPort = parsePort(options.port);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const openPort = await findOpenPort(selectedPort);
    if (!openPort) {
      console.error(`No open dashboard port found between ${selectedPort} and ${selectedPort + 24}.`);
      process.exit(1);
    }
    if (openPort !== selectedPort) {
      console.log(`\n  Port ${selectedPort} is busy — using ${openPort} instead.`);
      selectedPort = openPort;
    }
    const port = String(selectedPort);

    // ─── Install dashboard deps ───────────────────────────────────────────────

    if (options.install || !existsSync(join(dashboardDir, 'node_modules'))) {
      console.log('\nInstalling dashboard dependencies...');
      try {
        execSync('npm install', { cwd: dashboardDir, stdio: 'inherit', timeout: 120000 });
      } catch (err) {
        console.error('Failed to install dashboard dependencies:', err);
        process.exit(1);
      }
    }

    // ─── Build for production (required for tunnel / remote access) ──────────

    if (options.build) {
      console.log('\nBuilding dashboard for production...');
      try {
        execSync('npm run build', { cwd: dashboardDir, stdio: 'inherit', timeout: 300000,
          env: { ...process.env, AUTH_SECRET: authSecret, ADMIN_PASSWORD: adminPassword,
                 ADMIN_USERNAME: adminUsername,
                 ELEVATE_ROOT: ctxRoot,
                 ELEVATE_FRAMEWORK_ROOT: process.cwd(),
                 ELEVATE_INSTANCE_ID: options.instance,
                 CTX_ROOT: ctxRoot,
                 CTX_FRAMEWORK_ROOT: process.cwd(),
                 CTX_INSTANCE_ID: options.instance } });
      } catch (err) {
        console.error('Dashboard build failed:', err);
        process.exit(1);
      }
    }

    // ─── Build .env.local so Next.js can pick up vars ─────────────────────────

    const nextEnvPath = join(dashboardDir, '.env.local');
    const nextEnvLines = [
      `# AUTO-GENERATED by ${CLI_NAME} dashboard. To change credentials, edit:`,
      `# ${join(ctxRoot, 'dashboard.env')}`,
      `AUTH_SECRET=${authSecret}`,
      `AUTH_TRUST_HOST=true`,
      `ADMIN_USERNAME=${adminUsername}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `ELEVATE_ROOT=${ctxRoot}`,
      `ELEVATE_FRAMEWORK_ROOT=${process.cwd()}`,
      `ELEVATE_INSTANCE_ID=${options.instance}`,
      `CTX_ROOT=${ctxRoot}`,
      `CTX_FRAMEWORK_ROOT=${process.cwd()}`,
      `CTX_INSTANCE_ID=${options.instance}`,
      `PORT=${port}`,
    ];
    writeFileSync(nextEnvPath, nextEnvLines.join('\n') + '\n', 'utf-8');
    try { chmodSync(nextEnvPath, 0o600); } catch { /* ignore on Windows */ }

    // ─── Start server ─────────────────────────────────────────────────────────

    const dashEnv = {
      ...buildRuntimeEnv({
        instanceId: options.instance,
        stateRoot: ctxRoot,
        frameworkRoot: process.cwd(),
      }),
      PORT: port,
      AUTH_SECRET: authSecret,
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword,
      AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || 'true',
    };

    const startMode = options.build ? 'start' : 'dev';
    const startArgs = startMode === 'start'
      ? ['next', 'start', '--port', port]
      : ['next', 'dev', '--port', port];

    const dashboardUrl = `http://localhost:${port}`;
    console.log(`\nDashboard starting on ${dashboardUrl}`);
    console.log(`  Admin username: ${adminUsername}`);
    console.log(`  Admin credentials: ${dashEnvPath}`);
    console.log(`  (View password with: cat ${dashEnvPath})`);
    if (options.build) {
      console.log('  Mode: production');
    } else {
      console.log('  Mode: dev (use --build for production/tunnel use)');
    }
    console.log('');

    // Route child stdout/stderr to a survivable log file instead of the
    // TTY. With stdio:'inherit', TTY close tears down the pipe and any
    // child write fails; with detached+unref the child stays alive past
    // the parent, so the log file is the only record it can produce.
    const logDir = join(ctxRoot, 'logs', 'dashboard');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'dashboard.log');
    const logFd = openSync(logPath, 'a');

    // On Windows, npx is a .cmd wrapper requiring shell resolution.
    // Pass as single string to avoid Node.js DEP0190 deprecation warning.
    const child = IS_WINDOWS
      ? spawn(['npx', ...startArgs].join(' '), { cwd: dashboardDir, stdio: ['ignore', logFd, logFd], env: dashEnv, shell: true, detached: true })
      : spawn('npx', startArgs, { cwd: dashboardDir, stdio: ['ignore', logFd, logFd], env: dashEnv, detached: true });

    // Detach the child from our event loop so parent exit does not take
    // it down. SIGHUP at the parent (tty close) then just terminates the
    // parent cleanly; the detached child keeps serving.
    child.unref();

    console.log(`  Log: ${logPath}`);
    console.log(`  PID: ${child.pid}`);
    if (options.open) {
      setTimeout(() => openBrowser(dashboardUrl), 1500);
    }

    child.on('error', (err: Error) => {
      console.error('Failed to start dashboard:', err.message);
      process.exit(1);
    });

    // SIGHUP (tty close) — exit the parent quietly. The detached child
    // is already independent of our process group.
    process.on('SIGHUP', () => { process.exit(0); });

    // SIGINT/SIGTERM on the parent are operator-initiated foreground
    // stops; forward them to the child so the foreground dashboard command
    // in the foreground still behaves like a regular `npm run dev`
    // under Ctrl-C.
    const forwardAndExit = (sig: NodeJS.Signals) => {
      try { child.kill(sig); } catch { /* already dead */ }
      process.exit(0);
    };
    process.on('SIGINT', () => forwardAndExit('SIGINT'));
    process.on('SIGTERM', () => forwardAndExit('SIGTERM'));
  });

function findDashboardDir(): string | null {
  const candidates = [
    join(process.cwd(), 'dashboard'),
    join(__dirname, '..', '..', 'dashboard'),
    join(process.cwd(), 'node_modules', 'elevateos', 'dashboard'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return null;
}
