import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import { matchPaymentToHousehold } from './payment-matcher.mjs';

const upper = (value) => String(value ?? '').trim().toUpperCase();

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'community-code': { type: 'string', default: 'URP-001' },
  },
});

const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const email = process.env.UROPROFIN_SERVICE_EMAIL || process.env.POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.UROPROFIN_SERVICE_PASSWORD || process.env.POCKETBASE_SUPERUSER_PASSWORD;
if (!pbUrl || !email || !password) throw new Error('Faltan POCKETBASE_URL y credenciales de servicio.');

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
await pb.collection('users').authWithPassword(email, password);

const communityCode = upper(values['community-code']);
const community = await pb.collection('communes').getFirstListItem(`code = "${communityCode}"`, { fields: 'id,code' });
const [payments, residents, households] = await Promise.all([
  pb.collection('payment_import_staging').getFullList({
    filter: `community = "${community.id}" && status = "unmatched"`,
    fields: 'id,sourceRow,externalKey,payerName,amount,currency,status',
  }),
  pb.collection('residents').getFullList({
    filter: `community = "${community.id}" && status = "active"`,
    fields: 'id,firstName,lastName,household',
  }),
  pb.collection('households').getFullList({
    filter: `community = "${community.id}" && status = "active"`,
    fields: 'id,code',
  }),
]);

const matcherResidents = residents.map((resident) => ({
  ...resident,
  householdExternalKey: resident.household,
}));
const householdById = new Map(households.map((household) => [household.id, { externalKey: household.id, code: household.code }]));
const householdByCode = new Map(households.map((household) => [household.code, household]));
const results = payments.map((payment) => ({
  payment,
  match: matchPaymentToHousehold(payment, matcherResidents, householdById),
}));
const matched = results.filter((item) => item.match.matched);
const reasons = results.reduce((counts, item) => {
  counts[item.match.reason] = (counts[item.match.reason] || 0) + 1;
  return counts;
}, {});

let updated = 0;
if (values.apply) {
  for (const item of matched) {
    const household = householdByCode.get(item.match.householdCode);
    if (!household) continue;
    await pb.collection('payment_import_staging').update(item.payment.id, {
      status: 'matched',
      matchedHousehold: household.id,
      reviewNotes: `Coincidencia automatica post-enriquecimiento: ${item.match.reason}. Requiere revision humana antes de distribuir pagos agrupados.`,
    });
    updated += 1;
  }
}

console.log(JSON.stringify({
  pendingPayments: payments.length,
  matched: matched.length,
  updated,
  dryRun: !values.apply,
  reasons,
  matchedSample: matched.slice(0, 20).map((item) => ({
    sourceRow: item.payment.sourceRow,
    payerName: item.payment.payerName,
    householdCode: item.match.householdCode,
    reason: item.match.reason,
  })),
}, null, 2));
