import { homedir } from 'os';
import { join } from 'path';

export const PRODUCT_NAME = 'ElevateOS';
export const AGENT_NAME = 'Elevate Agent';
export const CLI_NAME = 'elevateos';
export const STATE_DIR_NAME = '.elevate';
export const DEFAULT_INSTANCE_ID = 'default';
export const PM2_DAEMON_NAME = 'elevate-daemon';
export const PM2_DASHBOARD_NAME = 'elevate-dashboard';
export const TUNNEL_NAME_BASE = 'elevateos';
export const TUNNEL_PLIST_LABEL = 'com.elevateos.tunnel';

export function getInstanceId(fallback: string = DEFAULT_INSTANCE_ID): string {
  return process.env.ELEVATE_INSTANCE_ID || process.env.CTX_INSTANCE_ID || fallback;
}

export function getStateRoot(instanceId: string = getInstanceId()): string {
  return process.env.ELEVATE_ROOT || process.env.CTX_ROOT || join(homedir(), STATE_DIR_NAME, instanceId);
}

export function getFrameworkRoot(fallback: string = process.cwd()): string {
  return (
    process.env.ELEVATE_FRAMEWORK_ROOT ||
    process.env.CTX_FRAMEWORK_ROOT ||
    process.env.CTX_PROJECT_ROOT ||
    fallback
  );
}

export function getTunnelName(instanceId: string = getInstanceId()): string {
  return `${TUNNEL_NAME_BASE}-${instanceId}`;
}

export function getTunnelPlistLabel(instanceId: string = getInstanceId()): string {
  return `${TUNNEL_PLIST_LABEL}.${instanceId}`;
}

export function buildRuntimeEnv(options: {
  instanceId: string;
  stateRoot: string;
  frameworkRoot: string;
  org?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELEVATE_INSTANCE_ID: options.instanceId,
    ELEVATE_ROOT: options.stateRoot,
    ELEVATE_FRAMEWORK_ROOT: options.frameworkRoot,
    CTX_INSTANCE_ID: options.instanceId,
    CTX_ROOT: options.stateRoot,
    CTX_FRAMEWORK_ROOT: options.frameworkRoot,
    CTX_PROJECT_ROOT: options.frameworkRoot,
  };

  if (options.org) {
    env.ELEVATE_ORG = options.org;
    env.CTX_ORG = options.org;
  }

  return env;
}
