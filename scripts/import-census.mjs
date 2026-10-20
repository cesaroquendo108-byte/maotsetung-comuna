import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import { parseCensus, parsePayments, safeSummary } from './census-lib.mjs';
import { importBatchPayload } from './import-policy.mjs';

const { values } = parseArgs({
  options: {
    census: { type: 'string' }, payments: { type: 'string' }, apply: { type: 'boolean', default: false },
    'export-private': { type: 'boolean', default: false },
    'accept-review-queue': { type: 'boolean', default: false },
    'community-code': { type: 'string', default: 'URP-001' },
    output: { type: 'string', default: 'imports' },
  },
});
if (!values.census || !values.payments) {
  console.error('Uso: npm run census:import -- --census "censo.xlsx" --payments "clap.xlsx" [--apply]');
  process.exit(1);
}

const fingerprintKey = process.env.UROPROFIN_IMPORT_HMAC_KEY || 'uroprofin-local-preview-v1';
const [census, payments] = await Promise.all([
  parseCensus(values.census, { communityCode: values['community-code'], fingerprintKey }),
  parsePayments(values.payments),
]);
console.log(JSON.stringify(safeSummary(census, payments), null, 2));

if (!values.apply && values['export-private']) {
  await fs.mkdir(values.output, { recursive: true });
  const file = path.join(values.output, `uroprofin-normalized-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(file, JSON.stringify({ census, payments }, null, 2), 'utf8');
  console.log(`Validación terminada. Archivo privado: ${path.resolve(file)}`);
  console.log('No se escribió nada en PocketBase. El archivo contiene PII: mantenlo fuera de Git y elimínalo al terminar la revisión.');
  process.exit(0);
}
if (!values.apply) {
  console.log('Validación terminada. No se escribió ningún archivo ni se modificó PocketBase.');
  console.log('Usa --export-private solo si necesitas revisar la salida normalizada en un equipo autorizado.');
  process.exit(0);
}

if (census.issues.length > 0 && !values['accept-review-queue']) {
  throw new Error(`La importación tiene ${census.issues.length} incidencias. Revisa el resumen y usa --accept-review-queue solo para cargarlas con estado de revisión.`);
}
if (!process.env.UROPROFIN_IMPORT_HMAC_KEY) throw new Error('Falta UROPROFIN_IMPORT_HMAC_KEY para generar claves técnicas no reversibles y estables.');

const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const email = process.env.UROPROFIN_SERVICE_EMAIL;
const password = process.env.UROPROFIN_SERVICE_PASSWORD;
if (!pbUrl || !email || !password) throw new Error('Faltan POCKETBASE_URL, UROPROFIN_SERVICE_EMAIL o UROPROFIN_SERVICE_PASSWORD.');

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
await pb.collection('users').authWithPassword(email, password);

async function first(collection, filter) {
  try { return await pb.collection(collection).getFirstListItem(filter); } catch (error) { if (error?.status === 404) return null; throw error; }
}
async function externalKeyIndex(collection, communityId) {
  const records = await pb.collection(collection).getFullList({
    filter: `community = "${communityId}"`,
    fields: 'id,externalKey',
  });
  return new Map(records.filter((record) => record.externalKey).map((record) => [record.externalKey, record]));
}
async function upsert(collection, index, externalKey, data) {
  const existing = index.get(externalKey);
  const record = existing
    ? await pb.collection(collection).update(existing.id, data)
    : await pb.collection(collection).create({ ...data, externalKey });
  index.set(externalKey, record);
  return record;
}

const communityCode = String(values['community-code']).trim().toUpperCase();
if (!/^[A-Z0-9_-]{2,30}$/.test(communityCode)) throw new Error('El código de comunidad solo admite letras, números, guion y guion bajo.');
let commune = await first('communes', `code = "${communityCode}"`);
if (!commune) commune = await pb.collection('communes').create({ code: communityCode, name: communityCode === 'URP-001' ? 'Comuna Uroprofin' : communityCode, status: 'active' });

const batch = await pb.collection('import_batches').create(importBatchPayload({
  communityId: commune.id,
  sourceFiles: [census.sourceFile, payments.sourceFile],
  summary: safeSummary(census, payments),
  importedBy: pb.authStore.model.id,
}));
try {
  let sector = await first('sectors', `community = "${commune.id}" && code = "BASE"`);
  if (!sector) sector = await pb.collection('sectors').create({ community: commune.id, code: 'BASE', name: 'Censo histórico 2023', status: 'review' });

  const [existingHouseholds, existingResidents, existingPayments] = await Promise.all([
    externalKeyIndex('households', commune.id),
    externalKeyIndex('residents', commune.id),
    externalKeyIndex('payment_import_staging', commune.id),
  ]);

  const householdIds = new Map();
  for (const household of census.households) {
    const record = await upsert('households', existingHouseholds, household.externalKey, { ...household, community: commune.id, sector: sector.id, importBatch: batch.id });
    householdIds.set(household.externalKey, record.id);
  }
  for (const resident of census.residents) {
    await upsert('residents', existingResidents, resident.externalKey, { ...resident, householdExternalKey: undefined, community: commune.id, household: householdIds.get(resident.householdExternalKey), importBatch: batch.id });
  }
  for (const payment of payments.payments) {
    await upsert('payment_import_staging', existingPayments, payment.externalKey, { ...payment, community: commune.id, importBatch: batch.id });
  }
  await pb.collection('import_batches').update(batch.id, { status: 'complete', completedAt: new Date().toISOString() });
  console.log(`Importación completada: ${batch.id}`);
} catch (error) {
  await pb.collection('import_batches').update(batch.id, { status: 'failed', errorCode: String(error?.status || 'unknown') }).catch(() => {});
  throw error;
}
