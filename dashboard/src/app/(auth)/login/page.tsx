'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SplashScreen } from '@/components/layout/splash-screen';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);

  // CSRF token strategy: fetch once, hold in a ref, inject on submit.
  // React state bound with value={csrfToken} and imperative writes via
  // querySelector both fail — React reconciliation resets uncontrolled
  // input values between the useEffect completion and the next render, so
  // the hidden input never carries the real token at submit time. The
  // hidden input in the JSX below is a placeholder; the real token is put
  // on the request body in handleSubmit().
  const csrfTokenRef = useRef<string>('');
  const [csrfReady, setCsrfReady] = useState(false);

  const refreshCsrfToken = useCallback(async () => {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json();
    const token = data?.csrfToken;
    if (!token) {
      console.error('[login] /api/auth/csrf returned no token', data);
      return '';
    }
    csrfTokenRef.current = token;
    setCsrfReady(true);
    return token;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await refreshCsrfToken();
        if (cancelled) return;
        if (!token) setCsrfReady(false);
      } catch (err) {
        console.error('[login] csrf fetch failed:', err);
        if (!cancelled) setCsrfReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCsrfToken]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // POST the credentials callback ourselves with an
    // application/x-www-form-urlencoded body. NextAuth's CSRF validator
    // reads the csrfToken field from urlencoded bodies; a multipart/form-data
    // body (what `new FormData()` produces) fails with MissingCSRF because
    // the parser doesn't recover the token from the multipart stream.
    // Bypassing signIn() from next-auth/react lets us control the exact body.
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = e.currentTarget;
    const usernameInput = form.querySelector('input[name="username"]') as HTMLInputElement | null;
    const passwordInput = form.querySelector('input[name="password"]') as HTMLInputElement | null;

    const csrfToken = await refreshCsrfToken();
    if (!csrfToken) {
      setError('Could not prepare sign-in. Please try again.');
      setLoading(false);
      return;
    }

    const body = new URLSearchParams();
    body.set('csrfToken', csrfToken);
    body.set('username', usernameInput?.value.trim() || '');
    body.set('password', passwordInput?.value || '');
    body.set('callbackUrl', '/');

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Ask Auth.js to return the redirect target as JSON instead of
          // issuing a 302. This avoids tunneled/mobile browsers following a
          // proxy-derived localhost callback URL.
          'X-Auth-Return-Redirect': '1',
        },
        body: body.toString(),
        credentials: 'same-origin',
        redirect: 'manual',
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json().catch(() => null) as { url?: string } | null;
        if (data?.url) {
          const target = new URL(data.url, window.location.origin);
          const code = target.searchParams.get('error');
          if (target.pathname.startsWith('/login') || code) {
            const msg = code === 'CallbackRouteError'
              ? 'Too many attempts. Please wait a few minutes and try again.'
              : code === 'CredentialsSignin'
                ? 'Invalid username or password.'
                : `Sign-in failed: ${code || 'Unknown'}`;
            setError(msg);
            setLoading(false);
            return;
          }
          const callbackParam = new URL(window.location.href).searchParams.get('callbackUrl');
          const safeTarget = callbackParam && callbackParam.startsWith('/') && !callbackParam.startsWith('//') ? callbackParam : '/';
          window.location.href = safeTarget;
          return;
        }
      }
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        window.location.href = '/';
        return;
      }
      if (res.redirected) {
        const target = new URL(res.url);
        if (target.pathname.startsWith('/login')) {
          const code = target.searchParams.get('error') || 'Unknown';
          // CallbackRouteError usually means the rate limiter blocked the request.
          // Show a human-readable message instead of the raw error code.
          const msg = code === 'CallbackRouteError'
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : `Sign-in failed: ${code}`;
          setError(msg);
          setLoading(false);
          return;
        }
        // Navigate to the original destination the user tried to reach, or /
        // if none was recorded. Use window.location.origin to build a safe
        // relative-only target — res.url can be http://localhost:3000/ behind
        // a reverse proxy (when AUTH_URL is not set), which would send the
        // browser to the wrong host.
        const callbackParam = new URL(window.location.href).searchParams.get('callbackUrl');
        // Validate same-origin: must start with / but not // (which is a protocol-relative URL)
        const safeTarget = callbackParam && callbackParam.startsWith('/') && !callbackParam.startsWith('//') ? callbackParam : '/';
        window.location.href = safeTarget;
        return;
      }
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      setError(`Sign-in failed with status ${res.status}`);
      setLoading(false);
    } catch (err) {
      console.error('[login] submit error:', err);
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  // Splash just needs to stay visible long enough - navigation happens in parallel
  const handleSplashComplete = useCallback(() => {
    // No-op: navigation already started above
  }, []);

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
    <div className={`relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 ${showSplash ? 'invisible' : ''}`}>
      <div aria-hidden className="absolute inset-x-0 top-0 h-[42vh] bg-primary" />
      <div aria-hidden className="absolute inset-x-0 top-[42vh] h-1 bg-warning" />
      <div className="relative z-10 w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2 text-primary-foreground">
          <div className="mx-auto flex h-20 w-64 items-center justify-center rounded-xl bg-white px-5 shadow-[0_18px_42px_-22px_rgba(16,24,39,0.55)] dark:bg-white/10 dark:ring-1 dark:ring-white/15">
            <Image
              src="/elevateos-wordmark.png"
              alt="ElevateOS"
              width={300}
              height={100}
              priority
              className="h-auto w-full object-contain dark:hidden"
            />
            <Image
              src="/elevateos-wordmark-dark.png"
              alt="ElevateOS"
              width={300}
              height={100}
              priority
              className="hidden h-auto w-full object-contain dark:block"
            />
          </div>
          <p className="text-sm text-primary-foreground/75">
            Real estate operating system
          </p>
        </div>

        {/* Login Card */}
        <Card className="border border-border bg-card shadow-[0_24px_70px_-42px_rgba(27,42,74,0.62)] ring-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-bold text-primary">Sign in</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Enter your credentials to access the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} method="POST" action="/api/auth/callback/credentials" className="space-y-4" suppressHydrationWarning>
              <input type="hidden" name="csrfToken" defaultValue="" suppressHydrationWarning />
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-semibold text-foreground">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  spellCheck={false}
                  placeholder="admin"
                  className="bg-background/80"
                  suppressHydrationWarning
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="current-password"
                  spellCheck={false}
                  placeholder="Enter password"
                  className="bg-background/80"
                  suppressHydrationWarning
                />
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <Button type="submit" className="h-10 w-full bg-primary font-bold hover:bg-[#121D35]" disabled={loading || !csrfReady}>
                {loading ? 'Signing in...' : csrfReady ? 'Sign In' : 'Loading…'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] font-medium text-primary/55">
          ElevateOS v1
        </p>
      </div>
    </div>
    </>
  );
}
