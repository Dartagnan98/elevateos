// ElevateOS Dashboard - Auth proxy
// Checks for next-auth session cookie; redirects to /login if missing.
// Cannot import auth.ts directly because it chains to better-sqlite3,
// which is not available in the Edge Runtime.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getToken } from 'next-auth/jwt';

// Allowed CORS origins - localhost dev + configured deployment URL + mobile app
// Built once at module load: env-derived origins are validated via `new URL()`,
// malformed values are dropped with a warning, and wildcards are explicitly rejected.
function buildAllowedOrigins(): string[] {
  const staticOrigins = ['http://localhost:3000', 'http://localhost:3001'];
  const envCandidates: Array<[string, string | undefined]> = [
    ['NEXTAUTH_URL', process.env.NEXTAUTH_URL],
    ['DASHBOARD_URL', process.env.DASHBOARD_URL],
    ['MOBILE_APP_ORIGIN', process.env.MOBILE_APP_ORIGIN],
  ];

  const validated: string[] = [];
  for (const [name, raw] of envCandidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed === '*') {
      console.warn(
        `[middleware] Ignoring wildcard CORS origin from ${name}; wildcards are not allowed.`,
      );
      continue;
    }
    try {
      validated.push(new URL(trimmed).origin);
    } catch {
      console.warn(
        `[middleware] Ignoring malformed CORS origin from ${name}: ${JSON.stringify(raw)}`,
      );
    }
  }

  return Array.from(new Set([...staticOrigins, ...validated]));
}

const ALLOWED_ORIGINS: string[] = buildAllowedOrigins();
const PUBLIC_FILE = /\.(?:avif|gif|ico|jpg|jpeg|png|svg|webp)$/i;
const SESSION_COOKIE_NAME = 'authjs.session-token';
const SECURE_SESSION_COOKIE_NAME = '__Secure-authjs.session-token';

function getAllowedOrigin(requestOrigin: string | null): string | null {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return null;
}

function hasCookie(request: NextRequest, cookieName: string): boolean {
  return request.cookies.getAll().some((cookie) => (
    cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`)
  ));
}

function authMisconfiguredResponse(corsOrigin: string) {
  const res = NextResponse.json(
    { error: 'Server misconfiguration: auth secret not configured' },
    { status: 500 },
  );
  res.headers.set('Access-Control-Allow-Origin', corsOrigin);
  res.headers.set('Vary', 'Origin');
  return res;
}

async function hasVerifiedSessionCookie(
  request: NextRequest,
  authSecret: string | undefined,
  corsOrigin: string,
): Promise<{ ok: boolean; response?: NextResponse }> {
  const candidateCookieNames = [SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME]
    .filter((name) => hasCookie(request, name));

  if (candidateCookieNames.length === 0) {
    return { ok: false };
  }
  if (!authSecret) {
    console.error('[proxy] CRITICAL: Session cookie presented but AUTH_SECRET/NEXTAUTH_SECRET is unset.');
    return { ok: false, response: authMisconfiguredResponse(corsOrigin) };
  }

  for (const cookieName of candidateCookieNames) {
    const token = await getToken({
      req: request,
      secret: authSecret,
      cookieName,
    });
    if (token) return { ok: true };
  }

  return { ok: false };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestOrigin = request.headers.get('origin');
  const corsOrigin = getAllowedOrigin(requestOrigin) ?? 'null';

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  // Allow public paths
  // Security (H7): SSE endpoints require ?token=<jwt> auth — removed from public whitelist
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    (!pathname.startsWith('/api/') && PUBLIC_FILE.test(pathname))
  ) {
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
    response.headers.set('Vary', 'Origin');
    return response;
  }

  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

  // Check for a verified NextAuth session token (web dashboard). A cookie name
  // alone is not enough; forged cookies must fail before hitting API handlers.
  const sessionCookie = await hasVerifiedSessionCookie(request, authSecret, corsOrigin);
  if (sessionCookie.response) {
    return sessionCookie.response;
  }
  const hasSession = sessionCookie.ok;

  // Check for Bearer token (mobile app)
  const authHeader = request.headers.get('Authorization');
  let hasBearerToken = false;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token.length > 0) {
      // Security (H6): Verify JWT signature — presence-only check bypassed by any string.
      if (!authSecret) {
        console.error(
          '[proxy] CRITICAL: Bearer token presented but AUTH_SECRET/NEXTAUTH_SECRET is unset. Refusing request.',
          { pathname, method: request.method },
        );
        return authMisconfiguredResponse(corsOrigin);
      }
      try {
        const secret = new TextEncoder().encode(authSecret);
        await jwtVerify(token, secret);
        hasBearerToken = true;
      } catch {
        hasBearerToken = false;
      }
    }
  }

  if (!hasSession && !hasBearerToken) {
    // For API routes, return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      res.headers.set('Access-Control-Allow-Origin', corsOrigin);
      res.headers.set('Vary', 'Origin');
      return res;
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', corsOrigin);
  response.headers.set('Vary', 'Origin');
  // Standard security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
