import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL || 'https://pb-uroprofin.157.173.104.214.nip.io';
const APP_ID = process.env.CEDULA_COM_VE_APP_ID || '9303';
const TOKEN = process.env.CEDULA_COM_VE_TOKEN || 'f39aa8a6a420cbf8b421ff4f18bcd716';
const EMAIL = process.env.UROPROFIN_SERVICE_EMAIL || 'servicio@uroprofin.local';
const PASSWORD = process.env.UROPROFIN_SERVICE_PASSWORD || 'Uroprofin2026!';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function cleanNationality(resident) {
  const nat = String(resident.nationality || '').toUpperCase();
  if (nat === 'E') return 'E';
  return 'V';
}

async function main() {
  console.log(`Conectando a PocketBase: ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  // Auth
  try {
    await pb.collection('users').authWithPassword(EMAIL, PASSWORD);
    console.log('[OK] Autenticacion exitosa en PocketBase.');
  } catch (err) {
    console.error('[ERROR] Error de autenticacion en PocketBase:', err.message);
    process.exit(1);
  }

  // Fetch all active residents
  console.log('Obteniendo lista de residentes del censo...');
  const residents = await pb.collection('residents').getFullList({
    filter: 'status = "active"',
    fields: 'id,firstName,lastName,idNumber,nationality,birthDate',
  });

  const missingBirthDate = residents.filter((r) => !r.birthDate && digits(r.idNumber).length >= 5);
  console.log(`Encontrados ${residents.length} residentes activos. ${missingBirthDate.length} sin fecha de nacimiento.`);

  let updatedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < missingBirthDate.length; index += 1) {
    const resident = missingBirthDate[index];
    const cedula = digits(resident.idNumber);
    const nac = cleanNationality(resident);
    const fullName = `${resident.firstName} ${resident.lastName}`.trim();

    console.log(`[${index + 1}/${missingBirthDate.length}] Consultando ${nac}-${cedula} (${fullName})...`);

    try {
      const url = `https://api.cedula.com.ve/api/v1?app_id=${APP_ID}&token=${TOKEN}&nacionalidad=${nac}&cedula=${cedula}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(` [ALERTA] Error HTTP ${res.status} en la API para ${cedula}`);
        failedCount += 1;
        continue;
      }
      const data = await res.json();
      const fechaNac = data?.data?.fecha_nac;

      if (fechaNac && /^\d{4}-\d{2}-\d{2}$/.test(fechaNac)) {
        await pb.collection('residents').update(resident.id, { birthDate: fechaNac });
        console.log(` [ACTUALIZADO] ${fullName} (${nac}-${cedula}): Fecha encontrada -> ${fechaNac}`);
        updatedCount += 1;
      } else {
        console.log(` [INFO] No se encontro fecha_nac en API para ${nac}-${cedula}`);
      }
    } catch (e) {
      console.error(` [ERROR] Error consultando ${cedula}:`, e.message);
      failedCount += 1;
    }

    // Pequeño delay de 200ms para cuidar el rate-limit de la API
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n=== PROCESO COMPLETADO ===`);
  console.log(`Total sin fecha procesados: ${missingBirthDate.length}`);
  console.log(`Actualizados con fecha: ${updatedCount}`);
  console.log(`Fallidos / No encontrados: ${failedCount}`);
}

main().catch(console.error);
