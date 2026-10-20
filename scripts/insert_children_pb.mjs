// Uses --env-file=.env.local flag
import PocketBase from 'pocketbase';
import fs from 'node:fs';

const PB_URL = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

console.log(`Conectando a PocketBase: ${PB_URL}`);

// Try multiple auth approaches
let authenticated = false;

// Attempt 1: superuser
const superEmail = process.env.POCKETBASE_SUPERUSER_EMAIL;
const superPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD;
if (!authenticated && superEmail && superPassword) {
  try {
    await pb.collection('_superusers').authWithPassword(superEmail, superPassword);
    console.log('[OK] Autenticacion superuser exitosa');
    authenticated = true;
  } catch (e) { console.log('Superuser auth falló:', e.message); }
}

// Attempt 2: service user
const svcEmail = process.env.UROPROFIN_SERVICE_EMAIL;
const svcPassword = process.env.UROPROFIN_SERVICE_PASSWORD;
if (!authenticated && svcEmail && svcPassword) {
  try {
    await pb.collection('users').authWithPassword(svcEmail, svcPassword);
    console.log('[OK] Autenticacion servicio exitosa:', pb.authStore.model?.email);
    authenticated = true;
  } catch (e) { console.log('Service auth falló:', e.message); }
}

// Attempt 3: CNE user
const cneEmail = process.env.UROPROFIN_CNE_EMAIL;
const cnePassword = process.env.UROPROFIN_CNE_PASSWORD;
if (!authenticated && cneEmail && cnePassword) {
  try {
    await pb.collection('users').authWithPassword(cneEmail, cnePassword);
    console.log('[OK] Autenticacion CNE exitosa:', pb.authStore.model?.email);
    authenticated = true;
  } catch (e) { console.log('CNE auth falló:', e.message); }
}

if (!authenticated) {
  console.error('[ERROR] No se pudo autenticar con ningun metodo.');
  console.log('Variables disponibles:');
  console.log('  POCKETBASE_URL:', PB_URL ? '[OK]' : '[FALTA]');
  console.log('  POCKETBASE_SUPERUSER_EMAIL:', superEmail ? '[OK]' : '[FALTA]');
  console.log('  UROPROFIN_SERVICE_EMAIL:', svcEmail ? svcEmail : '[FALTA]');
  console.log('  UROPROFIN_CNE_EMAIL:', cneEmail ? cneEmail : '[FALTA]');
  process.exit(1);
}

// 1. Get the community
const communes = await pb.collection('communes').getFullList({ fields: 'id,code,name' });
console.log(`\nComunas encontradas: ${communes.length}`);
communes.forEach(c => console.log(`  - ${c.code}: ${c.name} (${c.id})`));

if (communes.length === 0) {
  console.error('No hay comunas registradas. No se pueden insertar residentes.');
  process.exit(1);
}

const community = communes[0];
console.log(`\nUsando comuna: ${community.code} (${community.id})`);

// 2. Get households
const households = await pb.collection('households').getFullList({
  filter: `community = "${community.id}" && status = "active"`,
  fields: 'id,code',
  sort: 'code',
});
console.log(`Hogares activos: ${households.length}`);

if (households.length === 0) {
  console.error('No hay hogares activos. No se pueden vincular residentes.');
  process.exit(1);
}

// 3. Get existing residents to avoid duplicates
const existingResidents = await pb.collection('residents').getFullList({
  filter: `community = "${community.id}" && status = "active"`,
  fields: 'id,firstName,lastName,idNumber,birthDate',
});
console.log(`Residentes existentes: ${existingResidents.length}`);

const existingSet = new Set();
for (const r of existingResidents) {
  existingSet.add(`${(r.firstName || '').toUpperCase().trim()}|${(r.lastName || '').toUpperCase().trim()}`);
  if (r.idNumber) {
    existingSet.add(`ID:${r.idNumber.replace(/\D/g, '')}`);
  }
}

// 4. Load children data
const children = JSON.parse(fs.readFileSync('scripts/children_data.json', 'utf-8'));
console.log(`\nNiños a insertar: ${children.length}`);

// Map sectors to households (round-robin if we don't have sector-based mapping)
const householdMap = new Map();
for (const h of households) {
  householdMap.set(h.code, h.id);
}

let created = 0;
let skipped = 0;
let errors = 0;

for (const child of children) {
  const nameKey = `${child.firstName}|${child.lastName}`;
  const idKey = child.idNumber ? `ID:${child.idNumber.replace(/\D/g, '')}` : null;

  // Check duplicates
  if (existingSet.has(nameKey)) {
    console.log(`  [EXISTE] Ya existe: ${child.firstName} ${child.lastName}`);
    skipped++;
    continue;
  }
  if (idKey && existingSet.has(idKey)) {
    console.log(`  [EXISTE] Ya existe (cédula): ${child.idNumber} - ${child.firstName} ${child.lastName}`);
    skipped++;
    continue;
  }

  // Pick a household (use first one as default)
  const householdId = households[0].id;

  try {
    await pb.collection('residents').create({
      community: community.id,
      household: householdId,
      firstName: child.firstName,
      lastName: child.lastName,
      idNumber: child.idNumber || '',
      nationality: child.nationality || 'V',
      birthDate: child.birthDate || '',
      relationship: child.relationship || 'Hijo/a',
      sex: child.sex || '',
      status: 'active',
    });
    existingSet.add(nameKey);
    if (idKey) existingSet.add(idKey);
    created++;
    console.log(`  [CREADO] ${child.firstName} ${child.lastName} (${child.birthDate || 'sin fecha'}) [${child.sector}]`);
  } catch (error) {
    errors++;
    console.log(`  [ERROR] ${child.firstName} ${child.lastName}: ${error.message}`);
    if (error.data) console.log(`     Detalle:`, JSON.stringify(error.data));
  }
}

console.log('\n========================================');
console.log(`RESUMEN DE INSERCION DE NINOS`);
console.log(`========================================`);
console.log(`Total procesados: ${children.length}`);
console.log(`Creados: ${created}`);
console.log(`Ya existian: ${skipped}`);
console.log(`Errores: ${errors}`);
console.log('========================================');
