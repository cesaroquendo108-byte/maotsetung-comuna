import { authenticate, json, PB_URL } from '../_auth.js';
import { buildResidentsFilter, isElectoralSegment, profileMatchesElectoralSegment } from '../../src/lib/residentFilters.js';

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
  const requestOrigin = `${protocol}://${req.headers.host || ''}`;
  if (origin === requestOrigin) return true;
  const allowed = String(process.env.APP_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return true;
}

function allowGet(req, res) {
  if (!applyCors(req, res)) {
    json(res, 403, { error: 'Origen no autorizado.' });
    return false;
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(204).end();
    return false;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    json(res, 405, { error: 'Metodo no permitido.' });
    return false;
  }
  return true;
}

async function pbRequest(path, token) {
  const response = await fetch(`${PB_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.message || 'PocketBase rechazo la operacion.'), { status: response.status, data });
  return data;
}

const AUTHORIZED_ADMIN_EMAILS = [
  'jesus.oquendo@gmail.com',
  'rosa.acosta05@gmail.com',
  'rosaacostave@gmail.com',
  'cesaroquendo10@gmail.com',
  'cesarfinve@gmail.com',
  'cesaroquendo64@gmail.com',
  'cesaroquendo108@gmail.com',
  'oquendocesar25@gmail.com',
  'kilby12lite@gmail.com',
  'david.enahp@gmail.com',
  'comunamaotsetung.caracas@gmail.com',
];

function isAuthorizedAdmin(email) {
  const clean = String(email || '').trim().toLowerCase();
  return AUTHORIZED_ADMIN_EMAILS.includes(clean) || clean.endsWith('@uroprofin.invalid') || clean.endsWith('@maotsetung.invalid');
}

async function getAdminMembership(auth, communityId) {
  if (!isAuthorizedAdmin(auth.user?.email)) {
    throw Object.assign(new Error('Acceso restringido a administradores autorizados.'), { status: 403 });
  }
  const filter = encodeURIComponent(`user = "${auth.user.id}" && community = "${communityId}" && status = "active" && role = "admin"`);
  const data = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${filter}`, auth.token);
  const membership = data.items?.[0];
  if (!membership) throw Object.assign(new Error('Solo administradores pueden exportar el censo completo.'), { status: 403 });
  return membership;
}

async function getAllPages(path, token) {
  const items = [];
  let page = 1;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await pbRequest(`${path}${separator}page=${page}&perPage=200`, token);
    items.push(...(data.items || []));
    if (page >= Number(data.totalPages || 1)) break;
    page += 1;
  }
  return items;
}

function ageFromBirthDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) age -= 1;
  return String(age);
}

function segmentFromAge(age) {
  const number = Number(age);
  if (!Number.isFinite(number)) return 'Sin fecha';
  if (number < 18) return 'Ninez';
  if (number >= 60) return 'Adulto mayor';
  return 'Adulto';
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRows(residents, profiles) {
  const profileByResident = new Map(profiles.map((profile) => [profile.resident, profile]));
  return residents.map((resident) => {
    const profile = profileByResident.get(resident.id) || {};
    const age = ageFromBirthDate(resident.birthDate);
    return {
      Hogar: resident.expand?.household?.code || '',
      Calle: resident.expand?.household?.street || '',
      Casa: resident.expand?.household?.houseNumber || '',
      Nombre: resident.firstName || '',
      Apellido: resident.lastName || '',
      Cedula: resident.idNumber || '',
      Nacionalidad: resident.nationality || '',
      Telefono: resident.phone || resident.phone1 || resident.phone2 || '',
      FechaNacimiento: resident.birthDate || '',
      Edad: age,
      Segmento: segmentFromAge(age),
      Sexo: resident.sex || '',
      Relacion: resident.relationship || '',
      Educacion: resident.educationLevel || '',
      Ocupacion: resident.occupation || '',
      Gas: resident.gasProvider || '',
      EstadoRegistro: resident.status || '',
      CNE: profile.status || 'sin_verificar',
      CentroVotacion: profile.votingCenterName || '',
    };
  });
}

function safeFilenamePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 45);
}

function sendCsv(res, rows, filename) {
  const headers = Object.keys(rows[0] || { Hogar: '', Nombre: '', Apellido: '' });
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(',')),
  ].join('\r\n');
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(`\uFEFF${body}`);
}

function sendExcel(res, rows, filename) {
  const headers = Object.keys(rows[0] || { Hogar: '', Nombre: '', Apellido: '' });
  const tableRows = rows.map((row) => `<tr>${headers.map((header) => `<td>${htmlValue(row[header])}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif} table{border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} th{background:#d7263d;color:white}</style></head><body><h1>Censo Comunal Mao Tse Tung</h1><table><thead><tr>${headers.map((header) => `<th>${htmlValue(header)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xls"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

export default async function handler(req, res) {
  if (!allowGet(req, res)) return;
  try {
    if (!PB_URL) return json(res, 503, { error: 'PocketBase no esta configurado en el servidor.' });
    const communityId = String(req.query?.communityId || '').trim();
    if (!/^[a-z0-9]{15}$/i.test(communityId)) return json(res, 400, { error: 'La comunidad seleccionada no es valida.' });
    const format = String(req.query?.format || 'csv').toLowerCase();
    if (!['csv', 'xls', 'excel'].includes(format)) return json(res, 400, { error: 'Formato no soportado.' });
    const query = String(req.query?.query || '').trim();
    const segment = String(req.query?.segment || 'Todos').trim() || 'Todos';
    const council = String(req.query?.council || 'Todos').trim() || 'Todos';
    const auth = await authenticate(req);
    await getAdminMembership(auth, communityId);
    const profileFilter = encodeURIComponent(`community = "${communityId}"`);
    const profiles = await getAllPages(`/api/collections/electoral_profiles/records?filter=${profileFilter}&fields=resident,status,votingCenterName,votingCenterAddress,source,checkedAt`, auth.token);
    const matchingElectoralResidents = isElectoralSegment(segment)
      ? new Set(profiles
        .filter((profile) => profileMatchesElectoralSegment(profile, segment))
        .map((profile) => profile.resident))
      : null;
    const residentFilter = encodeURIComponent(buildResidentsFilter(`community = "${communityId}"`, { query, segment: isElectoralSegment(segment) ? 'Todos' : segment, council }));
    const residentRecords = await getAllPages(`/api/collections/residents/records?filter=${residentFilter}&sort=lastName,firstName&expand=household`, auth.token);
    const residents = matchingElectoralResidents
      ? residentRecords.filter((resident) => matchingElectoralResidents.has(resident.id))
      : residentRecords;
    const rows = buildRows(residents, profiles);
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = safeFilenamePart(segment === 'Todos' ? query : segment);
    const filename = `maotsetung-censo${suffix ? `-${suffix}` : ''}-${stamp}`;
    if (format === 'csv') return sendCsv(res, rows, filename);
    return sendExcel(res, rows, filename);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'No se pudo exportar el censo.' });
  }
}
