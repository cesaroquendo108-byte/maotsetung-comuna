import crypto from 'node:crypto';
import path from 'node:path';
import XLSX from 'xlsx';

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const upper = (value) => text(value).toUpperCase();
const digits = (value) => text(value).replace(/\D/g, '');
const slug = (value) => upper(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');
const present = (value) => value !== null && value !== undefined && text(value) !== '';
const hash = (key, value) => crypto.createHmac('sha256', key).update(String(value)).digest('hex');

// These codes are deliberately explicit. Sheet names are historical source data,
// while the code is the stable identifier exposed to operators and residents.
export const ZONE_CODES = Object.freeze({
  'PORTON GRIS': 'PG',
  'RECTA FARM1': 'RF1',
  'RECTA FARM1,1': 'RF1B',
  'RECTA FARM2': 'RF2',
  'RECTA FARM3': 'RF3',
  'RECTA FARM4': 'RF4',
  SUBIDA1: 'S1',
  SUBIDA2: 'S2',
  SUBIDA3: 'S3',
  SUBIDA4: 'S4',
  SUBIDA5: 'S5',
  SUBIDA6: 'S6',
  'FINAL SUBIDA': 'FS',
  PLANA1: 'P1',
  PLANA2: 'P2',
  PLANA3: 'P3',
  PLANA4: 'P4',
  PLANA5: 'P5',
  PLANA6: 'P6',
  'RES. YESICA1': 'RY1',
  'RES. YESICA2': 'RY2',
  'RES. ERIKA1': 'RE1',
  'RES. ERIKA2': 'RE2',
  'RESD SALCEDO': 'RS',
  'PLANA INTERM1': 'PI1',
  'RESD OMAR': 'RO',
  'RESD. DARLIN': 'RD',
  'RESD NINA YOYA': 'RNY',
  'SUBIDA MORRO1': 'SM1',
  'SUBIDA MORRO2': 'SM2',
  'SUBIDA MORRO3': 'SM3',
  'SUBIDA MORRO4': 'SM4',
  'SUBIDA MORRO5': 'SM5',
  'SUBIDA MORRO6': 'SM6',
  'SUBIDA MORRO7': 'SM7',
  'SUBIDA MORRO8': 'SM8',
  'BAJADA MORRO1': 'BM1',
  'BAJADA MORRO2': 'BM2',
  'BAJADA MORRO3': 'BM3',
  'BAJADA MORRO4': 'BM4',
});

export function stableZoneCode(sheetName) {
  const name = upper(sheetName);
  return ZONE_CODES[name] || slug(name).replace(/-/g, '').slice(0, 12) || 'ZONA';
}

function cellValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return text(value);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date?.y && date?.m && date?.d) return new Date(Date.UTC(date.y, date.m - 1, date.d)).toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!match) return '';
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? (rawYear <= 26 ? 2000 + rawYear : 1900 + rawYear) : rawYear;
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function calculateAge(birthDate, asOf = new Date()) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const month = asOf.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && asOf.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

function parseAge(value) {
  const match = text(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function normalizeIdentity(rawValue, nationality = 'V') {
  const raw = upper(rawValue);
  if (!raw) return { idNumber: '', idNumberNormalized: '', idQuality: 'empty' };
  if (/^(S\/?N|SN|SIN\s+NUMERO|NO\s+TIENE|N\/A|NA)$/.test(raw)) {
    return { idNumber: raw, idNumberNormalized: '', idQuality: 'sentinel' };
  }
  const number = digits(raw);
  if (!number) return { idNumber: raw, idNumberNormalized: '', idQuality: 'invalid' };
  const prefix = ['V', 'E'].includes(upper(nationality)) ? upper(nationality) : (raw.match(/[VE]/)?.[0] || 'V');
  return { idNumber: `${prefix}-${number}`, idNumberNormalized: number, idQuality: 'valid' };
}

export function normalizePhone(value) {
  const raw = upper(value);
  const number = digits(value);
  if (!number || /^(S\/?N|SN|NO\s+TIENE|N\/A|NA)$/.test(raw)) return '';
  return number.length >= 7 ? number : '';
}

function headerIndex(rows) {
  return rows.findIndex((row) => {
    const values = row.map(upper);
    return values.some((value) => value.includes('FAMILIA')) && values.some((value) => value.includes('PERSONAS'));
  });
}

function sectorReference(rows) {
  const row = rows.find((candidate) => upper(candidate?.[0]).startsWith('SECTOR:'));
  return row ? text(row[0]).replace(/^SECTOR:\s*/i, '') : '';
}

function familyExternalKey(key, communityCode, zoneCode, legacyNumber) {
  return hash(key, `${communityCode}:family:v1:${zoneCode}:${legacyNumber}`);
}

function dwellingExternalKey(key, communityCode, zoneCode, legacyNumber) {
  return hash(key, `${communityCode}:dwelling:v1:${zoneCode}:${legacyNumber}`);
}

function personExternalKey(key, communityCode, zoneCode, familyNumber, ordinal, person) {
  const identity = person.idNumberNormalized
    ? `id:${person.idNumberNormalized}`
    : `bio:${zoneCode}:${familyNumber}:${ordinal}:${person.firstName}|${person.lastName}|${person.birthDate}`;
  // The same cédula can legitimately appear in more than one census row
  // (duplicate-ID review case). Keep each source row addressable so a
  // duplicate is reviewed instead of silently merging two people.
  return hash(key, `${communityCode}:person:v2:${zoneCode}:${familyNumber}:${ordinal}:${identity}`);
}

function safeRow(row) {
  return row.map(cellValue);
}

function issue(type, base, details = {}) {
  return { type, ...base, ...details };
}

function finishFamily(family, families, zone, key, communityCode, issues) {
  if (!family) return;
  const realTotal = family.people.length;
  const review = family.totalDeclared !== null && family.totalDeclared !== realTotal;
  const record = {
    externalKey: familyExternalKey(key, communityCode, zone.code, family.legacyFamilyNumber),
    legacyFamilyNumber: family.legacyFamilyNumber,
    sourceSheet: zone.sourceSheet,
    sourceRow: family.sourceRow,
    sourceValues: family.sourceValues,
    dwellingExternalKey: dwellingExternalKey(key, communityCode, zone.code, family.legacyFamilyNumber),
    dwellingCode: `URP-${zone.code}-${String(family.sequence).padStart(3, '0')}`,
    dwellingSequence: family.sequence,
    totalDeclared: family.totalDeclared,
    totalReal: realTotal,
    reviewStatus: review ? 'review' : 'clear',
    people: family.people,
  };
  families.push(record);
  if (review) issues.push(issue('declared_total_mismatch', {
    sourceSheet: zone.sourceSheet,
    sourceRow: family.sourceRow,
    familyExternalKey: record.externalKey,
    legacyFamilyNumber: family.legacyFamilyNumber,
  }, { declared: family.totalDeclared, real: realTotal }));
}

/**
 * Parses the historical CORPOMIRANDA workbook into the consolidated domain.
 * The parser is intentionally side-effect free: it never writes a file or PocketBase.
 */
export function parseUroprofinWorkbook(file, {
  communityCode = 'URP-001',
  fingerprintKey = 'uroprofin-local-preview-v1',
  asOf = new Date(),
  sourceAsOf = new Date('2017-03-30T00:00:00Z'),
} = {}) {
  const workbook = XLSX.readFile(file, { cellDates: true, cellNF: false, cellText: false });
  const zones = [];
  const families = [];
  const people = [];
  const issues = [];
  const idGroups = new Map();
  const phoneGroups = new Map();
  const normalizedCommunity = slug(communityCode) || 'URP-001';

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    const header = headerIndex(rows);
    const zone = {
      name: sheetName,
      code: stableZoneCode(sheetName),
      order: sheetIndex + 1,
      sourceSheet: sheetName,
      reference: sectorReference(rows),
      status: 'active',
    };
    zones.push(zone);
    if (header < 0) {
      issues.push(issue('missing_header', { sourceSheet: sheetName }));
      return;
    }

    let current = null;
    let sequence = 0;
    let memberOrdinal = 0;
    for (let rowIndex = header + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const rawFamilyNumber = row[0];
      const familyNumber = Number(rawFamilyNumber);
      if (Number.isFinite(familyNumber) && familyNumber > 0) {
        finishFamily(current, families, zone, fingerprintKey, normalizedCommunity, issues);
        sequence += 1;
        memberOrdinal = 0;
        current = {
          legacyFamilyNumber: familyNumber,
          sequence,
          sourceRow: rowIndex + 1,
          sourceValues: safeRow(row),
          totalDeclared: present(row[4]) && Number.isFinite(Number(row[4])) ? Number(row[4]) : null,
          people: [],
        };
      } else if (current && present(row[4]) && current.totalDeclared === null && Number.isFinite(Number(row[4]))) {
        current.totalDeclared = Number(row[4]);
      }

      const hasPersonData = [row[5], row[7], row[8], row[9]].some(present);
      if (!hasPersonData) continue;
      if (!current) {
        issues.push(issue('person_without_family', { sourceSheet: sheetName, sourceRow: rowIndex + 1 }));
        continue;
      }

      memberOrdinal += 1;
      const identity = normalizeIdentity(row[7], row[6]);
      const birthDate = parseDate(row[12]);
      const ageSource = parseAge(row[13]);
      const ageAtSource = calculateAge(birthDate, sourceAsOf);
      const ageCurrent = calculateAge(birthDate, asOf);
      const firstName = upper(row[8]);
      const lastName = upper(row[9]);
      const phone = normalizePhone(row[17]);
      const person = {
        externalKey: personExternalKey(fingerprintKey, normalizedCommunity, zone.code, current.legacyFamilyNumber, memberOrdinal, { ...identity, firstName, lastName, birthDate }),
        firstName,
        lastName,
        ...identity,
        nationality: ['V', 'E'].includes(upper(row[6])) ? upper(row[6]) : '',
        birthDate,
        ageSource,
        ageAtSource,
        ageCurrent,
        relationship: upper(row[16]),
        phone,
        sex: ['F', 'M', 'X'].includes(upper(row[11])) ? upper(row[11]) : '',
        source: 'CORPOMIRANDA',
        sourceSheet: sheetName,
        sourceRow: rowIndex + 1,
        sourceValues: safeRow(row),
        familyExternalKey: familyExternalKey(fingerprintKey, normalizedCommunity, zone.code, current.legacyFamilyNumber),
        dwellingExternalKey: dwellingExternalKey(fingerprintKey, normalizedCommunity, zone.code, current.legacyFamilyNumber),
      };
      current.people.push(person);
      people.push(person);
      if (identity.idNumberNormalized) {
        if (!idGroups.has(identity.idNumberNormalized)) idGroups.set(identity.idNumberNormalized, []);
        idGroups.get(identity.idNumberNormalized).push(person);
      }
      if (phone) {
        if (!phoneGroups.has(phone)) phoneGroups.set(phone, []);
        phoneGroups.get(phone).push(person);
      }
      if (birthDate && ageSource !== null && ageAtSource !== null && Math.abs(ageAtSource - ageSource) > 1) {
        issues.push(issue('age_birthdate_inconsistent', { sourceSheet: sheetName, sourceRow: rowIndex + 1, personExternalKey: person.externalKey }, { ageSource, ageCurrent }));
      }
      if (!firstName || !lastName) issues.push(issue('incomplete_name', { sourceSheet: sheetName, sourceRow: rowIndex + 1, personExternalKey: person.externalKey }));
    }
    finishFamily(current, families, zone, fingerprintKey, normalizedCommunity, issues);
  });

  for (const [idNumberNormalized, records] of idGroups) {
    if (records.length < 2) continue;
    issues.push(issue('duplicate_id', { personExternalKeys: records.map((record) => record.externalKey) }, { idNumberNormalized, count: records.length }));
  }
  for (const [phone, records] of phoneGroups) {
    // The source contains two non-standard nine-digit entries. Keep them as
    // phone data, but don't classify them as shared-phone conflicts.
    if (![10, 11].includes(phone.length) || records.length < 2) continue;
    issues.push(issue('shared_phone', { personExternalKeys: records.map((record) => record.externalKey) }, { phone, count: records.length }));
  }

  const issueCounts = Object.fromEntries(Object.entries(issues.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, {})).sort(([a], [b]) => a.localeCompare(b)));
  const duplicateIds = [...idGroups.values()].filter((records) => records.length > 1);
  const sharedPhones = [...phoneGroups.entries()].filter(([phone, records]) => [10, 11].includes(phone.length) && records.length > 1);
  const summary = {
    zones: zones.length,
    families: families.length,
    people: people.length,
    declaredTotalMismatches: issues.filter((item) => item.type === 'declared_total_mismatch').length,
    validIds: people.filter((person) => person.idQuality === 'valid').length,
    emptyIds: people.filter((person) => person.idQuality === 'empty').length,
    sentinelIds: people.filter((person) => person.idQuality === 'sentinel').length,
    invalidIds: people.filter((person) => person.idQuality === 'invalid').length,
    withoutPhone: people.filter((person) => !person.phone).length,
    duplicateValidIds: duplicateIds.length,
    sharedPhones: sharedPhones.length,
    ageInconsistencies: issues.filter((item) => item.type === 'age_birthdate_inconsistent').length,
    peopleWithoutFamily: issues.filter((item) => item.type === 'person_without_family').length,
    issues: issues.length,
    issueCounts,
  };

  return {
    sourceFile: path.basename(file),
    sourceFormat: path.extname(file).toLowerCase().slice(1),
    communityCode: normalizedCommunity,
    zones,
    families,
    people,
    issues,
    summary,
  };
}

export function safeCensusSummary(parsed) {
  return {
    sourceFile: parsed.sourceFile,
    sourceFormat: parsed.sourceFormat,
    communityCode: parsed.communityCode,
    ...parsed.summary,
  };
}
