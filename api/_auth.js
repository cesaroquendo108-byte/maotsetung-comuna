const PB_URL = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL || '';

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
  const requestOrigin = `${protocol}://${req.headers.host || ''}`;
  if (origin === requestOrigin) return true;
  const allowed = String(process.env.APP_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return true;
}

export function allowPost(req, res) {
  if (!applyCors(req, res)) {
    json(res, 403, { error: 'Origen no autorizado.' });
    return false;
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return false;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    json(res, 405, { error: 'Método no permitido.' });
    return false;
  }
  return true;
}

export function allowGet(req, res) {
  if (!applyCors(req, res)) {
    json(res, 403, { error: 'Origen no autorizado.' });
    return false;
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(204).end();
    return false;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    json(res, 405, { error: 'Método no permitido.' });
    return false;
  }
  return true;
}

export async function authenticate(req) {
  if (!PB_URL) throw Object.assign(new Error('PocketBase no está configurado en el servidor.'), { status: 503 });
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Inicia sesión para continuar.'), { status: 401 });

  const response = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: authorization },
  });
  if (!response.ok) throw Object.assign(new Error('La sesión venció. Entra de nuevo.'), { status: 401 });
  const auth = await response.json();
  return { token: authorization.slice(7), user: auth.record };
}

export async function getMembership(auth, idNumber, { ownHouseholdOnly = false, ownResidentOnly = false, communityId = '' } = {}) {
  const headers = { Authorization: `Bearer ${auth.token}` };
  const normalizedCommunityId = String(communityId || '').trim();
  if (normalizedCommunityId && !/^[a-z0-9]{15}$/i.test(normalizedCommunityId)) {
    throw Object.assign(new Error('La comunidad seleccionada no es válida.'), { status: 400 });
  }
  const communityScope = normalizedCommunityId ? ` && community = "${normalizedCommunityId}"` : '';
  const membershipFilter = encodeURIComponent(`user = "${auth.user.id}" && status = "active"${communityScope}`);
  const membershipResponse = await fetch(`${PB_URL}/api/collections/community_memberships/records?perPage=1&filter=${membershipFilter}`, { headers });
  if (!membershipResponse.ok) throw Object.assign(new Error('No existe una membresía activa.'), { status: 403 });
  const memberships = await membershipResponse.json();
  const membership = memberships.items?.[0];
  if (!membership) throw Object.assign(new Error('No existe una membresía activa.'), { status: 403 });

  const normalizedId = String(idNumber || '').replace(/\D/g, '');
  if (!normalizedId) throw Object.assign(new Error('La cédula no es válida.'), { status: 400 });
  if (ownHouseholdOnly && !membership.household) throw Object.assign(new Error('Tu cuenta no tiene un hogar vinculado para esta consulta.'), { status: 403 });
  if (ownResidentOnly) {
    if (!membership.resident) {
      throw Object.assign(new Error('Tu cuenta aún no está vinculada a una identidad residente verificada.'), { status: 403 });
    }
    const residentResponse = await fetch(`${PB_URL}/api/collections/residents/records/${membership.resident}`, { headers });
    if (!residentResponse.ok) throw Object.assign(new Error('No tienes permiso para consultar esa identidad.'), { status: 403 });
    const resident = await residentResponse.json();
    const residentIdNumber = String(resident.idNumber || '').replace(/\D/g, '');
    if (
      residentIdNumber !== normalizedId
      || resident.status !== 'active'
      || resident.community !== membership.community
      || resident.household !== membership.household
    ) {
      throw Object.assign(new Error('La cédula no corresponde a la identidad verificada de tu cuenta.'), { status: 403 });
    }
    return { membership, resident };
  }
  const scope = !ownHouseholdOnly && (membership.role === 'admin' || membership.role === 'collaborator')
    ? `community = "${membership.community}"`
    : `household = "${membership.household}"`;
  const residentFilter = encodeURIComponent(`${scope} && idNumberNormalized = "${normalizedId}" && status = "active"`);
  const residentResponse = await fetch(`${PB_URL}/api/collections/residents/records?perPage=1&filter=${residentFilter}`, { headers });
  if (!residentResponse.ok) throw Object.assign(new Error('No tienes permiso para consultar esa persona.'), { status: 403 });
  const residents = await residentResponse.json();
  const resident = residents.items?.[0];
  if (!resident) throw Object.assign(new Error('La cédula no pertenece a un registro visible para tu cuenta.'), { status: 403 });
  return { membership, resident };
}

export { PB_URL };
