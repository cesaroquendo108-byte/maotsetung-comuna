import PocketBase from 'pocketbase';
import fs from 'node:fs';

const PB_URL = 'https://pb-uroprofin.157.173.104.214.nip.io';
const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

// Step 1: List auth methods and try to find communities
async function inspect() {
  try {
    // Get communes
    const communes = await pb.collection('communes').getFullList({ fields: 'id,code,name' });
    console.log('=== COMMUNES ===');
    console.log(JSON.stringify(communes, null, 2));

    if (communes.length === 0) {
      console.log('\nNo communes found. Checking if collection exists with no auth...');
    }

    // Get a few households
    for (const commune of communes) {
      const households = await pb.collection('households').getList(1, 5, {
        filter: `community = "${commune.id}" && status = "active"`,
        fields: 'id,code,status,community',
      });
      console.log(`\n=== HOUSEHOLDS for ${commune.code} (${commune.id}) ===`);
      console.log(`Total: ${households.totalItems}`);
      console.log(JSON.stringify(households.items, null, 2));
    }
  } catch (error) {
    console.log('Error without auth:', error.message);
    console.log('Status:', error.status);
  }
}

await inspect();

// Step 2: Try superuser auth
const superEmail = process.env.POCKETBASE_SUPERUSER_EMAIL;
const superPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD;

if (superEmail && superPassword) {
  console.log('\n=== Trying superuser auth ===');
  try {
    await pb.collection('_superusers').authWithPassword(superEmail, superPassword);
    console.log('Superuser auth OK');
    await inspect();
  } catch (error) {
    console.log('Superuser auth failed:', error.message);
  }
}

// Step 3: Try service email
const svcEmail = process.env.UROPROFIN_SERVICE_EMAIL;
const svcPassword = process.env.UROPROFIN_SERVICE_PASSWORD;

if (svcEmail && svcPassword) {
  console.log('\n=== Trying service user auth ===');
  try {
    await pb.collection('users').authWithPassword(svcEmail, svcPassword);
    console.log('Service auth OK, user:', pb.authStore.model?.email);
    await inspect();
  } catch (error) {
    console.log('Service auth failed:', error.message);
  }
}

// Also try the CNE user
const cneEmail = process.env.UROPROFIN_CNE_EMAIL;
const cnePassword = process.env.UROPROFIN_CNE_PASSWORD;
if (cneEmail && cnePassword) {
  console.log('\n=== Trying CNE user auth ===');
  try {
    await pb.collection('users').authWithPassword(cneEmail, cnePassword);
    console.log('CNE auth OK, user:', pb.authStore.model?.email);
    await inspect();
  } catch (error) {
    console.log('CNE auth failed:', error.message);
  }
}
