import type { AppUser } from '@/lib/types';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type AuthSession = {
  token?: string;
  user: AppUser;
  expiresAt: number;
  issuedAt: number;
};

let currentSession: AuthSession | null = null;

export function createSession(user: AppUser, token?: string, expiresAt?: number): AuthSession {
  const issuedAt = Date.now();
  const sessionExpiresAt = expiresAt ?? issuedAt + SESSION_TTL_MS;

  currentSession = {
    token,
    user,
    expiresAt: sessionExpiresAt,
    issuedAt,
  };

  return currentSession;
}

export function getSession(): AuthSession | null {
  if (!currentSession) {
    return null;
  }

  if (Date.now() >= currentSession.expiresAt) {
    currentSession = null;
    return null;
  }

  return currentSession;
}

export function clearSession() {
  currentSession = null;
}

export function hasValidSession() {
  return !!getSession();
}
