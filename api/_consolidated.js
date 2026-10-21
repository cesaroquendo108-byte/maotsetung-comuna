import { authenticate, allowGet, allowPost, json, PB_URL } from './_auth.js';

let serviceTokenPromise;

export { authenticate, json, PB_URL };

export { allowGet };

export function allowJsonPost(req, res) {
  return allowPost(req, res);
}

export function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { throw Object.assign(new Error('El cuerpo JSON no es válido.'), { status: 400 }); }
}

function encodedFilter(filter) {
  return encodeURIComponent(filter);
}

export async function pbRequest(endpoint, { token, method = 'GET', body, headers = {} } = {}) {
  if (!PB_URL) throw Object.assign(new Error('PocketBase no está configurado en el servidor.'), { status: 503 });
  const response = await fetch(`${PB_URL}${endpoint}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.message || 'PocketBase rechazó la operación.'), { status: response.status, data });
  return data;
}

export async function pbUpload(endpoint, { token, method = 'POST', formData, headers = {} } = {}) {
  if (!PB_URL) throw Object.assign(new Error('PocketBase no está configurado en el servidor.'), { status: 503 });
  const response = await fetch(`${PB_URL}${endpoint}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.message || 'PocketBase rechazó la operación.'), { status: response.status, data });
  return data;
}

export async function serviceToken() {
  if (!serviceTokenPromise) {
    serviceTokenPromise = (async () => {
      const email = process.env.MAOTSETUNG_SERVICE_EMAIL || process.env.UROPROFIN_SERVICE_EMAIL;
      const password = process.env.MAOTSETUNG_SERVICE_PASSWORD || process.env.UROPROFIN_SERVICE_PASSWORD;
      if (!email || !password) throw Object.assign(new Error('El servicio administrativo no está configurado.'), { status: 503 });
      const data = await pbRequest('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email, password } });
      return data.token;
    })().catch((error) => {
      serviceTokenPromise = null;
      throw error;
    });
  }
  return serviceTokenPromise;
}

const communityCache = new Map();

export async function findCommunity({ communityId, communityCode, token }) {
  const cacheKey = `${communityId || ''}:${communityCode || ''}`;
  if (communityCache.has(cacheKey)) {
    return communityCache.get(cacheKey);
  }
  if (communityId && !/^[a-z0-9]{15}$/i.test(communityId)) throw Object.assign(new Error('La comunidad seleccionada no es válida.'), { status: 400 });
  const filter = communityId ? `id = "${communityId}"` : `code = "${String(communityCode || '').trim().toUpperCase().replace(/"/g, '')}"`;
  if (!communityId && !communityCode) throw Object.assign(new Error('Indica la comunidad.'), { status: 400 });
  const data = await pbRequest(`/api/collections/communes/records?perPage=1&filter=${encodedFilter(filter)}`, { token });
  const community = data.items?.[0];
  if (!community) throw Object.assign(new Error('La comunidad no existe.'), { status: 404 });
  communityCache.set(cacheKey, community);
  return community;
}

export async function activeMembership(auth, communityId, roles = []) {
  const roleFilter = roles.length ? ` && (${roles.map((role) => `role = "${role}"`).join(' || ')})` : '';
  const data = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${encodedFilter(`user = "${auth.user.id}" && community = "${communityId}" && status = "active"${roleFilter}`)}`, { token: auth.token });
  const membership = data.items?.[0];
  if (!membership) throw Object.assign(new Error('No tienes una membresía activa para esta comunidad.'), { status: 403 });
  return membership;
}

export function maskSearch(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 4) return '••••';
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
}
