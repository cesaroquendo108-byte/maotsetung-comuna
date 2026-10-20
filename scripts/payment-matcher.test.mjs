import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPaymentToHousehold, paymentNameTokens } from './payment-matcher.mjs';

const households = new Map([
  ['h1', { code: 'URP-01-001' }],
  ['h2', { code: 'URP-01-002' }],
]);
const residents = [
  { firstName: 'Edgar Domingo', lastName: 'Bustamante', householdExternalKey: 'h1' },
  { firstName: 'Freddy', lastName: 'Troconis', householdExternalKey: 'h1' },
  { firstName: 'Nuris', lastName: 'Troconis', householdExternalKey: 'h2' },
];

test('normaliza acentos, conectores y tratamientos', () => {
  assert.deepEqual(paymentNameTokens('Sra. José y mamá'), ['JOSE']);
});

test('concilia nombre y apellido completos con un solo hogar', () => {
  assert.deepEqual(
    matchPaymentToHousehold({ payerName: 'edgar bustamante' }, residents, households),
    { matched: true, reason: 'full_token_match', householdCode: 'URP-01-001', candidateCount: 1 },
  );
});

test('no atribuye un apellido presente en hogares distintos', () => {
  const result = matchPaymentToHousehold({ payerName: 'troconis' }, residents, households);
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'ambiguous_household');
});

test('no atribuye filas sin pagador', () => {
  assert.equal(matchPaymentToHousehold({ payerName: '' }, residents, households).reason, 'missing_payer_name');
});
