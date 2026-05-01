import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CLI_NAME, PRODUCT_NAME, getStateRoot, getTunnelName, getTunnelPlistLabel } from '../utils/elevate.js';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

function supportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => parseInt(part, 10));
  return major > 20 || (major === 20 && minor >= 19);
}

export const doctorCommand = new Command('doctor')
  .option('--instance <id>', 'Instance ID', 'default')
  .description('Diagnose common issues')
  .action(async (options: { instance: string }) => {
    console.log(`\n${PRODUCT_NAME} Doctor\n`);

    const checks: Check[] = [];

    // Check Node.js version
    const nodeVersion = process.version;
    const nodeOk = supportedNode(nodeVersion);
    checks.push({
      name: 'Node.js version',
      status: nodeOk ? 'pass' : 'fail',
      message: `${nodeVersion} ${nodeOk ? '(OK)' : '(requires 20.19+)'}`,
      fix: !nodeOk ? 'Install Node.js 20.19+ from https://nodejs.org, then reinstall dependencies' : undefined,
    });

    // Check PM2
    try {
      const pm2Version = execSync('pm2 --version', { encoding: 'utf-8' }).trim();
      checks.push({
        name: 'PM2',
        status: 'pass',
        message: `v${pm2Version}`,
      });
    } catch {
      checks.push({
        name: 'PM2',
        status: 'warn',
        message: 'Not installed',
        fix: 'Install with: npm install -g pm2',
      });
    }

    // Check Claude Code CLI
    try {
      const claudeVersion = execSync('claude --version', { encoding: 'utf-8', timeout: 5000 }).trim();
      checks.push({
        name: 'Claude Code CLI',
        status: 'pass',
        message: claudeVersion,
      });
    } catch {
      checks.push({
        name: 'Claude Code CLI',
        status: 'fail',
        message: 'Not found',
        fix: 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
      });
    }

    // Check node-pty
    try {
      require('node-pty');
      checks.push({
        name: 'node-pty',
        status: 'pass',
        message: 'Native module loaded',
      });
    } catch {
      checks.push({
        name: 'node-pty',
        status: 'fail',
        message: 'Failed to load native module',
        fix: process.platform === 'win32'
          ? 'Install "Desktop development with C++" workload from Visual Studio Build Tools (https://visualstudio.microsoft.com/visual-cpp-build-tools/), then run: npm rebuild node-pty'
          : 'Install build tools: xcode-select --install (macOS) or apt install build-essential (Linux)',
      });
    }

    // Fix spawn-helper permissions (Unix only)
    if (process.platform !== 'win32') {
      const prebuildsDir = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
      const buildRelease = join(process.cwd(), 'node_modules', 'node-pty', 'build', 'Release');
      let permFixed = false;

      // Fix permissions on all spawn-helper binaries
      for (const dir of [prebuildsDir, buildRelease]) {
        if (!existsSync(dir)) continue;
        try {
          const entries = dir === prebuildsDir ? readdirSync(dir) : ['.'];
          for (const entry of entries) {
            const helperPath = dir === prebuildsDir
              ? join(dir, entry, 'spawn-helper')
              : join(dir, 'spawn-helper');
            if (existsSync(helperPath)) {
              const mode = statSync(helperPath).mode;
              if ((mode & 0o111) === 0) {
                chmodSync(helperPath, 0o755);
                permFixed = true;
              }
            }
          }
        } catch { /* skip */ }
      }

      if (permFixed) {
        checks.push({
          name: 'node-pty spawn-helper',
          status: 'warn',
          message: 'Permissions were missing - fixed automatically',
        });
      }
    }

    // Actual spawn test (cross-platform)
    try {
      const pty = require('node-pty');
      let output = '';
      const isWin = process.platform === 'win32';
      const smokeCmd = isWin ? 'cmd.exe' : '/bin/echo';
      const smokeArgs = isWin ? ['/c', 'echo', 'pty-ok'] : ['pty-ok'];
      const p = pty.spawn(smokeCmd, smokeArgs, { name: 'xterm-256color', cols: 80, rows: 24 });
      await new Promise<void>((resolve, reject) => {
        p.onData((data: string) => { output += data; });
        p.onExit(({ exitCode }: { exitCode: number }) => {
          if (exitCode === 0 && output.includes('pty-ok')) resolve();
          else reject(new Error(`exit ${exitCode}`));
        });
        setTimeout(() => reject(new Error('timed out')), 5000);
      });
      checks.push({
        name: 'node-pty spawn test',
        status: 'pass',
        message: 'Can spawn processes',
      });
    } catch (err) {
      checks.push({
        name: 'node-pty spawn test',
        status: 'fail',
        message: `Cannot spawn processes: ${(err as Error).message}`,
        fix: 'Try: npm rebuild node-pty',
      });
    }

    // Check state directory
    const ctxRoot = getStateRoot(options.instance);
    checks.push({
      name: 'State directory',
      status: existsSync(ctxRoot) ? 'pass' : 'warn',
      message: existsSync(ctxRoot) ? ctxRoot : 'Not found',
      fix: !existsSync(ctxRoot) ? `Run: ${CLI_NAME} init <org-name>` : undefined,
    });

    // Check Claude Code auth
    try {
      execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' });
      checks.push({ name: 'Claude Code auth', status: 'pass', message: 'Authenticated' });
    } catch {
      checks.push({
        name: 'Claude Code auth',
        status: 'warn',
        message: 'Not authenticated',
        fix: 'Run: claude login',
      });
    }

    // ── Tunnel checks (macOS only) ──────────────────────────────────────
    if (process.platform === 'darwin') {
      // cloudflared installed?
      try {
        const cfVer = execSync('cloudflared --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }).trim();
        checks.push({ name: 'cloudflared', status: 'pass', message: cfVer });
      } catch {
        checks.push({
          name: 'cloudflared',
          status: 'warn',
          message: 'Not installed',
          fix: 'Install with: brew install cloudflared',
        });
      }

      // Cloudflare auth cert
      const cfCert = join(homedir(), '.cloudflared', 'cert.pem');
      checks.push({
        name: 'Cloudflare auth',
        status: existsSync(cfCert) ? 'pass' : 'warn',
        message: existsSync(cfCert) ? 'Authenticated (cert.pem found)' : 'Not authenticated',
        fix: !existsSync(cfCert) ? 'Run: cloudflared login' : undefined,
      });

      // Tunnel exists?
      let tunnelExists = false;
      try {
        const listOut = execSync('cloudflared tunnel list --output json', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 10000,
        });
        const tunnels: Array<{ name: string }> = JSON.parse(listOut);
        tunnelExists = tunnels.some((t) => t.name === getTunnelName(options.instance));
      } catch { /* not authenticated or cloudflared not installed */ }
      checks.push({
        name: `Tunnel '${getTunnelName(options.instance)}'`,
        status: tunnelExists ? 'pass' : 'warn',
        message: tunnelExists ? 'Exists' : 'Not created',
        fix: !tunnelExists ? `Run: ${CLI_NAME} tunnel start --instance ${options.instance} --hostname dashboard.example.com` : undefined,
      });

      // launchd service running?
      let serviceRunning = false;
      try {
        serviceRunning = spawnSync('launchctl', ['list', getTunnelPlistLabel(options.instance)], { stdio: 'pipe' }).status === 0;
      } catch { /* launchctl not available */ }
      checks.push({
        name: 'Tunnel service (launchd)',
        status: serviceRunning ? 'pass' : 'warn',
        message: serviceRunning ? 'Running' : 'Not running',
        fix: !serviceRunning ? `Run: ${CLI_NAME} tunnel start --instance ${options.instance}` : undefined,
      });

      // Tunnel URL saved?
      const tunnelConfigPath = join(getStateRoot(options.instance), 'tunnel.json');
      let tunnelUrl: string | undefined;
      try {
        const tc = JSON.parse(readFileSync(tunnelConfigPath, 'utf-8'));
        tunnelUrl = tc.tunnelUrl;
      } catch { /* no config yet */ }
      checks.push({
        name: 'Tunnel URL',
        status: tunnelUrl ? 'pass' : 'warn',
        message: tunnelUrl ?? 'Not set',
        fix: !tunnelUrl ? `Run: ${CLI_NAME} tunnel start --instance ${options.instance} --hostname dashboard.example.com` : undefined,
      });
    }

    // Check gh CLI (needed for community publishing --contribute)
    try {
      const ghVersion = execSync('gh --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }).trim().split('\n')[0];
      checks.push({ name: 'gh CLI', status: 'pass', message: ghVersion });
    } catch {
      checks.push({
        name: 'gh CLI',
        status: 'warn',
        message: 'Not installed',
        fix: 'Install with: brew install gh (macOS) or https://cli.github.com',
      });
    }

    // Check upstream git remote (needed for check-upstream and community --contribute)
    const frameworkRoot = process.cwd();
    if (existsSync(join(frameworkRoot, '.git'))) {
      try {
        execSync('git remote get-url upstream', { encoding: 'utf-8', stdio: 'pipe', cwd: frameworkRoot });
        checks.push({ name: 'upstream remote', status: 'pass', message: 'Configured' });
      } catch {
        checks.push({
          name: 'upstream remote',
          status: 'warn',
          message: 'Not configured',
          fix: 'Run: git remote add upstream <canonical-upstream-repo-url>',
        });
      }
    }

    // Check community/catalog.json (needed for browse-catalog and install-community-item)
    const catalogPath = join(frameworkRoot, 'community', 'catalog.json');
    checks.push({
      name: 'community/catalog.json',
      status: existsSync(catalogPath) ? 'pass' : 'warn',
      message: existsSync(catalogPath) ? 'Found' : 'Not found',
      fix: !existsSync(catalogPath) ? `Run: ${CLI_NAME} bus check-upstream --apply to fetch the latest catalog` : undefined,
    });

    // Check GEMINI_API_KEY for Knowledge Base (semantic search / RAG)
    const orgsDir = join(frameworkRoot, 'orgs');
    let geminiConfigured = false;
    let geminiOrgFound = false;
    if (existsSync(orgsDir)) {
      try {
        for (const org of readdirSync(orgsDir)) {
          const secretsPath = join(orgsDir, org, 'secrets.env');
          if (existsSync(secretsPath)) {
            geminiOrgFound = true;
            const content = readFileSync(secretsPath, 'utf-8');
            if (/^GEMINI_API_KEY=.+/m.test(content)) {
              geminiConfigured = true;
              break;
            }
          }
        }
      } catch { /* ignore scan errors */ }
    }
    if (geminiOrgFound) {
      checks.push({
        name: 'Knowledge Base (GEMINI_API_KEY)',
        status: geminiConfigured ? 'pass' : 'warn',
        message: geminiConfigured ? 'Configured' : 'Not set — semantic search and RAG disabled',
        fix: !geminiConfigured ? 'Add GEMINI_API_KEY to orgs/<org>/secrets.env — get a free key at https://aistudio.google.com/app/apikey' : undefined,
      });
    }

    // Display results
    let hasFailures = false;
    for (const check of checks) {
      const icon = check.status === 'pass' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
      const prefix = `  [${icon}]`;
      console.log(`${prefix.padEnd(10)} ${check.name}: ${check.message}`);
      if (check.fix) {
        console.log(`           Fix: ${check.fix}`);
      }
      if (check.status === 'fail') hasFailures = true;
    }

    const warnCount = checks.filter(c => c.status === 'warn').length;
    const failCount = checks.filter(c => c.status === 'fail').length;

    console.log('');
    if (failCount > 0) {
      console.log(`  ${failCount} check(s) failed. Fix the issues above and run doctor again.\n`);
      process.exit(1);
    } else if (warnCount > 0) {
      console.log(`  All critical checks passed, ${warnCount} warning(s). See above for details.\n`);
    } else {
      console.log('  All checks passed.\n');
    }
  });
