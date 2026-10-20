import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';
import {
  calculateAge,
  parseUroprofinWorkbook,
  safeCensusSummary,
  stableZoneCode,
} from './uroprofin-census-lib.mjs';

function row(family, declared, person, id, name, surname, phone, birth = '1980-01-01', age = 37) {
  const cells = Array(32).fill(null);
  cells[0] = family;
  cells[4] = declared;
  cells[5] = person;
  cells[6] = 'V';
  cells[7] = id;
  cells[8] = name;
  cells[9] = surname;
  cells[11] = 'F';
  cells[12] = birth;
  cells[13] = age;
  cells[16] = person === 1 ? 'JEFE DE FAMILIA' : 'HIJO';
  cells[17] = phone;
  return cells;
}

test('uses stable editable zone codes', () => {
  assert.equal(stableZoneCode('PORTON GRIS'), 'PG');
  assert.equal(stableZoneCode('RECTA FARM1,1'), 'RF1B');
  assert.equal(stableZoneCode('SUBIDA MORRO8'), 'SM8');
});

test('calculates current age from birth date, not historical source age', () => {
  assert.equal(calculateAge('2000-08-13', new Date('2026-08-13T00:00:00Z')), 26);
  assert.equal(calculateAge('', new Date('2026-08-13T00:00:00Z')), null);
});

test('parses families, people, mismatches and shared-phone review cases idempotently', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uroprofin-census-test-'));
  const file = path.join(directory, 'sample.xlsx');
  const header = Array(32).fill(null);
  header[0] = 'N° FAMILIA';
  header[4] = 'NUMERO DE PERSONAS EN EL GRUPO FAMILIAR';
  header[5] = 'N° PERSONAS';
  header[7] = 'CEDULA';
  header[8] = 'NOMBRE';
  header[9] = 'APELLIDO';
  const book = XLSX.utils.book_new();
  const rows = [
    ['SECTOR: TEST'], [], [], [], [], [], header,
    row(1, 1, 1, '100', 'ANA', 'UNO', '04120000000'),
    row(null, null, 2, '101', 'LUIS', 'UNO', '04120000000'),
    row(2, 1, 1, '100', 'ANA', 'DOS', '04120000001'),
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'PORTON GRIS');
  XLSX.writeFile(book, file);

  const first = parseUroprofinWorkbook(file, { communityCode: 'URP-001', fingerprintKey: 'test-key', sourceAsOf: new Date('2017-03-30T00:00:00Z') });
  const second = parseUroprofinWorkbook(file, { communityCode: 'URP-001', fingerprintKey: 'test-key', sourceAsOf: new Date('2017-03-30T00:00:00Z') });
  assert.deepEqual(safeCensusSummary(first), safeCensusSummary(second));
  assert.equal(first.summary.zones, 1);
  assert.equal(first.summary.families, 2);
  assert.equal(first.summary.people, 3);
  assert.equal(first.summary.declaredTotalMismatches, 1);
  assert.equal(first.summary.duplicateValidIds, 1);
  assert.equal(first.summary.sharedPhones, 1);
  assert.deepEqual(first.people.map((person) => person.externalKey), second.people.map((person) => person.externalKey));

  await fs.rm(directory, { recursive: true, force: true });
});
