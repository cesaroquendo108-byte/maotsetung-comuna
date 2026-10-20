import { allowJsonPost, authenticate, bodyOf, json } from './_consolidated.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const OPENROUTER_KEYS = [
  process.env.OPENROUTER_API_KEY,
  process.env.VITE_OPENROUTER_API_KEY,
].filter(Boolean);
const OPENROUTER_MODELS = [
  process.env.OPENROUTER_MODEL,
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.1-flash-lite',
].filter(Boolean);

function extractJsonFromText(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        /* noop */
      }
    }
  }
  return {
    es_documento_valido: false,
    motivo_invalidez: rawText.trim().slice(0, 400),
  };
}

function normalizeScanResult(parsed, scanType) {
  if (!parsed || parsed.es_documento_valido === false) return parsed;
  if (scanType === 'rif') {
    const addr = String(parsed.domicilio_fiscal || parsed.fiscalAddress || '').trim();
    parsed.estado = parsed.estado || parsed.state || 'Miranda';
    parsed.municipio = parsed.municipio || parsed.municipality || 'Sucre';
    parsed.parroquia = parsed.parroquia || parsed.parish || 'Petare';
    parsed.ciudad = parsed.ciudad || parsed.city || 'Caracas';

    if (!parsed.numero_casa && !parsed.houseNumber && addr) {
      const match = addr.match(/(?:CASA|QUINTA|QTA\.?|VIVIENDA|PARCELA|LOTE)\s*[:.-]?\s*(?:NRO\.?|N°|NUMERO|NO\.?|#)?\s*([0-9]{1,5})\b/i) ||
                    addr.match(/(?:NRO\.?|N°|NUMERO|NO\.?|#)\s*[:.-]?\s*([0-9]{1,5})\b/i) ||
                    addr.match(/\bCASA\s*([0-9]{1,5})\b/i) ||
                    addr.match(/\b([0-9]{3,4})\b/i);
      if (match) {
        parsed.numero_casa = match[1];
        parsed.houseNumber = match[1];
      }
    }
  }
  return parsed;
}

export default async function handler(req, res) {
  if (!allowJsonPost(req, res)) return;

  try {
    try {
      await authenticate(req);
    } catch {
      // Permitir escaneo durante autoregistro vecinal público
    }

    if (!GEMINI_API_KEY && !OPENROUTER_KEYS.length) {
      return json(res, 503, { error: 'El servicio de escaneo inteligente no está configurado.' });
    }
    const input = bodyOf(req);
    const scanType = String(req.query?.type || input.type || 'cedula').trim().toLowerCase();

    let image = null;
    let prompt = '';

    if (scanType === 'rif') {
      image = input.image || input.rifFile;
      if (!image) {
        return json(res, 400, { error: 'Falta la imagen del comprobante RIF.' });
      }
      prompt = `Transcribe all visible text from this Venezuelan SENIAT RIF document or identity document and map to JSON:
{
  "es_documento_valido": true,
  "tipo_documento_detectado": "RIF or CEDULA",
  "tipo_documento": "RIF",
  "numero_rif": "formato e.g. V-12345678-0 or J-12345678-0",
  "numero_cedula": "dígitos de cédula si es persona natural",
  "fullName": "nombre completo o razón social",
  "nombres": "primer y segundo nombre",
  "apellidos": "primer y segundo apellido",
  "razon_social": "nombre completo o razón social",
  "domicilio_fiscal": "dirección fiscal completa",
  "numero_casa": "número de casa o inmueble si aparece en la dirección fiscal o documento, ej: 1006 o null",
  "state": "estado",
  "estado": "estado",
  "municipality": "municipio",
  "municipio": "municipio",
  "parish": "parroquia",
  "parroquia": "parroquia",
  "city": "ciudad",
  "ciudad": "ciudad",
  "postalCode": "código o zona postal",
  "codigo_postal": "código o zona postal",
  "fecha_emision": "YYYY-MM-DD or null",
  "fecha_actualizacion": "YYYY-MM-DD or null",
  "expirationDate": "YYYY-MM-DD (para RIF venezolano, si no tiene vencimiento explícito pero tiene última actualización o inscripción, suma 3 años a esa fecha)",
  "fecha_vencimiento": "YYYY-MM-DD (para RIF venezolano, si no tiene vencimiento explícito pero tiene última actualización o inscripción, suma 3 años a esa fecha)"
}
Return valid JSON only. If not a valid Venezuelan document, set "es_documento_valido": false and "motivo_invalidez": "reason".`;
    } else {
      image = input.image || input.cedulaFile;
      if (!image) {
        return json(res, 400, { error: 'Falta la imagen de la cédula.' });
      }
      prompt = `Transcribe all visible text from this Venezuelan identity document (Cédula de Identidad) or SENIAT RIF and map to JSON:
{
  "es_documento_valido": true,
  "tipo_documento_detectado": "CEDULA or RIF",
  "tipo_documento": "V or E or RIF",
  "numero_cedula": "digits only",
  "cedula": "digits only",
  "numero_rif": "RIF e.g. V-XXXXXXXX-X if present",
  "fullName": "full name",
  "nombres": "first and middle names",
  "apellidos": "last names",
  "fecha_nacimiento": "YYYY-MM-DD or null",
  "fecha_vencimiento": "YYYY-MM-DD or null",
  "domicilio_fiscal": "dirección fiscal si es RIF o null",
  "estado_civil": "SOLTERO/CASADO/etc or null",
  "sexo": "M or F",
  "lugar_nacimiento": "city or state or null"
}
Return valid JSON only. If not a valid document, set "es_documento_valido": false and "motivo_invalidez": "reason".`;
    }

    const dataUri = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;

    // 1. Prioritize Direct Google Gemini API (AI Studio)
    if (GEMINI_API_KEY) {
      try {
        const cleanB64 = dataUri.replace(/^data:image\/\w+;base64,/, '');
        const mimeType = dataUri.includes('png') ? 'image/png' : 'image/jpeg';
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: cleanB64 } },
              ],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        });

        if (geminiRes.ok) {
          const gemData = await geminiRes.json();
          const rawText = gemData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = extractJsonFromText(rawText);
            if (parsed) {
              const normalized = normalizeScanResult(parsed, scanType);
              return json(res, 200, {
                success: true,
                data: normalized,
                ...normalized,
              });
            }
          }
        }
      } catch (_) {}
    }

    let lastError = null;
    for (const apiKey of OPENROUTER_KEYS) {
      for (const model of OPENROUTER_MODELS) {
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://maotsetung-comuna.vercel.app',
              'X-Title': 'Mao Tse Tung Registro Comunal',
            },
            body: JSON.stringify({
              model,
              temperature: 0.1,
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataUri } },
                  ],
                },
              ],
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            lastError = new Error(`OpenRouter (${response.status}): ${errText.slice(0, 150)}`);
            if (response.status === 402 || response.status === 429) {
              break;
            }
            continue;
          }

          const result = await response.json();
          const rawContent = result.choices?.[0]?.message?.content || '{}';
          const parsed = extractJsonFromText(rawContent);
          const normalized = normalizeScanResult(parsed, scanType);

          return json(res, 200, {
            success: true,
            data: normalized,
            ...normalized,
          });
        } catch (err) {
          lastError = err;
        }
      }
    }

    return json(res, 502, {
      error: lastError?.message || 'Error en OpenRouter al procesar la imagen.',
    });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || 'Error procesando el escaneo del documento.',
    });
  }
}
