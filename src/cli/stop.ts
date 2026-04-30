import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { IPCClient } from '../daemon/ipc-server.js';
import { CLI_NAME, PM2_DAEMON_NAME, getStateRoot } from '../utils/elevate.js';

/**
 * BUG-036 fix: write a `.user-stop` marker before the agent's PTY is killed,
 * so the SessionEnd crash-alert hook (src/hooks/hook-crash-alert.ts) knows
 * the stop was intentional and does not fire a false 🚨 CRASH alarm.
 * Pattern matches src/cli/bus.ts:1285-1289.
 */
export function writeStopMarker(instanceId: string, agent: string, reason: string): void {
  try {
    const ctxRoot = getStateRoot(instanceId);
    const stateDir = join(ctxRoot, 'state', agent);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, '.user-stop'), reason);
  } catch { /* don't block stop on marker-write failure */ }
}

export const stopCommand = new Command('stop')
  .argument('[agent]', 'Agent name to stop. Omit and pass --all to stop every running agent.')
  .option('--instance <id>', 'Instance ID', 'default')
  .option('--all', 'Stop every running agent (required when no agent name is given)')
  .description(`Stop a running agent. Use --all to stop every agent. Does NOT stop the daemon process itself — use \`pm2 stop ${PM2_DAEMON_NAME}\` for that.`)
  .action(async (agent: string | undefined, options: { instance: string; all?: boolean }) => {
    // Safety: refuse to stop the entire fleet unless the user explicitly opted in.
    if (!agent && !options.all) {
      console.error('Refusing to stop all agents without an explicit target.');
      console.error('');
      console.error(`  To stop one agent:    ${CLI_NAME} stop <agent>`);
      console.error(`  To stop every agent:  ${CLI_NAME} stop --all`);
      console.error(`  To stop the daemon:   pm2 stop ${PM2_DAEMON_NAME}`);
      console.error('');
      console.error(`(Previously \`${CLI_NAME} stop\` with no argument silently stopped every running agent. That behavior was a foot-gun and now requires --all.)`);
      process.exit(2);
    }

    if (agent && options.all) {
      console.error('Error: pass either an agent name or --all, not both.');
      process.exit(2);
    }

    const ipc = new IPCClient(options.instance);
    const daemonRunning = await ipc.isDaemonRunning();

    if (!daemonRunning) {
      console.log('Daemon is not running.');
      return;
    }

    if (agent) {
      console.log(`Stopping agent: ${agent}`);
      writeStopMarker(options.instance, agent, `stopped via ${CLI_NAME} stop`);
      const response = await ipc.send({ type: 'stop-agent', agent, source: `${CLI_NAME} stop` });
      if (response.success) {
        console.log(`  ${response.data}`);
      } else {
        console.error(`  Error: ${response.error}`);
        process.exit(1);
      }
      return;
    }

    // options.all === true
    console.log('Stopping all agents...');
    const listResponse = await ipc.send({ type: 'list-agents', source: `${CLI_NAME} stop --all` });
    if (!listResponse.success) {
      console.error(`  Error listing agents: ${listResponse.error}`);
      process.exit(1);
    }
    const agents = listResponse.data as string[];
    if (agents.length === 0) {
      console.log('  No agents are running.');
      return;
    }
    for (const a of agents) {
      writeStopMarker(options.instance, a, `stopped via ${CLI_NAME} stop --all`);
      const response = await ipc.send({ type: 'stop-agent', agent: a, source: `${CLI_NAME} stop --all` });
      console.log(`  ${a}: ${response.success ? 'stopped' : response.error}`);
    }
    console.log(`\nAll agents stopped. The daemon is still running. To stop it: pm2 stop ${PM2_DAEMON_NAME}`);
  });
