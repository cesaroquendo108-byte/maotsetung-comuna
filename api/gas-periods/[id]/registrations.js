import {
  activeMembership,
  allowJsonPost,
  authenticate,
  bodyOf,
  json,
  pbRequest,
  serviceToken,
} from '../../_consolidated.js';

function encode(filter) {
  return encodeURIComponent(filter);
}

export default async function handler(req, res) {
  if (!allowJsonPost(req, res)) return;
  try {
    const auth = await authenticate(req);
    const periodId = String(req.query?.id || '').trim();
    const input = bodyOf(req);
    if (!/^[a-z0-9]{15}$/i.test(periodId)) return json(res, 400, { error: 'El período de bombonas no es válido.' });
    const period = await pbRequest(`/api/collections/gas_periods/records/${periodId}?fields=id,community,status`, { token: auth.token });
    if (!['open', 'review'].includes(period.status)) return json(res, 409, { error: 'El período de bombonas no está abierto.' });
    const membership = await activeMembership(auth, period.community);
    const requestedFamily = String(input.familyId || '').trim();
    const requestedDwelling = String(input.dwellingId || '').trim();
    const familyId = membership.role === 'regular' ? membership.family : requestedFamily || membership.family;
    const dwellingId = membership.role === 'regular' ? membership.dwelling : requestedDwelling || membership.dwelling;
    if (!/^[a-z0-9]{15}$/i.test(familyId) || !/^[a-z0-9]{15}$/i.test(dwellingId)) return json(res, 400, { error: 'La cuenta debe estar vinculada a una familia y vivienda antes de registrar bombonas.' });
    const internalToken = await serviceToken();
    const family = await pbRequest(`/api/collections/families/records/${familyId}?fields=id,community,dwelling`, { token: internalToken });
    const dwelling = await pbRequest(`/api/collections/dwellings/records/${dwellingId}?fields=id,community,status`, { token: internalToken });
    if (family.community !== period.community || dwelling.community !== period.community || family.dwelling !== dwelling.id) return json(res, 403, { error: 'La familia y la vivienda no pertenecen al mismo consejo.' });
    const existing = await pbRequest(`/api/collections/gas_registrations/records?perPage=1&filter=${encode(`period = "${period.id}" && family = "${family.id}"`)}&fields=id,status`, { token: internalToken });
    if (existing.items?.[0]) return json(res, 409, { error: 'Esta familia ya tiene una solicitud en el período activo.', registrationId: existing.items[0].id });
    const registration = await pbRequest('/api/collections/gas_registrations/records', {
      token: auth.token,
      method: 'POST',
      body: {
        community: period.community,
        period: period.id,
        family: family.id,
        dwelling: dwelling.id,
        requestedBy: auth.user.id,
        status: dwelling.status === 'verified' ? 'pending' : 'review',
        pendingLink: dwelling.status !== 'verified',
        needsRefill: Boolean(input.needsRefill),
        registeredAt: new Date().toISOString(),
        observations: String(input.observations || '').trim().slice(0, 3000),
      },
    });
    const cylinders = Array.isArray(input.cylinders) ? input.cylinders.slice(0, 10) : [];
    const createdCylinders = [];
    for (const cylinder of cylinders) {
      createdCylinders.push(await pbRequest('/api/collections/gas_cylinders/records', {
        token: internalToken,
        method: 'POST',
        body: {
          community: period.community,
          registration: registration.id,
          type: String(cylinder.type || 'Doméstica').trim().slice(0, 80),
          size: String(cylinder.size || '10 kg').trim().slice(0, 40),
          provider: ['Gas Caracas', 'PDVSA', 'Gas Comunal', 'otro'].includes(cylinder.provider) ? cylinder.provider : 'otro',
          condition: ['own', 'borrowed', 'damaged', 'missing', 'shared'].includes(cylinder.condition) ? cylinder.condition : 'own',
          needsRefill: Boolean(cylinder.needsRefill),
          shared: Boolean(cylinder.shared),
          observations: String(cylinder.observations || '').trim().slice(0, 2000),
        },
      }));
    }
    return json(res, 201, { registrationId: registration.id, status: registration.status, pendingLink: registration.pendingLink, cylinders: createdCylinders.length });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo registrar la solicitud de bombona.' });
  }
}
