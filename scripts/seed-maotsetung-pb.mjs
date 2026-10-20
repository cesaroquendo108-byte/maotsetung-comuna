// Script de Inicialización y Semillero para PocketBase
// Comuna Mao Tse Tung - Parroquia San Agustín, Municipio Bolivariano Libertador, Caracas
// Escuela Nacional de Administración y Hacienda Pública (ENAHP-IUT)

import PocketBase from 'pocketbase';
import { COMMUNITY_CONFIG } from '../src/config/community.js';

const PB_URL = process.env.VITE_POCKETBASE_URL || process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.MAOTSETUNG_SERVICE_EMAIL || 'admin@maotsetung.local';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.MAOTSETUNG_SERVICE_PASSWORD || 'MaoTseTung2026!';

async function seed() {
  console.log(`Conectando a PocketBase en: ${PB_URL}`);
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  let authenticated = false;
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    authenticated = true;
    console.log('Autenticado como Superusuario (_superusers) de PocketBase.');
  } catch (superErr) {
    try {
      if (pb.admins) {
        await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
        authenticated = true;
        console.log('Autenticado como Superadministrador (admins) de PocketBase.');
      }
    } catch (_) {
      try {
        await pb.collection('users').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
        authenticated = true;
        console.log('Autenticado con cuenta técnica de usuario.');
      } catch (err) {
        console.warn('No fue posible autenticar con credenciales directas:', err.message);
        console.warn('Superuser error:', superErr.message);
      }
    }
  }

  if (!authenticated) {
    console.log('Asegúrese de exportar PB_ADMIN_EMAIL y PB_ADMIN_PASSWORD para ejecutar la inicialización completa.');
    return;
  }

  // 1. Crear o Verificar Comuna Mao Tse Tung
  let commune = null;
  try {
    commune = await pb.collection('communes').getFirstListItem(`code = "${COMMUNITY_CONFIG.code}"`);
    console.log(`Comuna ya registrada: [${commune.code}] ${commune.name} (ID: ${commune.id})`);
  } catch (_) {
    commune = await pb.collection('communes').create({
      code: COMMUNITY_CONFIG.code,
      name: COMMUNITY_CONFIG.name,
      legalName: COMMUNITY_CONFIG.legalName,
      state: COMMUNITY_CONFIG.state,
      municipality: COMMUNITY_CONFIG.municipality,
      parish: COMMUNITY_CONFIG.parish,
      postalCode: COMMUNITY_CONFIG.postalCode,
      country: COMMUNITY_CONFIG.country,
      status: 'active',
      tagline: COMMUNITY_CONFIG.tagline,
    });
    console.log(`Comuna creada con éxito: [${commune.code}] ${commune.name} (ID: ${commune.id})`);
  }

  // 2. Crear o Verificar los 5 Consejos Comunales en la colección zones
  console.log('Verificando los 5 Consejos Comunales de San Agustín:');
  for (let idx = 0; idx < COMMUNITY_CONFIG.councils.length; idx++) {
    const c = COMMUNITY_CONFIG.councils[idx];
    try {
      const existingZone = await pb.collection('zones').getFirstListItem(
        `community = "${commune.id}" && code = "${c.abbreviation}"`
      );
      console.log(`  - [${c.abbreviation}] ${c.name} ya existe (ID: ${existingZone.id})`);
    } catch (_) {
      const newZone = await pb.collection('zones').create({
        community: commune.id,
        code: c.abbreviation,
        name: c.name.toUpperCase(),
        reference: `${c.shortName} · Parroquia San Agustín`,
        sortOrder: idx + 1,
        sourceSheet: `CC_${c.abbreviation}`,
        status: 'active',
      });
      console.log(`  + [${c.abbreviation}] ${c.name} creado (ID: ${newZone.id})`);
    }
  }

  // 3. Vincular voceros y administradores autorizados
  const adminEmails = [
    'jesus.oquendo@gmail.com',
    'rosa.acosta05@gmail.com',
    'cesaroquendo10@gmail.com',
    'kilby12lite@gmail.com',
    'comunamaotsetung.caracas@gmail.com',
  ];

  console.log('Verificando membresías de administradores autorizados:');
  for (const email of adminEmails) {
    try {
      const user = await pb.collection('users').getFirstListItem(`email = "${email}"`);
      const memFilter = `community = "${commune.id}" && user = "${user.id}"`;
      try {
        const mem = await pb.collection('community_memberships').getFirstListItem(memFilter);
        if (mem.role !== 'admin' || mem.status !== 'active') {
          await pb.collection('community_memberships').update(mem.id, { role: 'admin', status: 'active' });
          console.log(`  * Membresía actualizada a admin para: ${email}`);
        } else {
          console.log(`  - Admin activo verificado: ${email}`);
        }
      } catch (_) {
        await pb.collection('community_memberships').create({
          community: commune.id,
          user: user.id,
          role: 'admin',
          status: 'active',
          notes: 'Membresía administrativa inicial de Comuna Mao Tse Tung',
        });
        console.log(`  + Membresía de admin creada para: ${email}`);
      }
    } catch (_) {
      console.log(`  . Usuario aún no registrado en auth: ${email} (se vinculará automáticamente en su primer inicio de sesión)`);
    }
  }

  console.log('Inicialización de Comuna Mao Tse Tung completada correctamente.');
}

seed().catch((err) => {
  console.error('Error durante la inicialización:', err);
  process.exit(1);
});
