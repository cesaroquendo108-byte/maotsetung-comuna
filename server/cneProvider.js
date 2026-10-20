function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function clean(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function enabled(value, fallback = false) {
  return String(value ?? fallback).toLowerCase() === 'true';
}

function normalizeStatus(data = {}) {
  if (['registered', 'not_registered', 'verification_error', 'unknown'].includes(data.status)) return data.status;
  if (data.registered === true || data.inscrito === true) return 'registered';
  if (data.registered === false || data.inscrito === false) return 'not_registered';
  return 'unknown';
}

export function providerAvailable() {
  return true;
}

export function normalizeElectoralResult(raw) {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const cne = data?.cne && typeof data.cne === 'object' ? data.cne : {};
  const hasCedulaCne = Boolean(cne.centro_electoral || cne.centro || cne.centro_votacion);
  const status = hasCedulaCne ? 'registered' : normalizeStatus(data);
  return {
    status,
    registered: status === 'registered',
    center: clean(data?.center || data?.voting_center || data?.centro || data?.centro_votacion || cne.centro_electoral || cne.centro, 300),
    address: clean(data?.address || data?.voting_center_address || data?.direccion || data?.direccion_centro || cne.direccion, 500),
    state: clean(data?.state || data?.estado || cne.estado, 100),
    municipality: clean(data?.municipality || data?.municipio || cne.municipio, 100),
    parish: clean(data?.parish || data?.parroquia || cne.parroquia, 100),
    rif: clean(data?.rif, 40),
    fullName: clean([
      data?.primer_nombre,
      data?.segundo_nombre,
      data?.primer_apellido,
      data?.segundo_apellido,
    ].filter(Boolean).join(' '), 300),
    birthDate: clean(data?.fecha_nac || data?.birth_date || data?.fecha_nacimiento, 20),
    source: clean(data?.source || (hasCedulaCne ? 'cedula.com.ve:cne-historico-2012' : 'authorized-provider'), 160),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchCedulaComVe(resident, signal) {
  const appId = process.env.CEDULA_COM_VE_APP_ID;
  const token = process.env.CEDULA_COM_VE_TOKEN;
  if (!appId || !token) return null;
  const baseUrl = process.env.CEDULA_COM_VE_URL || 'https://api.cedula.com.ve/api/v1';
  const url = new URL(baseUrl);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('token', token);
  url.searchParams.set('nacionalidad', ['V', 'E'].includes(String(resident.nationality || '').toUpperCase()) ? String(resident.nationality).toUpperCase() : 'V');
  url.searchParams.set('cedula', digits(resident.idNumber));
  const response = await fetch(url, { method: 'GET', signal });
  if (!response.ok) throw new Error('CNE_UPSTREAM_ERROR');
  const raw = await response.json();
  if (raw?.error === true && !raw?.data) {
    return {
      status: 'unknown',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      source: 'cedula.com.ve:cne-historico-2012',
      checkedAt: new Date().toISOString(),
      errorCode: clean(raw?.message || raw?.error_str || 'CEDULA_LOOKUP_EMPTY', 120),
    };
  }
  return normalizeElectoralResult(raw);
}

async function fetchGenericProvider(resident, signal) {
  const providerUrl = process.env.CNE_PROVIDER_URL;
  const providerToken = process.env.CNE_PROVIDER_TOKEN;
  if (!providerUrl || !providerToken) return null;
  const response = await fetch(providerUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nationality: ['V', 'E'].includes(String(resident.nationality || '').toUpperCase())
        ? String(resident.nationality).toUpperCase()
        : 'V',
      idNumber: digits(resident.idNumber),
    }),
    signal,
  });
  if (!response.ok) throw new Error('CNE_UPSTREAM_ERROR');
  return normalizeElectoralResult(await response.json());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function fieldAfter(text, label, stopLabels = []) {
  const start = text.toLocaleUpperCase('es').indexOf(label.toLocaleUpperCase('es'));
  if (start < 0) return '';
  const after = text.slice(start + label.length);
  let end = after.length;
  for (const stop of stopLabels) {
    const index = after.toLocaleUpperCase('es').indexOf(stop.toLocaleUpperCase('es'));
    if (index >= 0 && index < end) end = index;
  }
  return clean(after.slice(0, end).replace(/^[:\s-]+/, '').trim(), 500);
}

function extractTablePairs(rawHtml) {
  const pairs = {};
  const rows = String(rawHtml || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean);
    for (let index = 0; index < cells.length - 1; index += 1) {
      const label = cells[index].replace(/\s+/g, ' ').trim();
      if (!/:$/.test(label)) continue;
      pairs[label.toLocaleUpperCase('es').replace(/:$/, '')] = cells[index + 1];
    }
  }
  return pairs;
}

function pairValue(pairs, labels = [], max = 240) {
  for (const label of labels) {
    const value = pairs[label.toLocaleUpperCase('es')];
    if (value) return clean(value, max);
  }
  return '';
}

export function normalizeDirectCne(rawHtml) {
  const text = stripTags(rawHtml);
  const upperText = text.toLocaleUpperCase('es');
  const notRegistered = upperText.includes('NO CORRESPONDE A UN ELECTOR')
    || upperText.includes('NO ESTA REGISTRADO')
    || upperText.includes('NO ESTÁ REGISTRADO')
    || upperText.includes('NO SE ENCUENTRA INSCRITO')
    || upperText.includes('NO SE ENCUENTRA INSCRITA');
  if (notRegistered) {
    return {
      status: 'not_registered',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      source: 'cne-direct',
      checkedAt: new Date().toISOString(),
    };
  }
  if (!upperText.includes('REGISTRO ELECTORAL') || upperText.includes('ADVERTENCIA')) {
    return {
      status: 'unknown',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      source: 'cne-direct',
      checkedAt: new Date().toISOString(),
    };
  }
  const pairs = extractTablePairs(rawHtml);
  const stop = ['Nombre:', 'Estado:', 'Municipio:', 'Parroquia:', 'Centro:', 'Dirección:', 'Direccion:', 'SERVICIO ELECTORAL', 'ESTATUS', 'Cerrar', 'Imprimir'];
  const center = pairValue(pairs, ['Centro'], 300)
    || fieldAfter(text, 'Centro:', ['Dirección:', 'Direccion:', 'SERVICIO ELECTORAL', 'ESTATUS', 'Cerrar', 'Imprimir']);
  return {
    status: center ? 'registered' : 'unknown',
    registered: Boolean(center),
    center: clean(center, 300),
    address: pairValue(pairs, ['Dirección', 'Direccion'], 500)
      || clean(fieldAfter(text, text.includes('Dirección:') ? 'Dirección:' : 'Direccion:', ['SERVICIO ELECTORAL', 'ESTATUS', 'Cerrar', 'Imprimir']), 500),
    state: pairValue(pairs, ['Estado'], 100)
      || clean(fieldAfter(text, 'Estado:', stop.filter((label) => label !== 'Estado:')), 100),
    municipality: pairValue(pairs, ['Municipio'], 100)
      || clean(fieldAfter(text, 'Municipio:', stop.filter((label) => label !== 'Municipio:')), 100),
    parish: pairValue(pairs, ['Parroquia'], 100)
      || clean(fieldAfter(text, 'Parroquia:', stop.filter((label) => label !== 'Parroquia:')), 100),
    source: 'cne-direct',
    checkedAt: new Date().toISOString(),
  };
}

async function fetchDirectCne(resident, signal) {
  if (!enabled(process.env.CNE_DIRECT_FALLBACK, true)) return null;
  const baseUrl = process.env.CNE_DIRECT_URL || 'http://www.cne.gov.ve/web/registro_electoral/ce.php';
  const nationality = ['V', 'E'].includes(String(resident.nationality || '').toUpperCase())
    ? String(resident.nationality).toUpperCase()
    : 'V';
  const url = new URL(baseUrl);
  url.searchParams.set('nacionalidad', nationality);
  url.searchParams.set('cedula', digits(resident.idNumber));
  const response = await fetch(url, { method: 'GET', signal });
  if (!response.ok) throw new Error('CNE_DIRECT_UPSTREAM_ERROR');
  return normalizeDirectCne(await response.text());
}

function csvSplit(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function csvRows(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = csvSplit(lines.shift()).map((name) => name.trim());
  return lines.map((line) => Object.fromEntries(csvSplit(line).map((value, index) => [header[index], value.trim()])));
}

function actaBasename(value) {
  return String(value || '').split('/').pop()?.trim() || '';
}

function findActaUrl(documentHtml) {
  return String(documentHtml || '').match(/https:\/\/static\.resultadosconvzla\.com\/[^"'\s<>]+Acta[^"'\s<>]+\.jpg/i)?.[0] || '';
}

function locationLine(...parts) {
  return parts.map((part) => clean(part, 120)).filter(Boolean).join(' · ');
}

let resultados2024IndexPromise = null;

async function loadResultados2024Index(signal) {
  if (!resultados2024IndexPromise) {
    resultados2024IndexPromise = (async () => {
      const resultsUrl = process.env.CNE_2024_RESULTS_CSV_URL || 'https://static.resultadosconvzla.com/RESULTADOS_2024_CSV_V3.csv';
      const tableUrl = process.env.CNE_2024_MESA_CSV_URL || 'https://static.resultadosconvzla.com/TablaMesaEleccionPresidencial2024.csv';
      const [resultsText, tableText] = await Promise.all([
        fetch(resultsUrl, { signal }).then((response) => {
          if (!response.ok) throw new Error('CNE_2024_RESULTS_CSV_ERROR');
          return response.text();
        }),
        fetch(tableUrl, { signal }).then((response) => {
          if (!response.ok) throw new Error('CNE_2024_MESA_CSV_ERROR');
          return response.text();
        }),
      ]);
      const resultByActa = new Map();
      for (const row of csvRows(resultsText)) {
        const key = actaBasename(row.URL);
        if (key) resultByActa.set(key, row);
      }
      const tableByCenterMesa = new Map();
      for (const row of csvRows(tableText)) {
        const key = `${row.CODIGO_CV}|${row.MESA}`;
        if (row.CODIGO_CV && row.MESA) tableByCenterMesa.set(key, row);
      }
      return { resultByActa, tableByCenterMesa };
    })().catch((error) => {
      resultados2024IndexPromise = null;
      throw error;
    });
  }
  return resultados2024IndexPromise;
}

export async function normalizeResultados2024FromDocument(documentHtml, { signal, index } = {}) {
  const actaUrl = findActaUrl(documentHtml);
  if (!actaUrl) {
    return {
      status: 'unknown',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      source: 'resultadosconvzla-2024',
      checkedAt: new Date().toISOString(),
      errorCode: 'RESULTADOS_2024_NOT_FOUND',
    };
  }
  const { resultByActa, tableByCenterMesa } = index || await loadResultados2024Index(signal);
  const result = resultByActa.get(actaBasename(actaUrl));
  if (!result) {
    return {
      status: 'unknown',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      source: 'resultadosconvzla-2024',
      checkedAt: new Date().toISOString(),
      errorCode: 'RESULTADOS_2024_ACTA_NOT_INDEXED',
    };
  }
  const table = tableByCenterMesa.get(`${result.CENTRO}|${result.MESA}`);
  const centerCode = clean(result.CENTRO, 40);
  const mesa = clean(result.MESA, 20);
  const centerName = clean(table?.['NOMBRE DEL CENTRO DE VOTACION'] || `Centro electoral ${centerCode}`, 300);
  const state = clean(result.EDO || table?.DES_ESTADO, 100);
  const municipality = clean(result.MUN || table?.DES_MUNICIPIO, 100);
  const parish = clean(result.PAR || table?.DES_PARROQUIA, 100);
  return {
    status: 'registered',
    registered: true,
    center: centerName,
    address: locationLine(state, municipality, parish, mesa ? `Mesa ${mesa}` : ''),
    state,
    municipality,
    parish,
    source: 'resultadosconvzla-2024',
    checkedAt: new Date().toISOString(),
    providerReference: clean(`centerCode=${centerCode};mesa=${mesa}`, 120),
  };
}

async function fetchResultados2024(resident, signal) {
  if (!enabled(process.env.CNE_2024_RESULTS_FALLBACK, false)) return null;
  const nationality = ['V', 'E'].includes(String(resident.nationality || '').toUpperCase())
    ? String(resident.nationality).toUpperCase()
    : 'V';
  const baseUrl = String(process.env.CNE_2024_DOCUMENT_BASE_URL || 'https://resultadosconvzla.com/documento').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/${nationality}${digits(resident.idNumber)}`, {
    method: 'GET',
    headers: { 'User-Agent': 'MaoTseTung/0.1 electoral-center-enrichment' },
    signal,
  });
  if (!response.ok) throw new Error('CNE_2024_DOCUMENT_ERROR');
  return normalizeResultados2024FromDocument(await response.text(), { signal });
}

export async function lookupElectoralProfile(resident) {
  const errors = [];
  let foundBirthDate = '';
  for (const lookup of [fetchCedulaComVe, fetchGenericProvider, fetchDirectCne, fetchResultados2024]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const result = await lookup(resident, controller.signal);
      if (result?.birthDate && !foundBirthDate) foundBirthDate = result.birthDate;
      if (result?.center || result?.status === 'registered' || result?.status === 'not_registered' || result?.birthDate) {
        if (foundBirthDate && !result.birthDate) result.birthDate = foundBirthDate;
        return result;
      }
      if (result) errors.push(result.errorCode || `${result.source || 'provider'}_EMPTY`);
    } catch (error) {
      errors.push(error.message || 'CNE_LOOKUP_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }
  if (errors.length) {
    return {
      status: 'unknown',
      registered: false,
      center: '',
      address: '',
      state: '',
      municipality: '',
      parish: '',
      birthDate: foundBirthDate || '',
      source: 'multi-provider',
      checkedAt: new Date().toISOString(),
      errorCode: clean(errors.join('|'), 120),
    };
  }
  throw Object.assign(new Error('CNE_PROVIDER_DISABLED'), { status: 503 });
}
