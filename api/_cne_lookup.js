import crypto from 'node:crypto';
import { allowPost, authenticate, getMembership, json } from './_auth.js';
import { lookupElectoralProfile, providerAvailable } from '../server/cneProvider.js';

async function pbRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL}${path}`, {
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

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;
  try {
    const { idNumber, consent, communityId } = req.body || {};
    if (consent !== true) return json(res, 400, { error: 'Se requiere consentimiento para la consulta.' });
    const normalizedId = String(idNumber || '').replace(/\D/g, '');
    if (normalizedId.length < 5 || normalizedId.length > 12) return json(res, 400, { error: 'La cedula no es valida.' });

    const auth = await authenticate(req);
    const { membership, resident } = await getMembership(auth, normalizedId, {
      ownResidentOnly: true,
      communityId,
    });

    if (!providerAvailable()) {
      return json(res, 503, {
        error: 'La consulta automatica esta desactivada hasta configurar un adaptador CNE autorizado.',
        code: 'CNE_PROVIDER_DISABLED',
      });
    }

    const consentAt = new Date().toISOString();
    const requestKey = crypto.randomUUID();
    const attempt = await pbRequest('/api/collections/cne_query_attempts/records', {
      method: 'POST',
      token: auth.token,
      body: {
        community: membership.community,
        resident: resident.id,
        actor: auth.user.id,
        consentAt,
        status: 'started',
        provider: process.env.CEDULA_COM_VE_APP_ID ? 'cedula.com.ve' : 'authorized-provider',
        requestKey,
      },
    });
    const cneServiceToken = await serviceToken();

    let result;
    try {
      result = await lookupElectoralProfile(resident);
    } catch (error) {
      await pbRequest(`/api/collections/cne_query_attempts/records/${attempt.id}`, {
        method: 'PATCH',
        token: cneServiceToken,
        body: {
          status: 'failed',
          errorCode: error.message === 'CNE_UPSTREAM_ERROR' ? 'CNE_UPSTREAM_ERROR' : 'CNE_NETWORK_ERROR',
          completedAt: new Date().toISOString(),
        },
      }).catch(() => {});
      return json(res, 502, { error: 'La fuente electoral no esta disponible en este momento.', code: error.message || 'CNE_NETWORK_ERROR' });
    }

    const profileFilter = encodeURIComponent(`resident = "${resident.id}"`);
    const profiles = await pbRequest(`/api/collections/electoral_profiles/records?perPage=1&filter=${profileFilter}`, { token: cneServiceToken });
    const profilePayload = {
      community: membership.community,
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
    if (profiles.items?.[0]) {
      await pbRequest(`/api/collections/electoral_profiles/records/${profiles.items[0].id}`, { method: 'PATCH', token: cneServiceToken, body: profilePayload });
    } else {
      await pbRequest('/api/collections/electoral_profiles/records', { method: 'POST', token: cneServiceToken, body: profilePayload });
    }
    if (result.birthDate && !resident.birthDate) {
      await pbRequest(`/api/collections/residents/records/${resident.id}`, { method: 'PATCH', token: cneServiceToken, body: { birthDate: result.birthDate } }).catch(() => {});
    }
    await pbRequest(`/api/collections/cne_query_attempts/records/${attempt.id}`, {
      method: 'PATCH', token: cneServiceToken, body: { status: 'succeeded', completedAt: new Date().toISOString() },
    });
    return json(res, 200, result);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo completar la consulta.' });
  }
}
