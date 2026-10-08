import { api } from '../document/instance';
import { friendlyAuthError, supabase, useAuthStore } from './auth';
import { describeMissing, passwordIsAcceptable } from './passwordPolicy';
import { useWorkspaceStore } from '../workspace/workspaceStore';

/** Account changes made from Settings. Each one throws an Error with a message a person can act on. */
export const MAX_NAME_LENGTH = 60;

function client() {
  const sb = supabase();
  if (!sb) throw new Error('Account changes are not available in this build.');
  return sb;
}

export const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

/** Change the name shown in the app. The session is refreshed so the server sees the new name straight away. */
export async function updateDisplayName(raw: string): Promise<string> {
  const name = cleanName(raw);
  if (!name) throw new Error('Enter a name.');
  const sb = client();
  const { error } = await sb.auth.updateUser({ data: { full_name: name, name } });
  if (error) throw new Error(friendlyAuthError(error.message));
  await sb.auth.refreshSession();
  const user = useWorkspaceStore.getState().user;
  if (user) useWorkspaceStore.setState({ user: { ...user, displayName: name } });
  return name;
}

/** Prove who is asking (sign in again with the current password), then set the new one. */
export async function changePassword(current: string, next: string): Promise<void> {
  const email = useAuthStore.getState().email;
  if (!email) throw new Error('You are not signed in.');
  if (!current) throw new Error('Enter your current password.');
  if (!passwordIsAcceptable(next)) throw new Error(describeMissing(next));
  if (next === current) throw new Error('Choose a password that is different from the current one.');
  const sb = client();
  const check = await sb.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error(/invalid login/i.test(check.error.message) ? 'The current password is not right.' : friendlyAuthError(check.error.message));
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/** Ask Supabase to change the sign-in email. It sends a confirmation link to the new address; nothing changes until it is followed. */
export async function changeEmail(current: string, nextRaw: string): Promise<string> {
  const email = useAuthStore.getState().email;
  const next = nextRaw.trim().toLowerCase();
  if (!email) throw new Error('You are not signed in.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) throw new Error('Enter a valid email address.');
  if (next === email.toLowerCase()) throw new Error('That is already your email address.');
  if (!current) throw new Error('Enter your current password.');
  const sb = client();
  const check = await sb.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error(/invalid login/i.test(check.error.message) ? 'The current password is not right.' : friendlyAuthError(check.error.message));
  const { error } = await sb.auth.updateUser({ email: next }, { emailRedirectTo: window.location.origin });
  if (error) throw new Error(friendlyAuthError(error.message));
  return next;
}

/** Sign out everywhere else; this device stays signed in. */
export async function signOutOtherSessions(): Promise<void> {
  const { error } = await client().auth.signOut({ scope: 'others' });
  if (error) throw new Error(friendlyAuthError(error.message));
}

export const AVATAR_SIDE = 256;
const ACCEPTED = /^image\/(png|jpeg|webp)$/;

/** Crop to a centred square, shrink to 256 px and re-encode as JPEG in the browser, so uploads are small and never carry the original file's extras. */
export async function prepareAvatar(file: File): Promise<{ contentType: 'image/jpeg'; data: string }> {
  if (!ACCEPTED.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (file.size > 10 * 1024 * 1024) throw new Error('That picture is too large. Choose one under 10 MB.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That picture could not be read.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIDE;
  canvas.height = AVATAR_SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Pictures are not available in this browser.');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { contentType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export async function uploadAvatar(file: File): Promise<void> {
  const { contentType, data } = await prepareAvatar(file);
  const { updatedAt } = await api.saveAvatar(contentType, data);
  const user = useWorkspaceStore.getState().user;
  if (user) useWorkspaceStore.setState({ user: { ...user, avatarUpdatedAt: updatedAt } });
  avatarCache.url = `data:${contentType};base64,${data}`;
  avatarCache.stamp = updatedAt;
  avatarListeners.forEach((l) => l());
}

export async function removeAvatar(): Promise<void> {
  await api.removeAvatar();
  const user = useWorkspaceStore.getState().user;
  if (user) useWorkspaceStore.setState({ user: { ...user, avatarUpdatedAt: null } });
  avatarCache.url = null;
  avatarCache.stamp = null;
  avatarListeners.forEach((l) => l());
}

/** The picture is fetched once per change (keyed by its stamp from /me) and kept in memory as a data URL. */
export const avatarCache: { url: string | null; stamp: string | null } = { url: null, stamp: null };
export const avatarListeners = new Set<() => void>();

export async function loadAvatar(stamp: string | null): Promise<string | null> {
  if (!stamp) return null;
  if (avatarCache.stamp === stamp && avatarCache.url) return avatarCache.url;
  const pic = await api.avatar();
  avatarCache.url = `data:${pic.contentType};base64,${pic.data}`;
  avatarCache.stamp = pic.updatedAt;
  return avatarCache.url;
}

/** Whether this person signs in with an email and password (so they have one to change), as opposed to Google only. */
export async function hasPasswordLogin(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.auth.getUser();
  const providers = (data.user?.app_metadata?.['providers'] as string[] | undefined) ?? [];
  return providers.includes('email');
}
