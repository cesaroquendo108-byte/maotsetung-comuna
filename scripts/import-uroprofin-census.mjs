import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import {
  parseUroprofinWorkbook,
  safeCensusSummary,
} from './uroprofin-census-lib.mjs';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'accept-review-queue': { type: 'boolean', default: false },
    'community-code': { type: 'string', default: 'URP-001' },
    'as-of': { type: 'string' },
    'source-as-of': { type: 'string', default: '2017-03-30' },
  },
});

if (!values.file) {
  console.error('Uso: npm run census:uroprofin -- --file "CORPOMIRANDA CENSO UROPROFIN.xls" [--apply]');
  process.exit(1);
}

const communityCode = String(values['community-code']).trim().toUpperCase();
if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(communityCode)) throw new Error('El código de comunidad no es válido.');
const fingerprintKey = process.env.UROPROFIN_IMPORT_HMAC_KEY || 'uroprofin-local-preview-v1';
const asOf = values['as-of'] ? new Date(`${values['as-of']}T00:00:00Z`) : new Date();
const sourceAsOf = new Date(`${values['source-as-of']}T00:00:00Z`);
if (Number.isNaN(asOf.getTime()) || Number.isNaN(sourceAsOf.getTime())) throw new Error('Las fechas --as-of y --source-as-of deben ser YYYY-MM-DD.');

const parsed = parseUroprofinWorkbook(values.file, { communityCode, fingerprintKey, asOf, sourceAsOf });
console.log(JSON.stringify(safeCensusSummary(parsed), null, 2));

if (!values.apply) {
  console.log('Vista previa terminada. No se escribió ningún archivo ni se modificó PocketBase.');
  process.exit(0);
}

if (!process.env.UROPROFIN_IMPORT_HMAC_KEY) throw new Error('Falta UROPROFIN_IMPORT_HMAC_KEY para una importación aplicada.');
if (parsed.issues.length && !values['accept-review-queue']) {
  throw new Error(`La importación tiene ${parsed.issues.length} casos de revisión. Usa --accept-review-queue después de inspeccionar el resumen.`);
}

const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const email = process.env.UROPROFIN_SERVICE_EMAIL;
const password = process.env.UROPROFIN_SERVICE_PASSWORD;
if (!pbUrl || !email || !password) throw new Error('Faltan POCKETBASE_URL, UROPROFIN_SERVICE_EMAIL o UROPROFIN_SERVICE_PASSWORD.');

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
await pb.collection('users').authWithPassword(email, password);
const importedBy = pb.authStore.model.id;
const sourceBytes = await fs.readFile(values.file);
const fingerprint = crypto.createHash('sha256').update(sourceBytes).digest('hex');

async function first(collection, filter, options = {}) {
  try {
    return await pb.collection(collection).getFirstListItem(filter, options);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function allByCommunity(collection, communityId, fields = 'id,externalKey,code') {
  return pb.collection(collection).getFullList({ filter: `community = "${communityId}"`, fields });
}

async function upsertByExternal(collection, index, externalKey, data) {
  const existing = index.get(externalKey);
  const record = existing
    ? await pb.collection(collection).update(existing.id, data)
    : await pb.collection(collection).create({ ...data, externalKey });
  index.set(externalKey, record);
  return record;
}

async function upsertByFilter(collection, filter, data) {
  const existing = await first(collection, filter);
  return existing ? pb.collection(collection).update(existing.id, data) : pb.collection(collection).create(data);
}

let community = await first('communes', `code = "${communityCode}"`);
if (!community) community = await pb.collection('communes').create({ code: communityCode, name: 'Comuna Uroprofin', status: 'active' });

let importRecord = await first('census_imports', `community = "${community.id}" && fingerprint = "${fingerprint}"`);
if (importRecord?.status === 'complete') {
  console.log(`Importación ya completada (${importRecord.lot}); no se duplicaron registros.`);
  process.exit(0);
}

const lot = `CORPOMIRANDA-${fingerprint.slice(0, 12).toUpperCase()}`;
const importData = {
  community: community.id,
  fileName: parsed.sourceFile,
  lot,
  source: 'CORPOMIRANDA',
  importedAt: new Date().toISOString(),
  status: 'processing',
  fingerprint,
  summary: safeCensusSummary(parsed),
  errorSummary: { issueCounts: parsed.summary.issueCounts },
  importedBy,
};
importRecord = importRecord
  ? await pb.collection('census_imports').update(importRecord.id, importData)
  : await pb.collection('census_imports').create(importData);

try {
  const [zoneRecords, dwellingRecords, familyRecords, residentRecords, householdRecords, caseRecords] = await Promise.all([
    allByCommunity('zones', community.id, 'id,code'),
    allByCommunity('dwellings', community.id, 'id,externalKey,code'),
    allByCommunity('families', community.id, 'id,externalKey,dwelling'),
    allByCommunity('residents', community.id, 'id,externalKey'),
    allByCommunity('households', community.id, 'id,externalKey,code'),
    allByCommunity('verification_cases', community.id, 'id,externalKey'),
  ]);
  const zoneIndex = new Map(zoneRecords.map((record) => [record.code, record]));
  const dwellingIndex = new Map(dwellingRecords.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
  const familyIndex = new Map(familyRecords.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
  const residentIndex = new Map(residentRecords.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
  const householdIndex = new Map(householdRecords.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
  const caseIndex = new Map(caseRecords.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
  const sectorIndex = new Map();

  for (const zone of parsed.zones) {
    const record = await upsertByFilter('zones', `community = "${community.id}" && code = "${zone.code}"`, {
      community: community.id,
      code: zone.code,
      name: zone.name,
      sortOrder: zone.order,
      sourceSheet: zone.sourceSheet,
      reference: zone.reference,
      status: zone.status,
    });
    zone.recordId = record.id;
    zoneIndex.set(zone.code, record);
  }

  for (const family of parsed.families) {
    const zone = parsed.zones.find((candidate) => candidate.sourceSheet === family.sourceSheet);
    const zoneRecord = zoneIndex.get(zone.code);
    let sector = sectorIndex.get(zone.code);
    if (!sector) {
      sector = await first('sectors', `community = "${community.id}" && code = "CENSUS-${zone.code}"`);
      if (!sector) sector = await pb.collection('sectors').create({ community: community.id, code: `CENSUS-${zone.code}`, name: zone.name, status: 'review' });
      sectorIndex.set(zone.code, sector);
    }
    const dwelling = await upsertByExternal('dwellings', dwellingIndex, family.dwellingExternalKey, {
      community: community.id,
      zone: zoneRecord.id,
      import: importRecord.id,
      code: family.dwellingCode,
      street: family.people[0]?.sourceValues?.[1] || '',
      staircase: family.people[0]?.sourceValues?.[2] || '',
      house: family.people[0]?.sourceValues?.[3] || '',
      reference: zone.reference,
      status: 'provisional',
      historicalCodes: [],
      sourceSheet: family.sourceSheet,
      sourceRow: family.sourceRow,
    });
    const household = await upsertByExternal('households', householdIndex, family.dwellingExternalKey, {
      community: community.id,
      sector: sector.id,
      code: family.dwellingCode,
      legacySequence: family.legacyFamilyNumber,
      address: zone.reference,
      reference: 'Puente de compatibilidad; la vivienda canónica está en dwellings.',
      status: family.reviewStatus === 'review' ? 'review' : 'active',
      sourceRow: family.sourceRow,
    });
    const familyRecord = await upsertByExternal('families', familyIndex, family.externalKey, {
      community: community.id,
      zone: zoneRecord.id,
      dwelling: dwelling.id,
      import: importRecord.id,
      legacyFamilyNumber: family.legacyFamilyNumber,
      sourceSheet: family.sourceSheet,
      sourceRow: family.sourceRow,
      totalDeclared: family.totalDeclared ?? 0,
      totalReal: family.totalReal,
      reviewStatus: family.reviewStatus,
      sourceValues: family.sourceValues,
    });
    family.recordId = familyRecord.id;
    family.dwellingRecordId = dwelling.id;

    for (const [ordinal, person] of family.people.entries()) {
      const residentData = {
        community: community.id,
        household: household.id,
        firstName: person.firstName,
        lastName: person.lastName,
        idNumber: person.idNumber,
        idNumberNormalized: person.idNumberNormalized,
        idQuality: person.idQuality,
        nationality: person.nationality || 'V',
        birthDate: person.birthDate,
        sex: person.sex,
        relationship: person.relationship,
        phone: person.phone,
        source: person.source,
        sourceSheet: person.sourceSheet,
        sourceRow: person.sourceRow,
        sourceValues: person.sourceValues,
        status: person.idQuality === 'valid' && person.firstName && person.lastName ? 'active' : 'review',
        createdBy: importedBy,
        updatedBy: importedBy,
      };
      if (person.ageSource !== null && person.ageSource !== undefined) residentData.ageSource = person.ageSource;
      if (person.ageCurrent !== null && person.ageCurrent !== undefined) residentData.ageCurrent = person.ageCurrent;
      const resident = await upsertByExternal('residents', residentIndex, person.externalKey, residentData);
      person.recordId = resident.id;
      const membershipFilter = `family = "${familyRecord.id}" && person = "${resident.id}"`;
      await upsertByFilter('family_memberships', membershipFilter, {
        community: community.id,
        family: familyRecord.id,
        person: resident.id,
        import: importRecord.id,
        relationship: person.relationship,
        isResponsible: ordinal === 0 || /JEFE|RESPONSABLE|CABEZA/.test(person.relationship),
        status: family.reviewStatus === 'review' ? 'review' : 'active',
        sourceRow: person.sourceRow,
        sourceValues: person.sourceValues,
      });
    }
  }

  for (const [index, item] of parsed.issues.entries()) {
    const family = item.familyExternalKey ? familyIndex.get(item.familyExternalKey) : null;
    const person = item.personExternalKey ? residentIndex.get(item.personExternalKey) : null;
    const caseKey = crypto.createHash('sha256').update(`${fingerprint}:${item.type}:${index}:${item.familyExternalKey || ''}:${item.personExternalKey || ''}`).digest('hex');
    await upsertByExternal('verification_cases', caseIndex, caseKey, {
      community: community.id,
      externalKey: caseKey,
      type: item.type === 'declared_total_mismatch' ? 'declared_mismatch' : item.type === 'duplicate_id' ? 'duplicate_id' : item.type === 'shared_phone' ? 'duplicate_phone' : item.type === 'age_birthdate_inconsistent' ? 'age_inconsistent' : 'correction',
      dwelling: family?.dwelling || '',
      family: family?.id || '',
      person: person?.id || '',
      status: 'pending',
      query: item,
      notes: 'Generado automáticamente por la importación histórica; requiere revisión humana.',
    });
  }

  await pb.collection('census_imports').update(importRecord.id, {
    status: 'complete',
    summary: safeCensusSummary(parsed),
    errorSummary: { issueCounts: parsed.summary.issueCounts },
  });
  console.log(`Importación completada: ${lot}. Zonas: ${parsed.summary.zones}; familias: ${parsed.summary.families}; personas: ${parsed.summary.people}.`);
} catch (error) {
  await pb.collection('census_imports').update(importRecord.id, {
    status: 'failed',
    errorSummary: { message: String(error?.message || error), issueCounts: parsed.summary.issueCounts },
  }).catch(() => {});
  throw error;
}
