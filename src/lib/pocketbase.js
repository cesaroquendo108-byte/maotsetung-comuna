import PocketBase from 'pocketbase';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const PRODUCTION_PB_URL = 'https://pb-maotsetung.157.173.104.214.nip.io';
const PRODUCTION_WEB_URL = 'https://maotsetung-comuna.vercel.app';

const env = (typeof import.meta !== 'undefined' && import.meta?.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});

export const PB_URL = env?.VITE_POCKETBASE_URL
  || (env?.DEV ? 'http://127.0.0.1:8090' : PRODUCTION_PB_URL);
export const API_BASE = env?.VITE_API_BASE
  || (Capacitor.isNativePlatform() ? PRODUCTION_WEB_URL : '');
export const DEMO_ENABLED = env?.VITE_DEMO_MODE !== 'false';

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

export default pb;

export function currentUser() {
  return pb.authStore.isValid ? pb.authStore.model : null;
}

export function logout() {
  pb.authStore.clear();
}

export async function getLoginAvailability() {
  try {
    const methods = await pb.collection('users').listAuthMethods();
    const google = Boolean(methods?.oauth2?.enabled && methods.oauth2.providers?.some((provider) => provider.name === 'google'));
    return { google, password: Boolean(methods?.password?.enabled) };
  } catch {
    return { google: null, password: null };
  }
}

export async function login(email, password) {
  const auth = await pb.collection('users').authWithPassword(String(email).trim(), password);
  return auth.record;
}

export async function registerWithPassword({ email, password, passwordConfirm, name }) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const pass = String(password || '');
  const passConfirm = String(passwordConfirm || pass);

  if (!cleanEmail) throw new Error('Introduce un correo electronico valido.');
  if (pass.length < 8) throw new Error('La contrasena debe tener al menos 8 caracteres.');
  if (pass !== passConfirm) throw new Error('Las contrasenas no coinciden.');

  try {
    const res = await fetch(`${API_BASE}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: pass, passwordConfirm: passConfirm, name: cleanName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || data?.message || 'No se pudo crear la cuenta.');
    }
  } catch (apiErr) {
    if (apiErr?.message && !apiErr.message.includes('fetch')) {
      throw apiErr;
    }
    await pb.collection('users').create({
      email: cleanEmail,
      password: pass,
      passwordConfirm: passConfirm,
      name: cleanName,
    });
  }

  return login(cleanEmail, pass);
}

export async function requestPasswordReset(email) {
  return pb.collection('users').requestPasswordReset(String(email).trim());
}

export async function loginGoogle() {
  const isNative = Capacitor.isNativePlatform();
  try {
    const auth = await pb.collection('users').authWithOAuth2({
      provider: 'google',
      ...(isNative ? { urlCallback: async (url) => Browser.open({ url }) } : {}),
    });
    if (isNative) {
      try { await Browser.close(); } catch { /* La pestaña ya pudo cerrarse. */ }
    }
    return auth.record;
  } catch (error) {
    if (isNative) {
      try { await Browser.close(); } catch { /* noop */ }
    }
    const message = String(error?.message || '');
    if (/realtime connection interrupted|browserFinished|cancel/i.test(message)) {
      throw new Error('La autenticación con Google fue cancelada o cerrada.');
    }
    if (/providers|oauth2|undefined|something went wrong|failed to authenticate/i.test(message)) {
      throw new Error('No se pudo completar el acceso con Google. Entra con correo y contraseña o explora la demo.');
    }
    throw error;
  }
}
