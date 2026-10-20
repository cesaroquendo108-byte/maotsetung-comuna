import { parseArgs } from 'node:util';
import { parseCensus, parsePayments, safeSummary } from './census-lib.mjs';

const { values } = parseArgs({ options: { census: { type: 'string' }, payments: { type: 'string' } } });
if (!values.census || !values.payments) {
  console.error('Uso: npm run census:inspect -- --census "ruta.xlsx" --payments "ruta.xlsx"');
  process.exitCode = 1;
} else {
  const [census, payments] = await Promise.all([parseCensus(values.census), parsePayments(values.payments)]);
  console.log(JSON.stringify(safeSummary(census, payments), null, 2));
}
