import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import { lookupElectoralProfile } from '../server/cneProvider.js';

const digits = (value) => String(value || '').replace(/\D/g, '');
const upper = (value) => String(value || '').trim().toUpperCase();

function ageFromBirthDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) age -= 1;
  return age;
}

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    limit: { type: 'string', default: '10' },
    'community-code': { type: 'string', default: 'URP-001' },
    'include-existing': { type: 'boolean', default: false },
    target: { type: 'string', default: 'missing' },
    offset: { type: 'string', default: '0' },
  },
});

const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const cneEmail = process.env.UROPROFIN_CNE_EMAIL;
const cnePassword = process.env.UROPROFIN_CNE_PASSWORD;
const importEmail = process.env.UROPROFIN_SERVICE_EMAIL;
const importPassword = process.env.UROPROFIN_SERVICE_PASSWORD;
if (!pbUrl || !cneEmail || !cnePassword || !importEmail || !importPassword) {
  throw new Error('Faltan POCKETBASE_URL, UROPROFIN_CNE_* y UROPROFIN_SERVICE_*.');
}
if (!process.env.CEDULA_COM_VE_APP_ID || !process.env.CEDULA_COM_VE_TOKEN) throw new Error('Faltan CEDULA_COM_VE_APP_ID y CEDULA_COM_VE_TOKEN.');

const importPb = new PocketBase(pbUrl);
importPb.autoCancellation(false);
await importPb.collection('users').authWithPassword(importEmail, importPassword);
const cnePb = new PocketBase(pbUrl);
cnePb.autoCancellation(false);
const cneAuth = await cnePb.collection('users').authWithPassword(cneEmail, cnePassword);
const communityCode = upper(values['community-code']);
const community = await importPb.collection('communes').getFirstListItem(`code = "${communityCode}"`, { fields: 'id,code' });
const [residents, existingProfiles] = await Promise.all([
  importPb.collection('residents').getFullList({
    filter: `community = "${community.id}" && status = "active" && idNumber != ""`,
    sort: 'lastName,firstName',
    fields: 'id,firstName,lastName,idNumber,nationality,birthDate',
  }),
  cnePb.collection('electoral_profiles').getFullList({
    filter: `community = "${community.id}"`,
    fields: 'id,resident,status,votingCenterName,votingCenterAddress,source',
  }),
]);
const profileByResident = new Map(existingProfiles.map((profile) => [profile.resident, profile]));
const limit = Math.max(1, Math.min(500, Number(values.limit) || 10));
const offset = Math.max(0, Number(values.offset) || 0);
const target = String(values.target || 'missing');
function shouldCheck(resident) {
  const profile = profileByResident.get(resident.id);
  if (target === 'problem') {
    return Boolean(profile) && (
      !String(profile.votingCenterName || '').trim()
      || ['unknown', 'verification_error'].includes(profile.status)
    );
  }
  if (target === 'all') return true;
  return values['include-existing'] || !profile;
}
const candidates = residents
  .filter(shouldCheck)
  .filter((resident) => {
    const age = ageFromBirthDate(resident.birthDate);
    return age == null || age >= 18;
  })
  .slice(offset)
  .slice(0, limit);

const rows = [];
const errors = [];
for (const resident of candidates) {
  try {
    const normalizedId = digits(resident.idNumber);
    if (normalizedId.length < 5) {
      errors.push({ resident: resident.id, status: 'invalid_id' });
      continue;
    }
    const result = await lookupElectoralProfile(resident);
    const payload = {
      community: community.id,
      resident: resident.id,
      status: result.status,
      votingCenterName: result.center,
      votingCenterAddress: result.address,
      source: result.source,
      checkedAt: result.checkedAt,
      consentAt: result.checkedAt,
      checkedBy: cneAuth.record.id,
      providerReference: result.providerReference || result.rif || '',
      errorCode: result.errorCode || '',
    };
    const existing = profileByResident.get(resident.id);
    const shouldWrite = !existing
      || result.center
      || (existing.status === 'unknown' && result.status === 'not_registered');
    if (values.apply) {
      if (existing && shouldWrite) await cnePb.collection('electoral_profiles').update(existing.id, payload);
      else if (!existing) await cnePb.collection('electoral_profiles').create(payload);
    }
    rows.push({
      resident: resident.id,
      status: result.status,
      center: result.center || '',
      source: result.source || '',
      write: shouldWrite,
    });
  } catch (error) {
    errors.push({ resident: resident.id, error: error.message || 'CNE_LOOKUP_ERROR' });
  }
}

const centerStats = rows.reduce((stats, row) => {
  const key = row.center || 'Centro no informado';
  stats[key] = (stats[key] || 0) + 1;
  return stats;
}, {});

console.log(JSON.stringify({
  scannedResidents: residents.length,
  existingProfiles: existingProfiles.length,
  target,
  offset,
  candidates: candidates.length,
  checked: rows.length,
  failed: errors.length,
  updated: values.apply ? rows.filter((row) => row.write).length : 0,
  dryRun: !values.apply,
  centerStats,
  statusCounts: rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {}),
  errors,
}, null, 2));
