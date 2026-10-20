import crypto from 'node:crypto';
import path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import { importedResidentStatus } from './import-policy.mjs';

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const upper = (value) => text(value).toUpperCase();
const digits = (value) => text(value).replace(/\D/g, '');
const slug = (value) => upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(String(value)).digest('hex');

function trackIncompleteName(issues, firstName, lastName, sourceSheet, sourceRow) {
  if (!firstName || !lastName) issues.push({ type: 'incomplete_name', sourceSheet, sourceRow });
}

function headerIndex(rows, required) {
  return rows.findIndex((row) => required.every((needle) => row.some((cell) => upper(cell).includes(needle))));
}

function normalizeId(value, nationality = 'V') {
  const number = digits(value);
  if (!number) return { idNumber: '', idNumberNormalized: '' };
  const prefix = ['V', 'E'].includes(upper(nationality)) ? upper(nationality) : 'V';
  return { idNumber: `${prefix}-${number}`, idNumberNormalized: number };
}

function normalizePhone(value) {
  const number = digits(value);
  return number.length >= 7 ? number : '';
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!match) return '';
  const year = Number(match[3]) < 100 ? 1900 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function personKey(person, namespace, fingerprintKey) {
  if (person.idNumberNormalized) return `id:${hmac(fingerprintKey, `${namespace}:resident:v1:${person.idNumberNormalized}`)}`;
  return `bio:${hmac(fingerprintKey, `${namespace}:resident:v1:${person.firstName}|${person.lastName}|${person.birthDate}|${person.householdExternalKey}`)}`;
}

export function residentExternalKey(person, { communityCode = 'URP-001', fingerprintKey } = {}) {
  if (!fingerprintKey) throw new Error('fingerprintKey es obligatoria.');
  return personKey(person, slug(communityCode) || 'UROPROFIN', fingerprintKey);
}

export async function parseCensus(file, { communityCode = 'URP-001', fingerprintKey = 'uroprofin-local-preview-v1' } = {}) {
  const namespace = slug(communityCode) || 'UROPROFIN';
  const [primaryRows, secondaryRows] = await Promise.all([
    readSheet(file, 'CENSO TOTAL'),
    readSheet(file, 'Copia de CENSO TOTAL'),
  ]);
  const primaryHeader = headerIndex(primaryRows, ['COMUNA', 'CC', 'NOMBRE', 'CEDULA']);
  const familyHeaderIndexes = primaryRows
    .map((row, index) => ({ index, isHeader: row.some((cell) => upper(cell).includes('NOMBRE COMPLETO DEL JEFE DE FAMILIA')) }))
    .filter((item) => item.isHeader)
    .map((item) => item.index);
  if (primaryHeader < 0) throw new Error('No se encontró el encabezado principal del censo.');

  const primaryEnd = familyHeaderIndexes[0] >= 0 ? familyHeaderIndexes[0] : primaryRows.length;
  const communeNames = new Set();
  const councilNames = new Set();
  const households = new Map();
  const residents = new Map();
  const issues = [];
  let currentHouseholdKey = '';
  let lastSequence = null;
  let block = 1;

  for (let index = primaryHeader + 1; index < primaryEnd; index += 1) {
    const row = primaryRows[index] || [];
    const commune = upper(row[1]);
    const council = upper(row[2]);
    const firstName = upper(row[3]);
    const lastName = upper(row[4]);
    const id = normalizeId(row[5]);
    const phone1 = normalizePhone(row[6]);
    const phone2 = normalizePhone(row[7]);
    if (!firstName && !lastName && !id.idNumberNormalized) continue;

    if (commune) communeNames.add(commune);
    if (council) councilNames.add(council);
    const sequence = Number(row[0]);
    if (Number.isFinite(sequence) && sequence > 0) {
      if (lastSequence != null && sequence <= lastSequence) block += 1;
      lastSequence = sequence;
      currentHouseholdKey = `${slug(council || 'UROPROFIN')}-${String(block).padStart(2, '0')}-${String(sequence).padStart(3, '0')}`;
      if (!households.has(currentHouseholdKey)) {
        households.set(currentHouseholdKey, {
          externalKey: currentHouseholdKey,
          code: `URP-${String(block).padStart(2, '0')}-${String(sequence).padStart(3, '0')}`,
          legacySequence: sequence,
          legacyBlock: block,
          sourceRow: index + 1,
          status: 'active',
        });
      }
    }
    if (!currentHouseholdKey) {
      currentHouseholdKey = `UNASSIGNED-${String(index + 1).padStart(4, '0')}`;
      households.set(currentHouseholdKey, { externalKey: currentHouseholdKey, code: `URP-PEND-${String(index + 1).padStart(4, '0')}`, sourceRow: index + 1, status: 'review' });
    }

    const resident = {
      externalKey: '', householdExternalKey: currentHouseholdKey, firstName, lastName,
      ...id, phone1, phone2, nationality: id.idNumber ? 'V' : '', birthDate: '', sex: '', relationship: '',
      sourceSheet: 'CENSO TOTAL', sourceRow: index + 1, isLegacyBeneficiary: false,
      status: importedResidentStatus({ firstName, lastName }),
    };
    trackIncompleteName(issues, firstName, lastName, resident.sourceSheet, resident.sourceRow);
    resident.externalKey = residentExternalKey(resident, { communityCode: namespace, fingerprintKey });
    if (residents.has(resident.externalKey)) {
      issues.push({ type: 'duplicate_resident', sourceSheet: resident.sourceSheet, sourceRow: resident.sourceRow });
      const existing = residents.get(resident.externalKey);
      if (!existing.phone1) existing.phone1 = phone1 || phone2;
      continue;
    }
    residents.set(resident.externalKey, resident);
  }

  for (let section = 0; section < familyHeaderIndexes.length; section += 1) {
    const start = familyHeaderIndexes[section] + 1;
    const end = familyHeaderIndexes[section + 1] || primaryRows.length;
    for (let index = start; index < end; index += 1) {
      const row = primaryRows[index] || [];
      const headId = normalizeId(row[5]).idNumberNormalized;
      const relationship = upper(row[9]);
      const firstName = upper(row[10]);
      const lastName = upper(row[11]);
      const nationality = upper(row[12]);
      const id = normalizeId(row[13], nationality);
      const birthDate = dateValue(row[15]);
      if (!firstName && !lastName && !id.idNumberNormalized) continue;

      let householdExternalKey = '';
      if (headId) {
        const head = [...residents.values()].find((resident) => resident.idNumberNormalized === headId);
        householdExternalKey = head?.householdExternalKey || '';
      }
      const hasMatchedHousehold = Boolean(householdExternalKey);
      if (!hasMatchedHousehold) {
        const pendingKey = headId ? hmac(fingerprintKey, `${namespace}:household-head:v1:${headId}`).slice(0, 24) : String(index + 1).padStart(4, '0');
        householdExternalKey = `FAMILY-PENDING-${pendingKey}`;
        if (!households.has(householdExternalKey)) households.set(householdExternalKey, { externalKey: householdExternalKey, code: `URP-FAM-${String(households.size + 1).padStart(4, '0')}`, sourceRow: index + 1, status: 'review' });
        issues.push({ type: 'unmatched_household_head', sourceSheet: 'CENSO TOTAL', sourceRow: index + 1 });
      }
      const resident = {
        externalKey: '', householdExternalKey, firstName, lastName, ...id,
        phone1: normalizePhone(row[14]), phone2: '', nationality: ['V', 'E'].includes(nationality) ? nationality : '',
        birthDate, sex: ['F', 'M'].includes(upper(row[17])) ? upper(row[17]) : '', relationship,
        educationLevel: upper(row[18]), email: text(row[19]).toLowerCase(), occupation: upper(row[20]),
        sourceSheet: 'CENSO TOTAL', sourceRow: index + 1, isLegacyBeneficiary: false,
        status: importedResidentStatus({ hasMatchedHousehold, firstName, lastName }),
      };
      trackIncompleteName(issues, firstName, lastName, resident.sourceSheet, resident.sourceRow);
      resident.externalKey = residentExternalKey(resident, { communityCode: namespace, fingerprintKey });
      if (residents.has(resident.externalKey)) {
        issues.push({ type: 'duplicate_family_member', sourceSheet: resident.sourceSheet, sourceRow: resident.sourceRow });
        continue;
      }
      residents.set(resident.externalKey, resident);
    }
  }

  const secondaryHeader = headerIndex(secondaryRows, ['NOMBRE', 'APELLIDO', 'CEDULA', 'TELEFONO']);
  let legacyBeneficiaries = 0;
  if (secondaryHeader >= 0) {
    for (let index = secondaryHeader + 1; index < secondaryRows.length; index += 1) {
      const row = secondaryRows[index] || [];
      const id = normalizeId(row[3]);
      const firstName = upper(row[1]);
      const lastName = upper(row[2]);
      if (!firstName && !lastName && !id.idNumberNormalized) continue;
      legacyBeneficiaries += 1;
      const match = id.idNumberNormalized ? [...residents.values()].find((resident) => resident.idNumberNormalized === id.idNumberNormalized) : null;
      if (match) {
        match.isLegacyBeneficiary = true;
        if (!match.phone1) match.phone1 = normalizePhone(row[4]);
        continue;
      }
      const householdExternalKey = `SECONDARY-${String(index + 1).padStart(4, '0')}`;
      households.set(householdExternalKey, { externalKey: householdExternalKey, code: `URP-SEC-${String(index + 1).padStart(4, '0')}`, sourceRow: index + 1, status: 'review' });
      const resident = {
        externalKey: '', householdExternalKey, firstName, lastName, ...id, phone1: normalizePhone(row[4]), phone2: '',
        nationality: id.idNumber ? 'V' : '', birthDate: '', sex: '', relationship: 'JEFE/A DE HOGAR',
        sourceSheet: 'Copia de CENSO TOTAL', sourceRow: index + 1, isLegacyBeneficiary: true, status: 'review',
      };
      trackIncompleteName(issues, firstName, lastName, resident.sourceSheet, resident.sourceRow);
      resident.externalKey = residentExternalKey(resident, { communityCode: namespace, fingerprintKey });
      residents.set(resident.externalKey, resident);
      issues.push({ type: 'secondary_only_resident', sourceSheet: resident.sourceSheet, sourceRow: resident.sourceRow });
    }
  }

  const allResidents = [...residents.values()];
  const validBirthDates = allResidents.filter((resident) => resident.birthDate).length;
  const issueCounts = Object.fromEntries(Object.entries(issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {})).sort(([a], [b]) => a.localeCompare(b)));
  return {
    sourceFile: path.basename(file),
    communeNames: [...communeNames], councilNames: [...councilNames],
    households: [...households.values()], residents: allResidents, issues,
    summary: {
      households: households.size, residents: residents.size, legacyBeneficiaries,
      withId: allResidents.filter((resident) => resident.idNumberNormalized).length,
      withoutId: allResidents.filter((resident) => !resident.idNumberNormalized).length,
      withBirthDate: validBirthDates,
      primaryResidents: allResidents.filter((resident) => resident.sourceSheet === 'CENSO TOTAL' && !resident.relationship).length,
      relatedFamilyMembers: allResidents.filter((resident) => resident.sourceSheet === 'CENSO TOTAL' && resident.relationship).length,
      secondaryOnlyResidents: allResidents.filter((resident) => resident.sourceSheet === 'Copia de CENSO TOTAL').length,
      issues: issues.length,
      issueCounts,
    },
  };
}

export async function parsePayments(file) {
  const rows = await readSheet(file, 1);
  const payments = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const rawReference = text(row[0]);
    const amount = Number(row[1]);
    const payerName = text(row[2]);
    if (!rawReference || !Number.isFinite(amount) || amount <= 0) continue;
    payments.push({
      externalKey: hash(`${path.basename(file)}:${index + 1}:${rawReference}:${amount}`),
      sourceRow: index + 1, rawReference, amount, payerName, currency: 'VES', status: 'unmatched',
    });
  }
  return {
    sourceFile: path.basename(file), payments,
    summary: {
      transactions: payments.length,
      total: payments.reduce((sum, payment) => sum + payment.amount, 0),
      withPayerName: payments.filter((payment) => payment.payerName).length,
      unmatched: payments.length,
    },
  };
}

export function safeSummary(census, payments) {
  return { census: census.summary, payments: payments.summary, communeCount: census.communeNames.length, councilCount: census.councilNames.length };
}
