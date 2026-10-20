import test from 'node:test';
import assert from 'node:assert/strict';
import { residentExternalKey } from './census-lib.mjs';
import { can } from '../src/lib/permissions.js';
import { summarizePaymentRecords } from '../src/lib/paymentSummary.js';

test('la clave externa no contiene la cédula y se aísla por comuna', () => {
  const person = { idNumberNormalized: '12345678' };
  const first = residentExternalKey(person, { communityCode: 'URP-001', fingerprintKey: 'clave-de-prueba-uno' });
  const repeated = residentExternalKey(person, { communityCode: 'URP-001', fingerprintKey: 'clave-de-prueba-uno' });
  const otherCommunity = residentExternalKey(person, { communityCode: 'OTRA-001', fingerprintKey: 'clave-de-prueba-uno' });
  assert.equal(first, repeated);
  assert.equal(first.includes('12345678'), false);
  assert.notEqual(first, otherCommunity);
});

test('colaborador agrega y corrige, pero no elimina ni aprueba cortesías ni ve el censo completo', () => {
  assert.equal(can('collaborator', 'census.create'), true);
  assert.equal(can('collaborator', 'census.update'), true);
  assert.equal(can('collaborator', 'census.delete'), false);
  assert.equal(can('collaborator', 'courtesy.manage'), false);
  assert.equal(can('collaborator', 'census.view_all'), false);
  assert.equal(can('collaborator', 'census.analytics'), false);
  assert.equal(can('regular', 'census.view_all'), false);
  assert.equal(can('regular', 'census.analytics'), false);
});

test('solo correos autorizados pueden ver o exportar el censo completo como administrador', () => {
  const authorized = ['jesus.oquendo@gmail.com', 'rosa.acosta05@gmail.com', 'cesaroquendo10@gmail.com', 'kilby12lite@gmail.com'];
  for (const email of authorized) {
    assert.equal(can('admin', 'census.view_all', { email }), true);
    assert.equal(can('admin', 'census.export', { email }), true);
    assert.equal(can('admin', 'census.analytics', { email }), true);
  }
  const unauthorized = ['vecino@gmail.com', 'otro@gmail.com', 'alcaldia@miranda.gob.ve'];
  for (const email of unauthorized) {
    assert.equal(can('admin', 'census.view_all', { email }), false);
    assert.equal(can('admin', 'census.export', { email }), false);
    assert.equal(can('admin', 'census.analytics', { email }), false);
  }
});

test('los totales de pago separan monedas y excluyen rechazados o cancelados', () => {
  const summary = summarizePaymentRecords([
    { amount: 800, currency: 'VES', status: 'pending_review' },
    { amount: 10, currency: 'USD', status: 'verified' },
    { amount: 900, currency: 'VES', status: 'rejected' },
    { amount: 5, currency: 'USD', status: 'cancelled' },
  ]);
  assert.equal(summary.active.length, 2);
  assert.deepEqual(summary.totals, { VES: 800, USD: 10 });
  assert.equal(summary.statusCounts.rejected, 1);
});
