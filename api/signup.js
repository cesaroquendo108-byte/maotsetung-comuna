import { allowPost, json } from './_auth.js';
import { pbRequest, serviceToken } from './_consolidated.js';

export default async function handler(req, res) {
  if (!allowPost(req, res)) return;

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
        return json(res, 400, { error: 'Ya existe una cuenta registrada con este correo electronico.' });
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
