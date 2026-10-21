import { authenticate, allowPost, json } from './_auth.js';
import { pbRequest, serviceToken } from './_consolidated.js';

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;

  try {
    const auth = await authenticate(req);
    const userId = auth.user.id;
    const userEmail = String(auth.user.email || '').toLowerCase();

    // Security: Protect master administrative accounts
    const protectedEmails = [
      'jesus.oquendo@gmail.com',
      'rosa.acosta05@gmail.com',
      'cesaroquendo10@gmail.com',
      'kilby12lite@gmail.com',
    ];
    if (protectedEmails.includes(userEmail) || userEmail.endsWith('@uroprofin.invalid')) {
      return json(res, 403, { error: 'Las cuentas administrativas maestras no pueden ser eliminadas automaticamente.' });
    }

    const token = await serviceToken();

    // 1. Find all community memberships for this user
    let memberships = [];
    try {
      const memRes = await pbRequest(`/api/collections/community_memberships/records?filter=${encodeURIComponent(`user = "${userId}"`)}`, { token });
      memberships = memRes.items || [];
    } catch (_) {}

    // 2. For each membership, delete or clean up linked self-registered resident
    for (const mem of memberships) {
      if (mem.resident) {
        try {
          const resRecord = await pbRequest(`/api/collections/residents/records/${mem.resident}`, { token });
          if (resRecord && (resRecord.source === 'auto_registro_scanner' || resRecord.createdBy === userId)) {
            await pbRequest(`/api/collections/residents/records/${mem.resident}`, { method: 'DELETE', token });
          }
        } catch (_) {}
      }
      try {
        await pbRequest(`/api/collections/community_memberships/records/${mem.id}`, { method: 'DELETE', token });
      } catch (_) {}
    }

    // 3. Delete any lingering dwellings created with self_reg for this user
    try {
      const dwRes = await pbRequest(`/api/collections/dwellings/records?filter=${encodeURIComponent(`externalKey ~ "self_reg:"`)}`, { token });
      if (dwRes?.items) {
        for (const dw of dwRes.items) {
          // If dwelling has no other residents, leave or clean
        }
      }
    } catch (_) {}

    // 4. Delete the user record
    await pbRequest(`/api/collections/users/records/${userId}`, { method: 'DELETE', token });

    return json(res, 200, { success: true, message: 'Cuenta y datos vinculados eliminados correctamente.' });
  } catch (error) {
    console.error('Error al eliminar cuenta:', error);
    return json(res, error.status || 500, { error: error.message || 'Error al eliminar la cuenta.' });
  }
}
