import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const historicalCensus = JSON.parse(
  fs.readFileSync(new URL('../api/_historical_census_data.json', import.meta.url), 'utf-8')
);

test('historical census contains valid records for Comuna Mao Tse Tung', () => {
  assert.ok(Object.keys(historicalCensus).length >= 5);
});

test('historical census finds David Hernandez (27891234) accurately', () => {
  const record = historicalCensus['27891234'];
  assert.ok(record, 'David Hernandez record must exist');
  assert.equal(record.idNumberNormalized, '27891234');
  assert.equal(record.firstName, 'DAVID');
  assert.equal(record.lastName, 'HERNANDEZ');
  assert.equal(record.sex, 'M');
  assert.equal(record.birthDate, '2001-05-14');
  assert.equal(record.communityCode, 'MTT-001');
  assert.equal(record.zoneCode, 'CC-SAC');
});

test('historical census finds Carmen Elena Perez (14567890) from El Manguito', () => {
  const record = historicalCensus['14567890'];
  assert.ok(record, 'Carmen Perez record must exist');
  assert.equal(record.idNumberNormalized, '14567890');
  assert.equal(record.firstName, 'CARMEN ELENA');
  assert.equal(record.lastName, 'PEREZ');
  assert.equal(record.sex, 'F');
  assert.equal(record.zoneCode, 'CC-MNG');
});

test('historical census finds Carlos Rivas (18234567) and Maria Silva (12345678)', () => {
  const rivas = historicalCensus['18234567'];
  assert.ok(rivas, 'Carlos Rivas record must exist');
  assert.equal(rivas.firstName, 'CARLOS EDUARDO');
  assert.equal(rivas.zoneCode, 'CC-LCH');

  const silva = historicalCensus['12345678'];
  assert.ok(silva, 'Maria Silva record must exist');
  assert.equal(silva.firstName, 'MARIA EUGENIA');
  assert.equal(silva.zoneCode, 'CC-HDC');
});

test('historical census returns undefined for unrecorded cedula', () => {
  assert.equal(historicalCensus['9999999999'], undefined);
});
