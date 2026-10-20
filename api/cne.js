import lookupHandler from './_cne_lookup.js';
import bulkMissingHandler from './_cne_bulk_missing.js';
import syncChildrenHandler from './_cne_sync_children.js';

export default async function handler(req, res) {
  const resource = String(req.query?.resource || '').trim().toLowerCase();

  if (resource === 'lookup') {
    return lookupHandler(req, res);
  }

  if (resource === 'bulk-missing') {
    return bulkMissingHandler(req, res);
  }

  if (resource === 'sync-children') {
    return syncChildrenHandler(req, res);
  }

  return res.status(404).json({ error: 'Recurso CNE no encontrado.' });
}
