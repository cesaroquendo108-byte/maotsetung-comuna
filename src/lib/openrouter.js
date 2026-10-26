import pb, { API_BASE } from './pocketbase.js';

const OPENROUTER_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENROUTER_API_KEY)
  || (typeof process !== 'undefined' && process.env?.VITE_OPENROUTER_API_KEY)
  || (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY)
  || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

/**
 * Converts a File object to a Base64 data URL string.
 * Automatically resizes and compresses images to reduce upload payloads.
 */
export function fileToBase64(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    // Si no es imagen (ej: PDF), pasarlo tal cual
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
      return;
    }

    // Comprimir usando Canvas API
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        // Rellenar fondo blanco por si acaso es PNG transparente
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir siempre a JPEG para mayor compresión (los comprobantes no necesitan transparencia)
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen para compresión.'));
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Finve Production Specification: Analyzes a Pago Móvil receipt with Vision Model
 * Applies deterministic post-processing and Fail Open policy.
 */
export async function analyzeReceiptImage(fileOrBase64, expectedBsAmount = null) {
  try {
    let dataUrl = '';
    if (typeof fileOrBase64 === 'string') {
      dataUrl = fileOrBase64;
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      dataUrl = await fileToBase64(fileOrBase64);
    } else {
      throw new Error('Formato de archivo no válido.');
    }

    // 1. Prioritize serverless /api/scan?type=receipt (uses server OPENROUTER_API_KEY safely)
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (pb?.authStore?.token) {
        headers.Authorization = `Bearer ${pb.authStore.token}`;
      }
      const apiRes = await fetch(`${API_BASE}/api/scan?type=receipt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ image: dataUrl, expectedBsAmount }),
      });
      if (apiRes.ok) {
        const apiJson = await apiRes.json();
        const serverData = apiJson?.data || apiJson;
        if (serverData && typeof serverData === 'object' && ('isPagoMovilReceipt' in serverData || 'referenceNumber' in serverData || 'amountBs' in serverData)) {
          return postProcessResult({ choices: [{ message: { content: JSON.stringify(serverData) } }] }, expectedBsAmount);
        }
      }
    } catch {
      /* Fallback to direct OpenRouter if client key is configured */
    }

    if (!OPENROUTER_API_KEY) {
      throw new Error('El lector óptico requiere conexión con el servidor.');
    }

    const expectedAmountStr = expectedBsAmount != null ? Math.round(Number(expectedBsAmount)) : 'Sin monto cotizado';

    const systemPrompt = `You are a payment-verification specialist for Venezuelan "pago móvil" (P2P/C2P interbank mobile payment) receipts. Users upload a screenshot or PDF of the receipt their banking app produced after paying a subscription.

Analyze the attached receipt and respond in two parts: extract the payment details, and assess whether the receipt looks legitimate.

## EXPECTED PAYMENT
- Amount: ${expectedAmountStr} Bs (compare rounded to whole bolívares: 5593.79 ≈ 5594; a difference of 1 Bs or less is acceptable rounding noise)

## EXTRACTION RULES
1. Venezuelan bank receipts (especially Banco de Venezuela / BDV, Banesco, Mercantil, Provincial, Bancamiga, etc.) label the transaction reference as "Referencia", "N° de referencia", "Nro. Referencia", "Operación", "Nro. de Operación", "N° de Operación", "Secuencia", "Código de referencia", or "Número de comprobante". On Banco de Venezuela receipts, the reference is very often labeled simply as "Operación", "Nro. de Operación", or "Secuencia" — extract this exact numeric or alphanumeric reference identifier as "referenceNumber".
2. Amounts use comma decimals (e.g. "2.310,18 Bs") — convert to a plain number (2310.18).
3. Dates may appear as DD/MM/YYYY or "11 de junio de 2026" — normalize to YYYY-MM-DD.
4. Origin = who paid (emisor); destination = who received (receptor/beneficiario). Banks may appear as 4-digit codes (0102, 0134) or names (Banco de Venezuela, Banesco) — extract whatever is shown, including masked values. Do NOT extract the destination/receiver phone number.
5. Phone numbers: normalize to 11 digits starting with 04 when possible.
6. Set any field you cannot read to null. Do NOT guess.

## SUSPICION ASSESSMENT
Mark "suspicious": true ONLY when one of these holds:
- The image is not a pago móvil receipt at all (random photo, meme, blank screenshot, bank app home screen without a completed payment).
- Visible signs of digital manipulation: mismatched fonts, misaligned or smudged text, inconsistent backgrounds, cloned regions, text that overlaps UI elements unnaturally.
- The receipt shows a FAILED or PENDING operation (e.g. "rechazada", "fallida", "en proceso") instead of a successful one.
- The amount, rounded to whole bolívares, differs from the expected amount above by more than 1 Bs.
- The receipt is so illegible that none of the key fields can be read.
Do NOT mark it suspicious for: destination phone/cédula/bank differences (banks mask and reformat these fields — they are NOT validated), cosmetic differences between banking apps, cropped edges, or watermarks. Every Venezuelan bank renders receipts differently.
"suspicionReasons" must be written in Spanish (Venezuela), short and concrete (e.g. "El monto del comprobante no coincide con el esperado").`;

    const jsonSchema = {
      name: "pago_movil_proof_analysis",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "isPagoMovilReceipt", "referenceNumber", "amountBs", "date",
          "originPhone", "originBank", "originDocument",
          "destinationBank", "destinationDocument",
          "suspicious", "suspicionReasons"
        ],
        properties: {
          isPagoMovilReceipt: { type: "boolean" },
          referenceNumber: { type: ["string", "null"] },
          amountBs: { type: ["number", "null"] },
          date: { type: ["string", "null"], description: "YYYY-MM-DD" },
          originPhone: { type: ["string", "null"] },
          originBank: { type: ["string", "null"] },
          originDocument: { type: ["string", "null"] },
          destinationBank: { type: ["string", "null"] },
          destinationDocument: { type: ["string", "null"] },
          suspicious: { type: "boolean" },
          suspicionReasons: { type: "array", items: { type: "string" } }
        }
      }
    };

    const payload = {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analiza este comprobante de pago móvil y responde con el esquema JSON.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      response_format: { type: 'json_object', schema: jsonSchema.schema },
      temperature: 0.1
    };

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://maotsetung-comuna.vercel.app',
        'X-Title': 'Mao Tse Tung Payment Verifier',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn('OpenRouter primary model error, trying fallback:', response.status);
      payload.model = 'google/gemini-2.5-flash-lite';
      delete payload.response_format.schema; // Fallback plain json_object mode
      const fallbackResp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://maotsetung-comuna.vercel.app',
          'X-Title': 'Mao Tse Tung Payment Verifier',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!fallbackResp.ok) {
        throw new Error(`Error en API OpenRouter (${response.status})`);
      }
      const fallbackData = await fallbackResp.json();
      return postProcessResult(fallbackData, expectedBsAmount);
    }

    const data = await response.json();
    return postProcessResult(data, expectedBsAmount);
  } catch (error) {
    // FAIL OPEN POLICY (§4 & §6):
    // Any exception in AI call or JSON parsing returns non-suspicious result
    // The payment then follows normal human-review path without blocking user revenue
    console.warn('AI analysis error (FAIL OPEN activated):', error.message);
    return {
      extraction: null,
      suspicious: false,
      suspicionReasons: [],
      failOpen: true,
      error: error.message
    };
  }
}

/**
 * Server-Side Deterministic Post-Processing (§4 Finve Spec):
 * 1. suspicious = raw.suspicious === true || raw.isPagoMovilReceipt !== true
 * 2. Deterministic Amount Check: if diff between rounded extracted and expected > 1 Bs, force suspicious = true
 * 3. Sanitize suspicionReasons (strings, deduped, max 8)
 */
function postProcessResult(apiResponse, expectedBsAmount) {
  const content = apiResponse?.choices?.[0]?.message?.content || '{}';
  try {
    const cleanJson = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const raw = JSON.parse(cleanJson);

    let isSuspicious = Boolean(raw.suspicious) || raw.isPagoMovilReceipt !== true;
    const reasons = Array.isArray(raw.suspicionReasons)
      ? raw.suspicionReasons.filter(r => typeof r === 'string' && r.trim().length > 0)
      : [];

    if (raw.isPagoMovilReceipt === false && !reasons.includes('La imagen no corresponde a un comprobante de Pago Móvil.')) {
      reasons.unshift('La imagen no corresponde a un comprobante de Pago Móvil.');
    }

    // Deterministic Amount Check (§4):
    if (expectedBsAmount != null && raw.amountBs != null) {
      const expectedRounded = Math.round(Number(expectedBsAmount));
      const extractedRounded = Math.round(Number(raw.amountBs));
      const diff = Math.abs(expectedRounded - extractedRounded);

      if (diff > 1) {
        isSuspicious = true;
        const amountReason = `El monto del comprobante (${extractedRounded} Bs) no coincide con el esperado (${expectedRounded} Bs).`;
        if (!reasons.includes(amountReason)) {
          reasons.unshift(amountReason);
        }
      }
    }

    // Dedupe and cap at 8 reasons
    const sanitizedReasons = [...new Set(reasons)].slice(0, 8);

    const extraction = {
      referenceNumber: raw.referenceNumber ? String(raw.referenceNumber).trim() : null,
      amountBs: raw.amountBs ? Number(raw.amountBs) : null,
      date: raw.date ? String(raw.date).trim() : null,
      originPhone: raw.originPhone ? String(raw.originPhone).trim() : null,
      originBank: raw.originBank ? String(raw.originBank).trim() : null,
      originDocument: raw.originDocument ? String(raw.originDocument).trim() : null,
      destinationBank: raw.destinationBank ? String(raw.destinationBank).trim() : null,
      destinationDocument: raw.destinationDocument ? String(raw.destinationDocument).trim() : null,
    };

    return {
      extraction,
      suspicious: isSuspicious,
      suspicionReasons: sanitizedReasons,
      failOpen: false
    };
  } catch (err) {
    console.warn('JSON parsing error (FAIL OPEN activated):', err);
    return {
      extraction: null,
      suspicious: false,
      suspicionReasons: [],
      failOpen: true,
      error: 'Parse error'
    };
  }
}
