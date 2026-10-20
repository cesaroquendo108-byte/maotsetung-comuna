import { activeMembership, allowGet, authenticate, findCommunity, json, pbRequest, serviceToken } from './_consolidated.js';

export default async function handler(req, res) {
  if (!allowGet(req, res)) return;
  try {
    const communityId = String(req.query?.communityId || '').trim();
    const communityCode = String(req.query?.communityCode || '').trim();
    let auth = null;
    try {
      auth = await authenticate(req);
    } catch (_) {}

    let token = auth?.token;
    let community = null;

    if (token) {
      try {
        community = await findCommunity({ communityId, communityCode, token });
        await activeMembership(auth, community.id, ['admin', 'collaborator']);
      } catch (error) {
        if (!communityCode || error?.status !== 403) throw error;
        token = await serviceToken();
        community = await findCommunity({ communityCode, token });
      }
    } else if (communityCode) {
      token = await serviceToken();
      community = await findCommunity({ communityCode, token });
    } else {
      return json(res, 401, { error: 'Inicia sesión para continuar.' });
    }

    const filter = encodeURIComponent(`community = "${community.id}" && status != "inactive"`);
    const data = await pbRequest(`/api/collections/zones/records?perPage=200&sort=sortOrder&filter=${filter}&fields=id,code,name,sortOrder,reference,status`, { token });
    return json(res, 200, { items: data.items || [] });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudieron consultar las zonas.' });
  }
}
