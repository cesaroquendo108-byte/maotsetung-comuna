import crypto from 'node:crypto';
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

export default async function handler(req, res) {
  if (!allowJsonPost(req, res)) return;
  try {
    const auth = await authenticate(req);
    const familyId = String(req.query?.id || '').trim();
    const input = bodyOf(req);
    const personIds = [...new Set(Array.isArray(input.personIds) ? input.personIds.map((id) => String(id).trim()).filter((id) => /^[a-z0-9]{15}$/i.test(id)) : [])];
    if (!/^[a-z0-9]{15}$/i.test(familyId) || personIds.length === 0) return json(res, 400, { error: 'Selecciona al menos una persona para separar.' });
    const family = await pbRequest(`/api/collections/families/records/${familyId}?fields=id,community,zone,dwelling,import,legacyFamilyNumber,totalDeclared,totalReal,reviewStatus,sourceSheet,sourceRow,sourceValues`, { token: auth.token });
    await activeMembership(auth, family.community, ['admin']);
    const links = await pbRequest(`/api/collections/family_memberships/records?perPage=200&filter=${encode(`community = "${family.community}" && family = "${family.id}" && status != "inactive"`)}&fields=id,person,relationship`, { token: auth.token });
    const selected = links.items.filter((link) => personIds.includes(link.person));
    if (selected.length !== personIds.length) return json(res, 400, { error: 'Una o más personas no pertenecen a la familia indicada.' });
    if (selected.length >= links.items.length) return json(res, 400, { error: 'La familia original debe conservar al menos una persona.' });
    const splitKey = crypto.createHash('sha256').update(`${family.id}:${personIds.sort().join(',')}`).digest('hex');
    const existing = await pbRequest(`/api/collections/families/records?perPage=1&filter=${encode(`community = "${family.community}" && splitKey = "${splitKey}"`)}&fields=id,legacyFamilyNumber`, { token: auth.token });
    if (existing.items?.[0]) return json(res, 200, { familyId: existing.items[0].id, status: 'already_split', movedPeople: selected.length });
    const siblings = await pbRequest(`/api/collections/families/records?perPage=200&filter=${encode(`community = "${family.community}" && zone = "${family.zone}" && legacyFamilyNumber = ${Number(family.legacyFamilyNumber)}`)}&fields=splitSequence`, { token: auth.token });
    const splitSequence = Math.max(0, ...siblings.items.map((item) => Number(item.splitSequence || 0))) + 1;
    const newFamily = await pbRequest('/api/collections/families/records', {
      token: auth.token,
      method: 'POST',
      body: {
        community: family.community,
        zone: family.zone,
        dwelling: family.dwelling,
        import: family.import,
        externalKey: `split:${splitKey}`,
        legacyFamilyNumber: family.legacyFamilyNumber,
        splitKey,
        splitSequence,
        sourceSheet: family.sourceSheet,
        sourceRow: family.sourceRow,
        totalDeclared: selected.length,
        totalReal: selected.length,
        reviewStatus: 'review',
        sourceValues: family.sourceValues,
        notes: 'Familia separada por revisión administrativa; conserva el número histórico original.',
      },
    });
    for (const link of selected) {
      await pbRequest(`/api/collections/family_memberships/records/${link.id}`, { token: auth.token, method: 'PATCH', body: { family: newFamily.id, status: 'review' } });
      const memberships = await pbRequest(`/api/collections/community_memberships/records?perPage=5&filter=${encode(`community = "${family.community}" && resident = "${link.person}"`)}&fields=id`, { token: auth.token }).catch(() => ({ items: [] }));
      for (const cm of (memberships.items || [])) {
        await pbRequest(`/api/collections/community_memberships/records/${cm.id}`, { token: auth.token, method: 'PATCH', body: { family: newFamily.id } });
      }
    }
    await pbRequest(`/api/collections/families/records/${family.id}`, { token: auth.token, method: 'PATCH', body: { totalReal: Math.max(0, Number(family.totalReal || links.items.length) - selected.length), reviewStatus: 'review' } });
    return json(res, 200, { familyId: newFamily.id, originalFamilyId: family.id, status: 'review', movedPeople: selected.length, legacyFamilyNumber: family.legacyFamilyNumber });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo separar la familia.' });
  }
}
