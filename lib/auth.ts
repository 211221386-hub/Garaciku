import type { AppUser } from '@/lib/types';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type AuthSession = {
  token?: string;
  user: AppUser;
  expiresAt: number;
  issuedAt: number;
};

let currentSession: AuthSession | null = null;
const SESSION_STORAGE_KEY = 'garaciku.auth.session';

function loadStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored) as AuthSession : null;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function createSession(user: AppUser, token?: string, expiresAt?: number): AuthSession {
  const issuedAt = Date.now();
  const sessionExpiresAt = expiresAt ?? issuedAt + SESSION_TTL_MS;

  currentSession = {
    token,
    user,
    expiresAt: sessionExpiresAt,
    issuedAt,
  };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentSession));
  }

  return currentSession;
}

export function getSession(): AuthSession | null {
  if (!currentSession) {
    currentSession = loadStoredSession();
  }

  if (!currentSession) {
    return null;
  }

  if (Date.now() >= currentSession.expiresAt) {
    clearSession();
    return null;
  }

  return currentSession;
}

export function clearSession() {
  currentSession = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function hasValidSession() {
  return !!getSession();
}
