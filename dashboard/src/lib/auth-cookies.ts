export function useSecureAuthCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.AUTH_SECURE_COOKIES ?? env.NEXTAUTH_SECURE_COOKIES;
  if (explicit) {
    return explicit === 'true' || explicit === '1';
  }

  const url = env.AUTH_URL ?? env.NEXTAUTH_URL ?? env.DASHBOARD_URL;
  if (!url) return false;

  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
