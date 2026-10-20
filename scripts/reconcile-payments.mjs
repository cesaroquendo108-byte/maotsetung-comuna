import { parseArgs } from 'node:util';
import PocketBase from 'pocketbase';
import { parseCensus, parsePayments } from './census-lib.mjs';
import { reconcilePaymentNames } from './payment-matcher.mjs';

const { values } = parseArgs({ options: {
  census: { type: 'string' },
  payments: { type: 'string' },
  apply: { type: 'boolean', default: false },
  'community-code': { type: 'string', default: 'URP-001' },
} });
if (!values.census || !values.payments) throw new Error('Indica --census y --payments.');

const [census, paymentBook] = await Promise.all([parseCensus(values.census), parsePayments(values.payments)]);
const results = reconcilePaymentNames(paymentBook.payments, census.residents, census.households);
const matched = results.filter((payment) => payment.match.matched);
const reasons = results.reduce((counts, payment) => {
  counts[payment.match.reason] = (counts[payment.match.reason] || 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ transactions: results.length, total: paymentBook.summary.total, matched: matched.length, pending: results.length - matched.length, reasons }, null, 2));
if (!values.apply) process.exit(0);

const pbUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const email = process.env.UROPROFIN_SERVICE_EMAIL;
const password = process.env.UROPROFIN_SERVICE_PASSWORD;
if (!pbUrl || !email || !password) throw new Error('Faltan las credenciales del servicio de importación.');

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
await pb.collection('users').authWithPassword(email, password);
const communityCode = String(values['community-code']).trim().toUpperCase();
const community = await pb.collection('communes').getFirstListItem(`code = "${communityCode}"`, { fields: 'id' });
const [staging, households] = await Promise.all([
  pb.collection('payment_import_staging').getFullList({ filter: `community = "${community.id}"`, fields: 'id,externalKey,status' }),
  pb.collection('households').getFullList({ filter: `community = "${community.id}"`, fields: 'id,code' }),
]);
const stagingByKey = new Map(staging.map((record) => [record.externalKey, record]));
const householdByCode = new Map(households.map((record) => [record.code, record]));
let updated = 0;
for (const payment of matched) {
  const staged = stagingByKey.get(payment.externalKey);
  const household = householdByCode.get(payment.match.householdCode);
  if (!staged || !household || ['imported', 'ignored'].includes(staged.status)) continue;
  await pb.collection('payment_import_staging').update(staged.id, {
    status: 'matched',
    matchedHousehold: household.id,
    reviewNotes: `Coincidencia automática conservadora: ${payment.match.reason}. Requiere revisión humana antes de distribuir pagos agrupados.`,
  });
  updated += 1;
}
console.log(JSON.stringify({ updated }));
