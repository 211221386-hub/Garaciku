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

function getBrowserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

function loadStoredSession(): AuthSession | null {
  const storage = getBrowserStorage();
  if (!storage) return null;

  try {
    const stored = storage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored) as AuthSession : null;
  } catch {
    try { storage.removeItem(SESSION_STORAGE_KEY); } catch {}
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

  try { getBrowserStorage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentSession)); } catch {}

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
  try { getBrowserStorage()?.removeItem(SESSION_STORAGE_KEY); } catch {}
}

export function hasValidSession() {
  return !!getSession();
}
