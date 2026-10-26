import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const historicalCensus = JSON.parse(
  fs.readFileSync(new URL('../api/_historical_census_data.json', import.meta.url), 'utf-8')
);

test('historical census starts clean without synthetic demo or Uroprofin records', () => {
  assert.equal(typeof historicalCensus, 'object');
  assert.equal(Object.keys(historicalCensus).length, 0);
  assert.equal(historicalCensus['12345678'], undefined);
  assert.equal(historicalCensus['27891234'], undefined);
});
