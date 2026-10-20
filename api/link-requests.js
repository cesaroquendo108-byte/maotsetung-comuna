import crypto from 'node:crypto';
import {
  allowJsonPost,
  allowGet,
  authenticate,
  bodyOf,
  findCommunity,
  json,
  maskSearch,
  pbRequest,
  serviceToken,
} from './_consolidated.js';

function encode(filter) {
  return encodeURIComponent(filter);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!allowGet(req, res)) return;
    try {
      const auth = await authenticate(req);
      const data = await pbRequest(`/api/collections/verification_cases/records?perPage=20&sort=-created&filter=${encode(`requestedBy = "${auth.user.id}"`)}&fields=id,type,status,zone,dwelling,family,person,query,resolution,created,updated`, { token: auth.token });
      return json(res, 200, { items: data.items || [] });
    } catch (error) {
      return json(res, error.status || 500, { error: error.message || 'No se pudo consultar el estado de la solicitud.' });
    }
  }
  if (!allowJsonPost(req, res)) return;
  try {
    const auth = await authenticate(req);
    const input = bodyOf(req);
    const token = await serviceToken();
    const community = await findCommunity({ communityId: input.communityId, communityCode: input.communityCode, token });
    const code = String(input.code || '').trim().toUpperCase().slice(0, 80);
    const idNumber = String(input.idNumber || '').replace(/\D/g, '').slice(0, 24);
    const phone = String(input.phone || '').replace(/\D/g, '').slice(0, 24);
    const reference = String(input.reference || '').trim().slice(0, 500);
    const zoneId = String(input.zoneId || '').trim();
    if (!code && !idNumber && !phone && (!zoneId || !reference)) {
      return json(res, 400, { error: 'Indica un código, cédula, teléfono o una zona con referencia.' });
    }

    if (zoneId) {
      const zone = await pbRequest(`/api/collections/zones/records/${encodeURIComponent(zoneId)}?fields=id,community,status`, { token });
      if (zone.community !== community.id || zone.status === 'inactive') return json(res, 400, { error: 'La zona seleccionada no pertenece a este consejo.' });
    }

    let matchedDwelling = null;
    let matchedPerson = null;
    let matchedFamily = null;
    let method = '';
    if (code) {
      const dwellings = await pbRequest(`/api/collections/dwellings/records?perPage=2&filter=${encode(`community = "${community.id}" && code = "${code}" && status != "inactive" && status != "merged"`)}&fields=id,code,zone`, { token });
      matchedDwelling = dwellings.items?.[0] || null;
      method = 'dwelling_code';
    } else if (idNumber || phone) {
      const field = idNumber ? 'idNumberNormalized' : 'phone';
      const value = idNumber || phone;
      const people = await pbRequest(`/api/collections/residents/records?perPage=2&filter=${encode(`community = "${community.id}" && ${field} = "${value}" && status != "inactive"`)}&fields=id,idNumberNormalized,phone`, { token });
      matchedPerson = people.items?.[0] || null;
      method = idNumber ? 'id_exact' : 'phone_exact';
      if (matchedPerson) {
        const links = await pbRequest(`/api/collections/family_memberships/records?perPage=2&filter=${encode(`community = "${community.id}" && person = "${matchedPerson.id}" && status = "active"`)}&expand=family&fields=id,family,expand`, { token });
        const link = links.items?.[0];
        matchedFamily = link?.expand?.family || null;
        if (matchedFamily?.dwelling) {
          matchedDwelling = await pbRequest(`/api/collections/dwellings/records/${encodeURIComponent(matchedFamily.dwelling)}?fields=id,code,zone`, { token }).catch(() => null);
        }
      }
    }
    if (matchedDwelling && !matchedFamily) {
      const families = await pbRequest(`/api/collections/families/records?perPage=2&filter=${encode(`community = "${community.id}" && dwelling = "${matchedDwelling.id}"`)}&fields=id,dwelling`, { token });
      matchedFamily = families.items?.[0] || null;
    }

    const requestKey = String(input.requestKey || `${Date.now()}-${Math.random()}`).slice(0, 120);
    const externalKey = crypto.createHash('sha256').update(`${community.id}:${auth.user.id}:${requestKey}`).digest('hex');
    const existing = await pbRequest(`/api/collections/verification_cases/records?perPage=1&filter=${encode(`community = "${community.id}" && externalKey = "${externalKey}"`)}&fields=id,status`, { token }).catch(() => ({ items: [] }));
    if (existing.items?.[0]) return json(res, 200, { caseId: existing.items[0].id, status: existing.items[0].status, match: 'pending_review' });

    const record = await pbRequest('/api/collections/verification_cases/records', {
      token,
      method: 'POST',
      body: {
        community: community.id,
        externalKey,
        type: matchedDwelling || matchedPerson ? 'link_request' : 'new_dwelling',
        zone: matchedDwelling?.zone || zoneId || '',
        dwelling: matchedDwelling?.id || '',
        family: matchedFamily?.id || '',
        person: matchedPerson?.id || '',
        requestedBy: auth.user.id,
        status: 'pending',
        query: {
          method,
          code: code ? maskSearch(code) : '',
          idNumber: idNumber ? maskSearch(idNumber) : '',
          phone: phone ? maskSearch(phone) : '',
          reference,
          submittedAt: new Date().toISOString(),
        },
        notes: 'La coincidencia queda pendiente de revisión administrativa; no se creó una vivienda automáticamente.',
      },
    });
    return json(res, 201, { caseId: record.id, status: record.status, match: matchedDwelling || matchedPerson ? 'candidate_found' : 'new_dwelling_review' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo registrar la solicitud.' });
  }
}
