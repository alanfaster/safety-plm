import { sb } from './config.js';

export async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/** Guard: redirect to login if not authenticated */
export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}
