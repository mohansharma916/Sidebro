/**
 * Browsers on the user's own machine or local network may call the API; arbitrary websites may not.
 * Extra origins can be allowed with CORS_ORIGINS (comma separated).
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (curl, tests, server-to-server) send no Origin header.
  if (!origin) return true;

  const extra = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;

  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    host = url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }

  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}
