import { allowPost, authenticate, json } from './_auth.js';
import { pbRequest, serviceToken } from './_consolidated.js';

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;

  const action = req.query.action || req.body?.action || 'signup';

  if (action === 'delete-account') {
    return handleDeleteAccount(req, res);
  }

  return handleSignup(req, res);
}

async function handleSignup(req, res) {
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const passwordConfirm = String(body.passwordConfirm || password);
    const name = String(body.name || '').trim();

    if (!email || !email.includes('@') || !email.includes('.')) {
      return json(res, 400, { error: 'Introduce un correo electronico valido.' });
    }
    if (password.length < 8) {
      return json(res, 400, { error: 'La contrasena debe tener al menos 8 caracteres.' });
    }
    if (password !== passwordConfirm) {
      return json(res, 400, { error: 'Las contrasenas no coinciden.' });
    }

    const token = await serviceToken();

    // Check if user already exists
    try {
      const existing = await pbRequest(`/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email = "${email}"`)}`, { token });
      if (existing.items && existing.items.length > 0) {
        return json(res, 400, { error: 'Ya existe una cuenta registrada con este correo electronico. Intenta iniciar sesion.' });
      }
    } catch (_) {}

    // Create user in PocketBase
    const user = await pbRequest('/api/collections/users/records', {
      method: 'POST',
      token,
      body: {
        email,
        password,
        passwordConfirm,
        name: name || email.split('@')[0],
      },
    });

    // Check if there is an existing resident record with this email to auto-link membership
    try {
      const resSearch = await pbRequest(`/api/collections/residents/records?perPage=1&filter=${encodeURIComponent(`email = "${email}"`)}`, { token });
      if (resSearch.items && resSearch.items.length > 0) {
        const resident = resSearch.items[0];
        const communeSearch = await pbRequest('/api/collections/communes/records?perPage=1', { token });
        const communeId = communeSearch.items?.[0]?.id || resident.community;
        await pbRequest('/api/collections/community_memberships/records', {
          method: 'POST',
          token,
          body: {
            community: communeId,
            user: user.id,
            resident: resident.id,
            household: resident.household || '',
            role: 'regular',
            status: 'active',
            notes: 'Cuenta comunal vinculada automaticamente por coincidencia de correo.',
          },
        });
      }
    } catch (_) {}

    return json(res, 201, {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    const message = error?.data?.data?.email?.message || error?.message || 'No se pudo crear la cuenta.';
    return json(res, error.status || 500, { error: message });
  }
}

async function handleDeleteAccount(req, res) {
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

    // 3. Delete the user record
    await pbRequest(`/api/collections/users/records/${userId}`, { method: 'DELETE', token });

    return json(res, 200, { success: true, message: 'Cuenta y datos vinculados eliminados correctamente.' });
  } catch (error) {
    console.error('Error al eliminar cuenta:', error);
    return json(res, error.status || 500, { error: error.message || 'Error al eliminar la cuenta.' });
  }
}
