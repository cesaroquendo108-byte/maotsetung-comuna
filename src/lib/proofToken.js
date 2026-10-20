// Proof Token HMAC signing & verification for Finve specification

const PROOF_TOKEN_SECRET = 'uroprofin_finve_payment_proof_secret_v1_secure';
const DOMAIN_PREFIX = 'proof-v1:';
const TTL_MS = 60 * 60 * 1000; // 1 hour TTL

/**
 * Encodes an object or string to base64url format
 */
function base64UrlEncode(str) {
  const base64 = btoa(typeof str === 'string' ? str : JSON.stringify(str));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a base64url string
 */
function base64UrlDecode(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Simple, fast HMAC-SHA256 like hash for browser environments
 */
async function generateHmacSignature(data, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(DOMAIN_PREFIX + data);

  try {
    if (crypto?.subcrypto || crypto?.subtle) {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      const hashArray = Array.from(new Uint8Array(signature));
      return base64UrlEncode(String.fromCharCode(...hashArray));
    }
  } catch (e) {
    console.warn('SubtleCrypto not available, using fallback HMAC:', e);
  }

  // Fallback simple checksum if WebCrypto subtle is unavailable in non-secure context
  let hash = 0;
  const str = secret + DOMAIN_PREFIX + data;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return base64UrlEncode(String(Math.abs(hash)));
}

/**
 * Signs a payment proof token payload with 1h TTL and HMAC signature
 * Payload format: { userId, receiptUrl, expectedBsAmount, suspicious, suspicionReasons, extraction, iat }
 */
export async function signProofToken(payload, secret = PROOF_TOKEN_SECRET) {
  const iat = Date.now();
  const tokenPayload = {
    ...payload,
    iat,
    exp: iat + TTL_MS
  };

  const encodedPayload = base64UrlEncode(tokenPayload);
  const signature = await generateHmacSignature(encodedPayload, secret);
  return `proof-v1.${encodedPayload}.${signature}`;
}

/**
 * Verifies a proof token signature, expiry, and userId match.
 * Returns decoded payload if valid, or throws an error.
 */
export async function verifyProofToken(tokenString, expectedUserId = null, secret = PROOF_TOKEN_SECRET) {
  if (!tokenString || typeof tokenString !== 'string') {
    throw new Error('Token de comprobante no proporcionado.');
  }

  const parts = tokenString.split('.');
  if (parts.length !== 3 || parts[0] !== 'proof-v1') {
    throw new Error('Formato de token de comprobante no válido.');
  }

  const [, encodedPayload, providedSignature] = parts;
  const expectedSignature = await generateHmacSignature(encodedPayload, secret);

  if (providedSignature !== expectedSignature) {
    throw new Error('Firma del token de comprobante alterada o no válida.');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (e) {
    throw new Error('Contenido del token ilegible.');
  }

  if (Date.now() > payload.exp) {
    throw new Error('El token del comprobante ha expirado. Sube la foto nuevamente.');
  }

  if (expectedUserId && payload.userId && String(payload.userId) !== String(expectedUserId)) {
    throw new Error('El comprobante pertenece a otro usuario.');
  }

  return payload;
}
