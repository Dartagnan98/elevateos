import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.fn();
const jwtVerifyMock = vi.fn();

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

vi.mock('jose', () => ({
  jwtVerify: jwtVerifyMock,
}));

const { proxy } = await import('../proxy');

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), init);
}

describe('dashboard proxy auth', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
    getTokenMock.mockReset();
    jwtVerifyMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it('rejects forged session cookies instead of trusting cookie presence', async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await proxy(request('/api/tasks', {
      headers: { cookie: 'authjs.session-token=forged' },
    }));

    expect(res.status).toBe(401);
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      secret: 'test-secret',
      cookieName: 'authjs.session-token',
    }));
  });

  it('does not treat API media paths as public static files', async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await proxy(request('/api/media/orgs/acme/preview.png'));

    expect(res.status).toBe(401);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('allows requests with a verified session token', async () => {
    getTokenMock.mockResolvedValue({ sub: '1', name: 'admin' });
    const res = await proxy(request('/api/tasks', {
      headers: { cookie: 'authjs.session-token=valid' },
    }));

    expect(res.status).toBe(200);
  });

  it('still allows verified mobile bearer tokens', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: '1' } });
    const res = await proxy(request('/api/tasks', {
      headers: { authorization: 'Bearer mobile-token' },
    }));

    expect(res.status).toBe(200);
    expect(jwtVerifyMock).toHaveBeenCalled();
  });
});
