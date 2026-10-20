import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';

const digits = (value) => String(value ?? '').trim().replace(/\D/g, '');
const text = (value) => String(value ?? '').trim();

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: true },
    'community-code': { type: 'string', default: 'URP-001' },
    'app-id': { type: 'string', default: process.env.CEDULA_COM_VE_APP_ID || '9354' },
    token: { type: 'string', default: process.env.CEDULA_COM_VE_TOKEN || '5a34b11edc91ba134780588f1e7ad3a2' },
    url: { type: 'string', default: process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL || 'https://pb-uroprofin.157.173.104.214.nip.io' },
    email: { type: 'string', default: process.env.UROPROFIN_SERVICE_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL },
    password: { type: 'string', default: process.env.UROPROFIN_SERVICE_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD },
    delay: { type: 'string', default: '150' },
  },
});

const appId = text(values['app-id']);
const apiToken = text(values.token);

if (!appId || !apiToken) {
  console.error('[ERROR] Falta --app-id o --token para la API de cedula.com.ve');
  process.exit(1);
}

async function main() {
  console.log(`Conectando a PocketBase en: ${values.url}`);
  const pb = new PocketBase(values.url);
  pb.autoCancellation(false);

  // Authenticate if email/password provided
  if (values.email && values.password) {
    try {
      await pb.collection('users').authWithPassword(values.email, values.password);
      console.log(`Autenticado como: ${values.email}`);
    } catch (err) {
      console.warn(`Autenticación en usuarios falló (${err.message}). Intentando superusuario si aplica...`);
    }
  }

  // Find community
  let community = null;
  try {
    community = await pb.collection('communes').getFirstListItem(`code = "${values['community-code'].toUpperCase()}"`, { fields: 'id,code,name' });
    console.log(`Comunidad encontrada: ${community.name} (${community.code})`);
  } catch (err) {
    console.log(`Buscando en todos los registros activos sin filtro de comunidad...`);
  }

  const filter = community
    ? `community = "${community.id}" && status = "active"`
    : 'status = "active"';

  console.log('Obteniendo residentes activos...');
  const residents = await pb.collection('residents').getFullList({
    filter,
    sort: 'lastName,firstName',
    fields: 'id,firstName,lastName,idNumber,nationality,birthDate,household',
  });

  const missingDate = residents.filter((r) => !r.birthDate && digits(r.idNumber).length >= 5);
  console.log(`Total residentes: ${residents.length} | Sin fecha de nacimiento: ${missingDate.length}`);

  if (!missingDate.length) {
    console.log('Todos los residentes con cédula ya tienen su fecha de nacimiento registrada.');
    return;
  }

  const delayMs = Math.max(50, Number(values.delay) || 150);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < missingDate.length; index += 1) {
    const resident = missingDate[index];
    const cedula = digits(resident.idNumber);
    const nac = String(resident.nationality || '').toUpperCase() === 'E' ? 'E' : 'V';
    const fullName = `${resident.firstName} ${resident.lastName}`.trim() || `Cédula ${nac}-${cedula}`;

    process.stdout.write(`[${index + 1}/${missingDate.length}] ${fullName} (${nac}-${cedula})... `);

    try {
      const apiUrl = `https://api.cedula.com.ve/api/v1?app_id=${appId}&token=${apiToken}&nacionalidad=${nac}&cedula=${cedula}`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        console.log(`HTTP Error ${response.status}`);
        failed += 1;
        continue;
      }

      const json = await response.json();
      const fechaNac = json?.data?.fecha_nac;

      if (fechaNac && /^\d{4}-\d{2}-\d{2}$/.test(fechaNac)) {
        if (values.apply) {
          await pb.collection('residents').update(resident.id, { birthDate: fechaNac });
        }
        console.log(`Fecha asignada: ${fechaNac}`);
        updated += 1;
      } else {
        console.log(`La API no contiene fecha para esta cédula.`);
        skipped += 1;
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
      failed += 1;
    }

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log('\n=============================================');
  console.log(`Sincronización finalizada.`);
  console.log(`Fechas asignadas para siempre: ${updated}`);
  console.log(`Cédulas sin fecha en API: ${skipped}`);
  console.log(`Errores de conexión: ${failed}`);
  console.log('=============================================');
}

main().catch((err) => {
  console.error('Fallo crítico en ejecución:', err);
  process.exit(1);
});
