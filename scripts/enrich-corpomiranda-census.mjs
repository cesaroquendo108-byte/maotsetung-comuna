import path from 'node:path';
import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import { readSheet } from 'read-excel-file/node';

const CORPOMIRANDA_SHEETS = [
  'PORTON GRIS',
  'RECTA FARM1',
  'RECTA FARM1,1',
  'RECTA FARM2',
  'RECTA FARM3',
  'RECTA FARM4',
  'SUBIDA1',
  'SUBIDA2',
  'SUBIDA3',
  'SUBIDA4',
  'SUBIDA5',
  'SUBIDA6',
  'FINAL SUBIDA',
  'PLANA1',
  'PLANA2',
  'PLANA3',
  'PLANA4',
  'PLANA5',
  'PLANA6',
  'RES. YESICA1',
  'RES. YESICA2',
  'RES. ERIKA1',
  'RES. ERIKA2',
  'RESD SALCEDO',
  'PLANA INTERM1',
  'RESD OMAR',
  'RESD. DARLIN',
  'RESD NINA YOYA',
  'SUBIDA MORRO1',
  'SUBIDA MORRO2',
  'SUBIDA MORRO3',
  'SUBIDA MORRO4',
  'SUBIDA MORRO5',
  'SUBIDA MORRO6',
  'SUBIDA MORRO7',
  'SUBIDA MORRO8',
  'BAJADA MORRO1',
  'BAJADA MORRO2',
  'BAJADA MORRO3',
  'BAJADA MORRO4',
];

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const upper = (value) => text(value).toUpperCase();
const digits = (value) => text(value).replace(/\D/g, '');
const norm = (value) => upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

function normalizePhone(value) {
  const number = digits(value);
  return number.length >= 7 ? number : '';
}

function normalizeNationality(value) {
  const valueUpper = upper(value);
  if (valueUpper.startsWith('E')) return 'E';
  if (valueUpper.startsWith('V')) return 'V';
  return '';
}

function normalizeSex(value) {
  const valueUpper = upper(value);
  if (valueUpper.startsWith('F')) return 'F';
  if (valueUpper.startsWith('M')) return 'M';
  return '';
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return '';
  const year = Number(match[3]) < 100 ? 1900 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function findHeader(rows) {
  return rows.findIndex((row) => {
    const cells = row.map(norm);
    return cells.some((cell) => cell === 'CEDULA') && cells.some((cell) => cell === 'NOMBRE') && cells.some((cell) => cell === 'APELLIDO');
  });
}

function columnMap(headerRow) {
  const wanted = {
    family: ['N FAMILIA', 'NO FAMILIA'],
    street: ['CALLE'],
    stairs: ['ESCALERA'],
    house: ['CASA'],
    nationality: ['NACIONALIDAD'],
    idNumber: ['CEDULA'],
    firstName: ['NOMBRE'],
    lastName: ['APELLIDO'],
    sex: ['SEXO'],
    birthDate: ['FECHA DE NACIMIENTO'],
    age: ['EDAD'],
    phone: ['TELEFONO'],
    educationLevel: ['GRADO DE INSTRUCCION'],
    studies: ['ESTUDIA'],
    pregnant: ['ACTUALMENTE EMBARAZADA'],
    hasDisability: ['TIENE ALGUNA DISCAPACIDAD'],
    disabilityType: ['TIPO DE DISCAPACIDAD'],
    hasDisease: ['TIENE ALGUNA ENFERMEDAD'],
    disease: ['ENFERMEDAD'],
    hasBenefit: ['TIENE PENSION U OTRO BENEFICIO SOCIAL'],
    benefitProgram: ['INDIQUE INSTITUCIUON O PROGRAMA', 'INDIQUE INSTITUCION O PROGRAMA'],
    jobInstitutionType: ['TIPO DE INSTITUCION DONDE TRABAJA'],
    incomeClass: ['CLASIFICACION DE INGRESO'],
    occupation: ['OCUPACION'],
    monthlyIncome: ['INGRESO MENSUAL'],
    observation: ['OBSERVACION'],
  };
  const normalizedHeader = headerRow.map(norm);
  return Object.fromEntries(Object.entries(wanted).map(([key, labels]) => {
    const index = normalizedHeader.findIndex((cell) => labels.includes(cell));
    return [key, index];
  }));
}

function value(row, columns, key) {
  const index = columns[key];
  return index >= 0 ? row[index] : '';
}

async function parseCorpormiranda(file) {
  const records = [];
  const issues = [];
  for (const sheet of CORPOMIRANDA_SHEETS) {
    let rows;
    try {
      rows = await readSheet(file, sheet);
    } catch (error) {
      issues.push({ type: 'sheet_read_error', sheet, message: error.message });
      continue;
    }
    const headerIndex = findHeader(rows);
    if (headerIndex < 0) {
      issues.push({ type: 'missing_header', sheet });
      continue;
    }
    const columns = columnMap(rows[headerIndex]);
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const idNumberNormalized = digits(value(row, columns, 'idNumber'));
      const firstName = upper(value(row, columns, 'firstName'));
      const lastName = upper(value(row, columns, 'lastName'));
      if (!idNumberNormalized && !firstName && !lastName) continue;
      const nationality = normalizeNationality(value(row, columns, 'nationality')) || 'V';
      records.push({
        sheet,
        sourceRow: index + 1,
        idNumber: idNumberNormalized ? `${nationality}-${idNumberNormalized}` : '',
        idNumberNormalized,
        nationality,
        firstName,
        lastName,
        birthDate: dateValue(value(row, columns, 'birthDate')),
        age: text(value(row, columns, 'age')),
        sex: normalizeSex(value(row, columns, 'sex')),
        phone: normalizePhone(value(row, columns, 'phone')),
        educationLevel: upper(value(row, columns, 'educationLevel')),
        occupation: upper(value(row, columns, 'occupation')),
        locationNote: [
          text(value(row, columns, 'street')) && `calle ${text(value(row, columns, 'street'))}`,
          text(value(row, columns, 'stairs')) && `escalera ${text(value(row, columns, 'stairs'))}`,
          text(value(row, columns, 'house')) && `casa ${text(value(row, columns, 'house'))}`,
        ].filter(Boolean).join(', '),
        sensitiveNote: [
          text(value(row, columns, 'pregnant')) && `embarazo: ${text(value(row, columns, 'pregnant'))}`,
          text(value(row, columns, 'hasDisability')) && `discapacidad: ${text(value(row, columns, 'hasDisability'))}`,
          text(value(row, columns, 'disabilityType')) && `tipo discapacidad: ${text(value(row, columns, 'disabilityType'))}`,
          text(value(row, columns, 'hasDisease')) && `enfermedad: ${text(value(row, columns, 'hasDisease'))}`,
          text(value(row, columns, 'disease')) && `detalle enfermedad: ${text(value(row, columns, 'disease'))}`,
          text(value(row, columns, 'hasBenefit')) && `beneficio: ${text(value(row, columns, 'hasBenefit'))}`,
          text(value(row, columns, 'benefitProgram')) && `programa: ${text(value(row, columns, 'benefitProgram'))}`,
          text(value(row, columns, 'incomeClass')) && `ingreso: ${text(value(row, columns, 'incomeClass'))}`,
          text(value(row, columns, 'monthlyIncome')) && `ingreso mensual: ${text(value(row, columns, 'monthlyIncome'))}`,
          text(value(row, columns, 'observation')) && `observacion: ${text(value(row, columns, 'observation'))}`,
        ].filter(Boolean).join('; '),
      });
    }
  }
  const byId = new Map();
  for (const record of records) {
    if (!record.idNumberNormalized) continue;
    const existing = byId.get(record.idNumberNormalized);
    if (!existing || (record.birthDate && !existing.birthDate)) byId.set(record.idNumberNormalized, record);
  }
  return { records: [...byId.values()], issues, parsedRows: records.length };
}

function buildPatch(existing, enrichment, includeSensitiveNotes = false) {
  const patch = {};
  const setIfBlank = (field, value) => {
    if (value && !text(existing[field])) patch[field] = value;
  };
  setIfBlank('birthDate', enrichment.birthDate);
  setIfBlank('phone', enrichment.phone);
  setIfBlank('phone1', enrichment.phone);
  setIfBlank('sex', enrichment.sex);
  setIfBlank('educationLevel', enrichment.educationLevel);
  setIfBlank('occupation', enrichment.occupation);
  setIfBlank('nationality', enrichment.nationality);
  if (!text(existing.idNumber) && enrichment.idNumber) patch.idNumber = enrichment.idNumber;
  if (!text(existing.firstName) && enrichment.firstName) patch.firstName = enrichment.firstName;
  if (!text(existing.lastName) && enrichment.lastName) patch.lastName = enrichment.lastName;

  const noteParts = [`Corpormiranda ${enrichment.sheet} fila ${enrichment.sourceRow}`];
  if (enrichment.locationNote) noteParts.push(enrichment.locationNote);
  if (includeSensitiveNotes && enrichment.sensitiveNote) noteParts.push(enrichment.sensitiveNote);
  const newNote = noteParts.join(' | ');
  const currentNotes = text(existing.notes);
  if (newNote && !currentNotes.includes(`Corpormiranda ${enrichment.sheet} fila ${enrichment.sourceRow}`)) {
    patch.notes = [currentNotes, newNote].filter(Boolean).join('\n').slice(0, 2000);
  }
  return patch;
}

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'community-code': { type: 'string', default: 'URP-001' },
    'include-sensitive-notes': { type: 'boolean', default: false },
  },
});

if (!values.file) throw new Error('Uso: node scripts/enrich-corpomiranda-census.mjs --file "CORPOMIRANDA.xlsx" [--apply]');

const parsed = await parseCorpormiranda(values.file);
const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const email = process.env.UROPROFIN_SERVICE_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.UROPROFIN_SERVICE_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD;
if (!pbUrl || !email || !password) {
  console.log(JSON.stringify({
    source: path.basename(values.file),
    parsedRows: parsed.parsedRows,
    uniqueCedulas: parsed.records.length,
    issues: parsed.issues,
    apply: false,
    blocked: 'Faltan POCKETBASE_URL y credenciales de servicio para escribir en PocketBase.',
  }, null, 2));
  process.exit(values.apply ? 1 : 0);
}

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
await pb.collection('users').authWithPassword(email, password);
const communityCode = upper(values['community-code']);
const community = await pb.collection('communes').getFirstListItem(`code = "${communityCode}"`, { fields: 'id,code' });
const residents = await pb.collection('residents').getFullList({
  filter: `community = "${community.id}" && status = "active" && idNumber != ""`,
  fields: 'id,firstName,lastName,idNumber,nationality,birthDate,sex,phone,phone1,educationLevel,occupation,notes,status',
});
const residentById = new Map(residents.map((resident) => [digits(resident.idNumber), resident]).filter(([id]) => id));

const matches = [];
const unmatched = [];
for (const enrichment of parsed.records) {
  const resident = residentById.get(enrichment.idNumberNormalized);
  if (!resident) {
    unmatched.push({ idNumber: enrichment.idNumber, name: `${enrichment.firstName} ${enrichment.lastName}`.trim(), sheet: enrichment.sheet, row: enrichment.sourceRow });
    continue;
  }
  const patch = buildPatch(resident, enrichment, values['include-sensitive-notes']);
  if (Object.keys(patch).length) matches.push({ resident, enrichment, patch });
}

let updated = 0;
if (values.apply) {
  for (const match of matches) {
    await pb.collection('residents').update(match.resident.id, match.patch);
    updated += 1;
  }
}

const patchFields = matches.reduce((counts, match) => {
  for (const field of Object.keys(match.patch)) counts[field] = (counts[field] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  source: path.basename(values.file),
  parsedRows: parsed.parsedRows,
  uniqueCedulas: parsed.records.length,
  residentsWithCedula: residents.length,
  matched: matches.length,
  unmatched: unmatched.length,
  updated,
  dryRun: !values.apply,
  patchFields,
  issues: parsed.issues,
  unmatchedSample: unmatched.slice(0, 20),
}, null, 2));
