/**
 * REST helper that attaches the current session's access token.
 * The token is issued when a session is created or joined by code.
 */
const SESSION_TOKEN_HEADER = 'x-session-token';

let sessionToken: string | null = null;

export function setSessionToken(token: string | null | undefined): void {
  sessionToken = token || null;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionToken && !headers.has(SESSION_TOKEN_HEADER)) {
    headers.set(SESSION_TOKEN_HEADER, sessionToken);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...init, headers });
}

export function postJson(path: string, body?: unknown): Promise<Response> {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

/** Short random id used to make transcript retries idempotent on the server. */
export function newClientId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return rand.replace(/[^A-Za-z0-9_-]/g, '');
}
