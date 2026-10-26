import pb, { API_BASE } from './pocketbase.js';
import { fileToBase64 } from './openrouter.js';

const OPENROUTER_KEYS = [
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENROUTER_API_KEY) || '',
  (typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY) || '',
].filter(Boolean);
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_DIRECT_KEY = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_GEMINI_API_KEY || import.meta.env?.VITE_GOOGLE_API_KEY)) || '';
const VISION_MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.1-flash-lite',
];

/**
 * Client-side fast image downsampler for mobile cameras
 */
export async function compressImageFile(file, maxWidth = 1600, maxHeight = 1600, quality = 0.85) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          const compressed = new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.jpeg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressed);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * Normalizes date strings to ISO YYYY-MM-DD
 */
export function normalizeToIsoDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmyMatch = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  const ymdMatch = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return '';
}

/**
 * Extracts house number and optional suffix from address text
 */
export function extractHouseNumber(text) {
  if (!text) return { houseNumber: '', houseSuffix: '' };
  const s = String(text).toUpperCase();

  const patterns = [
    /(?:CASA|QUINTA|QTA\.?|VIVIENDA|PARCELA|LOTE)\s*[:.-]?\s*(?:NRO\.?|N°|NUMERO|NO\.?|#)?\s*([0-9]{1,5})\s*[-/]?\s*([A-Z0-9]{1,3})?\b/i,
    /(?:NRO\.?|N°|NUMERO|NO\.?|#)\s*[:.-]?\s*([0-9]{1,5})\s*[-/]?\s*([A-Z0-9]{1,3})?\b/i,
    /\bCASA\s*([0-9]{1,5})\s*([A-Z])?\b/i,
    /\b([0-9]{3,4})\s*([A-Z])?\b/i,
  ];

  for (const pat of patterns) {
    const match = s.match(pat);
    if (match) {
      return {
        houseNumber: match[1],
        houseSuffix: match[2] || '',
      };
    }
  }
  return { houseNumber: '', houseSuffix: '' };
}

/**
 * Extract clean JSON from LLM response text
 */
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

/**
 * Execute client-side vision completion via OpenRouter with multi-model fallback
 */
async function callVisionDirect(base64Data, prompt) {
  const dataUri = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
  let lastError = null;

  if (GEMINI_DIRECT_KEY) {
    try {
      const cleanB64 = dataUri.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = dataUri.includes('png') ? 'image/png' : 'image/jpeg';
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_DIRECT_KEY}`, {
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
          if (parsed) return parsed;
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  for (const apiKey of OPENROUTER_KEYS) {
    for (const model of VISION_MODELS) {
      const payload = {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: dataUri },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      };

      try {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://maotsetung-comuna.vercel.app',
            'X-Title': 'Mao Tse Tung Registro Comunal',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = new Error(`Error del motor de visión HTTP ${response.status}: ${errText.slice(0, 150)}`);
          if (response.status === 402 || response.status === 429) {
            break;
          }
          continue;
        }

        const json = await response.json();
        const text = json.choices?.[0]?.message?.content;
        if (!text) continue;
        const parsed = extractJsonFromText(text);
        if (parsed) return parsed;
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error('No se pudo procesar la imagen con los motores de visión disponibles.');
}

export function formatCedulaData(raw) {
  if (!raw || raw.es_documento_valido === false) {
    if (raw?.tipo_documento_detectado === 'RIF' || raw?.tipo_documento === 'RIF' || raw?.numero_rif || (raw?.motivo_invalidez && /RIF/i.test(raw.motivo_invalidez))) {
      const rifData = formatRifData({ ...raw, es_documento_valido: true });
      return {
        ...rifData,
        isRifDocument: true,
        tipo_documento: 'V',
        numero_cedula: rifData.numero_cedula_asociada || '',
        nombres: rifData.nombres,
        apellidos: rifData.apellidos,
        nombre_completo: rifData.razon_social,
      };
    }
    throw new Error(raw?.motivo_invalidez || 'No se reconoció una cédula de identidad válida o legible.');
  }

  // Auto-detect RIF uploaded in Cédula step
  if (raw.tipo_documento_detectado === 'RIF' || raw.tipo_documento === 'RIF' || (raw.numero_rif && !raw.numero_cedula)) {
    const rifData = formatRifData(raw);
    return {
      ...rifData,
      isRifDocument: true,
      tipo_documento: 'V',
      numero_cedula: rifData.numero_cedula_asociada || '',
      nombres: rifData.nombres,
      apellidos: rifData.apellidos,
      nombre_completo: rifData.razon_social,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const numCedula = String(raw.numero_cedula || raw.cedula || raw.documentNumber || '').replace(/\D/g, '');
  const tipoDoc = String(raw.tipo_documento || 'V').toUpperCase().includes('E') ? 'E' : 'V';
  const isoNac = normalizeToIsoDate(raw.fecha_nacimiento || raw.birthDate);
  const isoVenc = normalizeToIsoDate(raw.fecha_vencimiento || raw.expirationDate);

  let estaVencida = false;
  let mensajeVigencia = 'Cédula Verificada';
  if (isoVenc) {
    const venc = new Date(isoVenc);
    const curr = new Date(today);
    estaVencida = venc < curr;
    const [y, m, d] = isoVenc.split('-');
    mensajeVigencia = estaVencida ? `Vencida el ${d}/${m}/${y}` : `Vigente hasta ${d}/${m}/${y}`;
  }

  return {
    es_documento_valido: true,
    tipo_documento: tipoDoc,
    numero_cedula: numCedula,
    nombres: String(raw.nombres || raw.firstName || '').trim(),
    apellidos: String(raw.apellidos || raw.firstLastName || '').trim(),
    nombre_completo: String(raw.fullName || `${raw.nombres || ''} ${raw.apellidos || ''}`).trim(),
    fecha_nacimiento: isoNac,
    fecha_vencimiento: isoVenc,
    sexo: String(raw.sexo || raw.gender || 'M').toUpperCase().startsWith('F') ? 'F' : 'M',
    estado_civil: String(raw.estado_civil || raw.maritalStatus || 'SOLTERO').toUpperCase(),
    lugar_nacimiento: String(raw.lugar_nacimiento || raw.birthPlace || '').trim(),
    esta_vencida: estaVencida,
    mensaje_vigencia: mensajeVigencia,
  };
}

export function formatRifData(raw) {
  if (!raw || raw.es_documento_valido === false) {
    if (raw?.tipo_documento_detectado === 'CEDULA' || raw?.tipo_documento === 'V' || raw?.tipo_documento === 'E') {
      const cedulaData = formatCedulaData({ ...raw, es_documento_valido: true });
      return { ...cedulaData, isCedulaDocument: true };
    }
    throw new Error(raw?.motivo_invalidez || 'No se reconoció un comprobante de RIF SENIAT válido o legible.');
  }

  if (raw.tipo_documento_detectado === 'CEDULA' || (raw.tipo_documento && raw.tipo_documento !== 'RIF' && raw.numero_cedula && !raw.numero_rif)) {
    const cedulaData = formatCedulaData(raw);
    return { ...cedulaData, isCedulaDocument: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  let rawDate = raw.expirationDate || raw.fecha_vencimiento || raw.fecha_actualizacion || raw.fecha_emision;
  let isoVenc = normalizeToIsoDate(rawDate);
  const isoEmis = normalizeToIsoDate(raw.fecha_emision || raw.fecha_actualizacion);

  // In Venezuelan SENIAT RIF, certificate validity is 3 years from update/emission date
  if (isoVenc) {
    const [y, m, d] = isoVenc.split('-').map(Number);
    const currYear = new Date().getFullYear();
    if (isoVenc <= today || y <= currYear) {
      isoVenc = `${y + 3}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  } else if (isoEmis) {
    const [y, m, d] = isoEmis.split('-').map(Number);
    isoVenc = `${y + 3}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  let estaVencido = isoVenc ? isoVenc < today : false;
  let mensajeVigencia = 'Comprobante RIF Verificado';
  if (isoVenc) {
    const [y, m, d] = isoVenc.split('-');
    mensajeVigencia = estaVencido ? `RIF Vencido el ${d}/${m}/${y}` : `RIF Vigente hasta ${d}/${m}/${y}`;
  }

  // Standardize RIF: V-11165218-6
  let cleanRif = String(raw.numero_rif || raw.documentNumber || raw.numero_documento || '').trim().toUpperCase();
  const matchWithCheck = cleanRif.match(/^([VJEG])[- ]?(\d{6,9})[- ]?(\d)$/i);
  if (matchWithCheck) {
    cleanRif = `${matchWithCheck[1].toUpperCase()}-${matchWithCheck[2]}-${matchWithCheck[3]}`;
  } else {
    const matchNoCheck = cleanRif.match(/^([VJEG])[- ]?(\d{7,10})$/i);
    if (matchNoCheck) {
      const letter = matchNoCheck[1].toUpperCase();
      const digits = matchNoCheck[2];
      cleanRif = `${letter}-${digits.slice(0, -1)}-${digits.slice(-1)}`;
    }
  }

  // Extract Cédula from natural person RIF
  let cedulaAsociada = '';
  if (/^V-/i.test(cleanRif)) {
    const parts = cleanRif.split('-');
    if (parts[1]) cedulaAsociada = parts[1];
  } else if (raw.numero_cedula) {
    cedulaAsociada = String(raw.numero_cedula).replace(/\D/g, '');
  }

  const fiscalAddr = String(raw.fiscalAddress || raw.domicilio_fiscal || '').trim();
  let estado = String(raw.state || raw.estado || '').trim();
  let municipio = String(raw.municipality || raw.municipio || '').trim();
  let parroquia = String(raw.parish || raw.parroquia || '').trim();
  let ciudad = String(raw.city || raw.ciudad || '').trim();
  let postalCode = String(raw.postalCode || raw.codigo_postal || '').trim();

  // Parse from address or default to Comuna Mao Tse Tung's territorial location (Distrito Capital / Libertador / San Agustín / Caracas)
  if (/MIRANDA/i.test(fiscalAddr)) {
    estado = 'Miranda';
  } else if (/DISTRITO CAPITAL/i.test(fiscalAddr) || !estado) {
    estado = 'Distrito Capital';
  }

  if (/SUCRE|PETARE/i.test(fiscalAddr)) {
    municipio = 'Sucre';
  } else if (/LIBERTADOR/i.test(fiscalAddr) || !municipio) {
    municipio = 'Municipio Bolivariano Libertador';
  }

  if (/PETARE/i.test(fiscalAddr)) {
    parroquia = 'Petare';
  } else if (/SAN AGUSTIN|MARIN|HORNOS DE CAL|LA CHARNECA|EL MANGUITO/i.test(fiscalAddr) || !parroquia) {
    parroquia = 'San Agustín';
  }

  if (!ciudad) {
    ciudad = 'Caracas';
  }

  if (!postalCode) {
    const zpMatch = fiscalAddr.match(/ZONA POSTAL\s*[:#]?\s*(\d{4})/i) || fiscalAddr.match(/\bCP\s*[:#]?\s*(\d{4})/i);
    if (zpMatch) {
      postalCode = zpMatch[1];
    } else {
      const cpMatch = fiscalAddr.match(/\b(10\d{2})\b/);
      postalCode = cpMatch ? cpMatch[1] : (estado === 'Miranda' ? '1073' : '1010');
    }
  }

  // Extract house number from RIF address or raw
  let numeroCasa = String(raw.numero_casa || raw.houseNumber || '').trim();
  if (!numeroCasa && fiscalAddr) {
    const extracted = extractHouseNumber(fiscalAddr);
    if (extracted.houseNumber) {
      numeroCasa = extracted.houseNumber;
    }
  }

  const fullName = String(raw.fullName || raw.razon_social || raw.nombre_razon_social || raw.nombre_completo || '').trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  let nombres = String(raw.nombres || '').trim();
  let apellidos = String(raw.apellidos || '').trim();
  if (!nombres && !apellidos && nameParts.length >= 2) {
    if (nameParts.length === 2) {
      nombres = nameParts[0];
      apellidos = nameParts[1];
    } else if (nameParts.length === 3) {
      nombres = nameParts[0];
      apellidos = `${nameParts[1]} ${nameParts[2]}`;
    } else {
      nombres = `${nameParts[0]} ${nameParts[1]}`;
      apellidos = nameParts.slice(2).join(' ');
    }
  }

  return {
    es_documento_valido: true,
    tipo_documento: 'RIF',
    numero_rif: cleanRif,
    numero_cedula_asociada: cedulaAsociada,
    nombres,
    apellidos,
    razon_social: fullName,
    domicilio_fiscal: fiscalAddr,
    estado: estado || 'Distrito Capital',
    municipio: municipio || 'Municipio Bolivariano Libertador',
    parroquia: parroquia || 'San Agustín',
    ciudad: ciudad || 'Caracas',
    codigo_postal: postalCode,
    numero_casa: numeroCasa,
    fecha_vencimiento: isoVenc,
    esta_vencido: estaVencido,
    mensaje_vigencia: mensajeVigencia,
  };
}

/**
 * Scans Cédula de Identidad venezolana (V/E)
 */
export async function scanCedulaDocument(fileOrBase64) {
  let base64 = '';
  if (typeof fileOrBase64 === 'string') {
    base64 = fileOrBase64;
  } else {
    const compressed = await compressImageFile(fileOrBase64);
    base64 = await fileToBase64(compressed);
  }

  // Attempt serverless API first if available, otherwise direct vision
  let serverPayload = null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (pb?.authStore?.token) {
      headers.Authorization = `Bearer ${pb.authStore.token}`;
    }
    const apiRes = await fetch(`${API_BASE}/api/scan?type=cedula`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: base64 }),
    });
    if (apiRes.ok) {
      const data = await apiRes.json();
      const payload = data?.data || data;
      if (payload && typeof payload === 'object' && ('es_documento_valido' in payload || payload.numero_cedula || payload.numero_rif)) {
        serverPayload = payload;
      }
    }
  } catch {
    /* Fallback directly to client OpenRouter vision */
  }
  if (serverPayload) {
    return formatCedulaData(serverPayload);
  }

  const prompt = `Transcribe all visible text from this image and map to JSON:
{
  "es_documento_valido": true,
  "tipo_documento_detectado": "CEDULA or RIF",
  "tipo_documento": "V or E or RIF",
  "numero_cedula": "digits only",
  "numero_rif": "e.g. V-XXXXXXXX-X if present",
  "fullName": "Full name",
  "nombres": "First and middle names",
  "apellidos": "First and second surnames",
  "fecha_nacimiento": "YYYY-MM-DD",
  "fecha_vencimiento": "YYYY-MM-DD",
  "estado_civil": "SOLTERO or CASADO or DIVORCIADO or VIUDO",
  "sexo": "M or F",
  "lugar_nacimiento": "City or State",
  "fiscalAddress": "Full fiscal address if RIF"
}
Output ONLY valid JSON. If neither a Venezuelan ID nor RIF document, describe why in JSON {"es_documento_valido": false, "motivo_invalidez": "..."}.`;

  const raw = await callVisionDirect(base64, prompt);
  return formatCedulaData(raw);
}

/**
 * Scans RIF del SENIAT (Comprobante Digital o Carnet)
 */
export async function scanRifDocument(fileOrBase64) {
  let base64 = '';
  if (typeof fileOrBase64 === 'string') {
    base64 = fileOrBase64;
  } else {
    const compressed = await compressImageFile(fileOrBase64);
    base64 = await fileToBase64(compressed);
  }

  let serverPayload = null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (pb?.authStore?.token) {
      headers.Authorization = `Bearer ${pb.authStore.token}`;
    }
    const apiRes = await fetch(`${API_BASE}/api/scan?type=rif`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: base64 }),
    });
    if (apiRes.ok) {
      const data = await apiRes.json();
      const payload = data?.data || data;
      if (payload && typeof payload === 'object' && ('es_documento_valido' in payload || payload.numero_rif || payload.numero_cedula)) {
        serverPayload = payload;
      }
    }
  } catch {
    /* Fallback directly to client OpenRouter vision */
  }
  if (serverPayload) {
    return formatRifData(serverPayload);
  }

  const prompt = `Transcribe all visible text from this image and map to JSON:
{
  "es_documento_valido": true,
  "tipo_documento_detectado": "RIF or CEDULA",
  "tipo_documento": "RIF",
  "numero_rif": "extract RIF e.g. V-12345678-9",
  "numero_cedula": "cédula digits if natural person",
  "fullName": "Name or Razon Social",
  "nombres": "first and middle names",
  "apellidos": "surnames",
  "expirationDate": "YYYY-MM-DD (note: in Venezuelan SENIAT RIF, if only fecha de actualización/emisión is present, expiration is 3 years after that date)",
  "fiscalAddress": "Full fiscal address",
  "numero_casa": "número de casa si aparece en la dirección fiscal o documento, ej: 1006 o null",
  "state": "State name",
  "municipality": "Municipality name",
  "parish": "Parish name",
  "city": "City name",
  "postalCode": "Postal code"
}
Output ONLY valid JSON. If neither a SENIAT RIF nor Venezuelan ID, describe why in JSON {"es_documento_valido": false, "motivo_invalidez": "..."}.`;

  const raw = await callVisionDirect(base64, prompt);
  return formatRifData(raw);
}
