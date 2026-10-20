import { activeMembership, allowGet, authenticate, json, pbRequest, serviceToken } from './_consolidated.js';

function encode(filter) {
  return encodeURIComponent(filter);
}

function mask(value) {
  const raw = String(value || '');
  if (raw.length < 5) return raw ? '••••' : '';
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
}

async function listDwellings(req, res, auth) {
  const communityId = String(req.query?.communityId || '').trim();
  await activeMembership(auth, communityId, ['admin', 'collaborator']);
  const zoneId = String(req.query?.zoneId || '').trim();
  const status = String(req.query?.status || '').trim();
  const clauses = [`community = "${communityId}"`];
  if (zoneId) clauses.push(`zone = "${zoneId}"`);
  if (['provisional', 'verified', 'merged', 'inactive'].includes(status)) clauses.push(`status = "${status}"`);
  const data = await pbRequest(`/api/collections/dwellings/records?perPage=200&sort=code&filter=${encode(clauses.join(' && '))}&fields=id,zone,code,reference,status,historicalCodes`, { token: auth.token });
  return json(res, 200, { items: data.items || [] });
}

async function getFamily(req, res, auth) {
  const familyId = String(req.query?.id || '').trim();
  if (!/^[a-z0-9]{15}$/i.test(familyId)) return json(res, 400, { error: 'La familia seleccionada no es válida.' });
  const internalToken = await serviceToken();
  const family = await pbRequest(`/api/collections/families/records/${familyId}?expand=zone,dwelling&fields=id,community,zone,dwelling,legacyFamilyNumber,totalDeclared,totalReal,reviewStatus,expand`, { token: internalToken });
  const membership = await activeMembership(auth, family.community);
  if (membership.role === 'regular' && membership.family !== family.id) return json(res, 403, { error: 'No tienes permiso para consultar esta familia.' });
  const links = await pbRequest(`/api/collections/family_memberships/records?perPage=200&filter=${encode(`community = "${family.community}" && family = "${family.id}" && status != "inactive"`)}&expand=person&fields=id,person,relationship,isResponsible,status,expand.person`, { token: internalToken });
  const people = (links.items || []).map((link) => {
    const person = link.expand?.person || {};
    const regular = membership.role === 'regular';
    return { id: person.id || link.person, name: `${person.firstName || ''} ${person.lastName || ''}`.trim(), idNumber: regular ? mask(person.idNumber) : person.idNumber || '', phone: regular ? mask(person.phone) : person.phone || '', relationship: link.relationship || person.relationship || '', isResponsible: Boolean(link.isResponsible), status: link.status };
  });
  return json(res, 200, {
    family: {
      id: family.id,
      legacyFamilyNumber: family.legacyFamilyNumber,
      dwelling: family.expand?.dwelling ? { id: family.expand.dwelling.id, code: family.expand.dwelling.code, status: family.expand.dwelling.status } : { id: family.dwelling },
      zone: family.expand?.zone ? { id: family.expand.zone.id, code: family.expand.zone.code, name: family.expand.zone.name } : { id: family.zone },
      totalDeclared: family.totalDeclared,
      totalReal: family.totalReal,
      reviewStatus: family.reviewStatus,
    },
    people,
  });
}

export default async function handler(req, res) {
  if (!allowGet(req, res)) return;
  try {
    const auth = await authenticate(req);
    return String(req.query?.resource || '').toLowerCase() === 'family'
      ? await getFamily(req, res, auth)
      : await listDwellings(req, res, auth);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo consultar la estructura.' });
  }
}
