import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSummary } from './census-lib.mjs';
import { familyResidentStatus, importedResidentStatus, importBatchPayload } from './import-policy.mjs';

test('safeSummary nunca incluye PII', () => {
  const result = safeSummary(
    { summary: { residents: 10 }, communeNames: ['X'], councilNames: ['Y'], residents: [{ firstName: 'SECRETO' }] },
    { summary: { transactions: 2 }, payments: [{ payerName: 'SECRETO' }] },
  );
  assert.equal(JSON.stringify(result).includes('SECRETO'), false);
  assert.deepEqual(result, { census: { residents: 10 }, payments: { transactions: 2 }, communeCount: 1, councilCount: 1 });
});

test('un familiar sin hogar conciliado queda en revisión', () => {
  assert.equal(familyResidentStatus(false), 'review');
  assert.equal(familyResidentStatus(true), 'active');
});

test('un nombre historico incompleto se conserva sin inventar datos y queda en revision', () => {
  assert.equal(importedResidentStatus({ firstName: '', lastName: 'APELLIDO' }), 'review');
  assert.equal(importedResidentStatus({ firstName: 'NOMBRE', lastName: '' }), 'review');
  assert.equal(importedResidentStatus({ firstName: 'NOMBRE', lastName: 'APELLIDO' }), 'active');
});

test('el lote de importación se crea asociado a la comuna resuelta', () => {
  const payload = importBatchPayload({
    communityId: 'community12345',
    sourceFiles: ['censo.xlsx', 'pagos.xlsx'],
    summary: { census: { residents: 1 }, payments: { transactions: 1 } },
    importedBy: 'service1234567',
  });

  assert.equal(payload.community, 'community12345');
  assert.equal(payload.status, 'processing');
  assert.equal(payload.type, 'census_and_payments');
  assert.throws(() => importBatchPayload({ sourceFiles: [], summary: {}, importedBy: 'service1234567' }), /communityId es obligatorio/);
});
