import { allowPost, authenticate, json } from './_auth.js';

const PB_URL = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL || '';

async function pbRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.message || 'PocketBase rechazó la operación.'), { status: response.status, data });
  return data;
}

async function serviceToken() {
  const email = process.env.MAOTSETUNG_SERVICE_EMAIL || process.env.MAOTSETUNG_CNE_EMAIL || process.env.UROPROFIN_SERVICE_EMAIL || process.env.UROPROFIN_CNE_EMAIL;
  const password = process.env.MAOTSETUNG_SERVICE_PASSWORD || process.env.MAOTSETUNG_CNE_PASSWORD || process.env.UROPROFIN_SERVICE_PASSWORD || process.env.UROPROFIN_CNE_PASSWORD;
  if (!email || !password) throw Object.assign(new Error('No hay cuenta técnica configurada.'), { status: 503 });
  const auth = await pbRequest('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  return auth.token;
}

async function getAllPages(path, token) {
  const items = [];
  let page = 1;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await pbRequest(`${path}${separator}page=${page}&perPage=200`, { token });
    items.push(...(data.items || []));
    if (page >= Number(data.totalPages || 1)) break;
    page += 1;
  }
  return items;
}

// Children data registry for Comuna Mao Tse Tung
const CHILDREN_DATA = [];

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;
  try {
    if (!PB_URL) return json(res, 503, { error: 'PocketBase no está configurado.' });

    const migrationSecret = process.env.MIGRATION_SECRET;
    const isMigration = Boolean(migrationSecret && req.headers['x-migration-secret'] === migrationSecret);
    let auth = null;
    let communityId = String(req.body?.communityId || '').trim();

    if (!isMigration) {
      auth = await authenticate(req);
      if (!/^[a-z0-9]{15}$/i.test(communityId)) return json(res, 400, { error: 'Comunidad no válida.' });
    }

    const token = await serviceToken();

    // Check admin if not migration
    if (!isMigration) {
      const memberFilter = encodeURIComponent(`user = "${auth.user.id}" && community = "${communityId}" && status = "active" && role = "admin"`);
      const memberData = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${memberFilter}`, { token: auth.token });
      if (!memberData.items?.[0]) return json(res, 403, { error: 'Solo un administrador puede sincronizar niños.' });
    } else {
      // If migration, fetch the first community if communityId is not provided
      if (!communityId) {
        const commData = await pbRequest('/api/collections/communes/records?perPage=1', { token });
        communityId = commData.items?.[0]?.id;
        if (!communityId) return json(res, 400, { error: 'No se encontraron comunas en la base de datos.' });
      }
    }

    // Get first household
    const hhFilter = encodeURIComponent(`community = "${communityId}" && status = "active"`);
    const hhData = await pbRequest(`/api/collections/households/records?perPage=1&filter=${hhFilter}`, { token });
    const householdId = hhData.items?.[0]?.id;
    if (!householdId) return json(res, 400, { error: 'No hay hogares activos.' });

    // Get existing residents
    const existingResidents = await getAllPages(
      `/api/collections/residents/records?filter=${encodeURIComponent(`community = "${communityId}" && status = "active"`)}&fields=id,firstName,lastName`,
      token
    );
    const existingNames = new Set(existingResidents.map(r => `${(r.firstName || '').toUpperCase()}|${(r.lastName || '').toUpperCase()}`));

    let created = 0;
    let skipped = 0;
    const errors = [];
    
    // Si estamos en migración y nos envían un array de personas, lo usamos. Si no, usamos el hardcodeado.
    const peopleToSync = (isMigration && Array.isArray(req.body?.people)) ? req.body.people : CHILDREN_DATA;

    for (const child of peopleToSync) {
      const key = `${child.firstName}|${child.lastName}`;
      if (existingNames.has(key)) { skipped++; continue; }

      try {
        await pbRequest('/api/collections/residents/records', {
          method: 'POST',
          token,
          body: {
            community: communityId,
            household: householdId,
            firstName: child.firstName,
            lastName: child.lastName,
            idNumber: child.cedula || child.idNumber || '',
            nationality: 'V',
            birthDate: child.birthDate || '',
            relationship: child.relationship || child.parentesco || 'Familiar',
            sex: '',
            status: 'active',
          },
        });
        existingNames.add(key);
        created++;
      } catch (e) {
        errors.push(`${child.firstName} ${child.lastName}: ${e.message}`);
      }
    }

    return json(res, 200, {
      success: true,
      message: `Se crearon ${created} personas en el censo. ${skipped} ya existían.${errors.length ? ` ${errors.length} errores.` : ''}`,
      createdCount: created,
      skippedCount: skipped,
      errorCount: errors.length,
      totalSynced: peopleToSync.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudieron sincronizar los registros.' });
  }
}
