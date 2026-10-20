import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL || 'https://pb-uroprofin.157.173.104.214.nip.io';

const dates = {
  '17950382': '1986-09-02',
  '5961642': '1958-12-13',
  '19513000': '1987-01-27',
  '24280506': '1992-05-21',
  '12954845': '1971-11-23',
  '19607563': '1990-01-05',
  '15178905': '1979-08-22',
  '11030980': '1971-09-11',
  '6845141': '1961-07-11',
  '16210945': '1979-12-03',
  '6205148': '1963-11-21',
  '20491147': '1988-08-29',
  '19873110': '1987-09-11',
  '23202120': '1995-04-10',
  '18475493': '1984-10-17',
  '23619142': '1959-10-14',
  '21414482': '1993-01-29',
  '14746537': '1980-06-28',
  '23188032': '1960-04-03',
  '5961836': '1959-10-10',
  '6125363': '1961-08-16',
};

async function patchAll() {
  console.log(`Conectando a PocketBase: ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  // Authenticate as superuser or service account
  try {
    if (process.env.POCKETBASE_SUPERUSER_EMAIL && process.env.POCKETBASE_SUPERUSER_PASSWORD) {
      await pb.collection('_superusers').authWithPassword(process.env.POCKETBASE_SUPERUSER_EMAIL, process.env.POCKETBASE_SUPERUSER_PASSWORD);
      console.log('[OK] Autenticado como superusuario PocketBase.');
    } else {
      await pb.collection('users').authWithPassword('servicio@uroprofin.local', 'Uroprofin2026!');
      console.log('[OK] Autenticado como usuario servicio.');
    }
  } catch (err) {
    console.warn(`[AVISO] Autenticacion directa en PB: ${err.message}. Continuando con consulta publica o superuser.`);
  }

  let count = 0;
  for (const [cedula, birthDate] of Object.entries(dates)) {
    try {
      const records = await pb.collection('residents').getFullList({
        filter: `idNumber ~ "${cedula}"`,
        fields: 'id,firstName,lastName,idNumber,birthDate,community,household',
      });
      for (const rec of records) {
        if (!rec.birthDate) {
          console.log(`[PATCHING] ${rec.firstName} ${rec.lastName} (V-${cedula}) -> ${birthDate}`);
          await pb.collection('residents').update(rec.id, { birthDate });
          count += 1;
        } else {
          console.log(`[YA TIENE FECHA] ${rec.firstName} ${rec.lastName}: ${rec.birthDate}`);
        }
      }
    } catch (e) {
      console.error(`Error al actualizar V-${cedula}:`, e.message);
    }
  }
  console.log(`\nTOTAL ACTUALIZADOS EN POCKETBASE: ${count}`);
}

patchAll();
