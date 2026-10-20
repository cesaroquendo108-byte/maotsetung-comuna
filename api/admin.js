import dwellingsMergeHandler from './_admin_dwellings_merge.js';
import familiesSplitHandler from './_admin_families_split.js';
import linkRequestsHandler from './_admin_link_requests.js';

export default async function handler(req, res) {
  const resource = String(req.query?.resource || '').trim().toLowerCase();

  if (resource === 'dwellings-merge') {
    return dwellingsMergeHandler(req, res);
  }

  if (resource === 'families-split') {
    return familiesSplitHandler(req, res);
  }

  if (resource === 'link-requests') {
    return linkRequestsHandler(req, res);
  }

  return res.status(404).json({ error: 'Recurso de administración no encontrado.' });
}
