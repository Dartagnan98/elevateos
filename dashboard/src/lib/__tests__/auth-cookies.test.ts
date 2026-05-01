import { describe, expect, it } from 'vitest';
import { useSecureAuthCookies } from '../auth-cookies';

describe('useSecureAuthCookies', () => {
  it('keeps local production dashboard cookies usable on http localhost', () => {
    expect(useSecureAuthCookies({ NODE_ENV: 'production' })).toBe(false);
    expect(useSecureAuthCookies({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'http://localhost:3000',
    })).toBe(false);
  });

  it('uses secure cookies for configured https dashboard URLs', () => {
    expect(useSecureAuthCookies({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://dashboard.example.com',
    })).toBe(true);
  });

  it('allows an explicit secure-cookie override', () => {
    expect(useSecureAuthCookies({
      NODE_ENV: 'production',
      AUTH_SECURE_COOKIES: 'true',
    })).toBe(true);
    expect(useSecureAuthCookies({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://dashboard.example.com',
      AUTH_SECURE_COOKIES: 'false',
    })).toBe(false);
  });
});
