import {
  activeMembership,
  allowGet,
  allowJsonPost,
  authenticate,
  bodyOf,
  json,
  pbRequest,
  serviceToken,
} from './_consolidated.js';

function encode(filter) {
  return encodeURIComponent(filter);
}

async function getOne(collection, id, token, fields = '') {
  const suffix = fields ? `?fields=${encodeURIComponent(fields)}` : '';
  return pbRequest(`/api/collections/${collection}/records/${id}${suffix}`, { token });
}

async function listRequests(req, res) {
  const auth = await authenticate(req);
  const communityId = String(req.query?.communityId || '').trim();
  if (!/^[a-z0-9]{15}$/i.test(communityId)) return json(res, 400, { error: 'El consejo seleccionado no es válido.' });
  await activeMembership(auth, communityId, ['admin', 'collaborator']);
  const token = await serviceToken();
  const data = await pbRequest(`/api/collections/verification_cases/records?perPage=100&sort=-created&filter=${encode(`community = "${communityId}" && (status = "pending" || status = "review")`)}&expand=zone,dwelling,family,person,requestedBy`, { token });
  const items = (data.items || []).map((item) => ({
    id: item.id,
    type: item.type,
    status: item.status,
    created: item.created,
    query: item.query || {},
    zone: item.expand?.zone ? { id: item.expand.zone.id, code: item.expand.zone.code, name: item.expand.zone.name } : null,
    dwelling: item.expand?.dwelling ? { id: item.expand.dwelling.id, code: item.expand.dwelling.code, status: item.expand.dwelling.status, reference: item.expand.dwelling.reference } : null,
    family: item.expand?.family ? { id: item.expand.family.id, legacyFamilyNumber: item.expand.family.legacyFamilyNumber } : null,
    person: item.expand?.person ? { id: item.expand.person.id, firstName: item.expand.person.firstName, lastName: item.expand.person.lastName, idNumber: item.expand.person.idNumber } : null,
    requestedBy: item.expand?.requestedBy ? { id: item.expand.requestedBy.id, name: item.expand.requestedBy.name, email: item.expand.requestedBy.email } : null,
    raw: { zoneId: item.zone, dwellingId: item.dwelling, familyId: item.family, personId: item.person },
  }));
  return json(res, 200, { items });
}

async function updateRequest(req, res) {
  const auth = await authenticate(req);
  const input = bodyOf(req);
  const caseId = String(input.caseId || req.query?.id || '').trim();
  const action = String(input.action || '').trim().toLowerCase();
  if (!/^[a-z0-9]{15}$/i.test(caseId) || !['approve', 'reject'].includes(action)) return json(res, 400, { error: 'La acción o solicitud no es válida.' });
  const caseRecord = await getOne('verification_cases', caseId, auth.token, 'id,community,type,status,requestedBy,zone,dwelling,family,person');
  await activeMembership(auth, caseRecord.community, ['admin']);
  if (caseRecord.status !== 'pending' && caseRecord.status !== 'review') return json(res, 409, { error: 'La solicitud ya fue cerrada.' });

  if (action === 'reject') {
    const updated = await pbRequest(`/api/collections/verification_cases/records/${caseId}`, {
      token: auth.token,
      method: 'PATCH',
      body: {
        status: 'rejected',
        reviewedBy: auth.user.id,
        reviewedAt: new Date().toISOString(),
        resolution: { method: 'human_review', notes: String(input.notes || 'Solicitud rechazada por revisión administrativa.').trim().slice(0, 1000) },
      },
    });
    return json(res, 200, { caseId: updated.id, status: updated.status });
  }

  let dwellingId = String(input.dwellingId || caseRecord.dwelling || '').trim();
  let familyId = String(input.familyId || caseRecord.family || '').trim();
  let personId = String(input.personId || caseRecord.person || '').trim();
  if (caseRecord.type === 'new_dwelling' && !dwellingId) {
    const zoneId = String(input.zoneId || caseRecord.zone || '').trim();
    const code = String(input.code || '').trim().toUpperCase();
    if (!/^[a-z0-9]{15}$/i.test(zoneId) || !/^[A-Z0-9]{2,10}-[A-Z0-9-]{2,60}$/.test(code)) return json(res, 400, { error: 'Para confirmar un nuevo hogar indica zona y código de vivienda.' });
    const createdDwelling = await pbRequest('/api/collections/dwellings/records', {
      token: auth.token,
      method: 'POST',
      body: {
        community: caseRecord.community,
        zone: zoneId,
        externalKey: `verified:${caseId}`,
        code,
        reference: String(input.reference || '').trim().slice(0, 500),
        status: 'verified',
        responsible: auth.user.id,
        historicalCodes: [],
        sourceSheet: 'MANUAL',
        sourceRow: 1,
      },
    });
    dwellingId = createdDwelling.id;
  }
  if (!dwellingId || !personId) return json(res, 400, { error: 'La aprobación requiere una vivienda y una persona seleccionadas.' });

  const dwelling = await getOne('dwellings', dwellingId, auth.token, 'id,community,code,zone,reference');
  if (dwelling.community !== caseRecord.community) return json(res, 403, { error: 'La vivienda no pertenece a este consejo.' });
  const resident = await getOne('residents', personId, auth.token, 'id,community,household,status');
  if (resident.community !== caseRecord.community || resident.status === 'inactive') return json(res, 403, { error: 'La persona no pertenece al censo activo de este consejo.' });
  const familyFilter = familyId
    ? `id = "${familyId}" && community = "${caseRecord.community}"`
    : `dwelling = "${dwellingId}" && community = "${caseRecord.community}" && reviewStatus != "resolved"`;
  const familyData = await pbRequest(`/api/collections/families/records?perPage=1&filter=${encode(familyFilter)}&fields=id,dwelling,community`, { token: auth.token });
  const family = familyData.items?.[0];
  if (!family) return json(res, 400, { error: 'Selecciona una familia censal válida para la vinculación.' });
  familyId = family.id;

  let household = null;
  if (resident.household) household = await getOne('households', resident.household, auth.token, 'id,community,code');
  if (!household) {
    const existing = await pbRequest(`/api/collections/households/records?perPage=1&filter=${encode(`community = "${caseRecord.community}" && code = "${dwelling.code}"`)}&fields=id,community,code`, { token: auth.token });
    household = existing.items?.[0];
    if (!household) household = await pbRequest('/api/collections/households/records', { token: auth.token, method: 'POST', body: { community: caseRecord.community, code: dwelling.code, address: dwelling.reference || '', status: 'review', sourceRow: 1 } });
  }

  const existingMembership = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${encode(`community = "${caseRecord.community}" && user = "${caseRecord.requestedBy}"`)}&fields=id,role`, { token: auth.token });
  const memberPayload = {
    community: caseRecord.community,
    user: caseRecord.requestedBy,
    household: household.id,
    resident: resident.id,
    family: familyId,
    dwelling: dwellingId,
    role: existingMembership.items?.[0]?.role || 'regular',
    status: 'active',
    approvedBy: auth.user.id,
    approvedAt: new Date().toISOString(),
    notes: String(input.notes || 'Vinculación confirmada por revisión humana.').trim().slice(0, 1000),
  };
  const membership = existingMembership.items?.[0]
    ? await pbRequest(`/api/collections/community_memberships/records/${existingMembership.items[0].id}`, { token: auth.token, method: 'PATCH', body: memberPayload })
    : await pbRequest('/api/collections/community_memberships/records', { token: auth.token, method: 'POST', body: memberPayload });
  await pbRequest(`/api/collections/verification_cases/records/${caseId}`, {
    token: auth.token,
    method: 'PATCH',
    body: { status: 'approved', dwelling: dwellingId, family: familyId, person: resident.id, reviewedBy: auth.user.id, reviewedAt: new Date().toISOString(), resolution: { method: 'human_review', notes: String(input.notes || '').trim().slice(0, 1000) } },
  });
  return json(res, 200, { caseId, status: 'approved', membershipId: membership.id });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!allowGet(req, res)) return;
      return await listRequests(req, res);
    }
    if (!allowJsonPost(req, res)) return;
    return await updateRequest(req, res);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo actualizar la vinculación.' });
  }
}
