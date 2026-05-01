import { describe, it, expect, afterEach } from 'vitest';
import { AgentPTY } from '../../../src/pty/agent-pty.js';
import type { AgentConfig, CtxEnv } from '../../../src/types/index.js';

const mockEnv: CtxEnv = {
  instanceId: 'test',
  ctxRoot: '/tmp/ctx',
  frameworkRoot: '/tmp/fw',
  agentName: 'claude-agent',
  agentDir: '/tmp/fw/orgs/acme/agents/claude-agent',
  org: 'acme',
  projectRoot: '/tmp/fw',
};

class TestAgentPTY extends AgentPTY {
  args(mode: 'fresh' | 'continue', prompt: string): string[] {
    return this.buildClaudeArgs(mode, prompt);
  }
}

function makePty(config: AgentConfig = {}) {
  return new TestAgentPTY(mockEnv, config);
}

afterEach(() => {
  delete process.env.ELEVATE_DANGEROUSLY_SKIP_PERMISSIONS;
  delete process.env.CTX_DANGEROUSLY_SKIP_PERMISSIONS;
});

describe('AgentPTY', () => {
  it('does not bypass Claude permissions by default', () => {
    const args = makePty().args('fresh', 'start');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).toEqual(['start']);
  });

  it('allows permission bypass only when explicitly configured', () => {
    const args = makePty({ dangerously_skip_permissions: true }).args('fresh', 'start');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('preserves model selection while leaving permissions gated', () => {
    const args = makePty({ model: 'claude-sonnet-4-5' }).args('continue', 'resume');
    expect(args).toEqual(['--continue', '--model', 'claude-sonnet-4-5', 'resume']);
  });

  it('keeps the legacy env override as an explicit escape hatch', () => {
    process.env.ELEVATE_DANGEROUSLY_SKIP_PERMISSIONS = '1';
    const args = makePty().args('fresh', 'start');
    expect(args).toContain('--dangerously-skip-permissions');
  });
});
