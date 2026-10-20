import {
  activeMembership,
  allowJsonPost,
  authenticate,
  bodyOf,
  json,
  pbRequest,
} from './_consolidated.js';

function encode(filter) {
  return encodeURIComponent(filter);
}

async function all(collection, filter, token, fields) {
  const items = [];
  let page = 1;
  for (;;) {
    const data = await pbRequest(`/api/collections/${collection}/records?page=${page}&perPage=200&filter=${encode(filter)}&fields=${encodeURIComponent(fields)}`, { token });
    items.push(...(data.items || []));
    if (page >= Number(data.totalPages || 1)) return items;
    page += 1;
  }
}

export default async function handler(req, res) {
  if (!allowJsonPost(req, res)) return;
  try {
    const auth = await authenticate(req);
    const sourceId = String(req.query?.id || '').trim();
    const input = bodyOf(req);
    const targetId = String(input.targetDwellingId || '').trim();
    if (!/^[a-z0-9]{15}$/i.test(sourceId) || !/^[a-z0-9]{15}$/i.test(targetId) || sourceId === targetId) return json(res, 400, { error: 'Indica dos viviendas distintas.' });
    const source = await pbRequest(`/api/collections/dwellings/records/${sourceId}?fields=id,community,code,status,historicalCodes`, { token: auth.token });
    const target = await pbRequest(`/api/collections/dwellings/records/${targetId}?fields=id,community,code,status,historicalCodes`, { token: auth.token });
    await activeMembership(auth, source.community, ['admin']);
    if (source.community !== target.community) return json(res, 403, { error: 'Las viviendas deben pertenecer a la misma comunidad.' });
    if (['merged', 'inactive'].includes(source.status) || ['merged', 'inactive'].includes(target.status)) return json(res, 409, { error: 'No se puede fusionar una vivienda cerrada.' });

    const families = await all('families', `community = "${source.community}" && dwelling = "${source.id}"`, auth.token, 'id,dwelling');
    const memberships = await all('community_memberships', `community = "${source.community}" && dwelling = "${source.id}"`, auth.token, 'id,dwelling');
    const cases = await all('verification_cases', `community = "${source.community}" && dwelling = "${source.id}"`, auth.token, 'id,dwelling');
    const historicalCodes = [...new Set([...(Array.isArray(target.historicalCodes) ? target.historicalCodes : []), target.code, source.code, ...(Array.isArray(source.historicalCodes) ? source.historicalCodes : [])].filter(Boolean))];
    await pbRequest(`/api/collections/dwellings/records/${target.id}`, { token: auth.token, method: 'PATCH', body: { historicalCodes, status: 'verified' } });
    for (const family of families) await pbRequest(`/api/collections/families/records/${family.id}`, { token: auth.token, method: 'PATCH', body: { dwelling: target.id } });
    for (const membership of memberships) await pbRequest(`/api/collections/community_memberships/records/${membership.id}`, { token: auth.token, method: 'PATCH', body: { dwelling: target.id } });
    for (const item of cases) await pbRequest(`/api/collections/verification_cases/records/${item.id}`, { token: auth.token, method: 'PATCH', body: { dwelling: target.id } });
    await pbRequest(`/api/collections/dwellings/records/${source.id}`, { token: auth.token, method: 'PATCH', body: { status: 'merged', mergedInto: target.id, historicalCodes } });
    return json(res, 200, { sourceDwellingId: source.id, targetDwellingId: target.id, movedFamilies: families.length, movedMemberships: memberships.length, movedCases: cases.length, historicalCodes });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo fusionar la vivienda.' });
  }
}
