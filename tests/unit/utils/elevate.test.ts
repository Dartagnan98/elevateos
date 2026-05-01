import { describe, expect, it } from 'vitest';
import {
  getTunnelName,
  getTunnelPlistLabel,
  TUNNEL_NAME_BASE,
  TUNNEL_PLIST_LABEL,
} from '../../../src/utils/elevate.js';

describe('ElevateOS utility naming', () => {
  it('derives per-instance Cloudflare tunnel names', () => {
    expect(getTunnelName('elevation')).toBe(`${TUNNEL_NAME_BASE}-elevation`);
  });

  it('derives per-instance launchd labels', () => {
    expect(getTunnelPlistLabel('elevation')).toBe(`${TUNNEL_PLIST_LABEL}.elevation`);
  });
});
