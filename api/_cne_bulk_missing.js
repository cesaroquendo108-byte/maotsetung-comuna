import crypto from 'node:crypto';
import { allowPost, authenticate, json, PB_URL } from './_auth.js';
import { lookupElectoralProfile, providerAvailable } from '../server/cneProvider.js';

async function pbRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.message || 'PocketBase rechazo la operacion.'), { status: response.status, data });
  return data;
}

async function serviceToken() {
  const email = process.env.MAOTSETUNG_CNE_EMAIL || process.env.UROPROFIN_CNE_EMAIL || process.env.MAOTSETUNG_SERVICE_EMAIL || process.env.UROPROFIN_SERVICE_EMAIL;
  const password = process.env.MAOTSETUNG_CNE_PASSWORD || process.env.UROPROFIN_CNE_PASSWORD || process.env.MAOTSETUNG_SERVICE_PASSWORD || process.env.UROPROFIN_SERVICE_PASSWORD;
  if (!email || !password) throw Object.assign(new Error('El servicio CNE no tiene una cuenta tecnica configurada.'), { status: 503 });
  const auth = await pbRequest('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  return auth.token;
}

function ageFromBirthDate(value) {
  if (!value) return null;
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  if (now.getMonth() < birthDate.getMonth() || (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

async function getActiveAdminMembership(auth, communityId) {
  const filter = encodeURIComponent(`user = "${auth.user.id}" && community = "${communityId}" && status = "active" && role = "admin"`);
  const data = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${filter}`, { token: auth.token });
  const membership = data.items?.[0];
  if (!membership) throw Object.assign(new Error('Solo un administrador de la comunidad puede ejecutar esta consulta.'), { status: 403 });
  return membership;
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

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;
  try {
    if (!PB_URL) return json(res, 503, { error: 'PocketBase no esta configurado en el servidor.' });
    const { communityId, limit = 20, confirmCommunityConsent } = req.body || {};
    const normalizedCommunityId = String(communityId || '').trim();
    if (!/^[a-z0-9]{15}$/i.test(normalizedCommunityId)) return json(res, 400, { error: 'La comunidad seleccionada no es valida.' });
    if (confirmCommunityConsent !== true) return json(res, 400, { error: 'Confirma que la junta tiene autorizacion para consultar estos registros.' });

    if (!providerAvailable()) {
      return json(res, 503, {
        error: 'La consulta automatica esta desactivada hasta configurar un adaptador CNE autorizado.',
        code: 'CNE_PROVIDER_DISABLED',
      });
    }

    const auth = await authenticate(req);
    await getActiveAdminMembership(auth, normalizedCommunityId);
    const cneToken = await serviceToken();
    const residentFilter = encodeURIComponent(`community = "${normalizedCommunityId}" && status = "active" && idNumber != ""`);
    const profileFilter = encodeURIComponent(`community = "${normalizedCommunityId}"`);
    const [residents, profiles] = await Promise.all([
      getAllPages(`/api/collections/residents/records?filter=${residentFilter}&sort=lastName,firstName&fields=id,firstName,lastName,idNumber,nationality,birthDate,household`, auth.token)
        .then((res) => (res.length ? res : getAllPages(`/api/collections/residents/records?filter=${residentFilter}&sort=lastName,firstName&fields=id,firstName,lastName,idNumber,nationality,birthDate,household`, cneToken))),
      getAllPages(`/api/collections/electoral_profiles/records?filter=${profileFilter}&fields=id,resident,status,votingCenterName`, cneToken)
        .then((res) => (res.length ? res : getAllPages(`/api/collections/electoral_profiles/records?filter=${profileFilter}&fields=id,resident,status,votingCenterName`, auth.token))),
    ]);
    const profileByResident = new Map(profiles.map((profile) => [profile.resident, profile]));
    const withoutBirthDate = residents.filter((resident) => !resident.birthDate).length;
    const knownMinors = residents.filter((resident) => {
      const age = ageFromBirthDate(resident.birthDate);
      return age != null && age < 18;
    }).length;
    const candidates = residents
      .filter((resident) => !profileByResident.has(resident.id) || !resident.birthDate)
      .filter((resident) => {
        const age = ageFromBirthDate(resident.birthDate);
        return age == null || age >= 18;
      })
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));

    const checked = [];
    const failed = [];
    for (const resident of candidates) {
      const consentAt = new Date().toISOString();
      const requestKey = crypto.randomUUID();
      let attempt = null;
      try {
        if (cneToken) {
          attempt = await pbRequest('/api/collections/cne_query_attempts/records', {
            method: 'POST',
            token: cneToken,
            body: {
              community: normalizedCommunityId,
              resident: resident.id,
              actor: auth.user.id,
              consentAt,
              status: 'started',
              provider: process.env.CEDULA_COM_VE_APP_ID ? 'cedula.com.ve' : 'authorized-provider',
              requestKey,
            },
          }).catch(() => null);
        }

        const result = await lookupElectoralProfile(resident);
        const existingProfile = profileByResident.get(resident.id);
        const profilePayload = {
          community: normalizedCommunityId,
          resident: resident.id,
          status: result.status,
          votingCenterName: result.center,
          votingCenterAddress: result.address,
          source: result.source,
          checkedAt: result.checkedAt,
          consentAt,
          checkedBy: auth.user.id,
          providerReference: result.providerReference || result.rif || '',
          errorCode: result.errorCode || '',
        };

        const activeToken = cneToken || auth.token;
        if (existingProfile) {
          await pbRequest(`/api/collections/electoral_profiles/records/${existingProfile.id}`, {
            method: 'PATCH',
            token: activeToken,
            body: profilePayload,
          }).catch(() => null);
        } else {
          await pbRequest('/api/collections/electoral_profiles/records', {
            method: 'POST',
            token: activeToken,
            body: profilePayload,
          }).catch(() => null);
        }

        if (result.birthDate && !resident.birthDate) {
          const patchBody = {
            community: resident.community || normalizedCommunityId,
            household: resident.household,
            birthDate: result.birthDate,
          };
          await pbRequest(`/api/collections/residents/records/${resident.id}`, {
            method: 'PATCH',
            token: auth.token,
            body: patchBody,
          }).catch((err) => {
            console.error(`[bulk-missing] Failed to patch birthDate for resident ${resident.id} with auth.token:`, err);
            return pbRequest(`/api/collections/residents/records/${resident.id}`, {
              method: 'PATCH',
              token: cneToken,
              body: patchBody,
            }).catch(() => null);
          });
        }

        if (attempt?.id && cneToken) {
          await pbRequest(`/api/collections/cne_query_attempts/records/${attempt.id}`, {
            method: 'PATCH',
            token: cneToken,
            body: { status: 'succeeded', completedAt: new Date().toISOString() },
          }).catch(() => null);
        }

        checked.push({
          resident: resident.id,
          name: `${resident.firstName || ''} ${resident.lastName || ''}`.trim(),
          status: result.status,
          center: result.center,
          birthDate: result.birthDate || '',
        });
      } catch (error) {
        console.error(`[bulk-missing] Error querying resident ${resident.id}:`, error);
        if (attempt?.id && cneToken) {
          await pbRequest(`/api/collections/cne_query_attempts/records/${attempt.id}`, {
            method: 'PATCH',
            token: cneToken,
            body: { status: 'failed', errorCode: error.message === 'CNE_UPSTREAM_ERROR' ? 'CNE_UPSTREAM_ERROR' : 'CNE_LOOKUP_ERROR', completedAt: new Date().toISOString() },
          }).catch(() => {});
        }
        failed.push({ resident: resident.id, name: `${resident.firstName || ''} ${resident.lastName || ''}`.trim(), error: error.message || 'CNE_LOOKUP_ERROR' });
      }
    }

    const centerStats = checked.reduce((stats, item) => {
      const key = item.center || 'Centro no informado';
      stats[key] = (stats[key] || 0) + 1;
      return stats;
    }, {});
    return json(res, 200, {
      scanned: residents.length,
      alreadyProfiled: profiles.length,
      withoutBirthDate,
      knownMinors,
      candidates: candidates.length,
      checked: checked.length,
      failed: failed.length,
      remainingWithoutProfile: Math.max(0, residents.length - profiles.length - checked.length - knownMinors),
      centerStats,
      rows: checked,
      errors: failed,
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo completar la consulta CNE por lote.' });
  }
}
